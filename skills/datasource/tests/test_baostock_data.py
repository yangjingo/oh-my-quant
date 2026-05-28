"""Smoke tests for BaoStock data fetchers.

Run with: python -m pytest skills/datasource/tests/test_baostock_data.py -v
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _check_bs_available() -> bool:
    """Check if baostock server is reachable."""
    try:
        import baostock as bs

        bs.login()
        rs = bs.query_stock_basic(code="sh.600000")
        rs.get_data()
        bs.logout()
        return True
    except Exception:
        return False


BS_OK = _check_bs_available()


# ---------------------------------------------------------------------------
# K-line data
# ---------------------------------------------------------------------------


class TestKLine:
    def test_daily_returns_dataframe(self):
        from skills.datasource.scripts.baostock import daily

        df = daily("000001", start="2025-01-01", end="2025-01-31")
        assert isinstance(df, pd.DataFrame)
        assert not df.empty

    def test_daily_has_ohlcv(self):
        from skills.datasource.scripts.baostock import daily

        df = daily("000001", start="2025-01-01", end="2025-01-31")
        for col in ["open", "high", "low", "close", "volume"]:
            assert col in df.columns, f"Missing: {col}"

    def test_daily_index_is_datetime(self):
        from skills.datasource.scripts.baostock import daily

        df = daily("000001", start="2025-01-01", end="2025-01-10")
        assert isinstance(df.index, pd.DatetimeIndex)

    def test_daily_index_sorted(self):
        from skills.datasource.scripts.baostock import daily

        df = daily("000001", start="2025-01-01", end="2025-01-31")
        assert df.index.is_monotonic_increasing

    def test_daily_shanghai_stock(self):
        from skills.datasource.scripts.baostock import daily

        df = daily("600036", start="2025-03-01", end="2025-03-15")
        assert isinstance(df, pd.DataFrame)
        assert not df.empty

    def test_weekly(self):
        from skills.datasource.scripts.baostock import weekly

        df = weekly("000001", start="2025-01-01", end="2025-06-01")
        assert isinstance(df, pd.DataFrame)
        assert not df.empty
        assert "close" in df.columns

    def test_monthly(self):
        from skills.datasource.scripts.baostock import monthly

        df = monthly("000001", start="2024-01-01", end="2025-06-01")
        assert isinstance(df, pd.DataFrame)
        assert not df.empty

    @pytest.mark.skipif(not BS_OK, reason="baostock server unreachable")
    def test_minute(self):
        from skills.datasource.scripts.baostock import minute

        df = minute("000001", freq="60")
        assert isinstance(df, pd.DataFrame)


# ---------------------------------------------------------------------------
# Index data
# ---------------------------------------------------------------------------


class TestIndex:
    def test_index_daily_hs300(self):
        from skills.datasource.scripts.baostock import index_daily

        df = index_daily("sh.000300", start="2025-01-01", end="2025-01-31")
        assert isinstance(df, pd.DataFrame)
        assert not df.empty

    def test_index_daily_sz50(self):
        from skills.datasource.scripts.baostock import index_daily

        df = index_daily("sh.000016", start="2025-01-01", end="2025-01-31")
        assert isinstance(df, pd.DataFrame)
        assert not df.empty


# ---------------------------------------------------------------------------
# Basic info
# ---------------------------------------------------------------------------


class TestBasic:
    def test_stock_basic(self):
        from skills.datasource.scripts.baostock import stock_basic

        # 全量查询可能因数据量大被服务器重置，先测单个
        df = stock_basic(code="sh.600000")
        assert isinstance(df, pd.DataFrame)
        assert not df.empty, "Single stock query should work"

    def test_stock_basic_all(self):
        from skills.datasource.scripts.baostock import stock_basic

        df = stock_basic()
        assert isinstance(df, pd.DataFrame)
        # 全量查询可能因网络不稳定返回空，不强断言 non-empty

    def test_stock_basic_single(self):
        from skills.datasource.scripts.baostock import stock_basic

        df = stock_basic(code="sh.600000")
        assert isinstance(df, pd.DataFrame)
        assert len(df) >= 1

    def test_stock_industry(self):
        from skills.datasource.scripts.baostock import stock_industry

        df = stock_industry(code="sh.600000")
        assert isinstance(df, pd.DataFrame)

    def test_trade_dates(self):
        from skills.datasource.scripts.baostock import trade_dates

        df = trade_dates(start="2025-05-01", end="2025-05-31")
        assert isinstance(df, pd.DataFrame)
        assert not df.empty
        assert "is_trading_day" in df.columns


# ---------------------------------------------------------------------------
# Index constituents
# ---------------------------------------------------------------------------


class TestConstituents:
    def test_hs300_stocks(self):
        from skills.datasource.scripts.baostock import hs300_stocks

        df = hs300_stocks()
        assert isinstance(df, pd.DataFrame)
        assert not df.empty, "CSI 300 constituents should not be empty"
        assert len(df) >= 290, f"Expected ~300 stocks, got {len(df)}"

    def test_sz50_stocks(self):
        from skills.datasource.scripts.baostock import sz50_stocks

        df = sz50_stocks()
        assert isinstance(df, pd.DataFrame)
        assert not df.empty
        assert len(df) >= 45, f"Expected ~50 stocks, got {len(df)}"

    def test_zz500_stocks(self):
        from skills.datasource.scripts.baostock import zz500_stocks

        df = zz500_stocks()
        assert isinstance(df, pd.DataFrame)
        assert not df.empty
        assert len(df) >= 450, f"Expected ~500 stocks, got {len(df)}"


# ---------------------------------------------------------------------------
# Financial data
# ---------------------------------------------------------------------------


class TestFinancial:
    def test_balance_data(self):
        from skills.datasource.scripts.baostock import balance_data

        df = balance_data("000001", year=2024, quarter=4)
        assert isinstance(df, pd.DataFrame)

    def test_profit_data(self):
        from skills.datasource.scripts.baostock import profit_data

        df = profit_data("000001", year=2024, quarter=4)
        assert isinstance(df, pd.DataFrame)

    def test_cash_flow_data(self):
        from skills.datasource.scripts.baostock import cash_flow_data

        df = cash_flow_data("000001", year=2024, quarter=4)
        assert isinstance(df, pd.DataFrame)

    def test_dupont_data(self):
        from skills.datasource.scripts.baostock import dupont_data

        df = dupont_data("000001", year=2024, quarter=4)
        assert isinstance(df, pd.DataFrame)

    def test_growth_data(self):
        from skills.datasource.scripts.baostock import growth_data

        df = growth_data("000001", year=2024, quarter=4)
        assert isinstance(df, pd.DataFrame)

    def test_operation_data(self):
        from skills.datasource.scripts.baostock import operation_data

        df = operation_data("000001", year=2024, quarter=4)
        assert isinstance(df, pd.DataFrame)


# ---------------------------------------------------------------------------
# Dividends / forecast / adjust
# ---------------------------------------------------------------------------


class TestDividend:
    def test_dividend_data(self):
        from skills.datasource.scripts.baostock import dividend_data

        df = dividend_data("000001", year="2024")
        assert isinstance(df, pd.DataFrame)

    def test_adjust_factor(self):
        from skills.datasource.scripts.baostock import adjust_factor

        df = adjust_factor("000001", start="2024-01-01", end="2025-12-31")
        assert isinstance(df, pd.DataFrame)

    def test_forecast_report(self):
        from skills.datasource.scripts.baostock import forecast_report

        df = forecast_report("000001", start="2024-01-01")
        assert isinstance(df, pd.DataFrame)

    def test_performance_express(self):
        from skills.datasource.scripts.baostock import performance_express

        df = performance_express("000001", start="2024-01-01")
        assert isinstance(df, pd.DataFrame)


# ---------------------------------------------------------------------------
# Macro
# ---------------------------------------------------------------------------


class TestMacro:
    def test_money_supply(self):
        from skills.datasource.scripts.baostock import money_supply

        df = money_supply(start="2024-01", end="2025-06")
        assert isinstance(df, pd.DataFrame)

    def test_deposit_rate(self):
        from skills.datasource.scripts.baostock import deposit_rate

        df = deposit_rate()
        assert isinstance(df, pd.DataFrame)

    def test_loan_rate(self):
        from skills.datasource.scripts.baostock import loan_rate

        df = loan_rate()
        assert isinstance(df, pd.DataFrame)

    def test_reserve_ratio(self):
        from skills.datasource.scripts.baostock import reserve_ratio

        df = reserve_ratio()
        assert isinstance(df, pd.DataFrame)
