"""IC 分析 + 分层回测"""

import numpy as np
import pandas as pd


def rank_ic(factor: pd.Series, forward_return: pd.Series) -> float:
    """单期截面 RankIC"""
    valid = factor.notna() & forward_return.notna()
    return factor[valid].corr(forward_return[valid], method="spearman")


def ic_summary(factor_panel: pd.DataFrame, forward_returns: pd.DataFrame,
               periods: list = None) -> pd.DataFrame:
    """多周期 IC 汇总表"""
    if periods is None:
        periods = [1, 5, 20]
    rows = []
    for p in periods:
        fwd_col = f"fwd_{p}d"
        ics = []
        for date in factor_panel.index.intersection(forward_returns.index):
            ics.append(rank_ic(factor_panel.loc[date], forward_returns.loc[date]))
        s = pd.Series(ics)
        rows.append({
            "period": f"{p}日", "IC_Mean": round(s.mean(), 4),
            "IC_Std": round(s.std(), 4),
            "ICIR": round(s.mean() / s.std(), 4) if s.std() else 0,
            "IC>0_ratio": round((s > 0).mean(), 2),
        })
    return pd.DataFrame(rows)


def quantile_test(factor: pd.DataFrame, returns: pd.DataFrame, n_groups: int = 5) -> pd.DataFrame:
    """分层回测——每期按因子值分组，等权持有，返回各组累计收益"""
    results = {}
    for date in factor.index.intersection(returns.index):
        f = factor.loc[date].dropna()
        r = returns.loc[date].dropna()
        common = f.index.intersection(r.index)
        if len(common) < n_groups * 3:
            continue
        labels = pd.qcut(f[common], n_groups, labels=[f"Q{i+1}" for i in range(n_groups)])
        for q, group in labels.groupby(labels):
            results.setdefault(q, []).append(r[group.index].mean())
    return pd.DataFrame(results)


def factor_corr(factors: dict[str, pd.Series]) -> pd.DataFrame:
    """多因子截面相关性矩阵"""
    panel = pd.DataFrame(factors).dropna()
    return panel.corr()
