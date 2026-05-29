"""因子计算与预处理工具"""

import numpy as np
import pandas as pd


def momentum(close: pd.Series, n: int = 20) -> pd.Series:
    return close.pct_change(n)


def reversal(close: pd.Series, n: int = 5) -> pd.Series:
    return -close.pct_change(n)


def volatility(close: pd.Series, n: int = 20) -> pd.Series:
    return close.pct_change().rolling(n).std()


def volume_ratio(volume: pd.Series, n: int = 20) -> pd.Series:
    return volume / volume.rolling(n).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(n).mean()
    loss = (-delta.clip(upper=0)).rolling(n).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def sma_deviation(close: pd.Series, short: int = 5, long: int = 20) -> pd.Series:
    return (close.rolling(short).mean() - close.rolling(long).mean()) / close.rolling(long).mean()


def winsorize(series: pd.Series, n_mad: float = 5.0) -> pd.Series:
    median = series.median()
    mad = (series - median).abs().median()
    upper = median + n_mad * 1.4826 * mad
    lower = median - n_mad * 1.4826 * mad
    return series.clip(lower, upper)


def standardize(series: pd.Series) -> pd.Series:
    return (series - series.mean()) / series.std(ddof=1)


def neutralize(series: pd.Series, exposures: pd.DataFrame) -> pd.Series:
    from sklearn.linear_model import LinearRegression
    valid = series.notna() & exposures.notna().all(axis=1)
    if valid.sum() < 10:
        return series
    X = pd.get_dummies(exposures.loc[valid], drop_first=True)
    y = series.loc[valid]
    resid = y - LinearRegression().fit(X, y).predict(X)
    result = series.copy()
    result.loc[valid] = resid
    return result


def write_benchmark(factor_name: str, series: pd.Series, symbol: str = "", params: dict = None):
    """按投递协议写入 benchmark/results/。见 benchmark/SKILL.md"""
    from datetime import datetime
    from pathlib import Path
    import json

    results_dir = Path(__file__).resolve().parents[3] / "benchmark" / "results"
    results_dir.mkdir(parents=True, exist_ok=True)

    s = series.dropna()
    payload = {
        "strategy": f"factor_{factor_name}",
        "date": datetime.now().strftime("%Y-%m-%d"),
        "skill": "factor",
        "total_score": 0,
        "grade": "N/A",
        "details": {
            "mean": round(float(s.mean()), 4),
            "std": round(float(s.std()), 4),
            "min": round(float(s.min()), 4),
            "max": round(float(s.max()), 4),
            "observations": len(s),
        },
    }
    if symbol:
        payload["symbol"] = symbol
    if params:
        payload["params"] = params

    filename = f"factor_{factor_name}_{payload['date']}.json"
    out = results_dir / filename
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def preprocess(series: pd.Series, exposures: pd.DataFrame = None) -> pd.Series:
    result = winsorize(series)
    if exposures is not None:
        result = neutralize(result, exposures)
    return standardize(result)
