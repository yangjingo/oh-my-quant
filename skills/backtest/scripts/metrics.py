"""回测工具 — 绩效指标 + 向量化回测引擎"""

import numpy as np
import pandas as pd


def max_drawdown(returns: pd.Series) -> float:
    cum = (1 + returns).cumprod()
    running_max = cum.expanding().max()
    return float(((cum - running_max) / running_max).min())


def max_dd_duration(returns: pd.Series) -> int:
    cum = (1 + returns).cumprod()
    running_max = cum.expanding().max()
    underwater = cum < running_max
    if not underwater.any():
        return 0
    blocks = underwater.astype(int).diff()
    durations = underwater.groupby((blocks == 1).cumsum()).sum()
    return int(durations.max())


def sharpe(returns: pd.Series, rf: float = 0.02) -> float:
    excess = returns - rf / 252
    return float(excess.mean() / excess.std() * np.sqrt(252)) if excess.std() else 0


def sortino(returns: pd.Series, rf: float = 0.02) -> float:
    excess = returns - rf / 252
    downside = excess[excess < 0].std()
    return float(excess.mean() / downside * np.sqrt(252)) if downside else 0


def calmar(returns: pd.Series) -> float:
    dd = abs(max_drawdown(returns))
    cagr = (1 + returns.mean()) ** 252 - 1
    return float(cagr / dd) if dd else 0


def win_rate(returns: pd.Series) -> float:
    return float((returns > 0).mean())


def profit_loss_ratio(returns: pd.Series) -> float:
    wins = returns[returns > 0].mean()
    losses = abs(returns[returns < 0].mean())
    return float(wins / losses) if losses else 0


def report(returns: pd.Series, benchmark_returns: pd.Series = None) -> dict:
    """一键生成绩效报告字典"""
    r = {
        "total_return": f"{(1 + returns).prod() - 1:.2%}",
        "cagr": f"{(1 + returns.mean()) ** 252 - 1:.2%}",
        "annual_vol": f"{returns.std() * np.sqrt(252):.2%}",
        "sharpe": round(sharpe(returns), 2),
        "sortino": round(sortino(returns), 2),
        "calmar": round(calmar(returns), 2),
        "max_drawdown": f"{max_drawdown(returns):.2%}",
        "max_dd_days": max_dd_duration(returns),
        "win_rate": f"{win_rate(returns):.2%}",
        "pnl_ratio": round(profit_loss_ratio(returns), 2),
    }
    if benchmark_returns is not None:
        excess_cagr = (1 + returns.mean()) ** 252 - (1 + benchmark_returns.mean()) ** 252
        r["excess_return"] = f"{excess_cagr:.2%}"
        r["tracking_error"] = f"{(returns - benchmark_returns).std() * np.sqrt(252):.2%}"
    return r


def vectorized_backtest(signals: pd.Series, prices: pd.Series,
                        initial_cash: float = 100000,
                        commission: float = 0.0003,
                        stamp_duty: float = 0.0005) -> pd.DataFrame:
    """
    简易向量化回测。
    signals: 目标仓位 0~1, index=date
    prices: 日收盘价, index=date
    返回 DataFrame，含 equity / position / returns
    """
    df = pd.DataFrame({"price": prices, "target": signals.shift(1)}, index=prices.index).dropna()

    df["position"] = (df["target"] * initial_cash / df["price"]).ffill().fillna(0)

    df["trade"] = df["position"].diff()
    df["cost"] = df["trade"].abs() * df["price"] * commission
    df["cost"] += df["trade"].clip(upper=0).abs() * df["price"] * stamp_duty

    df["equity"] = initial_cash
    for i in range(1, len(df)):
        prev_eq = df["equity"].iloc[i - 1]
        pos = df["position"].iloc[i - 1]
        px_chg = df["price"].iloc[i] / df["price"].iloc[i - 1] - 1
        df.iloc[i, df.columns.get_loc("equity")] = prev_eq + pos * px_chg * df["price"].iloc[i] - df["cost"].iloc[i]

    df["returns"] = df["equity"].pct_change()
    return df
