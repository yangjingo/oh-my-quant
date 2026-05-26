"""Generate styled HTML dashboard from benchmark/results/"""

import json
import pandas as pd
from pathlib import Path
from datetime import datetime

RESULTS_DIR = Path(__file__).resolve().parents[1] / "results"

GRADE_COLORS = {"S": "#00e676", "A": "#76ff03", "B": "#ffeb3b", "C": "#ff9800", "D": "#f44336"}
GRADE_BG = {"S": "rgba(0,230,118,0.12)", "A": "rgba(118,255,3,0.10)", "B": "rgba(255,235,59,0.10)", "C": "rgba(255,152,0,0.12)", "D": "rgba(244,67,54,0.15)"}

THEME = {
    "bg": "#0d1117", "card": "#161b22", "border": "#30363d",
    "text": "#c9d1d9", "muted": "#8b949e", "accent": "#58a6ff",
    "green": "#3fb950", "red": "#f85149", "yellow": "#d2991d",
}

CSS = """
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
       background:$bg; color:$text; padding:32px 40px; line-height:1.5; }
h1 { font-size:24px; font-weight:600; margin-bottom:4px; letter-spacing:-0.5px; }
h2 { font-size:14px; font-weight:500; color:$muted; margin-bottom:28px; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:16px; margin-bottom:28px; }
.card { background:$card; border:1px solid $border; border-radius:10px; padding:20px; }
.card .label { font-size:12px; color:$muted; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px; }
.card .value { font-size:28px; font-weight:700; }
.grade-pills { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; }
.grade-pill { padding:4px 12px; border-radius:20px; font-size:13px; font-weight:600; }
table { width:100%; border-collapse:collapse; margin-top:12px; }
th { text-align:left; font-size:11px; color:$muted; text-transform:uppercase; letter-spacing:0.5px;
     padding:10px 14px; border-bottom:1px solid $border; }
td { padding:10px 14px; font-size:14px; border-bottom:1px solid rgba(48,54,61,0.5); }
tr:hover td { background:rgba(88,166,255,0.04); }
.bar { height:8px; border-radius:4px; min-width:4px; transition:width 0.3s; }
.bar-track { background:$border; border-radius:4px; width:100%; overflow:hidden; }
.section { margin-bottom:32px; }
.section-title { font-size:16px; font-weight:600; margin-bottom:16px; color:$text; }
.footer { text-align:center; font-size:12px; color:$muted; margin-top:40px; }
.score { font-variant-numeric:tabular-nums; font-feature-settings:"tnum"; }
.empty-state { text-align:center; padding:60px 20px; color:$muted; }
.empty-state .icon { font-size:48px; margin-bottom:16px; }
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


def build_html(df: pd.DataFrame) -> str:
    css = CSS
    for k, v in THEME.items():
        css = css.replace(f"${k}", v)

    if df.empty:
        return f"""<html><head><meta charset="utf-8"><style>{css}</style></head>
<body><h1>Benchmark Dashboard</h1><h2>oh-my-quant</h2>
<div class="empty-state"><div class="icon">📭</div>
<p>暂无评测结果</p><p style="font-size:13px;margin-top:8px;">运行 <code style="background:{THEME['card']};padding:2px 8px;border-radius:4px;">whyj-quant benchmark run --symbol 000001</code> 添加</p>
</div></body></html>"""

    total = len(df)
    avg_score = round(df["total_score"].mean(), 1)
    best = df.loc[df["total_score"].idxmax()]
    grade_counts = df["grade"].value_counts()

    cards = f"""
    <div class="card"><div class="label">评测总数</div><div class="value">{total}</div></div>
    <div class="card"><div class="label">平均得分</div><div class="value">{avg_score}<span style="font-size:16px;color:{THEME['muted']}">/100</span></div></div>
    <div class="card"><div class="label">最高得分</div>
      <div class="value">{best['total_score']:.0f}<span style="font-size:14px;color:{THEME['muted']};font-weight:400"> {best['strategy']}</span></div></div>
    <div class="card"><div class="label">平均夏普</div><div class="value">{df['sharpe'].mean():.1f}</div></div>
    """

    grade_html = ""
    for g in "SABCD":
        count = grade_counts.get(g, 0)
        pct = count / total * 100 if total else 0
        color = GRADE_COLORS[g]
        bg = GRADE_BG[g]
        grade_html += f"""<div class="grade-pill" style="background:{bg};color:{color};border:1px solid {color}33">
          {g} &nbsp;{count}&nbsp; <span style="opacity:0.7">{pct:.0f}%</span></div>"""

    table_rows = ""
    for _, r in df.sort_values("total_score", ascending=False).iterrows():
        g = r["grade"]
        c = GRADE_COLORS.get(g, THEME["text"])
        score_pct = r["total_score"] / 100 * 100
        table_rows += f"""<tr>
          <td style="font-weight:500">{r['strategy']}</td>
          <td style="font-weight:700;color:{c}" class="score">{r['total_score']:.0f}</td>
          <td><div class="bar-track"><div class="bar" style="width:{score_pct}%;background:{c}"></div></div></td>
          <td style="color:{c};font-weight:600">{g}</td>
          <td>{r['cagr']:.1%}</td>
          <td>{r['sharpe']:.1f}</td>
          <td style="color:{THEME['red']}">{r['max_drawdown']:.1%}</td>
          <td style="color:{THEME['muted']};font-size:13px">{r['date']}</td>
        </tr>"""

    return f"""<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>{css}</style></head><body>
<h1>📊 Benchmark Dashboard</h1>
<h2>oh-my-quant · {datetime.now().strftime('%Y-%m-%d %H:%M')}</h2>

<div class="section"><div class="grid">{cards}</div></div>

<div class="section">
  <div class="section-title">评级分布</div>
  <div class="grade-pills">{grade_html}</div>
</div>

<div class="section">
  <div class="section-title">策略排名</div>
  <table><thead><tr>
    <th>策略</th><th>得分</th><th></th><th>评级</th><th>CAGR</th><th>夏普</th><th>最大回撤</th><th>日期</th>
  </tr></thead><tbody>{table_rows}</tbody></table>
</div>

<div class="footer">oh-my-quant · benchmark dashboard · generated {datetime.now().isoformat()}</div>
</body></html>"""


if __name__ == "__main__":
    df = collect()
    html = build_html(df)
    out = Path(__file__).resolve().parents[1] / "reports" / "dashboard.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"Dashboard written to {out}")
