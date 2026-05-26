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


# ── JQData 聚宽 SDK ──────────────────────────────────────────

_jqdata_authed = False


def _jqdata_auth():
    """JQData 登录认证（自动从 .env 读取 JQDATA_USER / JQDATA_PASS）"""
    global _jqdata_authed
    if _jqdata_authed:
        return
    user = os.environ.get("JQDATA_USER", "")
    password = os.environ.get("JQDATA_PASS", "")
    if not user or not password:
        raise RuntimeError("JQData 未配置: 请在 .env 中设置 JQDATA_USER=<手机号> JQDATA_PASS=<密码>")
    from jqdatasdk import auth
    auth(user, password)
    _jqdata_authed = True


def fetch_jqdata_daily(security: str, start: str = "2020-01-01", end: str = "2025-12-31",
                       fields: list = None) -> pd.DataFrame:
    """JQData A 股日线行情（前复权）。

    security: 聚宽格式代码，如 '000001.XSHE'（平安银行）, '600519.XSHG'（贵州茅台）
    fields: 默认 ['open','close','high','low','volume','money']
    """
    _jqdata_auth()
    from jqdatasdk import get_price

    if fields is None:
        fields = ["open", "close", "high", "low", "volume", "money"]

    df = get_price(security, start_date=start, end_date=end,
                   frequency="daily", fields=fields, skip_paused=False, fq="pre")
    if isinstance(df, pd.DataFrame):
        df.columns = [c.lower() for c in df.columns]
        df.index.name = "date"
    return df


def fetch_jqdata_financial(security: str, stat_date: str = "2024q4",
                           fields: list = None) -> pd.DataFrame:
    """JQData 单季度财务数据。

    stat_date: 报告期，如 '2024q4'
    fields: 默认 ['code','day','capital_stock','total_assets','total_liability',
                   'operating_revenue','operating_profit','net_profit','roe','eps']
    """
    _jqdata_auth()
    from jqdatasdk import get_fundamentals, query, valuation, income, balance

    if fields is None:
        q = query(valuation, income, balance).filter(
            valuation.code == security,
            balance.stat_date == stat_date,
            income.stat_date == stat_date,
        )
    else:
        q = query(valuation, income, balance).filter(
            valuation.code == security,
            balance.stat_date == stat_date,
            income.stat_date == stat_date,
        )
    df = get_fundamentals(q, stat_date)
    if isinstance(df, pd.DataFrame):
        df.columns = [c.lower() for c in df.columns]
    return df


def fetch_jqdata_valuation(security: str, start: str = "2020-01-01", end: str = "2025-12-31",
                           fields: list = None) -> pd.DataFrame:
    """JQData 市值表数据（流通市值、总市值、PE/PB）。"""
    _jqdata_auth()
    from jqdatasdk import get_valuation
    df = get_valuation(security, start_date=start, end_date=end, fields=fields)
    if isinstance(df, pd.DataFrame):
        df.columns = [c.lower() for c in df.columns]
    return df


def fetch_jqdata_financials_multi(security: str, quarters: list = None,
                                  fields: list = None) -> pd.DataFrame:
    """JQData 多季度财务数据。

    quarters: ['2024q1','2024q2','2024q3','2024q4']
    """
    _jqdata_auth()
    from jqdatasdk import get_fundamentals, query, valuation, income, balance

    if quarters is None:
        quarters = ["2024q4"]

    dfs = []
    for q in quarters:
        qry = query(valuation, income, balance).filter(
            valuation.code == security,
            balance.stat_date == q,
            income.stat_date == q,
        )
        df = get_fundamentals(qry, stat_date=q)
        if isinstance(df, pd.DataFrame):
            df.columns = [c.lower() for c in df.columns]
        dfs.append(df)
    import pandas as pd
    return pd.concat(dfs)


def fetch_jqdata_futures_info() -> pd.DataFrame:
    """JQData 所有期货合约信息。"""
    _jqdata_auth()
    from jqdatasdk import get_all_securities
    df = get_all_securities(types=["futures"])
    return df


def fetch_jqdata_index_weights(index_code: str, date: str = None) -> pd.DataFrame:
    """JQData 指数成分股及权重。

    index_code: 聚宽格式，如 '000300.XSHG'
    """
    _jqdata_auth()
    from jqdatasdk import get_index_weights
    return get_index_weights(index_code, date=date)


def fetch_jqdata_alpha101(universe: str = "000300.XSHG") -> pd.DataFrame:
    """JQData Alpha101 因子批量计算。✓ 试用可用"""
    _jqdata_auth()
    from jqdatasdk import get_all_alpha_101, get_index_stocks
    stocks = get_index_stocks(universe)
    return get_all_alpha_101(stocks)


def fetch_jqdata_alpha191(universe: str = "000300.XSHG") -> pd.DataFrame:
    """JQData Alpha191 因子批量计算。✓ 试用可用"""
    _jqdata_auth()
    from jqdatasdk import get_all_alpha_191, get_index_stocks
    stocks = get_index_stocks(universe)
    return get_all_alpha_191(stocks)


def jqdata_query_count() -> dict:
    """查询 JQData 当日剩余可调用条数"""
    _jqdata_auth()
    from jqdatasdk import get_query_count
    return get_query_count()


def jqdata_logout():
    """JQData 注销连接"""
    global _jqdata_authed
    from jqdatasdk import logout
    logout()
    _jqdata_authed = False


# ── 缓存 ──────────────────────────────────────────────────────

def cache_get(symbol: str, source: str, fetcher, **kwargs) -> pd.DataFrame:
    """缓存读取/写入"""
    os.makedirs(CACHE_DIR, exist_ok=True)
    key = f"{source}_{symbol}_{kwargs.get('period','daily')}"
    path = f"{CACHE_DIR}/{key}.parquet"
    if os.path.exists(path):
        return pd.read_parquet(path)
    df = fetcher(symbol, **kwargs)
    if os.path.exists(CACHE_DIR):  # re-check after fetcher may have changed cwd
        df.to_parquet(path)
    return df
