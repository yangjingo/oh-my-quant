"""Portfolio prediction — multi-regime Monte Carlo, stress tests, risk decomposition."""

from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
PORTFOLIO_DIR = ROOT / "skills" / "portfolio"

# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


def _load_data() -> tuple[pd.DataFrame, dict]:
    q = json.loads((PORTFOLIO_DIR / "quarterly.json").read_text(encoding="utf-8"))
    funds = q["quarters"]["2026-Q2"]["funds"]
    rows = []
    for f in funds:
        rows.append({
            "code": f["code"],
            "name": f["name"],
            "q_return": f["q_return_pct"] / 100,
            "q_max_dd": f["q_max_drawdown_pct"] / 100,
            "start_nav": f["start_nav"],
            "end_nav": f["end_nav"],
        })
    df = pd.DataFrame(rows)
    h = json.loads((PORTFOLIO_DIR / "holdings.json").read_text(encoding="utf-8"))
    return df, h


# ---------------------------------------------------------------------------
# Regime definitions
# ---------------------------------------------------------------------------

def _regime_params(fund_df: pd.DataFrame, mode: str) -> dict:
    """根据模式返回 (annual_return, annual_vol, tail_dof) 参数。

    mode:
        conservative — AI 回归均值，年收益 15%，波动 35%
        stress      — AI 泡沫破裂，年收益 -20%，波动 50%
        crash       — 极端尾部事件
    """
    q_returns = fund_df["q_return"].values
    q_dds = abs(fund_df["q_max_dd"].values)

    match mode:
        case "conservative":
            # 均值回归：假设未来 AI 收益收敛到长期均值
            ann_ret = 0.15
            ann_vol = 0.35
            dof = 5.0  # 中度肥尾
        case "stress":
            ann_ret = -0.20
            ann_vol = 0.50
            dof = 3.0
        case "crash":
            ann_ret = -0.40
            ann_vol = 0.70
            dof = 2.5
        case _:  # "momentum" — 沿用 Q2 趋势
            ann_ret = q_returns.mean() * 4
            ann_vol = q_dds.mean() * 2  # 年化波动 ≈ 2 × 均回撤
            dof = 4.0

    daily_mu = ann_ret / 252
    daily_sigma = ann_vol / math.sqrt(252)
    return {"daily_mu": daily_mu, "daily_sigma": daily_sigma, "dof": dof}


# ---------------------------------------------------------------------------
# Core simulation
# ---------------------------------------------------------------------------

def _simulate_paths(
    daily_mu: float,
    daily_sigma: float,
    dof: float,
    n_simulations: int,
    horizon_days: int,
    initial_value: float,
) -> np.ndarray:
    """Student-t 分布蒙特卡洛路径。dof 越小肥尾越重。"""
    # 标准化 t 分布：均值为 0，方差为 1
    scale = math.sqrt((dof - 2) / dof) if dof > 2 else 1.0

    terminal = np.zeros(n_simulations)
    for i in range(n_simulations):
        shocks = np.random.standard_t(dof, horizon_days) * scale * daily_sigma + daily_mu
        terminal[i] = initial_value * np.prod(1 + shocks)
    return terminal


def _summarize(values: np.ndarray, initial_value: float, label: str) -> dict:
    returns = (values / initial_value - 1) * 100
    sorted_ret = np.sort(returns)

    return {
        "label": label,
        "mean_return": round(float(returns.mean()), 1),
        "median_return": round(float(np.median(returns)), 1),
        "volatility": round(float(returns.std()), 1),
        "skewness": round(float(pd.Series(returns).skew()), 2),
        "kurtosis": round(float(pd.Series(returns).kurtosis()), 2),
        "var_95": round(float(np.percentile(returns, 5)), 1),
        "var_99": round(float(np.percentile(returns, 1)), 1),
        "cvar_95": round(float(returns[returns <= np.percentile(returns, 5)].mean()), 1),
        "cvar_99": round(float(returns[returns <= np.percentile(returns, 1)].mean()), 1),
        "max_drawdown_dist": {
            "p50": round(float(np.percentile(sorted_ret[:len(sorted_ret)//2], 50)), 1),
            "p10_worst": round(float(np.percentile(returns, 10)), 1),
            "p01_worst": round(float(np.percentile(returns, 1)), 1),
        },
        "prob_positive": round(float((returns > 0).mean()) * 100, 1),
        "prob_loss_gt_10pct": round(float((returns < -10).mean()) * 100, 1),
        "prob_loss_gt_20pct": round(float((returns < -20).mean()) * 100, 1),
        "scenarios": {
            "strong_bull (p95)": f"{np.percentile(returns, 95):+.1f}%",
            "bull (p75)": f"{np.percentile(returns, 75):+.1f}%",
            "base (p50)": f"{np.percentile(returns, 50):+.1f}%",
            "bear (p25)": f"{np.percentile(returns, 25):+.1f}%",
            "severe (p10)": f"{np.percentile(returns, 10):+.1f}%",
            "crash (p05)": f"{np.percentile(returns, 5):+.1f}%",
            "tail (p01)": f"{np.percentile(returns, 1):+.1f}%",
        },
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def full_prediction(
    n_simulations: int = 20000,
    horizon_days: int = 63,
    initial_value: float = 100000,
) -> dict:
    """三模式预测 + 风险分解。"""
    fund_df, holdings = _load_data()

    modes = ["momentum", "conservative", "stress", "crash"]
    results = {}
    for mode in modes:
        params = _regime_params(fund_df, mode)
        values = _simulate_paths(
            daily_mu=params["daily_mu"],
            daily_sigma=params["daily_sigma"],
            dof=params["dof"],
            n_simulations=n_simulations,
            horizon_days=horizon_days,
            initial_value=initial_value,
        )
        results[mode] = _summarize(values, initial_value, mode)

    return {
        "meta": {
            "horizon_days": horizon_days,
            "horizon_label": f"{horizon_days} 交易日 (~{horizon_days // 21} 个月)",
            "n_simulations": n_simulations,
            "initial_value": initial_value,
            "distribution": "Student-t (fat tail)",
        },
        "regimes": results,
        "concentration": concentration_analysis(fund_df, holdings),
        "risk_decomposition": risk_decomposition(fund_df),
        "stress_tests": stress_tests(initial_value),
    }


def concentration_analysis(fund_df: pd.DataFrame, holdings: dict) -> dict:
    sectors = holdings.get("focus_sectors", [])
    n = len(fund_df)
    returns = fund_df["q_return"]
    dds = abs(fund_df["q_max_dd"])

    # Herfindahl-Hirschman 集中度：等权 = 1/n = 0.143
    hhi = 1.0 / n

    return {
        "fund_count": n,
        "unique_themes": 1,
        "theme": "AI / Tech (single-sector)",
        "focus_sectors": sectors,
        "hhi_concentration": round(hhi, 3),
        "max_single_fund_weight": f"{1/n:.0%}",
        "q2_cross_section": {
            "best": f"{returns.max():.0%}",
            "worst": f"{returns.min():.0%}",
            "spread": f"{returns.max() - returns.min():.0%}",
            "avg_max_dd": f"{-dds.mean():.0%}",
        },
        "warning": (
            "CRITICAL: 7 只基金 100% 暴露于 AI/Tech 单一主题。"
            "无跨行业、无跨资产、无跨市场对冲。"
            "若 AI 板块出现系统性回调（如 2022 NASDAQ -33%），"
            "组合可能回撤 25-40% 且无任何保护。"
        ),
        "suggested_hedges": [
            "加入债券/货基 (10-20%) 降低组合波动",
            "考虑非 AI 行业基金 (消费/医药/红利) 做行业分散",
            "加入宽基指数空头或看跌期权做尾部对冲",
        ],
    }


def risk_decomposition(fund_df: pd.DataFrame) -> dict:
    """按基金拆分风险贡献（基于 Q2 回撤作为波动代理）。"""
    dds = abs(fund_df["q_max_dd"].values)
    total_risk = dds.sum()
    contributions = []
    for i, row in fund_df.iterrows():
        rc = dds[i] / total_risk
        contributions.append({
            "name": row["name"],
            "q_return": f"{row['q_return']:.0%}",
            "q_max_dd": f"{row['q_max_dd']:.0%}",
            "risk_contribution": f"{rc:.0%}",
        })
    contributions.sort(key=lambda x: float(x["risk_contribution"].rstrip("%")) / 100, reverse=True)
    return {"method": "equal-weighted drawdown proxy", "per_fund": contributions}


def wind_benchmark(sample_size: int = 30) -> dict:
    """万得偏股混合基金指数代理。

    用 AKShare 拉取偏股混合型基金抽样净值，构造等权平均作为
    885001.WI 的近似替代，返回 3 个月统计。
    """
    import time

    try:
        import akshare as ak
    except ImportError:
        return {"error": "akshare not installed", "index_3m": None}

    all_funds = ak.fund_name_em()
    hybrid = all_funds[all_funds["基金类型"].str.contains("偏股", na=False)]
    sample_codes = hybrid["基金代码"].dropna().sample(
        min(sample_size, len(hybrid)), random_state=42
    ).tolist()

    returns_3m = []
    for code in sample_codes:
        try:
            df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
            df = df.rename(columns={"净值日期": "date", "单位净值": "nav"})
            df["date"] = pd.to_datetime(df["date"])
            df = df.set_index("date").sort_index()
            df["nav"] = pd.to_numeric(df["nav"], errors="coerce")
            rets = df["nav"].pct_change().dropna()
            if len(rets) >= 40:
                ret_3m = float((1 + rets.tail(63)).prod() - 1)
                returns_3m.append(ret_3m)
            time.sleep(0.3)
        except Exception:
            pass

    if not returns_3m:
        return {"error": "no data", "index_3m": None}

    arr = np.array(returns_3m)
    return {
        "name": "万得偏股混合基金指数 (代理 885001.WI)",
        "sample_size": len(arr),
        "index_3m": round(float(arr.mean()) * 100, 1),
        "median_3m": round(float(np.median(arr)) * 100, 1),
        "std_3m": round(float(arr.std()) * 100, 1),
        "range_3m": f"{arr.min()*100:+.1f}% ~ {arr.max()*100:+.1f}%",
        "method": "偏股混合型基金抽样等权均值",
    }


def benchmark_comparison(portfolio_returns_3m: list[float]) -> dict:
    """与万得偏股混合指数对比。

    portfolio_returns_3m: 持仓各基金 3 个月收益（小数）。
    """
    bench = wind_benchmark()
    if bench.get("error"):
        return {"error": bench["error"]}

    port_avg = np.mean(portfolio_returns_3m) * 100
    bench_3m = bench["index_3m"]

    return {
        "portfolio_avg_3m": round(float(port_avg), 1),
        "benchmark_3m": bench_3m,
        "excess_return": round(float(port_avg - bench_3m), 1),
        "information_ratio": (
            round(float((port_avg - bench_3m) / (np.std(portfolio_returns_3m) * 100)), 2)
            if np.std(portfolio_returns_3m) > 0
            else 0
        ),
        "beat_rate": round(float((np.array(portfolio_returns_3m) * 100 > bench_3m).mean()) * 100, 1),
        "benchmark_detail": bench,
    }


def stress_tests(initial_value: float = 100000) -> dict:
    """历史场景压力测试。"""
    scenarios = [
        ("2022 NASDAQ Bear (-33%)", -0.33),
        ("2020 COVID Crash (-34% 1mo)", -0.34),
        ("2018 Q4 Tech Selloff (-20%)", -0.20),
        ("2015 China Bubble Burst (-45% CSI300)", -0.45),
        ("2008 GFC (-57% SPX)", -0.57),
        ("2000 Dot-com (-78% NASDAQ)", -0.78),
    ]
    results = {}
    for name, shock in scenarios:
        # AI 组合 beta ≈ 1.5 vs NASDAQ
        beta = 1.5
        impact = shock * beta
        results[name] = {
            "historical_drawdown": f"{shock:.0%}",
            "estimated_portfolio_impact": f"{impact:.0%}",
            "estimated_value": round(initial_value * (1 + impact), 0),
            "loss_amount": round(initial_value * abs(impact), 0),
        }
    return results
