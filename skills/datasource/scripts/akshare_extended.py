"""AKShare extended data fetchers — fund, ETF, CB, macro, money flow, financials, index, news."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[3]


# ---------------------------------------------------------------------------
# 基础信息
# ---------------------------------------------------------------------------

def stock_basic(market: str | None = None) -> pd.DataFrame:
    """A 股股票列表。

    market: "主板" / "创业板" / "科创板" / None=全部
    """
    import akshare as ak

    df = ak.stock_info_a_code_name()
    df = df.rename(columns={"code": "ts_code", "name": "name"})
    if market:
        # stock_info_a_code_name 不返回 market 字段, 需要时可用 stock_zh_a_spot_em
        ...
    return df


def stock_spot() -> pd.DataFrame:
    """A 股实时行情快照 (所有股票)。"""
    import akshare as ak

    df = ak.stock_zh_a_spot_em()
    return df


def trade_cal(start: str = "20200101", end: str = "20251231") -> pd.DataFrame:
    """交易日历 (上交所)。

    start/end: YYYYMMDD
    """
    import akshare as ak

    df = ak.tool_trade_date_hist_sina()
    if start or end:
        df["trade_date"] = pd.to_datetime(df["trade_date"])
        df = df[(df["trade_date"] >= start) & (df["trade_date"] <= end)]
    return df


# ---------------------------------------------------------------------------
# 指数
# ---------------------------------------------------------------------------

def index_daily(ts_code: str, start: str = "20100101", end: str = "20251231") -> pd.DataFrame:
    """指数日线行情。

    ts_code: 如 "000300" (沪深300), "000016" (上证50), "399006" (创业板指)
    """
    import akshare as ak

    df = ak.stock_zh_index_daily(symbol=f"sh{ts_code}" if ts_code.startswith("000") else f"sz{ts_code}")
    if df.empty:
        return df
    df = df.rename(columns={"date": "date", "open": "open", "high": "high",
                            "low": "low", "close": "close", "volume": "volume"})
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date").sort_index()
    if start and "date" not in (df.index.name or ""):
        ...
    return df


def index_cons(index_code: str) -> pd.DataFrame:
    """指数成分股。

    index_code: "000300" (沪深300), "000016" (上证50), "399006" (创业板指)
    """
    import akshare as ak

    return ak.index_stock_cons(symbol=index_code)


# ---------------------------------------------------------------------------
# ETF / LOF
# ---------------------------------------------------------------------------

def etf_basic() -> pd.DataFrame:
    """ETF 基本信息列表 (沪深两市, 包含 QDII)。"""
    import akshare as ak

    df_sh = ak.fund_etf_category_sina(symbol="ETF基金")
    df_sz = ak.fund_etf_category_sina(symbol="LOF基金")
    df = pd.concat([df_sh, df_sz], ignore_index=True)
    return df


def etf_daily(ts_code: str, start: str = "20100101", end: str = "20251231") -> pd.DataFrame:
    """ETF 日线行情。

    ts_code: 如 "510050" (上证50ETF)
    """
    import akshare as ak

    df = ak.fund_etf_hist_sina(symbol=ts_code)
    if df.empty:
        return df
    df = df.rename(columns={"date": "date", "open": "open", "high": "high",
                            "low": "low", "close": "close", "volume": "volume"})
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date").sort_index()
    return df


# ---------------------------------------------------------------------------
# 公募基金
# ---------------------------------------------------------------------------

def fund_basic() -> pd.DataFrame:
    """公募基金列表。"""
    import akshare as ak

    df = ak.fund_name_em()
    return df


def fund_nav(ts_code: str) -> pd.DataFrame:
    """基金历史净值。

    ts_code: 基金代码, 如 "000001"
    """
    import akshare as ak

    df = ak.fund_open_fund_info_em(symbol=ts_code, indicator="单位净值走势")
    return df


# ---------------------------------------------------------------------------
# 可转债
# ---------------------------------------------------------------------------

def cb_basic() -> pd.DataFrame:
    """可转债基本信息列表。"""
    import akshare as ak

    df = ak.bond_cb_jsl(cookie="")
    return df


def cb_daily(ts_code: str, start: str = "20100101", end: str = "20251231") -> pd.DataFrame:
    """可转债日线行情。

    ts_code: 可转债代码, 如 "113013"
    """
    import akshare as ak

    df = ak.bond_zh_hs_cov_daily(symbol=f"sh{ts_code}" if ts_code.startswith(("1", "5", "6")) else f"sz{ts_code}")
    if df.empty:
        return df
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date").sort_index()
    return df


# ---------------------------------------------------------------------------
# 资金流向
# ---------------------------------------------------------------------------

def moneyflow(ts_code: str) -> pd.DataFrame:
    """个股资金流向 (东方财富, 100 日)。

    ts_code: 股票代码, 如 "000001"
    """
    import akshare as ak

    df = ak.stock_individual_fund_flow(stock=ts_code, market="sz" if ts_code.startswith(("0", "3")) else "sh")
    return df


def moneyflow_market() -> pd.DataFrame:
    """大盘资金流向 (东方财富)。"""
    import akshare as ak

    df = ak.stock_market_fund_flow()
    return df


# ---------------------------------------------------------------------------
# 财务指标
# ---------------------------------------------------------------------------

def fina_indicator(ts_code: str) -> pd.DataFrame:
    """个股最新财务指标。

    ts_code: 股票代码, 如 "000001"
    """
    import akshare as ak

    df = ak.stock_financial_abstract(symbol=ts_code)
    return df


def fina_balance_sheet(ts_code: str) -> pd.DataFrame:
    """资产负债表。

    ts_code: 股票代码, 如 "000001" (深交所) 或 "600519" (上交所)
    """
    import akshare as ak

    if ts_code.startswith(("0", "3")):
        symbol = f"SZ{ts_code}"
    elif ts_code.startswith(("6", "5", "9")):
        symbol = f"SH{ts_code}"
    else:
        symbol = ts_code
    df = ak.stock_balance_sheet_by_report_em(symbol=symbol)
    return df


def fina_income(ts_code: str) -> pd.DataFrame:
    """利润表。

    ts_code: 股票代码, 如 "000001" (深交所) 或 "600519" (上交所)
    """
    import akshare as ak

    if ts_code.startswith(("0", "3")):
        symbol = f"SZ{ts_code}"
    elif ts_code.startswith(("6", "5", "9")):
        symbol = f"SH{ts_code}"
    else:
        symbol = ts_code
    df = ak.stock_profit_sheet_by_report_em(symbol=symbol)
    return df


def fina_cashflow(ts_code: str) -> pd.DataFrame:
    """现金流量表。

    ts_code: 股票代码, 如 "000001" (深交所) 或 "600519" (上交所)
    """
    import akshare as ak

    if ts_code.startswith(("0", "3")):
        symbol = f"SZ{ts_code}"
    elif ts_code.startswith(("6", "5", "9")):
        symbol = f"SH{ts_code}"
    else:
        symbol = ts_code
    df = ak.stock_cash_flow_sheet_by_report_em(symbol=symbol)
    return df


# ---------------------------------------------------------------------------
# 宏观数据
# ---------------------------------------------------------------------------

def macro_cpi() -> pd.DataFrame:
    """CPI 居民消费价格指数。"""
    import akshare as ak

    df = ak.macro_china_cpi_yearly()
    return df


def macro_pmi() -> pd.DataFrame:
    """PMI 采购经理指数。"""
    import akshare as ak

    df = ak.macro_china_pmi_yearly()
    return df


def macro_money_supply() -> pd.DataFrame:
    """货币供应量 (M0/M1/M2)。"""
    import akshare as ak

    df = ak.macro_china_money_supply()
    return df


def macro_shibor(indicator: str = "隔夜") -> pd.DataFrame:
    """Shibor 利率。

    indicator: "隔夜" / "1周" / "2周" / "1月" / "3月" / "6月" / "9月" / "1年"
    """
    import akshare as ak

    df = ak.rate_interbank(indicator=indicator)
    return df


def macro_gdp() -> pd.DataFrame:
    """GDP 国内生产总值。"""
    import akshare as ak

    df = ak.macro_china_gdp_yearly()
    return df


# ---------------------------------------------------------------------------
# 新闻 / 公告
# ---------------------------------------------------------------------------

def news_cctv(date: str = "20240101") -> pd.DataFrame:
    """新闻联播文字稿。

    date: YYYYMMDD
    """
    import akshare as ak

    df = ak.news_cctv(date=date)
    return df


# ---------------------------------------------------------------------------
# 期货
# ---------------------------------------------------------------------------

def futures_daily(ts_code: str, start: str = "20100101", end: str = "20251231") -> pd.DataFrame:
    """期货日线行情 (新浪)。

    ts_code: 如 "AU0" (黄金连续), "CU0" (沪铜连续)
    """
    import akshare as ak

    df = ak.futures_main_sina(symbol=ts_code)
    if df.empty:
        return df
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date").sort_index()
    return df
