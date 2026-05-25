"""数据获取工具 — AKShare / yfinance 封装"""

import os
import time
import pandas as pd

CACHE_DIR = "data/cache"

COLUMN_MAP = {
    "日期": "date", "开盘": "open", "最高": "high", "最低": "low",
    "收盘": "close", "成交量": "volume", "成交额": "amount",
    "振幅": "amplitude", "涨跌幅": "pct_change", "涨跌额": "change", "换手率": "turnover",
}


def fetch_a_stock(symbol: str, start: str = "20100101", end: str = "20251231",
                  period: str = "daily", adjust: str = "qfq") -> pd.DataFrame:
    """A 股历史日线（前复权）"""
    import akshare as ak
    raw = ak.stock_zh_a_hist(symbol=symbol, period=period, start_date=start, end_date=end, adjust=adjust)
    return _normalize(raw)


def fetch_a_minute(symbol: str, period: str = "60") -> pd.DataFrame:
    """A 股分钟线"""
    import akshare as ak
    raw = ak.stock_zh_a_hist_min_em(symbol=symbol, period=period, adjust="qfq")
    return _normalize(raw)


def fetch_index_cons(index_code: str) -> pd.DataFrame:
    """指数成分股"""
    import akshare as ak
    return ak.index_stock_cons(index_code=index_code)


def fetch_us_stock(ticker: str, start: str = "2010-01-01", end: str = "2025-12-31") -> pd.DataFrame:
    """美股日线"""
    import yfinance as yf
    df = yf.download(ticker, start=start, end=end, progress=False)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.droplevel(1)
    df.columns = [c.lower().replace(" ", "_") for c in df.columns]
    return df


def _normalize(df: pd.DataFrame) -> pd.DataFrame:
    """标准化列名和索引"""
    df = df.rename(columns={k: v for k, v in COLUMN_MAP.items() if k in df.columns})
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date")
    df = df.sort_index()
    df = df[~df.index.duplicated(keep="first")]
    return df


def cache_get(symbol: str, source: str, fetcher, **kwargs) -> pd.DataFrame:
    """缓存读取/写入"""
    os.makedirs(CACHE_DIR, exist_ok=True)
    key = f"{source}_{symbol}_{kwargs.get('period','daily')}"
    path = f"{CACHE_DIR}/{key}.parquet"
    if os.path.exists(path):
        return pd.read_parquet(path)
    df = fetcher(symbol, **kwargs)
    df.to_parquet(path)
    return df
