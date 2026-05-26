"""Generate individual metric HTML pages — definition + use case + visualization.

Design tokens from docs/DESIGN.md (NewForm Alpha spec).
"""

import json
import pandas as pd
import plotly.graph_objects as go
from pathlib import Path
from datetime import datetime

OUT_DIR = Path(__file__).resolve().parents[1] / "metrics"
RESULTS_DIR = Path(__file__).resolve().parents[1] / "results"

# ── NewForm tokens ─────────────────────────────────────────────
BG = "#121413"
PAPER = "#121413"
GRID = "#2C302E"
TEXT = "#8C9490"
WHITE = "#F7F9F6"
MINT = "#39E180"
RED = "#E04040"
GOLD = "#F0C040"
ORANGE = "#E08040"
SURFACE = "#1E2220"
HAIRLINE = "#2C302E"
DARKEN = "#0a0b0a"

CSS = f"""<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{background:{PAPER};color:{WHITE};font-family:'Inter','Helvetica Neue',Arial,sans-serif;line-height:1.55;-webkit-font-smoothing:antialiased}}
.hero{{background:{BG};padding:80px 48px 48px;border-bottom:1px solid {GRID}}}
.hero h1{{font-size:48px;font-weight:800;letter-spacing:-1.8px;line-height:1.1}}
.hero .tagline{{font-size:14px;color:{TEXT};margin-top:12px;font-family:'SF Mono',Menlo,monospace}}
.hero .formula{{margin-top:24px;display:inline-block;background:{SURFACE};border:1px solid {GRID};padding:20px 28px;font-size:16px;color:{WHITE};border-radius:2px}}
.katex{{font-size:16px!important}}
.katex .mathnormal{{color:{WHITE}}}
.katex .mord{{color:{WHITE}}}
.katex .mbin{{color:{MINT}}}
.katex .mrel{{color:{MINT}}}
.katex .mopen{{color:{TEXT}}}
.katex .mclose{{color:{TEXT}}}
.katex .mord.text{{color:{TEXT}}}
.content{{padding:48px;max-width:900px}}
.content h2{{font-size:20px;font-weight:700;letter-spacing:-0.5px;margin:40px 0 16px;padding-top:24px;border-top:1px solid {GRID}}}
.content h2:first-of-type{{border-top:none;padding-top:0;margin-top:0}}
.content p{{font-size:15px;color:{TEXT};margin-bottom:12px}}
.content ul{{margin:12px 0 24px 20px;color:{TEXT};font-size:14px}}
.content ul li{{margin-bottom:8px}}
.tag{{display:inline-block;padding:4px 12px;border-radius:2px;font-size:12px;font-weight:600;letter-spacing:0.3px;margin-right:8px;margin-bottom:8px;border:1px solid {GRID}}}
.tag-good{{color:{MINT};border-color:{MINT}44;background:rgba(57,225,128,0.08)}}
.tag-warn{{color:#F0C040;border-color:#F0C04044;background:rgba(240,192,64,0.08)}}
.tag-bad{{color:{RED};border-color:{RED}44;background:rgba(224,64,64,0.08)}}
.chart-box{{margin:32px 0;border:1px solid {GRID};padding:0;background:{DARKEN}}}
.reading{{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1px;background:{GRID};border:1px solid {GRID};margin:24px 0}}
.reading-card{{background:{SURFACE};padding:20px}}
.reading-card .label{{font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:{TEXT};margin-bottom:8px}}
.reading-card .value{{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}}
.footer{{border-top:1px solid {GRID};padding:20px 48px;text-align:center;font-size:11px;color:{TEXT};letter-spacing:0.3px}}
.back{{font-size:12px;color:{TEXT};text-decoration:none;border-bottom:1px solid {GRID};padding-bottom:2px}}
.back:hover{{color:{MINT};border-color:{MINT}}}
@media(max-width:768px){{.hero{{padding:48px 24px}}.hero h1{{font-size:32px}}.content{{padding:32px 24px}}}}
</style>"""

# ── Load sample returns for charts ──

def _load_returns() -> pd.Series:
    """Load or synthesize daily returns."""
    # Try real data first
    cache = Path(__file__).resolve().parents[1] / "data" / "000001_daily.csv"
    if cache.exists():
        df = pd.read_csv(cache, index_col=0, parse_dates=True)
        if "close" in df.columns and len(df) > 10:
            return df["close"].pct_change().dropna()
    # Try results
    for f in RESULTS_DIR.glob("*.json"):
        d = json.loads(f.read_text())
        if d.get("details", {}).get("cagr"):
            rng = pd.date_range("2024-01-01", periods=252, freq="B")
            import numpy as np
            np.random.seed(42)
            return pd.Series(np.random.normal(d["details"]["cagr"]/252, 0.015, 252), index=rng)
    import numpy as np
    np.random.seed(42)
    return pd.Series(np.random.normal(0.0008, 0.018, 252), index=pd.date_range("2024-01-01", periods=252, freq="B"))


RETURNS = _load_returns()


# ── Chart builders ──

def _base_fig(title: str) -> go.Figure:
    fig = go.Figure()
    fig.update_layout(
        template="none", paper_bgcolor=PAPER, plot_bgcolor=DARKEN,
        font=dict(family="SF Mono,Menlo,monospace", size=10, color=TEXT),
        margin=dict(l=40, r=20, t=40, b=20), height=340,
        xaxis=dict(showgrid=True, gridcolor=GRID, gridwidth=1, zeroline=False, tickfont=dict(color=TEXT, size=9)),
        yaxis=dict(showgrid=True, gridcolor=GRID, gridwidth=1, zeroline=False, tickfont=dict(color=WHITE, size=10), side="right"),
        legend=dict(orientation="h", y=1.02, x=0, font=dict(size=9, color=TEXT), bgcolor="rgba(0,0,0,0)"),
        title=dict(text=title, font=dict(size=11, color=TEXT, family="SF Mono,Menlo,monospace"), x=0.01, y=0.97),
    )
    return fig


def _fig_html(fig: go.Figure) -> str:
    return fig.to_html(full_html=False, include_plotlyjs="cdn", config={
        "displayModeBar": False, "displaylogo": False,
    })


# ── Page builder ──

def _page(title: str, accent_color: str, definition: str, formula: str,
          use_cases: list[tuple[str, str]], chart_html: str, readings: list[tuple[str, str, str]],
          level: str = "", citation: str = "") -> str:
    """Build a complete metric HTML page."""
    level_badge = ""
    if level == "primary":
        level_badge = f'<span style="display:inline-block;background:rgba(57,225,128,0.12);color:{MINT};border:1px solid {MINT}44;padding:3px 10px;border-radius:2px;font-size:11px;font-weight:600;letter-spacing:0.3px;margin-left:12px;vertical-align:middle">PRIMARY METRIC</span>'
    elif level == "secondary":
        level_badge = f'<span style="display:inline-block;background:rgba(140,148,144,0.10);color:{TEXT};border:1px solid {GRID};padding:3px 10px;border-radius:2px;font-size:11px;font-weight:600;letter-spacing:0.3px;margin-left:12px;vertical-align:middle">SECONDARY</span>'
    cite_html = f'<div style="margin-top:12px;font-size:12px;color:{TEXT};font-family:SF Mono,Menlo,monospace;opacity:0.7">{citation}</div>' if citation else ""

    tags = "".join(f'<span class="tag tag-{t}">{label}</span>' for label, t in use_cases)
    cards = "".join(
        f'<div class="reading-card"><div class="label">{label}</div><div class="value" style="color:{color}">{val}</div></div>'
        for label, val, color in readings
    )
    return f"""<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} &middot; oh-my-quant</title>{CSS}</head><body>
<div class="hero">
  <h1 style="color:{accent_color}">{title}{level_badge}</h1>
  <div class="tagline">{definition}</div>
  {cite_html}
  <div class="formula">{formula}</div>
  <div style="margin-top:20px">{tags}</div>
</div>
<div class="content">
  <div class="reading">{cards}</div>
  <div class="chart-box">{chart_html}</div>
  <h2>使用场景</h2>"""


# ── Individual metrics ──

def sharpe_page() -> str:
    """Sharpe Ratio metric page."""
    r = RETURNS
    excess = r - 0.02/252
    sharpe_val = float(excess.mean() / r.std() * (252**0.5)) if r.std() else 0
    rolling_sharpe = pd.Series([
        float((excess.iloc[:i].mean() / max(r.iloc[:i].std(), 1e-8)) * (252**0.5))
        for i in range(60, len(r))
    ], index=r.index[60:])

    fig = _base_fig("Sharpe Ratio · Rolling 60-day")
    fig.add_trace(go.Scatter(x=rolling_sharpe.index, y=rolling_sharpe, mode="lines",
        line=dict(color=MINT, width=2), name="Rolling Sharpe", fill="tozeroy",
        fillcolor="rgba(57,225,128,0.08)"))
    fig.add_hline(y=0, line=dict(color=GRID, width=1))
    fig.add_hline(y=sharpe_val, line=dict(color=MINT, width=1, dash="dash"),
                   annotation=dict(text=f"Overall {sharpe_val:.2f}", font=dict(color=MINT, size=9)))

    readings = [
        ("Sharpe Ratio", f"{sharpe_val:.2f}", MINT if sharpe_val > 1 else GOLD if sharpe_val > 0.5 else RED),
        ("Annual Vol", f"{r.std()*(252**0.5):.1%}", TEXT),
        ("Mean Return", f"{r.mean()*252:.1%}", MINT if r.mean() > 0 else RED),
    ]

    title = "Sharpe Ratio"
    color = MINT
    definition = "衡量每单位风险所获得的超额回报。与 CR 同为 primary metric (Sharpe, 1994)。"
    formula = "$$\\text{Sharpe} = \\frac{R_p - R_f}{\\sigma_p}$$  $R_p$=年化收益 · $R_f$=无风险利率(2%) · $\\sigma_p$=年化波动率"
    citation = "Sharpe, W.F. (1994). The Sharpe Ratio. *Journal of Portfolio Management*."
    level = "primary"
    use_cases = [
        ("> 2.0: 优秀", "good"), ("1.0~2.0: 良好", "good"), ("0.5~1.0: 一般", "warn"),
        ("< 0.5: 较差", "bad"), ("< 0: 不如无风险", "bad"),
    ]

    page = _page(title, color, definition, formula, use_cases, _fig_html(fig), readings, level, citation)

    page += """<ul>
<li><b>策略比较</b>: 不同策略之间用夏普比率横向对比，消除波动率差异</li>
<li><b>基准对标</b>: 策略夏普低于基准夏普，说明风险承担低效</li>
<li><b>杠杆判断</b>: 夏普高的策略可以通过加杠杆放大收益，夏普低则加杠杆无意义</li>
<li><b>注意</b>: 夏普假设收益正态分布，对肥尾策略（期权卖方等）会高估表现</li>
</ul>
</div>
<script>renderMathInElement(document.body,{{delimiters:[{{left:'$$',right:'$$',display:true}},{{left:'$',right:'$',display:false}}]}})</script>
<script>renderMathInElement(document.body,{{delimiters:[{{left:'$$',right:'$$',display:true}},{{left:'$',right:'$',display:false}}]}})</script>
<div class="footer">oh-my-quant &middot; NewForm alpha &middot; zero-shadow</div>
</body></html>"""
    return page, "sharpe_ratio"


def maxdd_page() -> str:
    """Max Drawdown metric page."""
    r = RETURNS
    cum = (1 + r).cumprod()
    running_max = cum.expanding().max()
    dd = (cum - running_max) / running_max
    max_dd = float(dd.min())
    max_dd_end = dd.idxmin()
    max_dd_start = (dd.loc[:max_dd_end] == 0)[::-1].idxmax() if any(dd.loc[:max_dd_end] == 0) else r.index[0]
    dd_duration = (dd < 0).astype(int).groupby((dd >= 0).cumsum()).sum().max()

    fig = _base_fig("Max Drawdown · Equity Curve")
    fig.add_trace(go.Scatter(x=cum.index, y=cum, mode="lines",
        line=dict(color=WHITE, width=1.5), name="Equity"))
    fig.add_trace(go.Scatter(x=running_max.index, y=running_max, mode="lines",
        line=dict(color=GRID, width=1, dash="dash"), name="Running Max"))
    # Highlight drawdown zone
    fig.add_vrect(x0=max_dd_start, x1=max_dd_end, fillcolor=RED, opacity=0.08,
                  line_width=0, annotation_text=f"Max DD {max_dd:.1%}",
                  annotation_font=dict(color=RED, size=9))

    readings = [
        ("Max Drawdown", f"{max_dd:.1%}", MINT if max_dd > -0.15 else GOLD if max_dd > -0.25 else RED),
        ("Duration (days)", str(int(dd_duration)), TEXT),
        ("Recovery Needed", f"{abs(max_dd/(1+max_dd)):.1%}", ORANGE if max_dd < -0.2 else TEXT),
    ]

    title = "Max Drawdown"
    color = RED
    definition = "投资组合从峰值到谷底的最大累计损失幅度。辅助指标，需与 CR/SR 联合判断 (Ang & Chen, 2003)。"
    formula = "$$\\text{MDD} = \\min\\!\\left(\\frac{V(t) - \\max_{0..t}V}{\\max_{0..t}V}\\right)$$  $V$=权益净值"
    citation = "Ang, A. & Chen, J. (2003). CAPM Over the Long Run: 1926-2001. *Journal of Empirical Finance*."
    level = "secondary"
    use_cases = [
        ("< -10%: 极优", "good"), ("-10%~-20%: 良好", "good"), ("-20%~-35%: 一般", "warn"),
        ("-35%~-50%: 差", "bad"), ("> -50%: 灾难", "bad"),
    ]

    page = _page(title, color, definition, formula, use_cases, _fig_html(fig), readings, level, citation)
    page += f"""<ul>
<li><b>心理承受</b>: 回撤超过 -25% 时大多数投资者会恐慌赎回，策略设计应以此为红线</li>
<li><b>恢复计算</b>: -50% 回撤需要 +100% 收益才回本，回撤越深恢复越难</li>
<li><b>仓位校验</b>: max_dd / 预期最大杠杆 ≤ 可承受亏损，反推合理仓位</li>
<li><b>回撤区间</b>: {max_dd_start.strftime('%Y-%m-%d') if hasattr(max_dd_start,'strftime') else 'N/A'} → {max_dd_end.strftime('%Y-%m-%d') if hasattr(max_dd_end,'strftime') else 'N/A'}，持续 {int(dd_duration)} 个交易日</li>
</ul>
</div>
<script>renderMathInElement(document.body,{{delimiters:[{{left:'$$',right:'$$',display:true}},{{left:'$',right:'$',display:false}}]}})</script>
<div class="footer">oh-my-quant &middot; NewForm alpha &middot; zero-shadow</div>
</body></html>"""
    return page, "max_drawdown"


def winrate_page() -> str:
    """Win Rate metric page."""
    r = RETURNS
    wins = (r > 0).sum()
    total = len(r)
    wr = float(wins / total)
    avg_win = float(r[r > 0].mean()) if wins > 0 else 0
    avg_loss = float(abs(r[r < 0].mean())) if (total - wins) > 0 else 0
    pnl_ratio = avg_win / avg_loss if avg_loss else 0

    # Bar chart: monthly win rates
    monthly_wr = r.groupby(r.index.to_period("M")).apply(lambda x: (x > 0).mean())
    fig = _base_fig("Monthly Win Rate · Bar")
    colors = [MINT if v >= 0.5 else RED for v in monthly_wr.values]
    fig.add_trace(go.Bar(x=monthly_wr.index.astype(str), y=monthly_wr.values,
        marker_color=colors, marker_line_width=0, name="Win Rate"))
    fig.add_hline(y=0.5, line=dict(color=GRID, width=1, dash="dash"),
                   annotation=dict(text="50%", font=dict(color=TEXT, size=9)))
    fig.update_layout(yaxis=dict(tickformat=".0%"))

    readings = [
        ("Win Rate", f"{wr:.1%}", MINT if wr > 0.55 else GOLD if wr > 0.45 else RED),
        ("Avg Win", f"{avg_win:.4%}", MINT),
        ("Avg Loss", f"-{avg_loss:.4%}", RED),
        ("PnL Ratio", f"{pnl_ratio:.2f}", MINT if pnl_ratio > 1.5 else GOLD if pnl_ratio > 1 else RED),
    ]

    title = "Win Rate"
    color = MINT if wr > 0.5 else GOLD
    definition = "盈利交易占总交易次数的比例。必须与盈亏比配合使用才有意义。"
    formula = "$$\\text{WinRate} = \\frac{N_{\\text{win}}}{N_{\\text{total}}}$$ $$\\text{PnL Ratio} = \\frac{\\overline{\\text{Win}}}{|\\overline{\\text{Loss}}|}$$"
    use_cases = [
        ("高胜率+高盈亏比: 圣杯", "good"), ("高胜率+低盈亏比: 剥头皮", "warn"),
        ("低胜率+高盈亏比: 趋势跟踪", "good"), ("低胜率+低盈亏比: 失败", "bad"),
    ]

    page = _page(title, color, definition, formula, use_cases, _fig_html(fig), readings)
    page += f"""<ul>
<li><b>策略分类</b>: WinRate {wr:.1%} × PnL Ratio {pnl_ratio:.1f} → 预期每笔盈亏 = {wr*pnl_ratio - (1-wr):.3f}</li>
<li><b>趋势策略</b>: 胜率 30-45% 正常，靠大赢小亏获利；若胜率 > 50% 且盈亏比 > 1.5 极少见</li>
<li><b>均值回归</b>: 胜率 55-65% 正常，小赢频繁但单笔亏损可能较大</li>
<li><b>组合考量</b>: 胜率影响心理（高频小赢舒适），盈亏比影响收益（低频大赢需要耐心）</li>
</ul>
</div>
<script>renderMathInElement(document.body,{{delimiters:[{{left:'$$',right:'$$',display:true}},{{left:'$',right:'$',display:false}}]}})</script>
<div class="footer">oh-my-quant &middot; NewForm alpha &middot; zero-shadow</div>
</body></html>"""
    return page, "win_rate"


def profit_factor_page() -> str:
    """Profit Factor metric page."""
    r = RETURNS
    gross_profit = float(r[r > 0].sum())
    gross_loss = float(abs(r[r < 0].sum())) if (r < 0).any() else 1e-8
    pf = gross_profit / gross_loss

    # Cumulative profit/loss
    cum_profit = r[r > 0].cumsum() if (r > 0).any() else pd.Series([0])
    cum_loss = abs(r[r < 0]).cumsum() if (r < 0).any() else pd.Series([0])

    fig = _base_fig("Cumulative Profit vs Loss")
    fig.add_trace(go.Scatter(x=cum_profit.index, y=cum_profit.values.cumsum() if len(cum_profit) else [0],
        mode="lines", line=dict(color=MINT, width=1.5), name="Cum Profit", fill="tozeroy",
        fillcolor="rgba(57,225,128,0.08)"))
    fig.add_trace(go.Scatter(x=cum_loss.index, y=cum_loss.values.cumsum() if len(cum_loss) else [0],
        mode="lines", line=dict(color=RED, width=1.5), name="Cum Loss", fill="tozeroy",
        fillcolor="rgba(224,64,64,0.08)"))

    readings = [
        ("Profit Factor", f"{pf:.2f}", MINT if pf > 1.5 else GOLD if pf > 1 else RED),
        ("Gross Profit", f"{gross_profit:.4f}", MINT),
        ("Gross Loss", f"{gross_loss:.4f}", RED),
    ]

    title = "Profit Factor"
    color = MINT if pf > 1.5 else GOLD
    definition = "总盈利与总亏损的比值。衡量策略产生盈利的效率，是胜率和盈亏比的综合体现。"
    formula = "$$\\text{PF} = \\frac{\\sum \\text{Profit}_i}{|\\sum \\text{Loss}_i|}$$  值 $>1$ = 净盈利策略"
    use_cases = [
        ("> 2.0: 优秀", "good"), ("1.5~2.0: 良好", "good"), ("1.2~1.5: 一般", "warn"),
        ("1.0~1.2: 勉强", "warn"), ("< 1.0: 亏损", "bad"),
    ]

    page = _page(title, color, definition, formula, use_cases, _fig_html(fig), readings)
    page += f"""<ul>
<li><b>综合指标</b>: Profit Factor={pf:.2f} 综合了胜率和盈亏比，比单独看任一指标更全面</li>
<li><b>筛选门槛</b>: 回测 PF < 1.3 的策略通常样本外表现差，建议 PF > 1.5 再考虑实盘</li>
<li><b>陷阱</b>: 样本量太少时 PF 会虚高（比如只有 5 笔交易全部盈利），需配合交易次数一起看</li>
<li><b>与夏普互补</b>: 夏普对单笔大盈亏敏感，PF 对盈亏次数敏感，两者结合判断更可靠</li>
</ul>
</div>
<script>renderMathInElement(document.body,{{delimiters:[{{left:'$$',right:'$$',display:true}},{{left:'$',right:'$',display:false}}]}})</script>
<div class="footer">oh-my-quant &middot; NewForm alpha &middot; zero-shadow</div>
</body></html>"""
    return page, "profit_factor"


def car_mdd_page() -> str:
    """CAR/MDD (Calmar) metric page."""
    r = RETURNS
    cagr = float((1 + r.mean()) ** 252 - 1)
    cum = (1 + r).cumprod()
    running_max = cum.expanding().max()
    dd = (cum - running_max) / running_max
    max_dd = float(dd.min())
    calmar = cagr / abs(max_dd) if max_dd else 0

    # Rolling 1yr CAR/MDD
    rolling_calmars = []
    for i in range(252, len(r)):
        sub = r.iloc[i-252:i]
        sub_cagr = (1 + sub.mean()) ** 252 - 1
        sub_cum = (1 + sub).cumprod()
        sub_max = sub_cum.expanding().max()
        sub_dd = float(((sub_cum - sub_max) / sub_max).min())
        rolling_calmars.append(sub_cagr / abs(sub_dd) if sub_dd else 0)

    fig = _base_fig("Calmar Ratio · Rolling 1-Year")
    if rolling_calmars:
        fig.add_trace(go.Scatter(x=r.index[252:], y=rolling_calmars, mode="lines",
            line=dict(color=MINT, width=2), name="Calmar", fill="tozeroy",
            fillcolor="rgba(57,225,128,0.08)"))
        fig.add_hline(y=calmar, line=dict(color=MINT, width=1, dash="dash"),
                       annotation=dict(text=f"{calmar:.2f}", font=dict(color=MINT, size=9)))

    readings = [
        ("Calmar Ratio", f"{calmar:.2f}", MINT if calmar > 1 else GOLD if calmar > 0.5 else RED),
        ("CAGR", f"{cagr:.1%}", MINT if cagr > 0 else RED),
        ("Max Drawdown", f"{max_dd:.1%}", TEXT),
    ]

    title = "CAR/MDD (Calmar)"
    color = MINT if calmar > 1 else GOLD
    definition = "年化收益率与最大回撤的比值。回撤调整后的收益效率指标，越高越好。"
    formula = "$$\\text{Calmar} = \\frac{\\text{CAGR}}{|\\text{MDD}|}$$  CAGR=年化复合收益 · MDD=最大回撤"
    use_cases = [
        ("> 2.0: 极优", "good"), ("1.0~2.0: 良好", "good"), ("0.5~1.0: 一般", "warn"),
        ("0.2~0.5: 偏差", "warn"), ("< 0.2: 无效", "bad"),
    ]

    page = _page(title, color, definition, formula, use_cases, _fig_html(fig), readings)
    page += """<ul>
<li><b>CTA/期货策略</b>: 这类策略夏普通常不高但回撤控制好，Calmar 比夏普更适合评价</li>
<li><b>回撤敏感型资金</b>: 银行理财、养老金等不能承受大回撤，Calmar 是首要筛选指标</li>
<li><b>策略成熟度</b>: Calmar 持续 > 1 且滚动稳定，表明策略在不同市场环境下回撤控制一致</li>
</ul>
</div>
<script>renderMathInElement(document.body,{{delimiters:[{{left:'$$',right:'$$',display:true}},{{left:'$',right:'$',display:false}}]}})</script>
<div class="footer">oh-my-quant &middot; NewForm alpha &middot; zero-shadow</div>
</body></html>"""
    return page, "car_mdd"


def ulcer_page() -> str:
    """Ulcer Index metric page."""
    r = RETURNS
    cum = (1 + r).cumprod()
    running_max = cum.expanding().max()
    dd = (cum - running_max) / running_max
    # Ulcer Index = sqrt(mean(drawdown^2))
    ulcer = float((dd ** 2).mean() ** 0.5)

    # Drawdown severity over time
    fig = _base_fig("Drawdown Severity · Ulcer Index")
    fig.add_trace(go.Scatter(x=dd.index, y=dd.abs(), mode="lines",
        line=dict(color=RED, width=1, shape="hv"), name="|Drawdown|", fill="tozeroy",
        fillcolor="rgba(224,64,64,0.10)"))
    fig.add_hline(y=ulcer, line=dict(color=MINT, width=1.5, dash="dash"),
                   annotation=dict(text=f"Ulcer {ulcer:.3f}", font=dict(color=MINT, size=9)))
    fig.update_layout(yaxis=dict(tickformat=".0%"))

    # Martin Ratio = (CAGR - Rf) / Ulcer
    cagr = float((1 + r.mean()) ** 252 - 1)
    martin = (cagr - 0.02) / ulcer if ulcer else 0

    readings = [
        ("Ulcer Index", f"{ulcer:.3f}", MINT if ulcer < 0.05 else GOLD if ulcer < 0.10 else RED),
        ("Martin Ratio", f"{martin:.2f}", MINT if martin > 1 else GOLD),
        ("Max |DD| Avg", f"{abs(dd).mean():.2%}", TEXT),
    ]

    title = "Ulcer Index"
    color = RED
    definition = "衡量回撤深度和持续时间的综合压力指标。不仅看最大回撤，还看回撤的持续性和频率。"
    formula = "$$\\text{Ulcer} = \\sqrt{\\frac{1}{N}\\sum R_i^2}$$  $R_i = \\frac{V_i - \\max(V_0..V_i)}{\\max(V_0..V_i)}$"
    use_cases = [
        ("< 0.05: 低压力", "good"), ("0.05~0.10: 中等", "good"), ("0.10~0.15: 高压", "warn"),
        ("0.15~0.25: 很高压", "bad"), ("> 0.25: 极端", "bad"),
    ]

    page = _page(title, color, definition, formula, use_cases, _fig_html(fig), readings)
    page += """<ul>
<li><b>vs Max Drawdown</b>: MaxDD 只看最差一个点，Ulcer 看整个回撤区间——策略可能多次小回撤叠加，MaxDD 不高但 Ulcer 高</li>
<li><b>长期持有体验</b>: Ulcer 低的策略持有者心理压力小，赎回率低，更适合零售投资者</li>
<li><b>Martin Ratio</b>: Martin = (CAGR - Rf) / Ulcer，类似夏普但用 Ulcer 替代标准差，对回撤模式更敏感</li>
<li><b>组合监控</b>: 月度跟踪 Ulcer Index 变化，若持续攀升说明策略压力在累积</li>
</ul>
</div>
<script>renderMathInElement(document.body,{{delimiters:[{{left:'$$',right:'$$',display:true}},{{left:'$',right:'$',display:false}}]}})</script>
<div class="footer">oh-my-quant &middot; NewForm alpha &middot; zero-shadow</div>
</body></html>"""
    return page, "ulcer_index"


def kline_page() -> str:
    """K-line candlestick metric page — reuses chart from kline_chart.py."""
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from kline_chart import load_or_generate, make_kline

    symbol = "000001"
    name = "平安银行"
    df = load_or_generate(symbol)
    chart_html = make_kline(df, symbol, name)

    # Quick stats from data
    close = df["close"]
    chg = (close.iloc[-1] / close.iloc[0] - 1) if len(close) > 1 else 0
    high = close.max()
    low = close.min()
    ma20 = close.rolling(20).mean().iloc[-1] if len(close) >= 20 else close.iloc[-1]
    trend = "↑ 多头" if close.iloc[-1] > ma20 else "↓ 空头"

    readings = [
        ("最新价", f"¥{close.iloc[-1]:.2f}", MINT if chg > 0 else RED),
        ("区间涨跌", f"{chg:.1%}", MINT if chg > 0 else RED),
        ("区间最高", f"¥{high:.2f}", WHITE),
        ("区间最低", f"¥{low:.2f}", TEXT),
    ]

    title = "K-line Candlestick"
    color = MINT
    definition = "OHLC 蜡烛图走势，叠加 MA5/MA20/MA60 均线 + 成交量。是最基础的量价可视化，策略信号审查的起点。"
    formula = f"$$\\text{{MA}}_5={close.rolling(5).mean().iloc[-1]:.2f}\\quad\\text{{MA}}_{{20}}={ma20:.2f}\\quad\\text{{MA}}_{{60}}={close.rolling(60).mean().iloc[-1] if len(close)>=60 else close.iloc[-1]:.2f}$$ 趋势: {trend}"
    use_cases = [
        ("价格 > MA60: 长多", "good"), ("MA5 ↑ 穿越 MA20: 金叉", "good"),
        ("价格 < MA20: 短空", "warn"), ("MA5 ↓ 穿越 MA20: 死叉", "bad"),
    ]

    page = _page(title, color, definition, formula, use_cases, chart_html, readings)
    page += f"""<ul>
<li><b>信号审查</b>: 在回测基础上用 K 线逐笔核对关键交易日的开平仓价格是否合理</li>
<li><b>均线框架</b>: MA20 > MA60 且价格在 MA20 上方 = 标准多头排列，反之空头</li>
<li><b>成交量验证</b>: 突破日成交量应显著放大（> 20日均量 1.5x），缩量突破可信度低</li>
<li><b>数据区间</b>: {df.index[0].strftime('%Y-%m-%d') if hasattr(df.index[0],'strftime') else 'N/A'} → {df.index[-1].strftime('%Y-%m-%d') if hasattr(df.index[-1],'strftime') else 'N/A'}，共 {len(df)} 个交易日</li>
</ul>
<script>renderMathInElement(document.body,{{delimiters:[{{left:'$$',right:'$$',display:true}},{{left:'$',right:'$',display:false}}]}})</script>
</div>
<script>renderMathInElement(document.body,{{delimiters:[{{left:'$$',right:'$$',display:true}},{{left:'$',right:'$',display:false}}]}})</script>
<div class="footer">oh-my-quant &middot; NewForm alpha &middot; zero-shadow</div>
</body></html>"""
    return page, "kline"


def cr_page() -> str:
    """Cumulative Return (CR) — primary metric."""
    r = RETURNS
    cr = float((1 + r).prod() - 1)
    cagr = float((1 + r.mean()) ** 252 - 1)
    cum = (1 + r).cumprod()

    fig = _base_fig("Cumulative Return · Equity Curve")
    fig.add_trace(go.Scatter(x=cum.index, y=cum, mode="lines",
        line=dict(color=MINT, width=2), name="Equity", fill="tozeroy",
        fillcolor="rgba(57,225,128,0.08)"))
    fig.add_hline(y=1.0, line=dict(color=GRID, width=1, dash="dash"),
                   annotation=dict(text="Initial", font=dict(color=TEXT, size=9)))

    readings = [
        ("Cumulative Return", f"{cr:.1%}", MINT if cr > 0 else RED),
        ("CAGR", f"{cagr:.1%}", MINT if cagr > 0 else RED),
        ("Final × (Initial=1)", f"{cum.iloc[-1]:.2f}", WHITE),
    ]

    title = "Cumulative Return"
    color = MINT
    definition = "衡量长期资本增值总量的首要指标。与 Sharpe Ratio 并列为 primary metric (Hull, 2007)。"
    formula = "$$\\text{CR} = \\frac{V_T - V_0}{V_0} = \\prod_{t=1}^{T}(1 + r_t) - 1$$  $V_0$=初始权益 · $V_T$=期末权益"
    citation = "Hull, J.C. (2007). *Risk Management and Financial Institutions*. Pearson."
    level = "primary"
    use_cases = [
        ("CR > 50%: 优秀", "good"), ("20-50%: 良好", "good"), ("0-20%: 一般", "warn"),
        ("< 0%: 亏损", "bad"),
    ]

    page = _page(title, color, definition, formula, use_cases, _fig_html(fig), readings, level, citation)
    page += """<ul>
<li><b>首要指标</b>: CR 直接回答"赚了多少钱"，是投资者最关心的结果指标</li>
<li><b>时间依赖</b>: CR 与回测时长强相关——5 年 50% 和 1 年 50% 含义完全不同，必须配合 CAGR 看年化</li>
<li><b>vs 基准</b>: 策略 CR 跑输基准 CR = 策略无效，无论其他指标多好看</li>
</ul>
</div>
<div class="footer">oh-my-quant &middot; NewForm alpha &middot; zero-shadow</div>
</body></html>"""
    return page, "cumulative_return"


def av_page() -> str:
    """Annualized Volatility (AV) — secondary metric."""
    r = RETURNS
    av = float(r.std() * (252 ** 0.5))
    rolling_vol = r.rolling(60).std() * (252 ** 0.5)

    fig = _base_fig("Annualized Volatility · Rolling 60-day")
    fig.add_trace(go.Scatter(x=rolling_vol.index, y=rolling_vol, mode="lines",
        line=dict(color=GOLD, width=2), name="Rolling Vol", fill="tozeroy",
        fillcolor="rgba(240,192,64,0.08)"))
    fig.add_hline(y=av, line=dict(color=GOLD, width=1, dash="dash"),
                   annotation=dict(text=f"AV {av:.1%}", font=dict(color=GOLD, size=9)))

    readings = [
        ("Annualized Vol", f"{av:.1%}", MINT if av < 0.20 else GOLD if av < 0.35 else RED),
        ("Daily σ", f"{r.std():.4f}", TEXT),
        ("Monthly σ", f"{r.std()*(21**0.5):.2%}", TEXT),
    ]

    title = "Annualized Volatility"
    color = GOLD
    definition = "收益率年化标准差，衡量策略的风险总量。辅助指标，需配合 CR/SR 解释 (Cochrane, 1988)。"
    formula = "$$\\text{AV} = \\sigma_{\\text{daily}} \\times \\sqrt{252}$$  $\\sigma_{\\text{daily}}$=日收益率标准差"
    citation = "Cochrane, J.H. (1988). How Big Is the Random Walk in GNP? *Journal of Political Economy*."
    level = "secondary"
    use_cases = [
        ("< 15%: 低波动", "good"), ("15-25%: 中等", "good"), ("25-35%: 较高", "warn"),
        ("35-50%: 高波动", "warn"), ("> 50%: 极高", "bad"),
    ]

    page = _page(title, color, definition, formula, use_cases, _fig_html(fig), readings, level, citation)
    page += """<ul>
<li><b>风险总量</b>: AV 衡量绝对风险——高 AV 不一定不好，关键看 CR 是否匹配</li>
<li><b>组合必备</b>: 配合 Sharpe 使用——同样 AV 下夏普越高越好，同样夏普下 AV 越低越好</li>
<li><b>滚动监控</b>: 滚动 AV 骤升 → 市场 regime change，需检查策略是否适应当前环境</li>
</ul>
</div>
<div class="footer">oh-my-quant &middot; NewForm alpha &middot; zero-shadow</div>
</body></html>"""
    return page, "annualized_volatility"


# ── Build all ──

METRICS = [
    ("sharpe",   sharpe_page,   "Sharpe Ratio"),
    ("cumulative_return", cr_page, "Cumulative Return"),
    ("max_dd",   maxdd_page,    "Max Drawdown"),
    ("annualized_volatility", av_page, "Annualized Volatility"),
    ("win_rate", winrate_page,  "Win Rate"),
    ("profit",   profit_factor_page, "Profit Factor"),
    ("car_mdd",  car_mdd_page,  "CAR/MDD (Calmar)"),
    ("ulcer",    ulcer_page,    "Ulcer Index"),
    ("kline",    kline_page,    "K-line Candlestick"),
]


def build_all():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for slug, fn, _name in METRICS:
        try:
            html, _ = fn()
            out = OUT_DIR / f"{slug}.html"
            out.write_text(html, encoding="utf-8")
            print(f"  ✓ {out}")
        except Exception as e:
            print(f"  ✗ {slug}: {e}")


if __name__ == "__main__":
    build_all()
