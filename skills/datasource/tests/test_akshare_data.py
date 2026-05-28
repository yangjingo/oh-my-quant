"""Smoke tests for AKShare data fetchers.

Run with: python -m pytest skills/datasource/tests/test_akshare_data.py -v
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

# Ensure project root is on sys.path
ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _check_api_available() -> bool:
    """Quick check whether eastmoney/sina APIs are reachable."""
    try:
        import urllib.request

        urllib.request.urlopen("https://push2.eastmoney.com", timeout=5)
        return True
    except Exception:
        return False


NETWORK_OK = _check_api_available()
"""Pre-flight network check — if False, tests depending on external APIs are skipped."""


# ---------------------------------------------------------------------------
# Core fetchers (skills/datasource/scripts/akshare.py)
# ---------------------------------------------------------------------------


class TestCoreDaily:
    """Tests for the core daily() function."""

    def test_daily_returns_dataframe(self):
        from skills.datasource.scripts.akshare import daily

        df = daily("000001", start="20250101", end="20250120", period="daily")
        assert isinstance(df, pd.DataFrame)
        assert not df.empty, "Expected non-empty DataFrame for 000001"

    def test_daily_has_required_columns(self):
        from skills.datasource.scripts.akshare import daily

        df = daily("000001", start="20250101", end="20250120")
        for col in ["open", "high", "low", "close"]:
            assert col in df.columns, f"Missing required column: {col}"

    def test_daily_index_is_datetime(self):
        from skills.datasource.scripts.akshare import daily

        df = daily("000001", start="20250101", end="20250120")
        assert isinstance(df.index, pd.DatetimeIndex), f"Expected DatetimeIndex, got {type(df.index)}"

    def test_daily_index_sorted(self):
        from skills.datasource.scripts.akshare import daily

        df = daily("000001", start="20250101", end="20250120")
        assert df.index.is_monotonic_increasing, "Index must be sorted"

    def test_daily_no_duplicate_index(self):
        from skills.datasource.scripts.akshare import daily

        df = daily("000001", start="20250101", end="20250120")
        assert not df.index.duplicated().any(), "Index must have no duplicates"

    def test_daily_shanghai_stock(self):
        from skills.datasource.scripts.akshare import daily

        df = daily("600036", start="20250301", end="20250315")
        assert isinstance(df, pd.DataFrame)
        assert not df.empty, "上海股票应该可以获取"


class TestCoreMinute:
    """Tests for minute() function."""

    @pytest.mark.skipif(not NETWORK_OK, reason="eastmoney API unreachable")
    def test_minute_returns_dataframe(self):
        from skills.datasource.scripts.akshare import minute

        df = minute("000001", period="60")
        assert isinstance(df, pd.DataFrame)


class TestCoreIndexCons:
    """Tests for index_cons() function."""

    def test_index_cons_hs300(self):
        from skills.datasource.scripts.akshare import index_cons

        df = index_cons(index_code="000300")
        assert isinstance(df, pd.DataFrame)
        assert not df.empty, "沪深300成分股应该有数据"


class TestFallback:
    """Tests for the fallback mechanism."""

    def test_fallback_sample(self):
        from skills.datasource.scripts.akshare import _fallback_sample

        df = _fallback_sample("000001", "20250101", "20250131")
        assert isinstance(df, pd.DataFrame)
        if not df.empty:
            assert "close" in df.columns

    def test_fallback_unknown_symbol(self):
        from skills.datasource.scripts.akshare import _fallback_sample

        df = _fallback_sample("999999", "20250101", "20250131")
        assert isinstance(df, pd.DataFrame)
        assert df.empty, "Unknown symbol should return empty DataFrame"

    def test_symbol_to_yf_sz(self):
        from skills.datasource.scripts.akshare import _symbol_to_yf

        assert _symbol_to_yf("000001") == "000001.SZ"
        assert _symbol_to_yf("300750") == "300750.SZ"

    def test_symbol_to_yf_sh(self):
        from skills.datasource.scripts.akshare import _symbol_to_yf

        assert _symbol_to_yf("600036") == "600036.SS"
        assert _symbol_to_yf("510050") == "510050.SS"

    def test_normalize_column_rename(self):
        from skills.datasource.scripts.akshare import _normalize

        raw = pd.DataFrame({
            "日期": ["20250101", "20250102"],
            "开盘": [10.0, 11.0],
            "收盘": [10.5, 11.5],
            "最高": [10.8, 12.0],
            "最低": [9.8, 10.5],
            "成交量": [1000, 2000],
        })
        df = _normalize(raw)
        assert "open" in df.columns
        assert "close" in df.columns
        assert "high" in df.columns
        assert "low" in df.columns
        assert "volume" in df.columns


# ---------------------------------------------------------------------------
# Extended fetchers (skills/datasource/scripts/akshare_extended.py)
# ---------------------------------------------------------------------------

AK_EXTENDED_MODULE = "skills.datasource.scripts.akshare_extended"


class TestExtendedStock:
    """Tests for stock-level extended fetchers."""

    @pytest.mark.skipif(not NETWORK_OK, reason="eastmoney API unreachable")
    def test_stock_basic(self):
        from skills.datasource.scripts.akshare_extended import stock_basic

        df = stock_basic()
        assert isinstance(df, pd.DataFrame)
        assert not df.empty
        assert "ts_code" in df.columns or "code" in df.columns

    @pytest.mark.skipif(not NETWORK_OK, reason="eastmoney API unreachable")
    def test_stock_spot(self):
        from skills.datasource.scripts.akshare_extended import stock_spot

        df = stock_spot()
        assert isinstance(df, pd.DataFrame)

    def test_trade_cal(self):
        from skills.datasource.scripts.akshare_extended import trade_cal

        df = trade_cal(start="20250101", end="20250131")
        assert isinstance(df, pd.DataFrame)
        assert not df.empty


class TestExtendedIndex:
    """Tests for index-level extended fetchers."""

    def test_index_daily(self):
        from skills.datasource.scripts.akshare_extended import index_daily

        df = index_daily("000300")  # 沪深300
        assert isinstance(df, pd.DataFrame)
        # note: this endpoint may return empty in some environments

    def test_index_cons(self):
        from skills.datasource.scripts.akshare_extended import index_cons

        df = index_cons(index_code="000300")
        assert isinstance(df, pd.DataFrame)


class TestExtendedETF:
    """Tests for ETF extended fetchers."""

    def test_etf_basic(self):
        from skills.datasource.scripts.akshare_extended import etf_basic

        df = etf_basic()
        assert isinstance(df, pd.DataFrame)
        assert not df.empty, "ETF基本信息应该有数据"

    def test_etf_daily(self):
        from skills.datasource.scripts.akshare_extended import etf_daily

        df = etf_daily("510050", start="20250301", end="20250320")
        assert isinstance(df, pd.DataFrame)


class TestExtendedFund:
    """Tests for mutual fund extended fetchers."""

    def test_fund_basic(self):
        from skills.datasource.scripts.akshare_extended import fund_basic

        df = fund_basic()
        assert isinstance(df, pd.DataFrame)
        assert not df.empty, "基金列表应该有数据"

    def test_fund_nav(self):
        from skills.datasource.scripts.akshare_extended import fund_nav

        df = fund_nav("000001")  # 华夏成长混合
        assert isinstance(df, pd.DataFrame)


class TestExtendedCB:
    """Tests for convertible bond extended fetchers."""

    @pytest.mark.skip(reason="bond_cb_jsl 可能需要 cookie")
    def test_cb_basic(self):
        from skills.datasource.scripts.akshare_extended import cb_basic

        df = cb_basic()
        assert isinstance(df, pd.DataFrame)


class TestExtendedMoneyFlow:
    """Tests for money flow extended fetchers."""

    @pytest.mark.skipif(not NETWORK_OK, reason="eastmoney API unreachable")
    def test_moneyflow(self):
        from skills.datasource.scripts.akshare_extended import moneyflow

        df = moneyflow("000001")
        assert isinstance(df, pd.DataFrame)

    def test_moneyflow_market(self):
        from skills.datasource.scripts.akshare_extended import moneyflow_market

        df = moneyflow_market()
        assert isinstance(df, pd.DataFrame)


class TestExtendedFinancials:
    """Tests for financial statement extended fetchers."""

    def test_fina_indicator(self):
        from skills.datasource.scripts.akshare_extended import fina_indicator

        df = fina_indicator("000001")
        assert isinstance(df, pd.DataFrame)

    def test_fina_balance_sheet(self):
        from skills.datasource.scripts.akshare_extended import fina_balance_sheet

        df = fina_balance_sheet("000001")
        assert isinstance(df, pd.DataFrame)

    def test_fina_income(self):
        from skills.datasource.scripts.akshare_extended import fina_income

        df = fina_income("000001")
        assert isinstance(df, pd.DataFrame)

    def test_fina_cashflow(self):
        from skills.datasource.scripts.akshare_extended import fina_cashflow

        df = fina_cashflow("000001")
        assert isinstance(df, pd.DataFrame)


class TestExtendedMacro:
    """Tests for macro indicator extended fetchers."""

    def test_macro_cpi(self):
        from skills.datasource.scripts.akshare_extended import macro_cpi

        df = macro_cpi()
        assert isinstance(df, pd.DataFrame)
        assert not df.empty, "CPI 应该有数据"

    def test_macro_pmi(self):
        from skills.datasource.scripts.akshare_extended import macro_pmi

        df = macro_pmi()
        assert isinstance(df, pd.DataFrame)
        assert not df.empty, "PMI 应该有数据"

    def test_macro_money_supply(self):
        from skills.datasource.scripts.akshare_extended import macro_money_supply

        df = macro_money_supply()
        assert isinstance(df, pd.DataFrame)
        assert not df.empty, "货币供应量应该有数据"

    def test_macro_shibor(self):
        from skills.datasource.scripts.akshare_extended import macro_shibor

        df = macro_shibor()
        assert isinstance(df, pd.DataFrame)

    def test_macro_gdp(self):
        from skills.datasource.scripts.akshare_extended import macro_gdp

        df = macro_gdp()
        assert isinstance(df, pd.DataFrame)
        assert not df.empty, "GDP 应该有数据"


class TestExtendedNews:
    """Tests for news extended fetchers."""

    def test_news_cctv(self):
        from skills.datasource.scripts.akshare_extended import news_cctv

        df = news_cctv(date="20250101")
        assert isinstance(df, pd.DataFrame)


class TestExtendedFutures:
    """Tests for futures extended fetchers."""

    def test_futures_daily(self):
        from skills.datasource.scripts.akshare_extended import futures_daily

        df = futures_daily("AU0")
        assert isinstance(df, pd.DataFrame)
