"""AKShare 数据获取 — A 股行情、成分股"""

import pandas as pd

COLUMN_MAP = {
    "日期": "date", "开盘": "open", "最高": "high", "最低": "low",
    "收盘": "close", "成交量": "volume", "成交额": "amount",
    "振幅": "amplitude", "涨跌幅": "pct_change", "涨跌额": "change", "换手率": "turnover",
}


def _normalize(df: pd.DataFrame) -> pd.DataFrame:
    df = df.rename(columns={k: v for k, v in COLUMN_MAP.items() if k in df.columns})
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date")
    df = df.sort_index()
    df = df[~df.index.duplicated(keep="first")]
    return df


def daily(symbol: str, start: str = "20100101", end: str = "20251231",
          period: str = "daily", adjust: str = "qfq") -> pd.DataFrame:
    """A 股历史日线（前复权）"""
    import akshare as ak
    raw = ak.stock_zh_a_hist(symbol=symbol, period=period, start_date=start, end_date=end, adjust=adjust)
    return _normalize(raw)


def minute(symbol: str, period: str = "60") -> pd.DataFrame:
    """A 股分钟线 (1/5/15/30/60)"""
    import akshare as ak
    raw = ak.stock_zh_a_hist_min_em(symbol=symbol, period=period, adjust="qfq")
    return _normalize(raw)


def index_cons(index_code: str) -> pd.DataFrame:
    """指数成分股"""
    import akshare as ak
    return ak.index_stock_cons(index_code=index_code)
