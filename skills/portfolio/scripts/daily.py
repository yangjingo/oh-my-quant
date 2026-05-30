"""Daily fund NAV tracker — run every day to accumulate NAV history locally.

Usage:
    python skills/portfolio/scripts/daily.py              # capture today's NAV (v1)
    python skills/portfolio/scripts/daily.py --holdings v2-semicon  # 方案A
    python skills/portfolio/scripts/daily.py --holdings v2-kc50    # 方案B
    python skills/portfolio/scripts/daily.py --review      # print daily log (v1)
    python skills/portfolio/scripts/daily.py --review --holdings v2-semicon
    python skills/portfolio/scripts/daily.py --review 022364  # single fund
    python skills/portfolio/scripts/daily.py --review --days 30  # last N days
"""

import hashlib
import json
from datetime import datetime, timedelta
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent  # skills/portfolio/
DATA_DIR = SKILL_DIR / "data"

HOLDINGS_MAP = {
    None: ("holdings.json", "daily.json"),
    "v1": ("holdings.json", "daily.json"),
    "v2-semicon": ("holdings_v2_semicon.json", "daily_v2_semicon.json"),
    "v2-kc50": ("holdings_v2_kc50.json", "daily_v2_kc50.json"),
}

_holdings_file = DATA_DIR / "holdings.json"
_daily_file = SKILL_DIR / "daily.json"


def set_variant(variant: str | None):
    global _holdings_file, _daily_file
    hf, df = HOLDINGS_MAP.get(variant, HOLDINGS_MAP[None])
    _holdings_file = DATA_DIR / hf
    _daily_file = SKILL_DIR / df


def load_holdings() -> list[dict]:
    data = json.loads(_holdings_file.read_text(encoding="utf-8"))
    return [f for f in data["funds"] if not f["code"].startswith("_")]


def load_daily() -> dict:
    if _daily_file.exists():
        return json.loads(_daily_file.read_text(encoding="utf-8"))
    return {"funds": {}, "dates": []}


def save_daily(data: dict):
    _daily_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def fetch_nav_today(code: str, today: str) -> tuple[str | None, float | None, float | None]:
    """Fetch latest NAV and daily change for one fund."""
    import akshare as ak

    try:
        df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
        df["净值日期"] = df["净值日期"].astype(str)
        latest = df.iloc[-1]

        nav = round(float(latest["单位净值"]), 4)
        chg = round(float(latest["日增长率"]), 2) if "日增长率" in df.columns else None
        nav_date = str(latest["净值日期"])
        return nav_date, nav, chg
    except Exception as e:
        print(f"  warn: {code} — {e}")
        return None, None, None


def capture_today():
    """Capture daily NAV snapshot for all holdings."""
    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")

    data = load_daily()

    if today_str in data.get("dates", []):
        print(f"  {today_str} already captured, updating...")

    entry = {"date": today_str, "captured_at": now.strftime("%H:%M:%S CST"), "funds": {}}

    funds = load_holdings()
    for f in funds:
        code = f["code"]
        nav_date, nav, chg = fetch_nav_today(code, today_str)
        if nav is not None:
            entry["funds"][code] = {"nav": nav, "chg_pct": chg, "nav_date": nav_date}
            chg_str = f"{chg:+.2f}%" if chg else "—"
            print(f"  {code} {f['name']}: {nav} ({chg_str})")

    # Initialize fund history if needed
    for f in funds:
        if f["code"] not in data["funds"]:
            data["funds"][f["code"]] = []

    # Append today's data per fund
    for code, info in entry["funds"].items():
        data["funds"][code].append({
            "date": today_str,
            "nav": info["nav"],
            "chg_pct": info["chg_pct"],
            "nav_date": info["nav_date"],
        })

    # Track date list for dedup
    if today_str not in data.get("dates", []):
        if "dates" not in data:
            data["dates"] = []
        data["dates"].append(today_str)
        data["dates"].sort()

    data["last_updated"] = now.strftime("%Y-%m-%d %H:%M:%S CST")
    return data


def review(code: str = None, days: int = 14):
    """Print daily log."""
    data = load_daily()
    if not data.get("funds"):
        print("No daily data yet. Run without --review to capture.")
        return

    funds = load_holdings()
    codes = [code] if code else [f["code"] for f in funds]
    name_map = {f["code"]: f["name"] for f in funds}

    for c in codes:
        history = data["funds"].get(c, [])[-days:]
        if not history:
            print(f"\n  {c}: no data")
            continue

        print(f"\n── {c} {name_map.get(c, '')} (last {len(history)} days) ──")
        print(f"  {'Date':<12} {'NAV':>8} {'Chg%':>8}")
        for entry in history:
            chg = f"{entry['chg_pct']:+.2f}%" if entry.get("chg_pct") is not None else "—"
            print(f"  {entry['date']:<12} {entry['nav']:>8.4f} {chg:>8}")


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser(description="Daily fund NAV tracker")
    p.add_argument("--holdings", default=None, choices=[None, "v1", "v2-semicon", "v2-kc50"],
                   help="Holdings variant (default: v1)")
    p.add_argument("--review", action="store_true", help="Print daily log")
    p.add_argument("--days", type=int, default=14, help="Days to show in review")
    p.add_argument("code", nargs="?", default=None, help="Fund code for single review")
    args = p.parse_args()

    set_variant(args.holdings)

    if args.review:
        review(code=args.code, days=args.days)
    else:
        print(f"Capturing {datetime.now().strftime('%Y-%m-%d')} [{args.holdings or 'v1'}] ...")
        holdings = load_holdings()
        data = capture_today()
        save_daily(data)
        # Print holdings hash for tracking
        h = hashlib.sha256(
            json.dumps({'codes': sorted([f['code'] for f in holdings if not f['code'].startswith('_')]), 'version': args.holdings or 'v1'}, sort_keys=True).encode()
        ).hexdigest()[:12]
        print(f"Saved to {_daily_file}  (holdings hash: {h})")
