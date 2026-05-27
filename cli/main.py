"""Minimal CLI for the runnable quant workflow."""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

import click

ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = ROOT / "skills"
BENCHMARK_DIR = ROOT / "benchmark"
RESULTS_DIR = BENCHMARK_DIR / "results"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def _load_env() -> None:
    for path in (ROOT / ".env", ROOT / "agent" / ".env"):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key, value)


def _to_us_date(value: str, default: str) -> str:
    if not value:
        return default
    if re.fullmatch(r"\d{8}", value):
        return f"{value[:4]}-{value[4:6]}-{value[6:]}"
    return value


def _load_cn_close(symbol: str, start: str, end: str):
    from skills.datasource.scripts.akshare import daily

    df = daily(symbol, start=start, end=end)
    if "close" not in df.columns:
        raise click.ClickException(f"{symbol} 缺少 close 列")
    return df["close"].dropna()


def _load_us_close(symbol: str, start: str, end: str):
    from skills.datasource.scripts.yfinance import daily

    df = daily(symbol, start=_to_us_date(start, "2010-01-01"), end=_to_us_date(end, "2025-12-31"))
    if "close" not in df.columns:
        raise click.ClickException(f"{symbol} 缺少 close 列")
    return df["close"].dropna()


def _load_benchmark_close(symbol: str, start: str, end: str):
    try:
        return _load_cn_close(symbol, start, end)
    except click.ClickException:
        return _load_us_close(symbol, start, end)


def _sma_signals(close, fast: int, slow: int):
    fast_ma = close.rolling(fast).mean()
    slow_ma = close.rolling(slow).mean()
    return (fast_ma > slow_ma).astype(float)


def _result_name(label: str | None, symbol: str, fast: int, slow: int) -> str:
    base = label or f"sma_{fast}_{slow}_{symbol}"
    slug = re.sub(r"[^0-9A-Za-z_-]+", "_", base).strip("_")
    return slug or f"sma_{fast}_{slow}_{symbol}"


def _save_result(filename: str, payload: dict) -> Path:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    out = RESULTS_DIR / f"{filename}_{datetime.now().date().isoformat()}.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


_load_env()


@click.group()
@click.version_option(version="0.2.0")
def cli():
    """whyj-quant CLI."""


@cli.group()
def data():
    """数据获取。"""


@data.command("download")
@click.option("--symbol", required=True, help="股票代码，如 000001 或 AAPL")
@click.option("--market", type=click.Choice(["A", "US"], case_sensitive=False), default="A", show_default=True)
@click.option("--start", default="20240101", show_default=True, help="A 股用 YYYYMMDD，美股可用 YYYY-MM-DD")
@click.option("--end", default="20241231", show_default=True, help="A 股用 YYYYMMDD，美股可用 YYYY-MM-DD")
@click.option("--period", default="daily", show_default=True)
def data_download(symbol: str, market: str, start: str, end: str, period: str):
    """下载历史行情。"""
    try:
        if market.upper() == "US":
            from skills.datasource.scripts.yfinance import daily

            df = daily(symbol, start=_to_us_date(start, "2024-01-01"), end=_to_us_date(end, "2024-12-31"))
        else:
            from skills.datasource.scripts.akshare import daily

            df = daily(symbol, start=start, end=end, period=period)
        click.secho(f"获取成功: {len(df)} 行", fg="green")
        click.echo(df.tail(5).to_string())
    except Exception as exc:
        raise click.ClickException(str(exc)) from exc


@cli.group()
def factor():
    """因子分析。"""


@factor.command("analyze")
@click.option("--symbol", required=True, help="股票代码")
@click.option(
    "--factor-name",
    "factor_name",
    type=click.Choice(["momentum", "reversal", "volatility", "rsi"], case_sensitive=False),
    default="momentum",
    show_default=True,
)
@click.option("--period", default=20, type=int, show_default=True)
def factor_analyze(symbol: str, factor_name: str, period: int):
    """计算单因子统计。"""
    try:
        from skills.datasource.scripts.akshare import daily
        from skills.factor.scripts.compute import momentum, reversal, rsi, volatility

        close = daily(symbol)["close"]
        factors = {
            "momentum": momentum,
            "reversal": reversal,
            "volatility": volatility,
            "rsi": rsi,
        }
        series = factors[factor_name](close, period).dropna()
        click.secho("因子统计", fg="green")
        click.echo(f"mean={series.mean():.4f}")
        click.echo(f"std={series.std():.4f}")
        click.echo(f"min={series.min():.4f}")
        click.echo(f"max={series.max():.4f}")
    except Exception as exc:
        raise click.ClickException(str(exc)) from exc


@cli.group()
def backtest():
    """回测。"""


@backtest.command("run")
@click.option("--symbol", required=True, help="股票代码")
@click.option("--fast", default=20, type=int, show_default=True)
@click.option("--slow", default=60, type=int, show_default=True)
@click.option("--cash", default=100000, type=int, show_default=True)
@click.option("--start", default="20200101", show_default=True)
@click.option("--end", default="20251231", show_default=True)
def backtest_run(symbol: str, fast: int, slow: int, cash: int, start: str, end: str):
    """运行最小可用的均线交叉回测。"""
    if fast >= slow:
        raise click.ClickException("fast 必须小于 slow")

    try:
        from skills.backtest.scripts.metrics import report, vectorized_backtest

        close = _load_cn_close(symbol, start, end)
        signals = _sma_signals(close, fast, slow)
        result = vectorized_backtest(signals, close, initial_cash=cash)
        perf = report(result["returns"].dropna())
        click.secho("回测完成", fg="green")
        for key, value in perf.items():
            click.echo(f"{key}: {value}")
    except Exception as exc:
        raise click.ClickException(str(exc)) from exc


@cli.group()
def risk():
    """风险指标。"""


@risk.command("check")
@click.option("--symbol", required=True, help="股票代码")
@click.option("--start", default="20200101", show_default=True)
@click.option("--end", default="20251231", show_default=True)
def risk_check(symbol: str, start: str, end: str):
    """计算风险指标。"""
    try:
        from skills.risk.scripts.risk_metrics import metrics

        returns = _load_cn_close(symbol, start, end).pct_change().dropna()
        result = metrics(returns)
        click.secho("风险指标", fg="green")
        for key, value in result.items():
            click.echo(f"{key}: {value}")
    except Exception as exc:
        raise click.ClickException(str(exc)) from exc


@cli.group()
def benchmark():
    """策略评分与结果汇总。"""


@benchmark.command("run")
@click.option("--symbol", required=True, help="策略标的")
@click.option("--benchmark-symbol", default="510300.SS", show_default=True, help="基准标的，优先使用 yfinance 可识别代码")
@click.option("--fast", default=20, type=int, show_default=True)
@click.option("--slow", default=60, type=int, show_default=True)
@click.option("--cash", default=100000, type=int, show_default=True)
@click.option("--start", default="20200101", show_default=True)
@click.option("--end", default="20251231", show_default=True)
@click.option("--label", default=None, help="结果标签")
def benchmark_run(
    symbol: str,
    benchmark_symbol: str,
    fast: int,
    slow: int,
    cash: int,
    start: str,
    end: str,
    label: str | None,
):
    """对均线交叉策略打分并写入结果文件。"""
    if fast >= slow:
        raise click.ClickException("fast 必须小于 slow")

    try:
        from benchmark.scripts.score import evaluate
        from skills.backtest.scripts.metrics import vectorized_backtest

        close = _load_cn_close(symbol, start, end)
        benchmark_close = _load_benchmark_close(benchmark_symbol, start, end)
        prices = (
            close.rename("strategy_close")
            .to_frame()
            .join(benchmark_close.rename("benchmark_close"), how="inner")
            .dropna()
        )
        signals = _sma_signals(prices["strategy_close"], fast, slow)
        bt = vectorized_backtest(signals, prices["strategy_close"], initial_cash=cash)

        strategy_returns = bt["returns"].dropna()
        benchmark_returns = prices["benchmark_close"].pct_change().dropna()
        common_index = strategy_returns.index.intersection(benchmark_returns.index)
        if common_index.empty:
            raise click.ClickException("策略收益与基准收益没有重叠区间")

        result = evaluate(strategy_returns.loc[common_index], benchmark_returns.loc[common_index])
        payload = {
            "strategy": _result_name(label, symbol, fast, slow),
            "date": datetime.now().date().isoformat(),
            "symbol": symbol,
            "benchmark_symbol": benchmark_symbol,
            "window": {"fast": fast, "slow": slow},
            **result,
        }
        out = _save_result(payload["strategy"], payload)
        click.secho(f"综合得分: {result['total_score']}/100 ({result['grade']})", fg="green")
        click.echo(f"结果文件: {out}")
    except Exception as exc:
        raise click.ClickException(str(exc)) from exc


@benchmark.command("dashboard")
def benchmark_dashboard():
    """打印 benchmark 结果汇总。"""
    try:
        from benchmark.scripts.dashboard import collect_results, summary

        df = collect_results()
        if df.empty:
            click.secho("暂无评测结果", fg="yellow")
            return

        stats = summary(df)
        click.secho(
            f"评测总数: {stats['total_evals']}  平均得分: {stats['avg_score']}/100  "
            f"最高: {stats['best_score']} ({stats['best_strategy']})",
            fg="green",
        )
        click.echo(
            "评级分布: "
            + " ".join(f"{grade}={stats['grade_distribution'][grade]}" for grade in "SABCD")
        )
        click.echo(f"平均夏普: {stats['avg_sharpe']}  平均回撤: {stats['avg_max_dd']:.2%}")
    except Exception as exc:
        raise click.ClickException(str(exc)) from exc


@cli.group()
def validate():
    """项目结构验证。"""


@validate.command("all")
def validate_all():
    """验证 skill 与 benchmark 目录。"""
    targets = [
        ("datasource", True),
        ("factor", True),
        ("backtest", True),
        ("risk", True),
        ("validate", True),
    ]

    passed = 0
    total = len(targets) + 1

    for name, needs_scripts in targets:
        skill_md = SKILLS_DIR / name / "SKILL.md"
        scripts_dir = SKILLS_DIR / name / "scripts"
        exists = skill_md.exists()
        scripts_ok = scripts_dir.is_dir() if needs_scripts else True
        scripts_label = "OK" if scripts_ok and needs_scripts else "-"
        ok = exists and scripts_ok
        passed += int(ok)
        click.secho(
            f"[{'OK' if ok else 'MISS'}] {name:<10} SKILL.md={'OK' if exists else 'MISS'} "
            f"scripts={scripts_label if scripts_ok else 'MISS'}",
            fg="green" if ok else "red",
        )

    benchmark_ok = (BENCHMARK_DIR / "SKILL.md").exists() and (BENCHMARK_DIR / "scripts").is_dir()
    passed += int(benchmark_ok)
    click.secho(
        f"[{'OK' if benchmark_ok else 'MISS'}] benchmark  SKILL.md={'OK' if (BENCHMARK_DIR / 'SKILL.md').exists() else 'MISS'} "
        f"scripts={'OK' if (BENCHMARK_DIR / 'scripts').is_dir() else '-'}",
        fg="green" if benchmark_ok else "red",
    )
    click.echo(f"\n通过: {passed}/{total}")


if __name__ == "__main__":
    cli()
