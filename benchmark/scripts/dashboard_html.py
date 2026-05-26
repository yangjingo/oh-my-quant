"""NewForm styled HTML dashboard — brutalist, dual-atmosphere, zero-shadow.

Design tokens from docs/DESIGN.md (NewForm Alpha spec).
All colors/spacing/typography MUST use the `C` token dict below.
Do NOT hardcode hex values outside the C dict.
"""

import json
import pandas as pd
from pathlib import Path
from datetime import datetime

RESULTS_DIR = Path(__file__).resolve().parents[1] / "results"

# ── NewForm Design Tokens ────────────────────────────────────────
C = {
    "primary": "#121413",
    "accent": "#39E180",
    "canvas_light": "#F7F9F6",
    "canvas_dark": "#121413",
    "surface_card": "#1E2220",
    "text_light": "#121413",
    "text_dark": "#F7F9F6",
    "muted_light": "#707572",
    "muted_dark": "#8C9490",
    "hairline_light": "#E2E6E3",
    "hairline_dark": "#2C302E",
    "on_accent": "#121413",
}

GRADE_SIGNAL = {"S": "#39E180", "A": "#39E180", "B": "#F0C040", "C": "#E08040", "D": "#E04040"}
GRADE_BG = {"S": "rgba(57,225,128,0.10)", "A": "rgba(57,225,128,0.06)", "B": "rgba(240,192,64,0.10)", "C": "rgba(224,128,64,0.10)", "D": "rgba(224,64,64,0.12)"}

CSS = f"""
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:'Inter','Helvetica Neue',Arial,sans-serif;background:{C['canvas_light']};color:{C['text_light']};line-height:1.55;-webkit-font-smoothing:antialiased}}
h1{{font-size:56px;font-weight:800;line-height:1.1;letter-spacing:-1.8px;color:{C['primary']}}}
h2{{font-size:24px;font-weight:700;line-height:1.3;letter-spacing:-0.5px}}
h3{{font-size:14px;font-weight:600;letter-spacing:0.3px;text-transform:uppercase;color:{C['muted_light']}}}
code{{font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;font-size:14px;background:{C['canvas_dark']};color:{C['accent']};padding:2px 8px;border-radius:2px}}

/* ── Hero / Light Floor ── */
.hero{{background:{C['canvas_light']};padding:80px 48px;border-bottom:1px solid {C['hairline_light']}}}
.hero h2{{color:{C['muted_light']};font-weight:400;font-size:16px;letter-spacing:0;margin-top:8px}}
.hero-grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;margin-top:48px;background:{C['hairline_light']};border:1px solid {C['hairline_light']}}}
.hero-card{{background:{C['canvas_light']};padding:32px 24px;position:relative}}
.hero-card .label{{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:{C['muted_light']};margin-bottom:12px}}
.hero-card .value{{font-size:42px;font-weight:800;letter-spacing:-1px;color:{C['primary']};font-variant-numeric:tabular-nums}}
.hero-card .unit{{font-size:18px;font-weight:400;color:{C['muted_light']};margin-left:4px}}

/* ── Engine Floor / Dark Base ── */
.engine{{background:{C['canvas_dark']};padding:80px 48px;color:{C['text_dark']}}}
.engine h2{{color:{C['text_dark']}}}
.engine h3{{color:{C['muted_dark']}}}
.section-header{{display:flex;align-items:baseline;gap:12px;margin-bottom:32px}}
.section-header .count{{font-family:'SF Mono',Menlo,monospace;font-size:13px;color:{C['muted_dark']};background:{C['surface_card']};padding:2px 10px;border-radius:2px;border:1px solid {C['hairline_dark']}}}

/* ── Grade Pills ── */
.pills{{display:flex;gap:1px;margin-bottom:48px}}
.pill{{flex:1;padding:24px 16px;text-align:center;border:1px solid {C['hairline_dark']};background:{C['surface_card']}}}
.pill .letter{{font-size:36px;font-weight:800;letter-spacing:-1px;line-height:1}}
.pill .count{{font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:{C['muted_dark']};margin-top:8px}}

/* ── Strategy Table ── */
table{{width:100%;border-collapse:collapse;font-size:14px}}
thead th{{text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:{C['muted_dark']};padding:12px 16px;border-bottom:1px solid {C['hairline_dark']};background:{C['surface_card']}}}
tbody td{{padding:14px 16px;border-bottom:1px solid {C['hairline_dark']};font-variant-numeric:tabular-nums}}
tbody tr:hover td{{background:rgba(57,225,128,0.03)}}
.score-bar{{height:4px;border-radius:0;min-width:0}}
.score-track{{background:{C['hairline_dark']};width:100%}}
.strategy-name{{font-weight:600;color:{C['text_dark']}}}
.metric-pos{{color:{C['accent']}}}
.metric-warn{{color:#E08040}}
.metric-neg{{color:#E04040}}

/* ── Footer ── */
.footer{{background:{C['canvas_dark']};border-top:1px solid {C['hairline_dark']};padding:24px 48px;text-align:center;font-size:12px;color:{C['muted_dark']};letter-spacing:0.3px}}

/* ── Mobile ── */
@media(max-width:768px){{
  .hero{{padding:48px 24px}}
  .hero-grid{{grid-template-columns:repeat(2,1fr)}}
  .hero-card .value{{font-size:28px}}
  .engine{{padding:48px 24px}}
  .pills{{flex-wrap:wrap}}
  .pill{{flex:1 1 20%}}
  h1{{font-size:36px}}
}}
"""


def collect():
    rows = []
    if not RESULTS_DIR.exists():
        return pd.DataFrame()
    for f in RESULTS_DIR.glob("*.json"):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            rows.append({
                "strategy": d.get("strategy", f.stem), "date": d.get("date", ""),
                "total_score": d.get("total_score", 0), "grade": d.get("grade", "?"),
                "return_score": d.get("return_score", 0), "risk_score": d.get("risk_score", 0),
                "robustness_score": d.get("robustness_score", 0),
                "cagr": d.get("details", {}).get("cagr", 0),
                "sharpe": d.get("details", {}).get("sharpe", 0),
                "max_drawdown": d.get("details", {}).get("max_drawdown", 0),
            })
        except Exception:
            pass
    return pd.DataFrame(rows)


def build(df: pd.DataFrame) -> str:
    if df.empty:
        return f"""<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>{CSS}</style><title>Benchmark Dashboard</title></head><body>
<div class="hero"><h1>Benchmark<br>Dashboard</h1><h2>oh-my-quant &middot; NewForm</h2></div>
<div class="engine"><div style="text-align:center;padding:80px 0;color:{C['muted_dark']}"><code>NO_DATA</code><p style="margin-top:16px;font-size:14px">whyj-quant benchmark run --symbol 000001</p></div></div>
<div class="footer">oh-my-quant &middot; {datetime.now().isoformat()}</div></body></html>"""

    total = len(df)
    avg_score = round(df["total_score"].mean(), 1)
    best = df.loc[df["total_score"].idxmax()]
    worst = df.loc[df["total_score"].idxmin()]
    s_count = (df["grade"] == "S").sum()
    a_count = (df["grade"] == "A").sum()
    sorted_df = df.sort_values("total_score", ascending=False)

    # Hero cards
    cards = f"""<div class="hero-card"><div class="label">Total Evals</div><div class="value">{total}</div></div>
<div class="hero-card"><div class="label">Avg Score</div><div class="value">{avg_score}<span class="unit">/100</span></div></div>
<div class="hero-card"><div class="label">Highest</div><div class="value">{best['total_score']:.0f}</div><div class="label" style="margin-top:4px;color:{C['accent']}">{best['strategy']}</div></div>
<div class="hero-card"><div class="label">Avg Sharpe</div><div class="value">{df['sharpe'].mean():.1f}</div></div>"""

    # Grade pills
    pills = ""
    for g in "SABCD":
        count = len(df[df["grade"] == g])
        color = GRADE_SIGNAL[g]
        pills += f"""<div class="pill"><div class="letter" style="color:{color}">{g}</div><div class="count">{count} strategies</div></div>"""

    # Table rows
    rows = ""
    for _, r in sorted_df.iterrows():
        g = r["grade"]
        sc = GRADE_SIGNAL.get(g, C["muted_dark"])
        pct = r["total_score"] / 100 * 100
        dd_class = "metric-pos" if r["max_drawdown"] > -0.15 else "metric-warn" if r["max_drawdown"] > -0.25 else "metric-neg"
        cagr_class = "metric-pos" if r["cagr"] > 0.10 else "metric-warn" if r["cagr"] > 0.03 else "metric-neg"
        rows += f"""<tr>
<td class="strategy-name">{r['strategy']}</td>
<td style="font-weight:700;color:{sc}">{r['total_score']:.0f}</td>
<td><div class="score-track"><div class="score-bar" style="width:{pct}%;background:{sc}"></div></div></td>
<td style="font-weight:700;color:{sc}">{g}</td>
<td class="{cagr_class}">{r['cagr']:.1%}</td>
<td>{r['sharpe']:.1f}</td>
<td class="{dd_class}">{r['max_drawdown']:.1%}</td>
<td style="color:{C['muted_dark']};font-size:12px">{r['date']}</td>
</tr>"""

    return f"""<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Benchmark Dashboard</title><style>{CSS}</style></head><body>

<div class="hero">
  <h1>Benchmark<br>Dashboard</h1>
  <h2>oh-my-quant &middot; NewForm &middot; {datetime.now().strftime('%Y-%m-%d %H:%M')}</h2>
  <div class="hero-grid">{cards}</div>
</div>

<div class="engine">
  <div class="section-header"><h2>Metric Pages</h2><span class="count">definition + use case + chart</span></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1px;background:{C['hairline_dark']};border:1px solid {C['hairline_dark']};margin-bottom:48px">
    {' '.join(f'<a href="{slug}.html" style="background:{C['surface_card']};padding:16px 20px;text-decoration:none;color:{C['text_dark']};font-size:13px;font-weight:600;display:block">{name}<br><span style="font-size:11px;color:{C['muted_dark']};font-weight:400">{desc}</span></a>' for slug, name, desc in [("sharpe","Sharpe Ratio","风险调整收益"),("max_dd","Max Drawdown","最大回撤"),("win_rate","Win Rate","胜率+盈亏比"),("profit","Profit Factor","盈亏效率"),("car_mdd","CAR/MDD","回撤调整收益"),("ulcer","Ulcer Index","压力指标")])}
  </div>

  <div class="section-header"><h2>Grade Distribution</h2><span class="count">{total} records</span></div>
  <div class="pills">{pills}</div>

  <div class="section-header"><h2>Strategy Ranking</h2><span class="count">sort by score</span></div>
  <table>
    <thead><tr><th>Strategy</th><th>Score</th><th></th><th>Grade</th><th>CAGR</th><th>Sharpe</th><th>Max DD</th><th>Date</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
</div>

<div class="engine">
  <div class="section-header"><h2>K-line &middot; 000001 平安银行</h2><span class="count">daily</span></div>
  <iframe src="kline_000001.html" style="width:100%;height:580px;border:1px solid {C['hairline_dark']};border-radius:0"></iframe>
</div>

<div class="footer">oh-my-quant &middot; NewForm alpha &middot; zero-shadow &middot; {datetime.now().isoformat()}</div>
</body></html>"""


if __name__ == "__main__":
    df = collect()
    out = Path(__file__).resolve().parents[1] / "metrics" / "dashboard.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build(df), encoding="utf-8")
    print(f"NewForm dashboard → {out}")
