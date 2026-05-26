"""NewForm-styled K-line chart generator — plotly interactive candlestick.

Design tokens from docs/DESIGN.md (NewForm Alpha spec).
All colors/spacing/typography MUST use the module-level constants below.
Do NOT hardcode hex values outside these constants.
"""

import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from pathlib import Path
import json
import numpy as np

OUT_DIR = Path(__file__).resolve().parents[1] / "metrics"

# ── NewForm palette ──
BG = "#121413"
PAPER = "#121413"
GRID = "#2C302E"
TEXT = "#8C9490"
MINT = "#39E180"
RED_CANDLE = "#E04040"
GREEN_CANDLE = "#39E180"
WHITE = "#F7F9F6"


def load_or_generate(symbol: str = "000001") -> pd.DataFrame:
    """Try to load cached data, fall back to synthetic."""
    cache = Path(__file__).resolve().parents[1] / "data" / f"{symbol}_daily.csv"
    if cache.exists():
        df = pd.read_csv(cache, index_col=0, parse_dates=True)
        if len(df) > 10:
            return df

    # Try yfinance for real data
    try:
        import yfinance as yf
        ticker_map = {"000001": "000001.SZ", "000300": "510300.SS"}
        yt = ticker_map.get(symbol, f"{symbol}.SZ")
        df = yf.download(yt, start="2025-06-01", end="2026-05-26", progress=False)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.droplevel(1)
        df.columns = [c.lower() for c in df.columns]
        df.index = pd.to_datetime(df.index)
        if len(df) > 20:
            return df
    except Exception:
        pass

    # Fallback: synthetic walk
    np.random.seed(42)
    dates = pd.date_range("2026-01-02", "2026-05-26", freq="B")
    n = len(dates)
    price = 12.0 * np.exp(np.cumsum(np.random.normal(0.0005, 0.018, n)))
    data = []
    for i, d in enumerate(dates):
        o = price[i]
        c = o * (1 + np.random.normal(0, 0.012))
        h = max(o, c) * (1 + abs(np.random.normal(0, 0.008)))
        l = min(o, c) * (1 - abs(np.random.normal(0, 0.008)))
        data.append({"date": d, "open": o, "high": h, "low": l, "close": c, "volume": int(np.random.uniform(5e7, 2e8))})
    return pd.DataFrame(data).set_index("date")


def make_kline(df: pd.DataFrame, symbol: str = "000001", name: str = "平安银行") -> str:
    """Generate NewForm-styled K-line chart, return HTML fragment."""
    df = df.copy()
    if not isinstance(df.index, pd.DatetimeIndex):
        df.index = pd.to_datetime(df.index)

    # Moving averages
    df["ma5"] = df["close"].rolling(5).mean()
    df["ma20"] = df["close"].rolling(20).mean()
    df["ma60"] = df["close"].rolling(60).mean()

    fig = make_subplots(
        rows=2, cols=1, shared_xaxes=True,
        vertical_spacing=0.03,
    )

    # ── Candlestick ──
    fig.add_trace(go.Candlestick(
        x=df.index,
        open=df["open"], high=df["high"], low=df["low"], close=df["close"],
        name="K-line",
        increasing_line_color=GREEN_CANDLE, decreasing_line_color=RED_CANDLE,
        increasing_fillcolor=GREEN_CANDLE, decreasing_fillcolor=RED_CANDLE,
        line=dict(width=1),
    ), row=1, col=1)

    # MAs
    for ma, color, width in [("ma5", MINT, 1), ("ma20", "#F0C040", 1.5), ("ma60", "#E08040", 1.5)]:
        if ma in df.columns:
            fig.add_trace(go.Scatter(
                x=df.index, y=df[ma], mode="lines", name=ma.upper(),
                line=dict(color=color, width=width, dash="solid"),
                opacity=0.8,
            ), row=1, col=1)

    # ── Volume ──
    colors = [GREEN_CANDLE if c >= o else RED_CANDLE for o, c in zip(df["open"], df["close"])]
    fig.add_trace(go.Bar(
        x=df.index, y=df["volume"], name="Volume",
        marker_color=colors, marker_line_width=0,
        opacity=0.5,
    ), row=2, col=1)

    # ── Layout: NewForm engine floor ──
    fig.update_layout(
        template="none",
        paper_bgcolor=PAPER, plot_bgcolor=BG,
        font=dict(family="SF Mono, Menlo, Monaco, monospace", size=11, color=TEXT),
        title=dict(
            text=f"<b style='font-family:Inter,sans-serif;font-size:18px;color:{WHITE}'>{symbol}</b>  "
                 f"<span style='font-size:12px;color:{TEXT}'>{name}</span>",
            x=0.01, xref="paper", y=0.97, yref="paper",
            pad=dict(b=0),
        ),
        xaxis=dict(showgrid=True, gridcolor=GRID, gridwidth=1, zeroline=False,
                    showticklabels=False, rangeslider=dict(visible=False)),
        xaxis2=dict(showgrid=True, gridcolor=GRID, gridwidth=1, zeroline=False,
                     tickformat="%m/%d", tickfont=dict(size=10, color=TEXT),
                     rangeslider=dict(visible=False)),
        yaxis=dict(showgrid=True, gridcolor=GRID, gridwidth=1, zeroline=False,
                    tickfont=dict(size=11, color=WHITE), side="right",
                    fixedrange=False),
        yaxis2=dict(showgrid=False, zeroline=False, tickfont=dict(size=9, color=TEXT),
                     showticklabels=False),
        legend=dict(orientation="v", yanchor="top", y=0.98, xanchor="left", x=1.01,
                     font=dict(size=10, color=TEXT), bgcolor="rgba(18,20,19,0.85)",
                     bordercolor=GRID, borderwidth=1),
        margin=dict(l=10, r=140, t=50, b=10),
        height=520,
        hovermode="x unified",
        hoverlabel=dict(bgcolor="#1E2220", font_size=12, font_family="SF Mono, monospace",
                         bordercolor=GRID),
        dragmode="pan",
    )

    fig.update_xaxes(rangeslider_visible=False, row=1, col=1)
    fig.update_xaxes(rangeslider_visible=False, row=2, col=1)
    fig.update_yaxes(title_text="", row=1, col=1)

    return fig.to_html(full_html=False, include_plotlyjs="cdn", config={
        "displayModeBar": True,
        "displaylogo": False,
        "modeBarButtonsToRemove": ["lasso2d", "select2d"],
    })


def kline_html(symbol: str = "000001", name: str = "平安银行") -> str:
    """Full standalone K-line HTML page in NewForm style."""
    df = load_or_generate(symbol)
    chart = make_kline(df, symbol, name)

    return f"""<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>K-line &middot; {symbol}</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{background:#121413;color:#F7F9F6;font-family:'Inter','Helvetica Neue',Arial,sans-serif;padding:0}}
.header{{padding:32px 40px 0;display:flex;justify-content:space-between;align-items:flex-end}}
.header h1{{font-size:24px;font-weight:700;letter-spacing:-0.5px}}
.header .meta{{font-size:12px;color:#8C9490;letter-spacing:0.3px}}
.chart-wrap{{margin:0}}
.footer{{border-top:1px solid #2C302E;padding:16px 40px;text-align:center;font-size:11px;color:#8C9490;letter-spacing:0.3px}}
</style></head><body>
<div class="header">
  <h1>K-line &middot; {symbol} <span style="font-weight:400;color:#8C9490">{name}</span></h1>
  <div class="meta">oh-my-quant &middot; NewForm</div>
</div>
<div class="chart-wrap">{chart}</div>
<div class="footer">Candles: <span style="color:#39E180">↑</span> MA5 &middot; <span style="color:#F0C040">MA20</span> &middot; <span style="color:#E08040">MA60</span> &middot; volume bar</div>
</body></html>"""


if __name__ == "__main__":
    for sym, nm in [("000001", "平安银行"), ("000300", "沪深300")]:
        html = kline_html(sym, nm)
        out = OUT_DIR / f"kline_{sym}.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(html, encoding="utf-8")
        print(f"K-line → {out}")
