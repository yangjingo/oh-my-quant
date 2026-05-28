"""Portfolio dashboard generator.

Fetch NAV via AKShare → sample for charting → inject into ECharts template → output HTML.

Usage:
    python skills/portfolio/scripts/generate.py              # full refresh
    python skills/portfolio/scripts/generate.py --no-fetch   # reuse cached NAV
"""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime
from pathlib import Path

import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
ROOT = SKILL_DIR.parents[1]
DATA_DIR = SKILL_DIR / "data"
TEMPLATE_DIR = SKILL_DIR / "templates"
OUTPUT_FILE = SKILL_DIR / "portfolio.html"

FUND_LIST = [
    {"code": "022364", "name": "永赢科技智选发起A", "type": "偏股混合"},
    {"code": "016372", "name": "信澳匠心严选一年持有A", "type": "偏股混合", "lock": "1年"},
    {"code": "022184", "name": "富国全球科技互联网C", "type": "QDII股票"},
    {"code": "001986", "name": "前海开源人工智能主题", "type": "灵活混合"},
    {"code": "008021", "name": "华富人工智能ETF联接C", "type": "指数股票"},
    {"code": "673060", "name": "西部利得景瑞灵活A", "type": "灵活混合"},
    {"code": "040015", "name": "华安动态灵活配置A", "type": "灵活混合"},
]

SAMPLED_POINTS = 84  # ~1yr of weekly-ish chart points


# ---------------------------------------------------------------------------
# Data fetching
# ---------------------------------------------------------------------------

def fetch_fund_nav(code: str) -> pd.DataFrame:
    """Pull full NAV history from AKShare → 天天基金."""
    import akshare as ak

    try:
        df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
        df = df.rename(columns={"净值日期": "date", "单位净值": "nav", "日增长率": "daily_ret"})
        df["date"] = pd.to_datetime(df["date"])
        df["nav"] = pd.to_numeric(df["nav"], errors="coerce")
        return df.set_index("date").sort_index()
    except Exception as e:
        print(f"  skip {code}: {e}")
        return pd.DataFrame()


def fetch_all(no_fetch: bool = False) -> dict[str, dict]:
    """Fetch NAV for all funds. Uses cache if --no-fetch."""
    cache_file = DATA_DIR / "nav_full.json"
    if no_fetch and cache_file.exists():
        print(f"Loading cached: {cache_file}")
        return json.loads(cache_file.read_text(encoding="utf-8"))

    print("Fetching NAV data from AKShare ...")
    result = {}
    failed = []
    for i, f in enumerate(FUND_LIST):
        code = f["code"]
        print(f"  [{i+1}/{len(FUND_LIST)}] {code} {f['name']} ...", end=" ", flush=True)
        df = fetch_fund_nav(code)
        if df.empty:
            print("FAIL")
            failed.append(f["name"])
            continue
        # Normalize to 1.0
        base = df["nav"].iloc[0]
        series = (df["nav"] / base).dropna()
        result[f["name"]] = {str(d.date()): round(float(v), 6) for d, v in series.items()}
        print(f"ok ({len(series)} days)")
        time.sleep(0.3)

    if failed:
        print(f"\n  WARNING: {len(failed)}/{len(FUND_LIST)} funds failed: {', '.join(failed)}")

    if not result:
        print("ERROR: all fund fetches failed")
        return result

    # Save full data
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved: {cache_file}")
    return result


# ---------------------------------------------------------------------------
# Sampling
# ---------------------------------------------------------------------------

def sample_nav(funds_nav: dict[str, dict]) -> dict:
    """Down-sample NAV to shared trading dates for lightweight charting."""
    fund_names = list(funds_nav.keys())
    common = sorted(set(funds_nav[fund_names[0]].keys()))
    for fn in fund_names[1:]:
        common = sorted(set(common) & set(funds_nav[fn].keys()))

    step = max(1, len(common) // SAMPLED_POINTS)
    shared = common[::step]
    if common[-1] not in shared:
        shared.append(common[-1])

    sampled = {fn: {d: funds_nav[fn][d] for d in shared if d in funds_nav[fn]} for fn in fund_names}
    port = {}
    for d in shared:
        vals = [funds_nav[fn].get(d) for fn in fund_names]
        if all(v is not None for v in vals):
            port[d] = round(sum(vals) / len(vals), 4)

    result = {"funds": sampled, "portfolio": port, "dates": shared}
    out = DATA_DIR / "nav_sampled.json"
    out.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    print(f"Sampled: {len(shared)} shared dates → {out}")
    return result


# ---------------------------------------------------------------------------
# HTML generation
# ---------------------------------------------------------------------------

def generate_html(sampled: dict) -> str:
    """Inject sampled NAV data into the ECharts brutalist template."""
    template_path = TEMPLATE_DIR / "portfolio.html"
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {template_path}")

    template = template_path.read_text(encoding="utf-8")
    data_json = json.dumps(sampled, ensure_ascii=False, separators=(",", ":"))
    html = template.replace("NAV_JSON_PLACEHOLDER", data_json)
    return html


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(no_fetch: bool = False, output: str | None = None):
    # 1. Fetch
    funds_nav = fetch_all(no_fetch=no_fetch)
    if not funds_nav:
        print("ERROR: no fund data fetched")
        sys.exit(1)

    # 2. Sample
    sampled = sample_nav(funds_nav)

    # 3. Generate HTML
    html = generate_html(sampled)

    # 4. Write
    out_path = Path(output) if output else OUTPUT_FILE
    out_path.write_text(html, encoding="utf-8")
    print(f"Dashboard: {out_path} ({len(html):,} bytes)")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Generate portfolio dashboard")
    parser.add_argument("--no-fetch", action="store_true", help="Use cached nav_full.json")
    parser.add_argument("--output", default=None, help="Output HTML path")
    args = parser.parse_args()

    main(no_fetch=args.no_fetch, output=args.output)
