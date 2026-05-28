"""BaoStock data fetchers — K-line, financials, index constituents, macro, dividends.

BaoStock 特色:
- 免费、无需 token，但需要 login()/logout()
- 日线数据从 1990 年开始，分钟线从 2020 年开始
- 季频财务数据从 2007 年开始
- 每日 17:30 更新日 K 线
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[3]


def _login():
    import baostock as bs

    bs.login()


def _logout():
    import baostock as bs

    bs.logout()


def _to_bs_code(symbol: str) -> str:
    """将纯数字代码转为 BaoStock 格式: 000001 -> sz.000001"""
    if "." in symbol:
        return symbol
    if symbol.startswith(("5", "6", "9")):
        return f"sh.{symbol}"
    return f"sz.{symbol}"


# ---------------------------------------------------------------------------
# K 线数据
# ---------------------------------------------------------------------------

def daily(
    symbol: str,
    start: str = "2010-01-01",
    end: str = "2025-12-31",
    adjust: str = "2",
) -> pd.DataFrame:
    """A 股日 K 线。

    symbol: 如 "000001" 或 "sh.600000"
    start/end: YYYY-MM-DD
    adjust: "1"=后复权, "2"=前复权, "3"=不复权
    """
    import baostock as bs

    code = _to_bs_code(symbol)
    fields = "date,open,high,low,close,preclose,volume,amount,adjustflag,turn,tradestatus,pctChg,isST"
    try:
        bs.login()
        rs = bs.query_history_k_data_plus(
            code, fields, start_date=start, end_date=end, frequency="d", adjustflag=adjust
        )
        df = rs.get_data()
    finally:
        bs.logout()

    if df.empty:
        return df
    numeric_cols = ["open", "high", "low", "close", "preclose", "volume", "amount", "turn", "pctChg"]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date").sort_index()
    return df[~df.index.duplicated(keep="first")]


def weekly(
    symbol: str,
    start: str = "2010-01-01",
    end: str = "2025-12-31",
    adjust: str = "2",
) -> pd.DataFrame:
    """A 股周 K 线。"""
    import baostock as bs

    code = _to_bs_code(symbol)
    fields = "date,open,high,low,close,volume,amount"
    try:
        bs.login()
        rs = bs.query_history_k_data_plus(
            code, fields, start_date=start, end_date=end, frequency="w", adjustflag=adjust
        )
        df = rs.get_data()
    finally:
        bs.logout()

    if df.empty:
        return df
    for col in ["open", "high", "low", "close", "volume", "amount"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date").sort_index()
    return df


def monthly(
    symbol: str,
    start: str = "2010-01-01",
    end: str = "2025-12-31",
    adjust: str = "2",
) -> pd.DataFrame:
    """A 股月 K 线。"""
    import baostock as bs

    code = _to_bs_code(symbol)
    fields = "date,open,high,low,close,volume,amount"
    try:
        bs.login()
        rs = bs.query_history_k_data_plus(
            code, fields, start_date=start, end_date=end, frequency="m", adjustflag=adjust
        )
        df = rs.get_data()
    finally:
        bs.logout()

    if df.empty:
        return df
    for col in ["open", "high", "low", "close", "volume", "amount"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date").sort_index()
    return df


def minute(symbol: str, freq: str = "60", start: str = "", end: str = "") -> pd.DataFrame:
    """A 股分钟 K 线。

    symbol: 如 "000001" 或 "sh.600000"
    freq: "5" / "15" / "30" / "60"
    start/end: YYYY-MM-DD，分钟线默认近 5 年
    """
    import baostock as bs

    code = _to_bs_code(symbol)
    fields = "date,time,open,high,low,close,volume,amount"
    try:
        bs.login()
        rs = bs.query_history_k_data_plus(
            code, fields, start_date=start or None, end_date=end or None, frequency=freq, adjustflag="2"
        )
        df = rs.get_data()
    finally:
        bs.logout()
    if df.empty:
        return df
    for col in ["open", "high", "low", "close", "volume", "amount"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


# ---------------------------------------------------------------------------
# 指数 K 线
# ---------------------------------------------------------------------------

def index_daily(
    index_code: str,
    start: str = "2010-01-01",
    end: str = "2025-12-31",
) -> pd.DataFrame:
    """指数日 K 线。

    index_code: "sh.000300" (沪深300), "sh.000016" (上证50), "sz.399001" (深证成指)
    """
    import baostock as bs

    fields = "date,open,high,low,close,preclose,volume,amount,pctChg"
    try:
        bs.login()
        rs = bs.query_history_k_data_plus(
            index_code, fields, start_date=start, end_date=end, frequency="d", adjustflag="3"
        )
        df = rs.get_data()
    finally:
        bs.logout()
    if df.empty:
        return df
    for col in ["open", "high", "low", "close", "preclose", "volume", "amount", "pctChg"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date").sort_index()
    return df


# ---------------------------------------------------------------------------
# 基础信息
# ---------------------------------------------------------------------------

def stock_basic(code: str = "", code_name: str = "") -> pd.DataFrame:
    """证券基本资料。

    code: 证券代码，可为空取全部
    code_name: 名称，支持模糊查询
    """
    import baostock as bs

    try:
        bs.login()
        rs = bs.query_stock_basic(code=code, code_name=code_name)
        df = rs.get_data()
    finally:
        bs.logout()
    return df


def all_stocks(day: str = "") -> pd.DataFrame:
    """给定日期的所有证券信息 (含上市状态)。"""
    import baostock as bs

    try:
        bs.login()
        rs = bs.query_all_stock(day=day)
        df = rs.get_data()
    finally:
        bs.logout()
    return df


def stock_industry(code: str = "", date: str = "") -> pd.DataFrame:
    """行业分类。"""
    import baostock as bs

    try:
        bs.login()
        rs = bs.query_stock_industry(code=code, date=date)
        df = rs.get_data()
    finally:
        bs.logout()
    return df


def trade_dates(start: str = "2015-01-01", end: str = "") -> pd.DataFrame:
    """交易日历。返回日期和是否交易日。"""
    import baostock as bs

    try:
        bs.login()
        rs = bs.query_trade_dates(start_date=start, end_date=end)
        df = rs.get_data()
    finally:
        bs.logout()
    if not df.empty:
        df["calendar_date"] = pd.to_datetime(df["calendar_date"])
    return df


# ---------------------------------------------------------------------------
# 指数成分股
# ---------------------------------------------------------------------------

def hs300_stocks(date: str = "") -> pd.DataFrame:
    """沪深 300 成分股。"""
    import baostock as bs

    try:
        bs.login()
        rs = bs.query_hs300_stocks(date=date)
        df = rs.get_data()
    finally:
        bs.logout()
    return df


def sz50_stocks(date: str = "") -> pd.DataFrame:
    """上证 50 成分股。"""
    import baostock as bs

    try:
        bs.login()
        rs = bs.query_sz50_stocks(date=date)
        df = rs.get_data()
    finally:
        bs.logout()
    return df


def zz500_stocks(date: str = "") -> pd.DataFrame:
    """中证 500 成分股。"""
    import baostock as bs

    try:
        bs.login()
        rs = bs.query_zz500_stocks(date=date)
        df = rs.get_data()
    finally:
        bs.logout()
    return df


# ---------------------------------------------------------------------------
# 季频财务数据
# ---------------------------------------------------------------------------

def balance_data(code: str, year: int | None = None, quarter: int | None = None) -> pd.DataFrame:
    """季频偿债能力 (资产负债表)。"""
    import baostock as bs

    try:
        bs.login()
        rs = bs.query_balance_data(code=_to_bs_code(code), year=year, quarter=quarter)
        df = rs.get_data()
    finally:
        bs.logout()
    return df


def profit_data(code: str, year: int | None = None, quarter: int | None = None) -> pd.DataFrame:
    """季频盈利能力 (利润表)。"""
    import baostock as bs

    try:
        bs.login()
        rs = bs.query_profit_data(code=_to_bs_code(code), year=year, quarter=quarter)
        df = rs.get_data()
    finally:
        bs.logout()
    return df


def cash_flow_data(code: str, year: int | None = None, quarter: int | None = None) -> pd.DataFrame:
    """季频现金流量。"""
    import baostock as bs

    try:
        bs.login()
        rs = bs.query_cash_flow_data(code=_to_bs_code(code), year=year, quarter=quarter)
        df = rs.get_data()
    finally:
        bs.logout()
    return df


def dupont_data(code: str, year: int | None = None, quarter: int | None = None) -> pd.DataFrame:
    """季频杜邦指标。"""
    import baostock as bs

    try:
        bs.login()
        rs = bs.query_dupont_data(code=_to_bs_code(code), year=year, quarter=quarter)
        df = rs.get_data()
    finally:
        bs.logout()
    return df


def growth_data(code: str, year: int | None = None, quarter: int | None = None) -> pd.DataFrame:
    """季频成长能力。"""
    import baostock as bs

    try:
        bs.login()
        rs = bs.query_growth_data(code=_to_bs_code(code), year=year, quarter=quarter)
        df = rs.get_data()
    finally:
        bs.logout()
    return df


def operation_data(code: str, year: int | None = None, quarter: int | None = None) -> pd.DataFrame:
    """季频营运能力。"""
    import baostock as bs

    try:
        bs.login()
        rs = bs.query_operation_data(code=_to_bs_code(code), year=year, quarter=quarter)
        df = rs.get_data()
    finally:
        bs.logout()
    return df


# ---------------------------------------------------------------------------
# 分红 / 复权 / 业绩预告
# ---------------------------------------------------------------------------

def dividend_data(code: str, year: str = "", year_type: str = "report") -> pd.DataFrame:
    """股息分红。

    year: 年份，如 "2024"
    year_type: "report"=预案公告年份, "operate"=除权除息年份
    """
    import baostock as bs

    try:
        bs.login()
        rs = bs.query_dividend_data(code=_to_bs_code(code), year=year, yearType=year_type)
        df = rs.get_data()
    finally:
        bs.logout()
    return df


def adjust_factor(code: str, start: str = "2015-01-01", end: str = "") -> pd.DataFrame:
    """复权因子。"""
    import baostock as bs

    try:
        bs.login()
        rs = bs.query_adjust_factor(code=_to_bs_code(code), start_date=start, end_date=end)
        df = rs.get_data()
    finally:
        bs.logout()
    return df


def forecast_report(code: str, start: str = "2015-01-01", end: str = "") -> pd.DataFrame:
    """业绩预告。"""
    import baostock as bs

    try:
        bs.login()
        rs = bs.query_forecast_report(code=_to_bs_code(code), start_date=start, end_date=end)
        df = rs.get_data()
    finally:
        bs.logout()
    return df


def performance_express(code: str, start: str = "2015-01-01", end: str = "") -> pd.DataFrame:
    """业绩快报。"""
    import baostock as bs

    try:
        bs.login()
        rs = bs.query_performance_express_report(code=_to_bs_code(code), start_date=start, end_date=end)
        df = rs.get_data()
    finally:
        bs.logout()
    return df


# ---------------------------------------------------------------------------
# 宏观数据
# ---------------------------------------------------------------------------

def money_supply(start: str = "", end: str = "") -> pd.DataFrame:
    """货币供应量 (月度)。

    start/end: YYYY-MM 格式
    """
    import baostock as bs

    try:
        bs.login()
        rs = bs.query_money_supply_data_month(start_date=start, end_date=end)
        df = rs.get_data()
    finally:
        bs.logout()
    return df


def deposit_rate(start: str = "", end: str = "") -> pd.DataFrame:
    """存款利率。"""
    import baostock as bs

    try:
        bs.login()
        rs = bs.query_deposit_rate_data(start_date=start, end_date=end)
        df = rs.get_data()
    finally:
        bs.logout()
    return df


def loan_rate(start: str = "", end: str = "") -> pd.DataFrame:
    """贷款利率。"""
    import baostock as bs

    try:
        bs.login()
        rs = bs.query_loan_rate_data(start_date=start, end_date=end)
        df = rs.get_data()
    finally:
        bs.logout()
    return df


def reserve_ratio(start: str = "", end: str = "", year_type: str = "0") -> pd.DataFrame:
    """存款准备金率。

    year_type: "0"=公告日期, "1"=生效日期
    """
    import baostock as bs

    try:
        bs.login()
        rs = bs.query_required_reserve_ratio_data(start_date=start, end_date=end, yearType=year_type)
        df = rs.get_data()
    finally:
        bs.logout()
    return df
