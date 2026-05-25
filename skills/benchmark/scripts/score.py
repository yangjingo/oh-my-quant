"""基准评测计算 — 收益/风险/稳健性三维评分"""

import numpy as np
import pandas as pd


def evaluate(returns: pd.Series, benchmark_returns: pd.Series,
             train_returns: pd.Series = None, test_returns: pd.Series = None) -> dict:
    """综合评测，返回 0-100 总分 + 各维度得分"""

    rf = 0.02

    # ── 收益能力 (40 分) ──
    cagr = (1 + returns.mean()) ** 252 - 1
    bench_cagr = (1 + benchmark_returns.mean()) ** 252 - 1
    excess = cagr - bench_cagr
    positive_months = (returns.resample("ME").apply(lambda x: (1+x).prod()-1) > 0).mean()

    return_score = 0
    if cagr > 0.15: return_score += 10
    elif cagr > 0.05: return_score += 6
    elif cagr > 0: return_score += 3

    if excess > 0.10: return_score += 15
    elif excess > 0.03: return_score += 10
    elif excess > 0: return_score += 5

    return_score += min(positive_months * 15, 15)

    # ── 风险控制 (40 分) ──
    sharpe_val = _sharpe(returns, rf)
    max_dd = _max_drawdown(returns)
    calmar_val = cagr / abs(max_dd) if max_dd != 0 else 0
    cvar = returns[returns <= np.percentile(returns, 5)].mean()

    risk_score = 0
    if sharpe_val > 2: risk_score += 10
    elif sharpe_val > 1: risk_score += 6
    elif sharpe_val > 0.5: risk_score += 3

    if max_dd > -0.10: risk_score += 10
    elif max_dd > -0.20: risk_score += 6
    elif max_dd > -0.35: risk_score += 3

    if calmar_val > 2: risk_score += 7
    elif calmar_val > 1: risk_score += 4

    if cvar > -0.03: risk_score += 5
    elif cvar > -0.05: risk_score += 3

    # ── 稳健性 (20 分) ──
    robustness_score = 0
    if train_returns is not None and test_returns is not None:
        train_cagr = (1 + train_returns.mean()) ** 252 - 1
        test_cagr = (1 + test_returns.mean()) ** 252 - 1
        if train_cagr > 0 and test_cagr > 0:
            ratio = test_cagr / train_cagr
            if ratio > 0.7: robustness_score += 10
            elif ratio > 0.3: robustness_score += 5
        sharpe_decay = 1 - _sharpe(test_returns, rf) / max(_sharpe(train_returns, rf), 1e-8)
        if sharpe_decay < 0.3: robustness_score += 10
        elif sharpe_decay < 0.5: robustness_score += 5
    else:
        robustness_score = 10  # 无样本外数据，给基线分

    # ── 额外加分 ──
    bonus = 0
    # 回撤控制好额外加分
    if max_dd > -0.05: bonus += 3

    total = min(return_score + risk_score + robustness_score + bonus, 100)

    grade = "S" if total >= 80 else "A" if total >= 60 else "B" if total >= 40 else "C" if total >= 20 else "D"

    return {
        "total_score": round(total, 1),
        "grade": grade,
        "return_score": round(return_score, 1),
        "risk_score": round(risk_score, 1),
        "robustness_score": round(robustness_score, 1),
        "bonus": bonus,
        "details": {
            "cagr": round(cagr, 4), "excess_return": round(excess, 4),
            "sharpe": round(sharpe_val, 2), "max_drawdown": round(max_dd, 4),
            "calmar": round(calmar_val, 2), "cvar_95": round(cvar, 4),
        },
    }


def _sharpe(returns: pd.Series, rf: float) -> float:
    excess = returns - rf / 252
    return float(excess.mean() / excess.std() * np.sqrt(252)) if excess.std() else 0


def _max_drawdown(returns: pd.Series) -> float:
    cum = (1 + returns).cumprod()
    return float(((cum - cum.expanding().max()) / cum.expanding().max()).min())
