"""Dashboard generator — fetch data via AKShare → render HTML report with philosophy insights.

Usage:
    python skills/portfolio/generate.py          # full refresh via AKShare
    python skills/portfolio/generate.py --no-fetch  # reuse cached data
    python skills/portfolio/generate.py --output portfolio.html
"""

import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

import sys; sys.path.insert(0, str(Path(__file__).resolve().parent))
import philosophy

ROOT = Path(__file__).resolve().parents[3]
SKILL_DIR = Path(__file__).resolve().parent.parent   # skills/portfolio/
OUTPUT_FILE = SKILL_DIR / "portfolio.html"
DATA_CACHE = SKILL_DIR / ".fund_data_cache.json"
DAILY_FILE = SKILL_DIR / "daily.json"


# ── Fund registry ──────────────────────────────────────────
FUND_LIST = [
    {"code": "022364", "name": "永赢科技智选发起A", "type": "偏股混合"},
    {"code": "016372", "name": "信澳匠心严选一年持有A", "type": "偏股混合", "lock": "1年"},
    {"code": "022184", "name": "富国全球科技互联网C", "type": "QDII股票"},
    {"code": "001986", "name": "前海开源人工智能主题", "type": "灵活混合"},
    {"code": "008021", "name": "华富人工智能ETF联接C", "type": "指数股票"},
    {"code": "673060", "name": "西部利得景瑞灵活A", "type": "灵活混合"},
    {"code": "040015", "name": "华安动态灵活配置A", "type": "灵活混合"},
]

# Downside data — from historical reports, not computable from NAV alone
DOWNSIDE_DATA = {
    "022364": {"q1_2026": None, "manager_drawdown": -1.89, "note": "成立仅1.5年，未经历完整熊市"},
    "016372": {"q1_2026": -3.01, "q2_2024": -4.58, "annual_2023": -15.05, "manager_drawdown": -0.23},
    "001986": {"annual_2023": -12.42, "manager_drawdown": -55.98, "note": "魏淳任职最大回撤极深"},
    "673060": {"annual_2023": -8.26, "manager_drawdown": None},
}


def load_cached_data() -> dict:
    if DATA_CACHE.exists():
        return json.loads(DATA_CACHE.read_text(encoding="utf-8"))
    return {}


def save_cached_data(data: dict):
    DATA_CACHE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ── AKShare fetch ──────────────────────────────────────────

def fetch_nav_history(code: str) -> pd.DataFrame:
    """Pull full NAV history for a fund via AKShare.
    Returns DataFrame with columns: 净值日期, 单位净值, 日增长率
    """
    import akshare as ak

    try:
        df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
        if df is None or df.empty:
            print(f"  warn: {code} returned empty NAV history")
            return pd.DataFrame()
        df["净值日期"] = pd.to_datetime(df["净值日期"])
        df = df.sort_values("净值日期").reset_index(drop=True)
        return df
    except Exception as e:
        print(f"  warn: {code} fetch failed — {e}")
        return pd.DataFrame()


def calc_return(nav_df: pd.DataFrame, lookback_days: int, today: datetime) -> float | None:
    """Calculate return over `lookback_days` calendar days from latest NAV.
    Returns None if insufficient history or target date has no data.
    """
    if nav_df.empty:
        return None
    target_date = today - timedelta(days=lookback_days)
    # Find NAV closest to (but not after) target_date
    before = nav_df[nav_df["净值日期"] <= pd.Timestamp(target_date)]
    if before.empty:
        return None
    start_nav = before.iloc[-1]["单位净值"]
    end_nav = nav_df.iloc[-1]["单位净值"]
    if start_nav <= 0 or end_nav <= 0:
        return None
    return round((end_nav / start_nav - 1) * 100, 1)


def ytd_return(nav_df: pd.DataFrame, today: datetime) -> float | None:
    """Calculate year-to-date return."""
    if nav_df.empty:
        return None
    year_start = pd.Timestamp(datetime(today.year, 1, 1))
    before = nav_df[nav_df["净值日期"] <= year_start]
    if before.empty:
        return None
    start_nav = before.iloc[-1]["单位净值"]
    end_nav = nav_df.iloc[-1]["单位净值"]
    if start_nav <= 0:
        return None
    return round((end_nav / start_nav - 1) * 100, 1)


def compute_returns(code: str, today: datetime) -> dict:
    """Fetch NAV and compute all period returns for one fund."""
    nav_df = fetch_nav_history(code)
    if nav_df.empty:
        return _empty_returns()

    latest_nav_date = nav_df.iloc[-1]["净值日期"]

    return {
        "w": calc_return(nav_df, 7, today),
        "m": calc_return(nav_df, 30, today),
        "q": calc_return(nav_df, 90, today),
        "hy": calc_return(nav_df, 180, today),
        "ytd": ytd_return(nav_df, today),
        "1y": calc_return(nav_df, 365, today),
        "nav_date": latest_nav_date.strftime("%m-%d") if hasattr(latest_nav_date, "strftime") else str(latest_nav_date)[5:10],
    }


def _empty_returns() -> dict:
    return {"w": None, "m": None, "q": None, "hy": None, "ytd": None, "1y": None, "nav_date": "—"}


def fetch_fund_data() -> dict:
    """Fetch fund NAV via AKShare, compute all period returns."""
    now = datetime.now()
    data = {
        "snapshot": now.strftime("%Y-%m-%d %H:%M:%S CST"),
        "date_str": now.strftime("%Y-%m-%d"),
        "source": "AKShare (天天基金)",
        "funds": [],
    }

    for i, f in enumerate(FUND_LIST):
        code = f["code"]
        print(f"  [{i+1}/{len(FUND_LIST)}] {code} {f['name']} ...", end=" ", flush=True)
        returns = compute_returns(code, now)
        print(f"ok (w={returns['w']}, m={returns['m']}, hy={returns['hy']})")

        entry = {
            "code": code,
            "name": f["name"],
            "type": f["type"],
            "returns": returns,
            "downside": DOWNSIDE_DATA.get(code, {}),
            "lock": f.get("lock"),
        }
        data["funds"].append(entry)

    return data


def fmt_pct(val) -> str:
    if val is None:
        return '<td class="num">—</td>'
    cls = "neg" if val < 0 else "pos"
    return f'<td class="num {cls}">{val:+.1f}%</td>'


def fmt_down(val) -> str:
    if val is None:
        return '<td class="num">—</td>'
    cls = "pos" if val > 0 else "neg"
    return f'<td class="num {cls}">{val:+.2f}%</td>'


def render_rows(data: dict) -> str:
    rows = []
    for f in data["funds"]:
        r = f["returns"]
        src_url = f"https://fund.10jqka.com.cn/pc/{f['code']}/"
        tag_cls = "tag-pill" if "指数" in f["type"] or "偏股" in f["type"] else "tag-muted"
        rows.append(f"""          <tr>
            <td style="font-weight:600;">{f['code']}</td>
            <td>{f['name']}</td>
            <td><span class="tag {tag_cls}">{f['type']}</span></td>
            {fmt_pct(r.get('w'))}
            {fmt_pct(r.get('m'))}
            {fmt_pct(r.get('q'))}
            {fmt_pct(r.get('hy'))}
            {fmt_pct(r.get('ytd'))}
            {fmt_pct(r.get('1y'))}
            <td>{r.get('nav_date', data['date_str'][5:])}</td>
            <td style="font-size:12px;"><a href="{src_url}" target="_blank">同花顺</a></td>
          </tr>""")
    return '\n'.join(rows)


def render_downside_rows(data: dict) -> str:
    rows = []
    for f in data["funds"]:
        d = f["downside"]
        rows.append(f"""          <tr>
            <td style="font-weight:600;">{f['code']}</td>
            <td>{f['name']}</td>
            {fmt_down(d.get('q1_2026'))}
            {fmt_down(d.get('q2_2024'))}
            {fmt_down(d.get('annual_2023'))}
            {fmt_down(d.get('manager_drawdown'))}
            <td style="font-size:11px;color:var(--muted-dark);">{d.get('note', '')}</td>
          </tr>""")
    return '\n'.join(rows)


def inject_data_into_html(template: str, data: dict, philos: list[dict]) -> str:
    """Replace data sections in HTML template with live data."""
    import re

    def replace_tbody(html: str, anchor: str, rows: str) -> str:
        """Replace content between <tbody> and </tbody> near the given anchor text."""
        anchor_pos = html.find(anchor)
        if anchor_pos == -1:
            return html
        tbody_start = html.find('<tbody>', anchor_pos - 2000)
        tbody_end = html.find('</tbody>', tbody_start)
        if tbody_start != -1 and tbody_end != -1:
            return html[:tbody_start + 7] + '\n' + rows + '\n        ' + html[tbody_end:]
        return html

    # Inject trend rows (anchor: "近期趋势")
    template = replace_tbody(template, "近期趋势", render_rows(data))

    # Inject downside rows (anchor: "季度回撤")
    template = replace_tbody(template, "季度回撤", render_downside_rows(data))

    # Inject snapshot time
    template = template.replace("snapshot: 2026-05-28 11:35 CST", f"snapshot: {data['snapshot']}")
    template = template.replace("Generated 2026-05-28 11:35:19 CST", f"Generated {data['snapshot']}")

    return template


def build(data: dict = None, no_fetch: bool = False):
    """Main entry: fetch → render → write."""
    if data is None:
        if no_fetch:
            data = load_cached_data()
            if not data:
                print("No cached data found, fetching...")
                data = fetch_fund_data()
        else:
            data = fetch_fund_data()
            save_cached_data(data)

    # Determine active philosophies
    ctx = philosophy.get_portfolio_context()
    philos = philosophy.get_relevant_philosophies(ctx)

    # Load template
    template_path = SKILL_DIR / "portfolio.html"
    if not template_path.exists():
        print(f"Template not found: {template_path}")
        return

    html = template_path.read_text(encoding="utf-8")

    # Inject data
    html = inject_data_into_html(html, data, philos)

    # Write
    OUTPUT_FILE.write_text(html, encoding="utf-8")
    print(f"Dashboard written: {OUTPUT_FILE}")
    print(f"  Philosophy insights: {len(philos)} cards")
    for p in philos:
        try:
            print(f"    - {p['master']}: {p['principle']}")
        except UnicodeEncodeError:
            print(f"    - [ok]")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Generate fund portfolio dashboard")
    parser.add_argument("--no-fetch", action="store_true", help="Use cached data")
    parser.add_argument("--output", default=None, help="Output path")
    args = parser.parse_args()

    if args.output:
        OUTPUT_FILE = Path(args.output)

    build(no_fetch=args.no_fetch)
