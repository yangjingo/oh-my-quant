"""风险指标计算"""

import numpy as np
import pandas as pd


def metrics(returns: pd.Series, rf: float = 0.02) -> dict:
    """一键计算所有风险指标"""
    cum = (1 + returns).cumprod()
    running_max = cum.expanding().max()
    dd = (cum - running_max) / running_max
    downside = returns[returns < 0]

    return {
        "annual_vol": round(returns.std() * np.sqrt(252), 4),
        "downside_vol": round(downside.std() * np.sqrt(252), 4) if len(downside) > 0 else 0,
        "var_95": round(np.percentile(returns, 5), 4),
        "var_99": round(np.percentile(returns, 1), 4),
        "var_95_parametric": round(returns.mean() - 1.645 * returns.std(), 4),
        "cvar_95": round(returns[returns <= np.percentile(returns, 5)].mean(), 4),
        "cvar_99": round(returns[returns <= np.percentile(returns, 1)].mean(), 4),
        "max_drawdown": round(dd.min(), 4),
        "max_dd_days": _dd_duration(dd),
        "skewness": round(returns.skew(), 4),
        "kurtosis": round(returns.kurtosis(), 4),
    }


def write_benchmark(result: dict, strategy: str, symbol: str = "", params: dict = None,
                    source: dict = None) -> "Path":
    """按投递协议写入 benchmark/results/。见 benchmark/SKILL.md"""
    from datetime import datetime
    from pathlib import Path
    import json

    results_dir = Path(__file__).resolve().parents[3] / "benchmark" / "results"
    results_dir.mkdir(parents=True, exist_ok=True)

    payload = {
        "strategy": strategy,
        "date": datetime.now().strftime("%Y-%m-%d"),
        "skill": "risk",
        "total_score": 0,
        "grade": "N/A",
    }
    if symbol:
        payload["symbol"] = symbol
    if params:
        payload["params"] = params
    if source:
        payload["source"] = source

    details = {k: v for k, v in result.items() if isinstance(v, (int, float))}
    if details:
        payload["details"] = details

    filename = f"risk_{strategy}_{payload['date']}.json"
    out = results_dir / filename
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def _dd_duration(drawdown: pd.Series) -> int:
    underwater = drawdown < 0
    if not underwater.any():
        return 0
    blocks = underwater.astype(int).diff()
    durations = underwater.groupby((blocks == 1).cumsum()).sum()
    return int(durations.max())
