"""Quarterly fund performance tracker.

Usage:
    python skills/portfolio/scripts/quarterly.py            # capture current quarter
    python skills/portfolio/scripts/quarterly.py --review   # print all historical quarters
"""

import json
from datetime import datetime
from pathlib import Path

import pandas as pd

SKILL_DIR = Path(__file__).resolve().parent.parent  # skills/portfolio/
HOLDINGS_FILE = SKILL_DIR / "holdings.json"
QUARTERLY_FILE = SKILL_DIR / "quarterly.json"


def current_quarter_key() -> str:
    now = datetime.now()
    q = (now.month - 1) // 3 + 1
    return f"{now.year}-Q{q}"


def current_quarter_start() -> datetime:
    now = datetime.now()
    q = (now.month - 1) // 3
    return datetime(now.year, q * 3 + 1, 1)


def load_holdings() -> list[dict]:
    return json.loads(HOLDINGS_FILE.read_text(encoding="utf-8"))["funds"]


def load_quarterly() -> dict:
    if QUARTERLY_FILE.exists():
        return json.loads(QUARTERLY_FILE.read_text(encoding="utf-8"))
    return {"quarters": {}}


def save_quarterly(data: dict):
    QUARTERLY_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def fetch_quarterly_nav(code: str, quarter_start: datetime) -> pd.DataFrame:
    """Fetch NAV history and isolate the current quarter."""
    import akshare as ak

    df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
    df["净值日期"] = pd.to_datetime(df["净值日期"])
    df = df.sort_values("净值日期").reset_index(drop=True)

    # Filter to current quarter
    mask = df["净值日期"] >= pd.Timestamp(quarter_start)
    df_q = df[mask].copy()
    return df_q


def capture_quarter() -> dict:
    """Capture quarterly snapshot for all holdings."""
    quarter_key = current_quarter_key()
    quarter_start = current_quarter_start()
    now = datetime.now()

    data = load_quarterly()

    if quarter_key in data["quarters"]:
        print(f"  {quarter_key} already captured, updating...")

    quarter_data = {
        "captured_at": now.strftime("%Y-%m-%d %H:%M:%S CST"),
        "quarter_start": quarter_start.strftime("%Y-%m-%d"),
        "quarter_end": now.strftime("%Y-%m-%d"),
        "funds": [],
    }

    funds = load_holdings()
    for f in funds:
        code = f["code"]
        try:
            nav = fetch_quarterly_nav(code, quarter_start)
            if nav.empty:
                print(f"  warn: {code} no data in {quarter_key}")
                continue

            start_nav = nav.iloc[0]["单位净值"]
            end_nav = nav.iloc[-1]["单位净值"]
            q_return = round((end_nav / start_nav - 1) * 100, 1)
            max_nav = nav["单位净值"].max()
            min_nav = nav["单位净值"].min()
            max_dd = round((min_nav / max_nav - 1) * 100, 1)

            fund_q = {
                "code": code,
                "name": f["name"],
                "start_nav": round(float(start_nav), 4),
                "end_nav": round(float(end_nav), 4),
                "end_date": nav.iloc[-1]["净值日期"].strftime("%Y-%m-%d"),
                "q_return_pct": q_return,
                "q_max_drawdown_pct": max_dd,
            }
            quarter_data["funds"].append(fund_q)
            print(f"  {code} {f['name']}: start={start_nav:.4f} end={end_nav:.4f} q_return={q_return:+.1f}% max_dd={max_dd:+.1f}%")

        except Exception as e:
            print(f"  error: {code} — {e}")

    # Compute aggregate
    if quarter_data["funds"]:
        returns = [f["q_return_pct"] for f in quarter_data["funds"]]
        quarter_data["avg_return_pct"] = round(sum(returns) / len(returns), 1)
        quarter_data["best"] = max(quarter_data["funds"], key=lambda x: x["q_return_pct"])["name"]
        quarter_data["worst"] = min(quarter_data["funds"], key=lambda x: x["q_return_pct"])["name"]

    data["quarters"][quarter_key] = quarter_data
    return data


def review():
    """Print all historical quarters."""
    data = load_quarterly()
    if not data["quarters"]:
        print("No quarterly data yet. Run without --review to capture.")
        return

    print("=" * 72)
    print("  Fund Portfolio — Quarterly Review")
    print("=" * 72)

    for qk in sorted(data["quarters"].keys()):
        q = data["quarters"][qk]
        print(f"\n── {qk} (captured {q['captured_at']}) ──")
        print(f"  avg: {q.get('avg_return_pct', '—')}%  |  best: {q.get('best', '—')}  |  worst: {q.get('worst', '—')}")
        print(f"  {'Code':<8} {'Name':<22} {'Q Return':>8} {'Max DD':>8}")
        print(f"  {'─'*6}  {'─'*20}  {'─'*8}  {'─'*8}")
        for f in q["funds"]:
            sign = "+" if f["q_return_pct"] >= 0 else ""
            print(f"  {f['code']:<8} {f['name']:<22} {sign}{f['q_return_pct']:>6.1f}%  {f['q_max_drawdown_pct']:>7.1f}%")


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser(description="Quarterly fund performance tracker")
    p.add_argument("--review", action="store_true", help="Print all historical quarters")
    args = p.parse_args()

    if args.review:
        review()
    else:
        print(f"Capturing {current_quarter_key()} ...")
        data = capture_quarter()
        save_quarterly(data)
        print(f"\nSaved to {QUARTERLY_FILE}")
