/**
 * Quant tool definitions — pi AgentTool format.
 * Registered with the pi Agent and called via LLM tool_use.
 */
import { Type } from "typebox";
import type { Static } from "typebox";
import type { AgentTool, AgentToolResult } from "../agent/core/types.ts";
import { ERRORS, formatError, type ErrorCode } from "../types/errors.ts";

// ── Schemas ──

const S = {
  FetchBars: Type.Object({
    symbol: Type.String({ description: "Stock code e.g. 000001.SZ or AAPL" }),
    market: Type.Union([Type.Literal("A"), Type.Literal("US"), Type.Literal("HK")], { default: "A" }),
    start: Type.Optional(Type.String({ description: "Start date YYYY-MM-DD" })),
    end: Type.Optional(Type.String({ description: "End date YYYY-MM-DD" })),
  }),
  ComputeFactor: Type.Object({
    symbol: Type.String(),
    factor: Type.Union([Type.Literal("momentum"), Type.Literal("reversal"), Type.Literal("volatility"),
      Type.Literal("volume_ratio"), Type.Literal("rsi"), Type.Literal("sma_deviation")]),
    period: Type.Number({ default: 20 }),
  }),
  RunBacktest: Type.Object({
    symbol: Type.String(),
    fast: Type.Number({ default: 20 }), slow: Type.Number({ default: 60 }),
    cash: Type.Number({ default: 100_000 }),
    start: Type.Optional(Type.String()), end: Type.Optional(Type.String()),
  }),
  CheckRisk: Type.Object({
    symbol: Type.String(),
    start: Type.Optional(Type.String()), end: Type.Optional(Type.String()),
  }),
  ScoreBenchmark: Type.Object({
    symbol: Type.String(),
    benchmark_symbol: Type.String({ default: "000300.SH" }),
    fast: Type.Number({ default: 20 }), slow: Type.Number({ default: 60 }),
    cash: Type.Number({ default: 100_000 }),
    label: Type.Optional(Type.String()),
  }),
  ShowDashboard: Type.Object({
    sort_by: Type.Optional(Type.Union([Type.Literal("score"), Type.Literal("cagr"), Type.Literal("sharpe")])),
  }),
};

type FetchBarsArgs = Static<typeof S.FetchBars>;
type ComputeFactorArgs = Static<typeof S.ComputeFactor>;
type RunBacktestArgs = Static<typeof S.RunBacktest>;
type CheckRiskArgs = Static<typeof S.CheckRisk>;
type ScoreBenchmarkArgs = Static<typeof S.ScoreBenchmark>;
type ShowDashboardArgs = Static<typeof S.ShowDashboard>;

// Helper: make a text result
function ok(text: string, details?: unknown): AgentToolResult<unknown> {
  return { content: [{ type: "text" as const, text }], details: details ?? {} };
}
function err(code: ErrorCode, detail?: string): AgentToolResult<unknown> {
  return { content: [{ type: "text" as const, text: formatError(ERRORS[code], detail) }], details: {} };
}

// ── Tool implementations ──

export const fetchBarsTool: AgentTool<typeof S.FetchBars> = {
  name: "fetch_bars",
  description: "Download daily OHLCV stock price data. Call this before any analysis. Supports A-share, US, HK markets.",
  label: "📥 Data",
  parameters: S.FetchBars,
  executionMode: "sequential",

  async execute(_id: string, args: FetchBarsArgs): Promise<AgentToolResult<unknown>> {
    const { fetchBars } = await import("../data/sources.ts");
    const result = await fetchBars(args.symbol, args.market, args.start, args.end);
    const bars = result.bars;
    const latest = bars[bars.length - 1];
    return ok([
      `Downloaded ${bars.length} bars for ${args.symbol} via ${result.source}`,
      `Range: ${bars[0]?.date} → ${latest?.date}`,
      latest ? `Latest close: ${latest.close.toFixed(2)}` : "",
    ].filter(Boolean).join("\n"),
    { symbol: args.symbol, source: result.source, barCount: bars.length });
  },
};

export const computeFactorTool: AgentTool<typeof S.ComputeFactor> = {
  name: "compute_factor",
  description: "Compute technical factor: momentum, reversal, volatility, volume_ratio, rsi, sma_deviation. Requires bars data cached first (call fetch_bars).",
  label: "📊 Factor",
  parameters: S.ComputeFactor,
  executionMode: "sequential",

  async execute(_id: string, args: ComputeFactorArgs): Promise<AgentToolResult<unknown>> {
    const { computeFactor: compute } = await import("../services/factor.ts");
    const { loadBars } = await import("../storage/bars.ts");

    let bars = await loadBars(args.symbol, "tushare");
    if (bars.length === 0) bars = await loadBars(args.symbol, "llmquant-data");
    if (bars.length === 0) return err("DATA_NO_CACHE", args.symbol);

    const close = bars.map((b) => b.close);
    const volume = bars.map((b) => b.volume);
    const values = compute(args.factor, close, volume, args.period);
    const allValid = values.filter((v): v is number => v !== null);
    const last = allValid.pop();
    const mean = allValid.length > 0 ? allValid.reduce((a: number, b: number) => a + b, 0) / allValid.length : 0;
    const sorted = [...allValid].sort((a, b) => a - b);
    const pctRank = last !== undefined && sorted.length > 0
      ? sorted.filter((v) => v <= last).length / sorted.length : 0;

    return ok([
      `Factor: ${args.factor}_${args.period} — ${args.symbol}`,
      `Latest: ${last?.toFixed(4) ?? "N/A"}  |  Mean: ${mean.toFixed(4)}`,
      `Percentile: ${(pctRank * 100).toFixed(0)}%`,
    ].join("\n"),
    { symbol: args.symbol, factor: args.factor, period: args.period, last, mean, percentile: pctRank });
  },
};

export const runBacktestTool: AgentTool<typeof S.RunBacktest> = {
  name: "run_backtest",
  description: "Run SMA crossover backtest. Returns: total return, CAGR, Sharpe, max drawdown, win rate. Requires bars data cached first.",
  label: "📈 Backtest",
  parameters: S.RunBacktest,
  executionMode: "sequential",

  async execute(_id: string, args: RunBacktestArgs): Promise<AgentToolResult<unknown>> {
    const { smaSignals, vectorizedBacktest, report } = await import("../services/backtest.ts");
    const { loadBars } = await import("../storage/bars.ts");

    let bars = await loadBars(args.symbol, "tushare");
    if (bars.length === 0) bars = await loadBars(args.symbol, "llmquant-data");
    if (bars.length === 0) return err("DATA_NO_CACHE", args.symbol);
    if (bars.length < args.slow + 10) return err("DATA_NOT_ENOUGH", `${args.slow + 10}+ bars for SMA(${args.fast},${args.slow}), got ${bars.length}.`);

    const close = bars.map((b) => b.close);
    const signals = smaSignals(close, args.fast, args.slow);
    const { returns } = vectorizedBacktest(signals, close, args.cash);
    const r = report(returns);

    return ok([
      `SMA(${args.fast},${args.slow}) Backtest — ${args.symbol}`,
      `──────────────────────────────────────`,
      `Total Return:  ${(r.totalReturn * 100).toFixed(2)}%    CAGR: ${(r.cagr * 100).toFixed(2)}%`,
      `Sharpe:        ${r.sharpe.toFixed(2)}         Max DD: ${(r.maxDrawdown * 100).toFixed(2)}%`,
      `Win Rate:      ${(r.winRate * 100).toFixed(1)}%        P/L Ratio: ${r.pnlRatio.toFixed(2)}`,
    ].join("\n"), { symbol: args.symbol, ...r });
  },
};

export const checkRiskTool: AgentTool<typeof S.CheckRisk> = {
  name: "check_risk",
  description: "Compute risk metrics: annual vol, VaR(95/99), CVaR(95/99), max drawdown, skewness, kurtosis.",
  label: "⚠️ Risk",
  parameters: S.CheckRisk,
  executionMode: "sequential",

  async execute(_id: string, args: CheckRiskArgs): Promise<AgentToolResult<unknown>> {
    const { metrics } = await import("../services/risk.ts");
    const { loadBars } = await import("../storage/bars.ts");

    let bars = await loadBars(args.symbol, "tushare");
    if (bars.length === 0) bars = await loadBars(args.symbol, "llmquant-data");
    if (bars.length === 0) return err("DATA_NO_CACHE", args.symbol);

    const close = bars.map((b) => b.close);
    const returns = close.slice(1).map((v, i) => v / close[i] - 1);
    const m = metrics(returns);

    return ok([
      `Risk Metrics — ${args.symbol}`,
      `─────────────────────────────────────`,
      `Annual Vol:    ${(m.annualVol * 100).toFixed(2)}%    Downside Vol: ${(m.downsideVol * 100).toFixed(2)}%`,
      `VaR 95%:       ${(m.var95 * 100).toFixed(2)}% (hist) / ${(m.var95Parametric * 100).toFixed(2)}% (normal)`,
      `VaR 99%:       ${(m.var99 * 100).toFixed(2)}%     CVaR 95%:    ${(m.cvar95 * 100).toFixed(2)}%`,
      `Max Drawdown:  ${(m.maxDrawdown * 100).toFixed(2)}%  (${m.maxDdDays} days)`,
      `Skewness:      ${m.skewness.toFixed(3)}      Kurtosis:    ${m.kurtosis.toFixed(3)}`,
    ].join("\n"), { symbol: args.symbol, ...m });
  },
};

export const scoreBenchmarkTool: AgentTool<typeof S.ScoreBenchmark> = {
  name: "score_benchmark",
  description: "Run 3-dimension strategy evaluation (Return 40 + Risk 40 + Robustness 20 = 100). Saves result to .ohquant/benchmark/results/.",
  label: "🏆 Score",
  parameters: S.ScoreBenchmark,
  executionMode: "sequential",

  async execute(_id: string, args: ScoreBenchmarkArgs): Promise<AgentToolResult<unknown>> {
    const { evaluate } = await import("../services/benchmark.ts");
    const { smaSignals, vectorizedBacktest } = await import("../services/backtest.ts");
    const { fetchBars } = await import("../data/sources.ts");
    const { saveBars } = await import("../storage/bars.ts");
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");

    // Fetch both
    const [stratR, benchR] = await Promise.all([
      fetchBars(args.symbol, "A"),
      fetchBars(args.benchmark_symbol, "A"),
    ]);
    if (stratR.bars.length === 0) return err("MCP_TOOL_FAILED", `${args.symbol}`);
    if (benchR.bars.length === 0) return err("MCP_TOOL_FAILED", `${args.benchmark_symbol}`);
    await saveBars(args.symbol, "tushare", stratR.bars);

    // Align dates
    const benchDates = new Set(benchR.bars.map((b) => b.date));
    const alignedStrat = stratR.bars.filter((b) => benchDates.has(b.date));
    const alignedBench = benchR.bars.filter((b) => benchDates.has(b.date));
    const stratClose = alignedStrat.map((b) => b.close);
    const benchClose = alignedBench.map((b) => b.close);

    // Split
    const split = Math.floor(stratClose.length * 0.7);
    const trainClose = stratClose.slice(0, split);
    const testClose = stratClose.slice(split);

    // Run
    const signals = smaSignals(stratClose, args.fast, args.slow);
    const { returns: stratReturns } = vectorizedBacktest(signals, stratClose, args.cash);
    const benchReturns = benchClose.slice(1).map((v, i) => v / benchClose[i] - 1);

    const trainSig = smaSignals(trainClose, args.fast, args.slow);
    const testSig = smaSignals(testClose, args.fast, args.slow);
    const { returns: trainR } = vectorizedBacktest(trainSig, trainClose, args.cash);
    const { returns: testR } = vectorizedBacktest(testSig, testClose, args.cash);

    const score = evaluate(
      { returns: stratReturns.slice(1) },
      { returns: benchReturns },
      { returns: trainR.slice(1) },
      { returns: testR.slice(1) },
    );

    // Save
    const dir = join(process.cwd(), ".ohquant", "benchmark", "results");
    try { mkdirSync(dir, { recursive: true }); } catch { /* ok */ }
    const now = new Date().toISOString().slice(0, 10);
    const name = args.label || `sma_${args.fast}_${args.slow}`;
    const filename = `${name}_${now}.json`;
    writeFileSync(join(dir, filename), JSON.stringify({
      strategy: name, date: now, symbol: args.symbol, benchmark_symbol: args.benchmark_symbol,
      window: { fast: args.fast, slow: args.slow },
      source: { strategy: { market: "A", fetcher: stratR.source }, benchmark: { market: "A", fetcher: benchR.source } },
      ...score,
    }, null, 2), "utf-8");

    return ok([
      `🏆 Benchmark — ${name}`,
      `─────────────────────────────────────`,
      `Grade: ${score.grade}  |  Score: ${score.totalScore}/100`,
      `Return: ${score.returnScore}/40 | Risk: ${score.riskScore}/40 | Robust: ${score.robustnessScore}/20`,
      `CAGR: ${(score.details.cagr * 100).toFixed(2)}%  |  Sharpe: ${score.details.sharpe}  |  Max DD: ${(score.details.maxDrawdown * 100).toFixed(2)}%`,
      ``,
      `Saved: .ohquant/benchmark/results/${filename}`,
    ].join("\n"), { filename, ...score });
  },
};

export const showDashboardTool: AgentTool<typeof S.ShowDashboard> = {
  name: "show_dashboard",
  description: "Show benchmark results dashboard from .ohquant/benchmark/results/",
  label: "📋 Dashboard",
  parameters: S.ShowDashboard,
  executionMode: "sequential",

  async execute(_id: string, _args: ShowDashboardArgs): Promise<AgentToolResult<unknown>> {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { collectResults, dashboardSummary } = await import("../services/dashboard.ts");

    const dir = join(process.cwd(), ".ohquant", "benchmark", "results");
    let files: string[] = [];
    try { files = readdirSync(dir).filter((f: string) => f.endsWith(".json")); } catch { files = []; }
    if (files.length === 0) return ok("No benchmark results yet. Try: 'Run SMA 20/60 backtest on 000001.SZ'");

    const results = files.map((f) => {
      try { return JSON.parse(readFileSync(join(dir, f), "utf-8")); } catch { return null; }
    }).filter(Boolean) as Record<string, unknown>[];
    const rows = collectResults(results);
    const s = dashboardSummary(rows);
    const sorted = [...rows].sort((a, b) => b.totalScore - a.totalScore).slice(0, 10);

    return ok([
      `📋 Dashboard — ${s.totalEvals} evaluations`,
      `Avg: ${s.avgScore}  Median: ${s.medianScore}  Best: ${s.bestStrategy} (${s.bestScore})`,
      `Grades: ${Object.entries(s.gradeDistribution).map(([g, n]) => `${g}:${n}`).join("  ")}`,
      ``,
      ...sorted.map((r) => `  ${r.grade.padEnd(2)} ${r.strategy.padEnd(28)} score=${String(r.totalScore).padEnd(5)} sharpe=${r.sharpe}  dd=${(r.maxDrawdown * 100).toFixed(1)}%`),
    ].join("\n"), { summary: s });
  },
};

export const QUANT_TOOLS: AgentTool[] = [
  fetchBarsTool,
  computeFactorTool,
  runBacktestTool,
  checkRiskTool,
  scoreBenchmarkTool,
  showDashboardTool,
];
