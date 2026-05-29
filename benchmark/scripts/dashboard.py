"""Benchmark Dashboard — 统计看板，聚合 benchmark/results/ 下的评测结果"""

import json
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

RESULTS_DIR = Path(__file__).resolve().parents[1] / "results"


def collect_results() -> pd.DataFrame:
    """收集所有测评结果 JSON，返回汇总 DataFrame"""
    rows = []
    if not RESULTS_DIR.exists():
        return pd.DataFrame()
    for f in sorted(RESULTS_DIR.glob("*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            src = data.get("source", {})
            strategy_src = src.get("strategy", {})
            bench_src = src.get("benchmark", {})
            rows.append({
                "strategy": data.get("strategy", f.stem),
                "date": data.get("date", ""),
                "symbol": data.get("symbol", ""),
                "benchmark_symbol": data.get("benchmark_symbol", ""),
                "total_score": data.get("total_score", 0),
                "grade": data.get("grade", "?"),
                "return_score": data.get("return_score", 0),
                "risk_score": data.get("risk_score", 0),
                "robustness_score": data.get("robustness_score", 0),
                "cagr": data.get("details", {}).get("cagr", 0),
                "sharpe": data.get("details", {}).get("sharpe", 0),
                "max_drawdown": data.get("details", {}).get("max_drawdown", 0),
                "strategy_fetcher": strategy_src.get("fetcher", "unknown"),
                "strategy_market": strategy_src.get("market", "?"),
                "benchmark_fetcher": bench_src.get("fetcher", "unknown"),
                "benchmark_market": bench_src.get("market", "?"),
            })
        except Exception as e:
            print(f"  warn: skip {f.name}: {e}")
    return pd.DataFrame(rows)


def summary(df: pd.DataFrame) -> dict:
    """生成摘要统计"""
    if df.empty:
        return {"total_evals": 0, "message": "无评测结果"}

    grade_counts = df["grade"].value_counts().to_dict()
    source_counts = df["strategy_fetcher"].value_counts().to_dict() if "strategy_fetcher" in df.columns else {}
    return {
        "total_evals": len(df),
        "avg_score": round(df["total_score"].mean(), 1),
        "median_score": round(df["total_score"].median(), 1),
        "best_strategy": df.loc[df["total_score"].idxmax(), "strategy"],
        "best_score": round(df["total_score"].max(), 1),
        "grade_distribution": {g: grade_counts.get(g, 0) for g in "SABCD"},
        "avg_sharpe": round(df["sharpe"].mean(), 2),
        "avg_max_dd": round(df["max_drawdown"].mean(), 4),
        "source_distribution": source_counts,
        "last_updated": datetime.now().isoformat(),
    }


def dashboard() -> str:
    """生成看板文本"""
    df = collect_results()
    s = summary(df)

    lines = [
        "=" * 55,
        "  Benchmark Dashboard",
        "=" * 55,
        f"  评测总数: {s['total_evals']}",
    ]
    if s["total_evals"] == 0:
        lines.append("  状态: 暂无评测结果，运行 whyj-quant benchmark run 添加")
        lines.append("=" * 55)
        return "\n".join(lines)

    lines.extend([
        f"  平均得分: {s['avg_score']}/100 | 中位数: {s['median_score']}/100",
        f"  最高得分: {s['best_score']} ({s['best_strategy']})",
        f"  平均夏普: {s['avg_sharpe']}  平均最大回撤: {s['avg_max_dd']:.2%}",
        "",
        "  评级分布:",
    ])
    for g in "SABCD":
        bar = "█" * s["grade_distribution"][g]
        lines.append(f"    {g}: {bar} ({s['grade_distribution'][g]})")

    if s.get("source_distribution"):
        lines.append("")
        lines.append("  数据源分布:")
        for src, count in sorted(s["source_distribution"].items(), key=lambda x: -x[1]):
            lines.append(f"    {src}: {count}")

    lines.append("")
    lines.append(f"  最近更新: {s['last_updated']}")
    lines.append("=" * 55)

    # 策略排名
    if not df.empty:
        lines.append("\n  策略排名 Top 10:")
        top = df.nlargest(10, "total_score")[
            ["strategy", "total_score", "grade", "sharpe", "max_drawdown", "strategy_fetcher"]
        ]
        for _, row in top.iterrows():
            fetcher = row.get("strategy_fetcher", "?")
            lines.append(
                f"    {row['strategy']:<30} {row['total_score']:>5.0f} ({row['grade']})  "
                f"sharpe={row['sharpe']:.1f}  dd={row['max_drawdown']:.2%}  [{fetcher}]"
            )

    return "\n".join(lines)


if __name__ == "__main__":
    print(dashboard())
