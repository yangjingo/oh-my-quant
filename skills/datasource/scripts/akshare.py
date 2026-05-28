"""A-share price loaders with stable fallbacks for CLI usage."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
SAMPLE_DATA = ROOT / "benchmark" / "data" / "000001_SZ_daily.csv"

COLUMN_MAP = {
    "日期": "date",
    "开盘": "open",
    "最高": "high",
    "最低": "low",
    "收盘": "close",
    "成交量": "volume",
    "成交额": "amount",
    "振幅": "amplitude",
    "涨跌幅": "pct_change",
    "涨跌额": "change",
    "换手率": "turnover",
}


def _normalize(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    df = df.rename(columns={key: value for key, value in COLUMN_MAP.items() if key in df.columns})
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date")
    df = df.sort_index()
    return df[~df.index.duplicated(keep="first")]


def _symbol_to_yf(symbol: str) -> str:
    if "." in symbol:
        return symbol
    if symbol.startswith(("5", "6", "9")):
        return f"{symbol}.SS"
    return f"{symbol}.SZ"


def _fallback_sample(symbol: str, start: str, end: str) -> pd.DataFrame:
    if symbol != "000001" or not SAMPLE_DATA.exists():
        return pd.DataFrame()
    df = pd.read_csv(SAMPLE_DATA, index_col=0, parse_dates=True)
    start_at = pd.to_datetime(start) if start else df.index.min()
    end_at = pd.to_datetime(end) if end else df.index.max()
    return df.loc[(df.index >= start_at) & (df.index <= end_at)]


def daily(
    symbol: str,
    start: str = "20100101",
    end: str = "20251231",
    period: str = "daily",
    adjust: str = "qfq",
) -> pd.DataFrame:
    """A 股历史价格，优先 yfinance，失败时回退到 AKShare/本地样例。"""

    try:
        from skills.datasource.scripts.yfinance import daily as yf_daily

        df = yf_daily(
            _symbol_to_yf(symbol),
            start=f"{start[:4]}-{start[4:6]}-{start[6:]}",
            end=f"{end[:4]}-{end[4:6]}-{end[6:]}",
        )
        if not df.empty and "close" in df.columns:
            df.index = pd.to_datetime(df.index)
            return df
    except Exception:
        pass

    try:
        import akshare as ak

        raw = ak.stock_zh_a_hist(
            symbol=symbol,
            period=period,
            start_date=start,
            end_date=end,
            adjust=adjust,
        )
        df = _normalize(raw)
        if not df.empty and "close" in df.columns:
            return df
    except Exception:
        pass

    df = _fallback_sample(symbol, start, end)
    if not df.empty and "close" in df.columns:
        return df.sort_index()

    raise RuntimeError(f"无法获取 {symbol} 的行情数据")


def minute(symbol: str, period: str = "60") -> pd.DataFrame:
    """A 股分钟线 (1/5/15/30/60)。"""
    import akshare as ak

    raw = ak.stock_zh_a_hist_min_em(symbol=symbol, period=period, adjust="qfq")
    return _normalize(raw)


def index_cons(index_code: str) -> pd.DataFrame:
    """指数成分股。

    index_code: "000300" (沪深300), "000016" (上证50), "399006" (创业板指)
    """
    import akshare as ak

    return ak.index_stock_cons(symbol=index_code)
