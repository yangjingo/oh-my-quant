"""13F institutional consensus aggregation helpers."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import pandas as pd

ALIASES = {
    "ticker": ["ticker", "symbol", "security_ticker"],
    "issuer": ["issuer", "issuer_name", "name_of_issuer", "company", "security_name"],
    "manager_name": ["manager_name", "manager", "investor_name", "holder", "institution"],
    "manager_rank": ["manager_rank", "rank", "top_manager_rank", "aum_rank"],
    "market_value_usd": ["market_value_usd", "market_value", "value_usd", "value", "position_value"],
    "shares": ["shares", "share_amount", "shares_held", "share_number"],
    "report_period": ["report_period", "quarter", "filing_period", "period", "period_of_report"],
    "sector": ["sector", "gics_sector", "industry_group"],
    "theme": ["theme", "investment_theme"],
    "ret_5d": ["ret_5d", "return_5d"],
    "ret_20d": ["ret_20d", "return_20d"],
    "ret_60d": ["ret_60d", "return_60d"],
    "put_call": ["put_call", "putCall", "option_type"],
}

NUMERIC_COLUMNS = [
    "manager_rank",
    "market_value_usd",
    "shares",
    "ret_5d",
    "ret_20d",
    "ret_60d",
]

RISK_NOTES = [
    "13F 披露有滞后，不代表机构当前仓位。",
    "13F 主要反映多头持仓，看不到完整对冲、空头和场外衍生品。",
    "季内调仓路径不可见，新增不等于当前仍在持有。",
    "样本通常来自头部管理人，存在样本选择偏差。",
    "热门大市值股票更容易形成人数共识，不应直接等同于超额收益。",
]


def load_table(path: Path) -> pd.DataFrame:
    """Load rows from csv/json/jsonl/parquet."""
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(path)
    if suffix == ".jsonl":
        return pd.read_json(path, lines=True)
    if suffix == ".parquet":
        return pd.read_parquet(path)
    if suffix == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            return pd.DataFrame(payload)
        if isinstance(payload, dict):
            for key in ("data", "rows", "items", "results", "holdings"):
                value = payload.get(key)
                if isinstance(value, list):
                    return pd.DataFrame(value)
        raise ValueError(f"Unsupported JSON payload in {path}")
    raise ValueError(f"Unsupported file type: {path.suffix}")


def first_present(frame: pd.DataFrame, names: list[str]) -> str | None:
    """Return the first matching column name."""
    for name in names:
        if name in frame.columns:
            return name
    return None


def first_non_empty(values: pd.Series) -> str:
    """Return the first non-empty string."""
    for value in values.fillna(""):
        text = str(value).strip()
        if text and text.upper() != "NAN":
            return text
    return ""


def join_unique(values: pd.Series, limit: int = 8) -> str:
    """Join unique strings with a bounded length."""
    seen = []
    for value in values.fillna(""):
        text = str(value).strip()
        if text and text not in seen:
            seen.append(text)
    return ", ".join(seen[:limit])


def rank_weight(rank: float) -> float:
    """Weight higher-ranked managers more heavily."""
    if pd.isna(rank) or rank <= 0:
        return 0.0
    return 1.0 / math.sqrt(float(rank))


def empty_frame() -> pd.DataFrame:
    """Return an empty normalized holdings frame."""
    return pd.DataFrame(columns=list(ALIASES))


def standardize(frame: pd.DataFrame) -> pd.DataFrame:
    """Normalize columns and filter option rows."""
    if frame.empty:
        return empty_frame()

    renamed = {}
    for canonical, aliases in ALIASES.items():
        match = first_present(frame, aliases)
        if match and canonical not in frame.columns:
            renamed[match] = canonical
    data = frame.rename(columns=renamed).copy()

    for column in ALIASES:
        if column not in data.columns:
            data[column] = pd.NA

    for column in NUMERIC_COLUMNS:
        data[column] = pd.to_numeric(data[column], errors="coerce")

    data["ticker"] = data["ticker"].astype(str).str.upper().str.strip()
    data["issuer"] = data["issuer"].fillna("").astype(str).str.strip()
    data["manager_name"] = data["manager_name"].fillna("").astype(str).str.strip()
    data["report_period"] = data["report_period"].fillna("").astype(str).str.strip()
    data["sector"] = data["sector"].fillna("").astype(str).str.strip()
    data["theme"] = data["theme"].fillna("").astype(str).str.strip()
    data["put_call"] = data["put_call"].fillna("").astype(str).str.upper().str.strip()

    data = data[~data["put_call"].isin({"PUT", "CALL"})]
    data = data[data["ticker"].ne("") & data["ticker"].ne("NAN")]
    data = data[data["manager_name"].ne("")]
    data["manager_rank"] = data["manager_rank"].fillna(9999.0)
    data["market_value_usd"] = data["market_value_usd"].fillna(0.0)
    data["shares"] = data["shares"].fillna(0.0)

    data = data[list(ALIASES)].drop_duplicates(
        subset=["report_period", "manager_name", "ticker"],
        keep="last",
    )
    return data.reset_index(drop=True)


def aggregate_consensus(frame: pd.DataFrame) -> pd.DataFrame:
    """Aggregate rows into one record per ticker."""
    if frame.empty:
        return pd.DataFrame(
            columns=[
                "ticker",
                "issuer",
                "holder_count",
                "weighted_holder_score",
                "total_value_usd",
                "total_shares",
                "manager_names",
                "sector",
                "theme",
                "ret_5d",
                "ret_20d",
                "ret_60d",
                "consensus_rank",
            ]
        )

    working = frame.copy()
    working["manager_weight"] = working["manager_rank"].apply(rank_weight)

    grouped = working.groupby("ticker", dropna=False)
    summary = grouped.agg(
        issuer=("issuer", first_non_empty),
        holder_count=("manager_name", lambda s: s.nunique()),
        weighted_holder_score=("manager_weight", "sum"),
        total_value_usd=("market_value_usd", "sum"),
        total_shares=("shares", "sum"),
        manager_names=("manager_name", join_unique),
        sector=("sector", first_non_empty),
        theme=("theme", first_non_empty),
        ret_5d=("ret_5d", "mean"),
        ret_20d=("ret_20d", "mean"),
        ret_60d=("ret_60d", "mean"),
    ).reset_index()

    return rank_consensus(summary)


def rank_consensus(frame: pd.DataFrame) -> pd.DataFrame:
    """Sort and assign consensus ranks."""
    if frame.empty:
        frame["consensus_rank"] = pd.Series(dtype="float64")
        return frame

    ranked = frame.sort_values(
        ["holder_count", "weighted_holder_score", "total_value_usd"],
        ascending=[False, False, False],
    ).reset_index(drop=True)
    ranked["consensus_rank"] = ranked.index + 1
    return ranked


def merge_periods(current: pd.DataFrame, previous: pd.DataFrame) -> pd.DataFrame:
    """Merge current and previous consensus snapshots."""
    current_agg = aggregate_consensus(current)
    previous_agg = aggregate_consensus(previous)

    current_ranked = current_agg.rename(
        columns={column: f"current_{column}" for column in current_agg.columns if column != "ticker"}
    )
    previous_ranked = previous_agg.rename(
        columns={column: f"previous_{column}" for column in previous_agg.columns if column != "ticker"}
    )

    merged = current_ranked.merge(previous_ranked, on="ticker", how="outer")
    merged["issuer"] = merged["current_issuer"].where(
        merged["current_issuer"].fillna("").astype(str).str.strip().ne(""),
        merged["previous_issuer"],
    )
    merged["sector"] = merged["current_sector"].where(
        merged["current_sector"].fillna("").astype(str).str.strip().ne(""),
        merged["previous_sector"],
    )
    merged["theme"] = merged["current_theme"].where(
        merged["current_theme"].fillna("").astype(str).str.strip().ne(""),
        merged["previous_theme"],
    )

    numeric_columns = [
        "current_holder_count",
        "current_weighted_holder_score",
        "current_total_value_usd",
        "current_total_shares",
        "current_ret_5d",
        "current_ret_20d",
        "current_ret_60d",
        "current_consensus_rank",
        "previous_holder_count",
        "previous_weighted_holder_score",
        "previous_total_value_usd",
        "previous_total_shares",
        "previous_ret_5d",
        "previous_ret_20d",
        "previous_ret_60d",
        "previous_consensus_rank",
    ]
    for column in numeric_columns:
        if column in merged.columns:
            merged[column] = pd.to_numeric(merged[column], errors="coerce")

    for column in [
        "current_holder_count",
        "current_weighted_holder_score",
        "current_total_value_usd",
        "current_total_shares",
        "previous_holder_count",
        "previous_weighted_holder_score",
        "previous_total_value_usd",
        "previous_total_shares",
    ]:
        merged[column] = merged[column].fillna(0.0)

    merged["holder_delta"] = merged["current_holder_count"] - merged["previous_holder_count"]
    merged["weighted_score_delta"] = (
        merged["current_weighted_holder_score"] - merged["previous_weighted_holder_score"]
    )
    merged["value_delta_usd"] = merged["current_total_value_usd"] - merged["previous_total_value_usd"]
    merged["value_delta_pct"] = merged["value_delta_usd"] / merged["previous_total_value_usd"].replace(0, pd.NA)

    return merged.sort_values(
        ["current_consensus_rank", "previous_consensus_rank", "ticker"],
        ascending=[True, True, True],
        na_position="last",
    ).reset_index(drop=True)


def summarize_dimension(frame: pd.DataFrame, column: str) -> pd.DataFrame:
    """Summarize sector or theme concentration."""
    usable = frame[frame[column].fillna("").astype(str).str.strip().ne("")].copy()
    if usable.empty:
        return pd.DataFrame(columns=[column, "ticker_count", "holder_sum", "weighted_score_sum"])

    grouped = usable.groupby(column, dropna=False).agg(
        ticker_count=("ticker", "nunique"),
        holder_sum=("current_holder_count", "sum"),
        weighted_score_sum=("current_weighted_holder_score", "sum"),
    ).reset_index()

    return grouped.sort_values(
        ["ticker_count", "weighted_score_sum"],
        ascending=[False, False],
    ).reset_index(drop=True)


def detect_new_entries(frame: pd.DataFrame, top_n: int) -> pd.DataFrame:
    """Names entering the current top-N consensus list."""
    mask = (
        frame["current_consensus_rank"].notna()
        & (frame["current_consensus_rank"] <= top_n)
        & (frame["previous_consensus_rank"].isna() | (frame["previous_consensus_rank"] > top_n))
    )
    return frame[mask].sort_values("current_consensus_rank").reset_index(drop=True)


def detect_exits(frame: pd.DataFrame, top_n: int) -> pd.DataFrame:
    """Names leaving the previous top-N consensus list."""
    mask = (
        frame["previous_consensus_rank"].notna()
        & (frame["previous_consensus_rank"] <= top_n)
        & (frame["current_consensus_rank"].isna() | (frame["current_consensus_rank"] > top_n))
    )
    return frame[mask].sort_values("previous_consensus_rank").reset_index(drop=True)


def format_value(value: object, kind: str) -> str:
    """Format values for markdown tables."""
    if pd.isna(value):
        return "-"
    if kind == "int":
        return f"{int(round(float(value)))}"
    if kind == "float":
        return f"{float(value):.2f}"
    if kind == "pct":
        return f"{float(value):.1%}"
    if kind == "usd":
        return f"${float(value) / 1_000_000_000:.2f}B"
    return str(value)


def markdown_table(frame: pd.DataFrame, columns: list[str], formats: dict[str, str]) -> str:
    """Render a small markdown table without external dependencies."""
    if frame.empty:
        return "_No rows._"

    headers = "|" + "|".join(columns) + "|"
    sep = "|" + "|".join(["---"] * len(columns)) + "|"
    lines = [headers, sep]
    for _, row in frame.iterrows():
        cells = [format_value(row.get(column), formats.get(column, "text")) for column in columns]
        lines.append("|" + "|".join(cells) + "|")
    return "\n".join(lines)


def infer_period(frame: pd.DataFrame, fallback: str) -> str:
    """Infer the dominant report period label."""
    if frame.empty or "report_period" not in frame.columns:
        return fallback
    values = frame["report_period"].dropna().astype(str).str.strip()
    values = values[values.ne("")]
    if values.empty:
        return fallback
    return values.mode().iloc[0]


def build_report(comparison: pd.DataFrame, current_label: str, previous_label: str, top_n: int) -> str:
    """Build a markdown report."""
    current_top = comparison[comparison["current_consensus_rank"].notna()].sort_values("current_consensus_rank").head(top_n)
    additions = comparison[comparison["current_holder_count"] > 0].sort_values(
        ["holder_delta", "weighted_score_delta", "current_holder_count", "current_total_value_usd"],
        ascending=[False, False, False, False],
    ).head(top_n)
    new_entries = detect_new_entries(comparison, top_n)
    exits = detect_exits(comparison, top_n)

    common = comparison[
        comparison["current_consensus_rank"].notna() & comparison["previous_consensus_rank"].notna()
    ].copy()
    strength_up = common.sort_values(
        ["weighted_score_delta", "holder_delta"],
        ascending=[False, False],
    ).head(10)
    strength_down = common.sort_values(
        ["weighted_score_delta", "holder_delta"],
        ascending=[True, True],
    ).head(10)

    sectors = summarize_dimension(current_top, "sector")
    themes = summarize_dimension(current_top, "theme")

    lines = [f"# 13F 机构共识报告：{current_label} vs {previous_label}", ""]
    lines.extend(
        [
            "## 本季共识加仓 Top 20",
            markdown_table(
                additions[
                    [
                        "ticker",
                        "issuer",
                        "current_holder_count",
                        "holder_delta",
                        "current_weighted_holder_score",
                        "weighted_score_delta",
                        "current_total_value_usd",
                    ]
                ],
                [
                    "ticker",
                    "issuer",
                    "current_holder_count",
                    "holder_delta",
                    "current_weighted_holder_score",
                    "weighted_score_delta",
                    "current_total_value_usd",
                ],
                {
                    "current_holder_count": "int",
                    "holder_delta": "int",
                    "current_weighted_holder_score": "float",
                    "weighted_score_delta": "float",
                    "current_total_value_usd": "usd",
                },
            ),
            "",
            "## 新进入榜单",
            markdown_table(
                new_entries[["ticker", "issuer", "current_consensus_rank", "previous_consensus_rank", "current_holder_count"]],
                ["ticker", "issuer", "current_consensus_rank", "previous_consensus_rank", "current_holder_count"],
                {
                    "current_consensus_rank": "int",
                    "previous_consensus_rank": "int",
                    "current_holder_count": "int",
                },
            ),
            "",
            "## 退出榜单",
            markdown_table(
                exits[["ticker", "issuer", "previous_consensus_rank", "current_consensus_rank", "previous_holder_count"]],
                ["ticker", "issuer", "previous_consensus_rank", "current_consensus_rank", "previous_holder_count"],
                {
                    "previous_consensus_rank": "int",
                    "current_consensus_rank": "int",
                    "previous_holder_count": "int",
                },
            ),
            "",
            "## 共识强度变化",
            "### 上升最快",
            markdown_table(
                strength_up[
                    [
                        "ticker",
                        "issuer",
                        "previous_consensus_rank",
                        "current_consensus_rank",
                        "holder_delta",
                        "weighted_score_delta",
                    ]
                ],
                [
                    "ticker",
                    "issuer",
                    "previous_consensus_rank",
                    "current_consensus_rank",
                    "holder_delta",
                    "weighted_score_delta",
                ],
                {
                    "previous_consensus_rank": "int",
                    "current_consensus_rank": "int",
                    "holder_delta": "int",
                    "weighted_score_delta": "float",
                },
            ),
            "",
            "### 下降最快",
            markdown_table(
                strength_down[
                    [
                        "ticker",
                        "issuer",
                        "previous_consensus_rank",
                        "current_consensus_rank",
                        "holder_delta",
                        "weighted_score_delta",
                    ]
                ],
                [
                    "ticker",
                    "issuer",
                    "previous_consensus_rank",
                    "current_consensus_rank",
                    "holder_delta",
                    "weighted_score_delta",
                ],
                {
                    "previous_consensus_rank": "int",
                    "current_consensus_rank": "int",
                    "holder_delta": "int",
                    "weighted_score_delta": "float",
                },
            ),
            "",
            "## 近期市场表现",
            markdown_table(
                current_top[["ticker", "issuer", "current_ret_5d", "current_ret_20d", "current_ret_60d"]],
                ["ticker", "issuer", "current_ret_5d", "current_ret_20d", "current_ret_60d"],
                {
                    "current_ret_5d": "pct",
                    "current_ret_20d": "pct",
                    "current_ret_60d": "pct",
                },
            ),
            "",
            "## 行业和主题总结",
            "### 行业",
            markdown_table(
                sectors,
                ["sector", "ticker_count", "holder_sum", "weighted_score_sum"],
                {"ticker_count": "int", "holder_sum": "int", "weighted_score_sum": "float"},
            ),
            "",
            "### 主题",
            markdown_table(
                themes,
                ["theme", "ticker_count", "holder_sum", "weighted_score_sum"],
                {"ticker_count": "int", "holder_sum": "int", "weighted_score_sum": "float"},
            ),
            "",
            "## 13F 风险提示",
        ]
    )
    lines.extend([f"- {note}" for note in RISK_NOTES])
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    """CLI parser."""
    parser = argparse.ArgumentParser(description="Build a 13F institutional consensus report.")
    parser.add_argument("--current", required=True, type=Path, help="Current-quarter holdings table")
    parser.add_argument("--previous", required=True, type=Path, help="Previous-quarter holdings table")
    parser.add_argument("--output", required=True, type=Path, help="Markdown report output path")
    parser.add_argument("--csv-output", type=Path, help="Optional merged comparison CSV path")
    parser.add_argument("--current-label", help="Override current-period label")
    parser.add_argument("--previous-label", help="Override previous-period label")
    parser.add_argument("--top-n", type=int, default=20, help="Consensus leaderboard size")
    return parser.parse_args()


def main() -> None:
    """Entry point."""
    args = parse_args()
    current = standardize(load_table(args.current))
    previous = standardize(load_table(args.previous))

    comparison = merge_periods(current, previous)
    current_label = args.current_label or infer_period(current, "当前季度")
    previous_label = args.previous_label or infer_period(previous, "上一季度")

    report = build_report(comparison, current_label, previous_label, args.top_n)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(report, encoding="utf-8")

    if args.csv_output:
        args.csv_output.parent.mkdir(parents=True, exist_ok=True)
        comparison.to_csv(args.csv_output, index=False)


if __name__ == "__main__":
    main()
