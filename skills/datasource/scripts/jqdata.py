"""JQData (聚宽) 数据获取"""

import os
from pathlib import Path
import pandas as pd

_jqdata_authed = False


def _load_dotenv():
    for p in [Path(__file__).resolve().parents[3] / ".env",
              Path(__file__).resolve().parents[1] / ".env"]:
        if p.exists():
            for line in p.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    if k not in os.environ:
                        os.environ[k] = v
            return


def _auth():
    global _jqdata_authed
    if _jqdata_authed:
        return
    _load_dotenv()
    user = os.environ.get("JQDATA_USER", "")
    password = os.environ.get("JQDATA_PASS", "")
    if not user or not password:
        raise RuntimeError("JQData 未配置: 请在 .env 中设置 JQDATA_USER=<手机号> JQDATA_PASS=<密码>")
    from jqdatasdk import auth
    auth(user, password)
    _jqdata_authed = True


def daily(security: str, start: str = "2020-01-01", end: str = "2025-12-31",
          fields: list = None) -> pd.DataFrame:
    """JQData A 股日线行情（前复权）。

    security: '000001.XSHE'（平安银行）, '600519.XSHG'（贵州茅台）
    """
    _auth()
    from jqdatasdk import get_price
    if fields is None:
        fields = ["open", "close", "high", "low", "volume", "money"]
    df = get_price(security, start_date=start, end_date=end,
                   frequency="daily", fields=fields, skip_paused=False, fq="pre")
    if isinstance(df, pd.DataFrame):
        df.columns = [c.lower() for c in df.columns]
        df.index.name = "date"
    return df


def financial(security: str, stat_date: str = "2024q4") -> pd.DataFrame:
    """JQData 单季度财务数据"""
    _auth()
    from jqdatasdk import get_fundamentals, query, valuation, income, balance
    q = query(valuation, income, balance).filter(
        valuation.code == security,
        balance.stat_date == stat_date,
        income.stat_date == stat_date,
    )
    df = get_fundamentals(q, stat_date)
    if isinstance(df, pd.DataFrame):
        df.columns = [c.lower() for c in df.columns]
    return df


def valuation(security: str, start: str = "2020-01-01", end: str = "2025-12-31") -> pd.DataFrame:
    """JQData 市值表数据（流通市值、总市值、PE/PB）"""
    _auth()
    from jqdatasdk import get_valuation
    df = get_valuation(security, start_date=start, end_date=end)
    if isinstance(df, pd.DataFrame):
        df.columns = [c.lower() for c in df.columns]
    return df


def financials_multi(security: str, quarters: list = None) -> pd.DataFrame:
    """JQData 多季度财务数据。quarters: ['2024q1','2024q2','2024q3','2024q4']"""
    _auth()
    from jqdatasdk import get_fundamentals, query, valuation, income, balance
    if quarters is None:
        quarters = ["2024q4"]
    dfs = []
    for q in quarters:
        qry = query(valuation, income, balance).filter(
            valuation.code == security, balance.stat_date == q, income.stat_date == q)
        df = get_fundamentals(qry, stat_date=q)
        if isinstance(df, pd.DataFrame):
            df.columns = [c.lower() for c in df.columns]
        dfs.append(df)
    return pd.concat(dfs)


def futures_info() -> pd.DataFrame:
    """JQData 所有期货合约信息"""
    _auth()
    from jqdatasdk import get_all_securities
    return get_all_securities(types=["futures"])


def index_weights(index_code: str, date: str = None) -> pd.DataFrame:
    """JQData 指数成分股及权重。index_code: '000300.XSHG'"""
    _auth()
    from jqdatasdk import get_index_weights
    return get_index_weights(index_code, date=date)


def alpha101(universe: str = "000300.XSHG") -> pd.DataFrame:
    """JQData Alpha101 因子批量计算"""
    _auth()
    from jqdatasdk import get_all_alpha_101, get_index_stocks
    stocks = get_index_stocks(universe)
    return get_all_alpha_101(stocks)


def alpha191(universe: str = "000300.XSHG") -> pd.DataFrame:
    """JQData Alpha191 因子批量计算"""
    _auth()
    from jqdatasdk import get_all_alpha_191, get_index_stocks
    stocks = get_index_stocks(universe)
    return get_all_alpha_191(stocks)


def query_count() -> dict:
    """查询 JQData 当日剩余可调用条数"""
    _auth()
    from jqdatasdk import get_query_count
    return get_query_count()


def logout():
    """JQData 注销"""
    global _jqdata_authed
    from jqdatasdk import logout
    logout()
    _jqdata_authed = False
