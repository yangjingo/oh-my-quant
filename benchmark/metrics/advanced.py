"""Advanced performance metrics.

Alpha/Beta, Information Ratio, Treynor, Omega, Tail Ratio,
rolling metrics, stability.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# CAPM-based
# ---------------------------------------------------------------------------

def alpha_beta(
    returns: pd.Series,
    benchmark_returns: pd.Series,
    rf: float = 0.02,
) -> dict:
    """OLS regression: (r - rf) = alpha + beta * (rm - rf) + epsilon.

    Returns alpha (annualized), beta, r_squared, annual_alpha.
    """
    common = returns.index.intersection(benchmark_returns.index)
    if len(common) < 20:
        return {"alpha": 0.0, "beta": 1.0, "annual_alpha": 0.0, "r_squared": 0.0}

    y = returns.loc[common] - rf / 252
    x = benchmark_returns.loc[common] - rf / 252

    if x.std() == 0:
        return {"alpha": 0.0, "beta": 1.0, "annual_alpha": 0.0, "r_squared": 0.0}

    beta = float(np.cov(y, x)[0, 1] / np.var(x))
    alpha_daily = float(y.mean() - beta * x.mean())
    residuals = y - (alpha_daily + beta * x)
    r_squared = float(1 - residuals.var() / y.var()) if y.var() else 0.0

    return {
        "alpha": round(alpha_daily, 6),
        "beta": round(beta, 4),
        "annual_alpha": round(alpha_daily * 252, 4),
        "r_squared": round(r_squared, 4),
    }


def treynor_ratio(
    returns: pd.Series,
    benchmark_returns: pd.Series,
    rf: float = 0.02,
) -> float:
    """(CAGR - rf) / beta — 单位系统风险的超额收益。"""
    cagr = (1 + returns.mean()) ** 252 - 1
    beta_val = alpha_beta(returns, benchmark_returns, rf)["beta"]
    if beta_val <= 0:
        return 0.0
    return round((cagr - rf) / beta_val, 4)


def information_ratio(
    returns: pd.Series,
    benchmark_returns: pd.Series,
) -> float:
    """主动收益 / 跟踪误差。"""
    common = returns.index.intersection(benchmark_returns.index)
    if len(common) < 20:
        return 0.0
    active = returns.loc[common] - benchmark_returns.loc[common]
    if active.std() == 0:
        return 0.0
    return round(float(active.mean() / active.std() * np.sqrt(252)), 4)


# ---------------------------------------------------------------------------
# Distribution-based
# ---------------------------------------------------------------------------

def omega_ratio(returns: pd.Series, threshold: float = 0.0) -> float:
    """全分布收益-损失比: E[max(r - threshold, 0)] / E[max(threshold - r, 0)].

    Omega > 1 means gains outweigh losses.
    """
    gains = returns[returns > threshold] - threshold
    losses = threshold - returns[returns <= threshold]
    if losses.sum() == 0:
        return float("inf")
    return round(float(gains.sum() / losses.sum()), 4)


def tail_ratio(returns: pd.Series, percentile: float = 5) -> float:
    """右尾 95 分位收益 / 左尾 5 分位损失绝对值。

    Tail ratio > 1 表示极端收益幅度大于极端损失。
    """
    right_tail = np.percentile(returns, 100 - percentile)
    left_tail = np.percentile(returns, percentile)
    if left_tail == 0:
        return float("inf")
    return round(abs(right_tail / left_tail), 4)


def stability(returns: pd.Series) -> float:
    """CAGR / 累积收益曲线对拟合线的 R²。

    衡量收益路径的平滑程度。1.0 = 完美线性增长。
    """
    cum = (1 + returns).cumprod()
    t = np.arange(len(cum))
    if cum.std() == 0:
        return 1.0
    return round(float(np.corrcoef(t, cum)[0, 1] ** 2), 4)


# ---------------------------------------------------------------------------
# Rolling
# ---------------------------------------------------------------------------

def rolling_sharpe(
    returns: pd.Series,
    window: int = 252,
    rf: float = 0.02,
) -> pd.Series:
    """滚动夏普 (默认 252 个交易日 = 1 年)。"""
    excess = returns - rf / 252
    roll_mean = excess.rolling(window).mean() * 252
    roll_std = excess.rolling(window).std() * np.sqrt(252)
    result = roll_mean / roll_std
    result[roll_std == 0] = 0.0
    return result.dropna()


def rolling_volatility(
    returns: pd.Series,
    window: int = 252,
) -> pd.Series:
    """滚动年化波动率。"""
    return (returns.rolling(window).std() * np.sqrt(252)).dropna()


def rolling_beta(
    returns: pd.Series,
    benchmark_returns: pd.Series,
    window: int = 252,
) -> pd.Series:
    """滚动 Beta。"""
    common = returns.index.intersection(benchmark_returns.index)
    r = returns.loc[common]
    b = benchmark_returns.loc[common]
    beta_series = pd.Series(np.nan, index=common)
    for i in range(window - 1, len(common)):
        y = r.iloc[i - window + 1 : i + 1]
        x = b.iloc[i - window + 1 : i + 1]
        if x.std() > 0:
            beta_series.iloc[i] = float(np.cov(y, x)[0, 1] / np.var(x))
    return beta_series.dropna()
