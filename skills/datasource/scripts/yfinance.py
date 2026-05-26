"""yfinance 数据获取 — 美股/全球行情"""

import pandas as pd


def daily(ticker: str, start: str = "2010-01-01", end: str = "2025-12-31") -> pd.DataFrame:
    """美股日线"""
    import yfinance as yf
    df = yf.download(ticker, start=start, end=end, progress=False)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.droplevel(1)
    df.columns = [c.lower().replace(" ", "_") for c in df.columns]
    return df


def multi(tickers: list, start: str = "2010-01-01", end: str = "2025-12-31") -> pd.DataFrame:
    """批量美股日线"""
    import yfinance as yf
    df = yf.download(tickers, start=start, end=end, progress=False)
    return df
