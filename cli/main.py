"""whyj-quant CLI — 串接 9 个量化 skills 的命令行入口"""

import click
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = ROOT / "skills"
CORE_SKILLS = ["data", "factor", "backtest", "risk", "research", "intel", "consensus"]

# Avoid Windows cp1252 write errors for existing Chinese / emoji CLI output.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# Load .env at startup
def _load_env():
    for p in [ROOT / ".env", ROOT / "agent" / ".env"]:
        if p.exists():
            for line in p.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    if k not in __import__("os").environ:
                        __import__("os").environ[k] = v
_load_env()


@click.group()
@click.version_option(version="0.1.0")
def cli():
    """whyj-quant — oh-my-quant 量化 skills 合集 CLI

    串接 data / factor / backtest / risk / research / intel / consensus / benchmark / validate 9 个 skills。

    \\b
    示例:
      whyj-quant run -p "回测平安银行 2024 年 20/60 均线策略"
      whyj-quant data download --symbol 000001
      whyj-quant backtest macd --symbol 000001
      whyj-quant validate --all
    """
    pass


# ── run: 自然语言入口（类似 vibe-trading run -p "..."）──

@cli.command()
@click.option("-p", "--prompt", required=True, help="自然语言任务描述")
@click.option("--dry-run", is_flag=True, help="只展示将调用的 skills，不实际执行")
def run(prompt: str, dry_run: bool):
    """自然语言驱动 — 解析意图，路由到对应 skill"""
    click.echo(f"🧠 解析: {prompt}")

    # 关键词路由
    keywords = {
        "data": ["数据", "下载", "行情", "获取", "财务"],
        "factor": ["因子", "alpha", "IC", "选股"],
        "backtest": ["回测", "策略", "backtest", "绩效", "均线", "MACD", "RSI"],
        "risk": ["风险", "VaR", "压力测试", "组合优化", "波动率"],
        "intel": ["巴菲特", "Dalio", "Marks", "大师", "股东信", "13F"],
        "consensus": ["共识", "共同买", "顶级基金", "机构共识", "抱团", "新进入榜单", "退出榜单"],
        "benchmark": ["评测", "benchmark", "对比", "排名"],
        "research": ["研究", "完整流程", "端到端"],
        "validate": ["验证", "测试", "check"],
    }

    matched = []
    for skill, words in keywords.items():
        score = sum(1 for w in words if w.lower() in prompt.lower())
        if score > 0:
            matched.append((skill, score))

    matched.sort(key=lambda x: x[1], reverse=True)

    if not matched:
        click.secho("⚠ 无法识别意图，请更具体描述或使用子命令", fg="yellow")
        return

    top_skill = matched[0][0]

    if dry_run:
        click.secho(f"[dry-run] 将调用 skill: {top_skill}", fg="cyan")
        for s, score in matched[1:]:
            click.echo(f"         相关 skill: {s} (score={score})")
        return

    click.secho(f"→ 路由到 skill: {top_skill}", fg="green")
    click.echo(f"📖 请参考 skills/{top_skill}/SKILL.md 执行任务")
    click.echo(f"🔧 可用脚本: skills/{top_skill}/scripts/")


# ── data ──

@cli.group()
def data():
    """数据获取与清洗"""

@data.command("download")
@click.option("--symbol", required=True, help="股票代码 (000001=平安银行)")
@click.option("--market", default="A", help="市场: A=沪深, US=美股")
@click.option("--start", default="20240101", help="开始日期 YYYYMMDD")
@click.option("--end", default="20241231", help="结束日期 YYYYMMDD")
@click.option("--period", default="daily", help="周期: daily/60/30/15/5/1")
def data_download(symbol: str, market: str, start: str, end: str, period: str):
    """下载股票历史行情数据"""
    click.echo(f"⬇ 下载 {market} {symbol} {start}-{end} {period}")
    try:
        from skills.datasource.scripts.akshare import daily as ak_daily
        from skills.datasource.scripts.yfinance import daily as yf_daily
        if market.upper() == "A":
            df = ak_daily(symbol, start=start, end=end, period=period)
        else:
            df = yf_daily(symbol, start=start.split("01")[0]+"-01-01", end=end.split("12")[0]+"-12-31")
        click.secho(f"✓ 获取 {len(df)} 行数据", fg="green")
        click.echo(df.tail(5).to_string())
    except ImportError as e:
        click.secho(f"✗ 缺少依赖: {e}", fg="red")
        click.echo("  pip install akshare yfinance")
        _show_skill_md("data")


# ── factor ──

@cli.group()
def factor():
    """因子研究与分析"""

@factor.command("analyze")
@click.option("--symbol", required=True, help="股票代码")
@click.option("--factor-name", default="momentum_20d", help="因子名称")
@click.option("--period", default=20, type=int, help="因子周期")
def factor_analyze(symbol: str, factor_name: str, period: int):
    """计算因子并进行 IC 分析"""
    click.echo(f"📊 计算 {symbol} {factor_name}")
    try:
        from skills.factor.scripts.compute import momentum, reversal, volatility, rsi
        import pandas as pd
        from skills.datasource.scripts.akshare import daily as ak_daily

        df = ak_daily(symbol)
        factor_map = {
            "momentum": momentum(df["close"], period),
            "reversal": reversal(df["close"], period),
            "volatility": volatility(df["close"], period),
            "rsi": rsi(df["close"], period),
        }
        result = factor_map.get(factor_name.split("_")[0], momentum(df["close"], period))
        click.secho(f"✓ 因子均值={result.mean():.4f} 标准差={result.std():.4f}", fg="green")
    except ImportError as e:
        click.secho(f"✗ 缺少依赖: {e}", fg="red")
        _show_skill_md("factor")


# ── backtest ──

@cli.group()
def backtest():
    """策略回测"""

@backtest.command("run")
@click.option("--strategy", default="macd", help="策略类型: macd, sma_cross, rsi")
@click.option("--symbol", required=True, help="股票代码")
@click.option("--fast", default=20, type=int, help="快线参数")
@click.option("--slow", default=60, type=int, help="慢线参数")
@click.option("--cash", default=100000, type=int, help="初始资金")
def backtest_run(strategy: str, symbol: str, fast: int, slow: int, cash: int):
    """运行回测"""
    click.echo(f"📈 回测 {strategy} {symbol} (参数: {fast}/{slow}, 资金: {cash})")
    try:
        from skills.backtest.scripts.metrics import vectorized_backtest, report
        from skills.datasource.scripts.akshare import daily as ak_daily
        import numpy as np

        df = ak_daily(symbol, start="20200101", end="20251231")
        close = df["close"]

        # 生成信号: 均线交叉
        fast_ma = close.rolling(fast).mean()
        slow_ma = close.rolling(slow).mean()
        signals = (fast_ma > slow_ma).astype(float)

        result = vectorized_backtest(signals, close, initial_cash=cash)
        perf = report(result["returns"].dropna())
        click.secho("✓ 回测完成", fg="green")
        for k, v in perf.items():
            click.echo(f"  {k}: {v}")
    except ImportError as e:
        click.secho(f"✗ 缺少依赖: {e}", fg="red")
        _show_skill_md("backtest")


# ── risk ──

@cli.group()
def risk():
    """风险管理"""

@risk.command("check")
@click.option("--symbol", required=True, help="股票代码")
@click.option("--benchmark", default="000300", help="基准代码")
def risk_check(symbol: str, benchmark: str):
    """计算风险指标"""
    click.echo(f"⚠ 风险评估 {symbol}")
    try:
        from skills.datasource.scripts.akshare import daily as ak_daily
        from skills.risk.scripts.risk_metrics import metrics
        import numpy as np

        df = ak_daily(symbol)
        returns = df["close"].pct_change().dropna()
        risk = metrics(returns)

        click.secho("✓ 风险指标", fg="green")
        for k, v in risk.items():
            click.echo(f"  {k}: {v}")
    except ImportError as e:
        click.secho(f"✗ 缺少依赖: {e}", fg="red")
        _show_skill_md("risk")


# ── intel ──

@cli.group()
def intel():
    """投资大师观点抓取"""

@intel.command("fetch")
@click.option("--master", default="all", help="大师: buffett, dalio, marks, all")
def intel_fetch(master: str):
    """抓取投资大师最新观点"""
    click.echo(f"🔍 抓取 {master} 最新观点")
    click.echo("提示: 此功能需 WebFetch/MCP 工具，请在 Claude Code 中使用 /intel skill")
    _show_skill_md("intel")


# ── consensus ──

@cli.group()
def consensus():
    """13F 机构共识持仓分析"""


@consensus.command("report")
@click.option("--quarter", default="latest", help="季度标签，例如 2026Q1")
@click.option("--top-n", default=20, type=int, help="输出榜单数量")
def consensus_report(quarter: str, top_n: int):
    """输出机构共识分析说明"""
    click.echo(f"🤝 机构共识分析 {quarter} Top {top_n}")
    click.echo("提示: 此功能需 financial-datasets 或 llmquant-data MCP，请在 Claude Code / Codex 中使用 /consensus skill")
    click.echo("脚本入口: skills/consensus/scripts/consensus.py")
    _show_skill_md("consensus")


# ── benchmark ──

@cli.group()
def benchmark():
    """策略基准评测"""

@benchmark.command("run")
@click.option("--symbol", required=True, help="股票代码")
@click.option("--strategy-desc", default="买入持有", help="策略描述")
def benchmark_run(symbol: str, strategy_desc: str):
    """运行基准评测"""
    click.echo(f"📏 评测 {symbol} {strategy_desc}")
    try:
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from skills.datasource.scripts.akshare import daily as ak_daily
        from benchmark.scripts.score import evaluate
        import pandas as pd

        df = ak_daily(symbol)
        returns = df["close"].pct_change().dropna()
        bench_ret = returns.copy()

        result = evaluate(returns, bench_ret)
        click.secho(f"✓ 综合得分: {result['total_score']}/100 (评级: {result['grade']})", fg="green")
        click.echo(f"  收益: {result['return_score']}/40  风险: {result['risk_score']}/40  稳健性: {result['robustness_score']}/20")
    except ImportError as e:
        click.secho(f"✗ 缺少依赖: {e}", fg="red")
        click.echo(f"  路径: benchmark/SKILL.md")


# ── research ──

@cli.group()
def research():
    """综合研究入口"""

@research.command("start")
@click.option("-p", "--prompt", required=True, help="研究主题")
def research_start(prompt: str):
    """启动完整研究流程"""
    click.echo(f"🔬 启动研究: {prompt}")
    click.echo("流程: data → factor → backtest → risk → 综合报告")
    click.echo("📖 请参考 skills/research/SKILL.md 获取完整编排指令")
    _show_skill_md("research")


# ── validate ──

@cli.group()
def validate():
    """验证 skills & CLI 工具"""

@validate.command("all")
def validate_all():
    """运行全部冒烟测试"""
    click.echo("🧪 运行全部 skill 结构验证")
    BENCHMARK_DIR = Path(__file__).resolve().parents[1] / "benchmark"
    total = 0
    passed = 0
    for name in [*CORE_SKILLS, "benchmark"]:
        if name == "benchmark":
            skill_md = BENCHMARK_DIR / "SKILL.md"
            scripts = BENCHMARK_DIR / "scripts"
        else:
            skill_md = SKILLS_DIR / name / "SKILL.md"
            scripts = SKILLS_DIR / name / "scripts"
        exists = skill_md.exists()
        has_scripts = scripts.is_dir() and any(scripts.iterdir())
        icon = "✓" if exists else "✗"
        color = "green" if exists else "red"
        if exists:
            passed += 1
        total += 1
        click.secho(f"  [{icon}] {name:<12} SKILL.md={'OK' if exists else 'MISS'} scripts={'OK' if has_scripts else '-'}", fg=color)
    click.secho(f"\n通过: {passed}/{total}", fg="green" if passed == total else "yellow")


@validate.command("check-cli")
def validate_check_cli():
    """检查外部 CLI 工具是否可用"""
    import subprocess
    tools = ["vibe-trading", "python"]
    for tool in tools:
        try:
            r = subprocess.run([tool, "--version"], capture_output=True, text=True, timeout=5)
            click.secho(f"  ✓ {tool}: {r.stdout.strip()[:60]}", fg="green")
        except FileNotFoundError:
            click.secho(f"  ✗ {tool}: not found", fg="red")
        except Exception as e:
            click.secho(f"  ? {tool}: {e}", fg="yellow")


# ── helpers ──

# ── dashboard ──

@cli.command()
@click.option("--html", is_flag=True, help="生成 HTML 看板并打开浏览器")
def dashboard(html: bool):
    """统计看板 — 聚合 benchmark/results/ 评测结果"""
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

    if html:
        from benchmark.scripts.dashboard_html import collect, build_html
        df = collect()
        out = Path(__file__).resolve().parents[1] / "benchmark/metrics/dashboard.html"
        out.write_text(build_html(df), encoding="utf-8")
        import webbrowser
        webbrowser.open(str(out))
        click.secho(f"✓ 打开看板: {out}", fg="green")
        return

    click.echo("📊 统计看板")
    try:
        from benchmark.scripts.dashboard import collect_results, summary

        df = collect_results()
        if df.empty:
            click.secho("暂无评测结果，运行 whyj-quant benchmark run --symbol 000001 添加", fg="yellow")
            return

        s = summary(df)
        click.secho(f"评测总数: {s['total_evals']}  平均得分: {s['avg_score']}/100  最高: {s['best_score']} ({s['best_strategy']})", fg="green")
        click.echo(f"评级分布: S={s['grade_distribution']['S']} A={s['grade_distribution']['A']} B={s['grade_distribution']['B']} C={s['grade_distribution']['C']} D={s['grade_distribution']['D']}")
        click.echo(f"平均夏普: {s['avg_sharpe']}  平均回撤: {s['avg_max_dd']:.2%}")

        top = df.nlargest(5, "total_score")
        click.echo("\nTop 5:")
        for _, r in top.iterrows():
            click.echo(f"  {r['strategy']:<25} {r['total_score']:>5.0f} ({r['grade']}) sharpe={r['sharpe']:.1f}")
    except Exception as e:
        click.secho(f"✗ 看板生成失败: {e}", fg="red")


def _show_skill_md(name: str):
    """打印 skill 的 SKILL.md 路径供参考"""
    path = SKILLS_DIR / name / "SKILL.md"
    if path.exists():
        click.echo(f"\n📖 详细指令: {path}")


if __name__ == "__main__":
    cli()
