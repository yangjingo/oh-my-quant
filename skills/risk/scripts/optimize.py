"""压力测试 + 组合优化"""

import numpy as np
import pandas as pd

SCENARIOS = {
    "2008金融危机": -0.70,
    "2015股灾": -0.45,
    "2018贸易战": -0.30,
    "2020疫情": -0.10,
    "2022加息": -0.20,
}


def stress_test(returns: pd.Series, custom: dict = None) -> pd.DataFrame:
    """历史情景压力测试"""
    scenarios = dict(SCENARIOS)
    if custom:
        scenarios.update(custom)
    rows = []
    for name, shock in scenarios.items():
        rows.append({
            "情景": name, "市场冲击": f"{shock:.1%}",
            "组合预估亏损": f"{shock:.1%}",
        })
    return pd.DataFrame(rows)


def equal_weight(n: int) -> np.ndarray:
    return np.ones(n) / n


def min_variance(cov: pd.DataFrame) -> np.ndarray:
    inv = np.linalg.inv(cov.values)
    w = inv @ np.ones(len(cov))
    return w / w.sum()


def max_sharpe(returns: pd.DataFrame, rf: float = 0.02) -> np.ndarray:
    mu = returns.mean().values * 252
    S = returns.cov().values * 252
    inv_S = np.linalg.inv(S)
    w = inv_S @ (mu - rf)
    return w / w.sum()


def risk_parity(cov: pd.DataFrame, iterations: int = 100) -> np.ndarray:
    n = len(cov)
    w = np.ones(n) / n
    for _ in range(iterations):
        sigma = np.sqrt(w @ cov.values @ w)
        mrc = cov.values @ w / sigma
        rc = w * mrc
        target = sigma / n
        w = w * (target / (rc + 1e-8))
        w = w / w.sum()
    return w


METHODS = {
    "equal_weight": lambda returns, rf: equal_weight(len(returns.columns)),
    "min_variance": lambda returns, rf: min_variance(returns.cov()),
    "max_sharpe": lambda returns, rf: max_sharpe(returns, rf),
    "risk_parity": lambda returns, rf: risk_parity(returns.cov()),
}


def optimize(returns: pd.DataFrame, method: str = "max_sharpe", rf: float = 0.02) -> pd.Series:
    """组合优化入口"""
    if method not in METHODS:
        raise ValueError(f"unknown method: {method}, available: {list(METHODS)}")
    w = METHODS[method](returns, rf)
    return pd.Series(w, index=returns.columns).round(4)
