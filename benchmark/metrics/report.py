"""Structured performance reports — annual returns, monthly table, drawdown recovery."""

from __future__ import annotations

import numpy as np
import pandas as pd


def annual_returns(returns: pd.Series) -> pd.DataFrame:
    """逐年收益表。返回每年收益率 (columns: year, return)。"""
    years = returns.index.year
    result = returns.groupby(years).apply(lambda x: (1 + x).prod() - 1)
    return result.rename("return").reset_index()


def monthly_returns_table(returns: pd.Series) -> pd.DataFrame:
    """逐月收益矩阵 (行=年, 列=1..12)。"""
    df = returns.to_frame("ret")
    df["year"] = df.index.year
    df["month"] = df.index.month
    table = df.pivot_table(values="ret", index="year", columns="month", aggfunc=lambda x: (1 + x).prod() - 1)
    if len(table) == 0:
        return table

    table.columns = [f"{m:02d}" for m in table.columns]
    table["YTD"] = table.sum(axis=1)
    table.loc["平均"] = table.mean()
    return table


def dd_recovery_report(returns: pd.Series) -> pd.DataFrame:
    """每次回撤的起止日期、深度、恢复天数。

    Returns DataFrame with columns:
        start, trough, end, depth, duration_days, recovery_days
    """
    cum = (1 + returns).cumprod()
    running_max = cum.expanding().max()
    drawdown = (cum - running_max) / running_max

    rows = []
    in_dd = False
    dd_start = None
    peak = 1.0

    for i in range(len(cum)):
        d = drawdown.iloc[i]
        if d < 0 and not in_dd:
            in_dd = True
            dd_start = cum.index[i]
            peak = running_max.iloc[i]
            trough = cum.index[i]
            depth = d
        elif in_dd:
            if d < depth:
                depth = d
                trough = cum.index[i]
            if d == 0:
                rows.append({
                    "start": dd_start,
                    "trough": trough,
                    "end": cum.index[i],
                    "depth": round(float(depth), 4),
                    "duration_days": (cum.index[i] - dd_start).days,
                    "recovery_days": (cum.index[i] - trough).days,
                })
                in_dd = False
                depth = 0.0

    if in_dd:
        rows.append({
            "start": dd_start,
            "trough": trough,
            "end": None,
            "depth": round(float(depth), 4),
            "duration_days": (cum.index[-1] - dd_start).days if dd_start else 0,
            "recovery_days": None,
        })

    return pd.DataFrame(rows)
