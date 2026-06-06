/**
 * Quant computation tool definitions — pi AgentTool format.
 * These depend on MCP data tools (tushare_daily, llmquant_price, etc.)
 * having cached the price data first.
 */
import { Type } from "typebox";
import type { Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { ERRORS, formatError, type ErrorCode } from "../types/errors.ts";

const S = {
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

type ComputeFactorArgs = Static<typeof S.ComputeFactor>;
type RunBacktestArgs = Static<typeof S.RunBacktest>;
type CheckRiskArgs = Static<typeof S.CheckRisk>;
type ScoreBenchmarkArgs = Static<typeof S.ScoreBenchmark>;
type ShowDashboardArgs = Static<typeof S.ShowDashboard>;

function ok(text: string, details?: unknown): AgentToolResult<unknown> {
  return { content: [{ type: "text" as const, text }], details: details ?? {} };
}

function err(code: ErrorCode, detail?: string): AgentToolResult<unknown> {
  return { content: [{ type: "text" as const, text: formatError(ERRORS[code], detail) }], details: {} };
}

/** Load bars from any available cache source. Returns null if nothing cached. */
async function loadCachedBars(symbol: string) {
  const { loadBars } = await import("../storage/bars.ts");
  for (const src of ["tushare", "akshare", "llmquant-data", "financial-datasets"]) {
    const bars = await loadBars(symbol, src);
    if (bars.length > 0) return { bars, source: src };
  }
  return null;
}

// ── compute_factor ──

export const computeFactorTool: AgentTool<typeof S.ComputeFactor> = {
  name: "compute_factor",
  description: "Compute technical factor (momentum, reversal, volatility, volume_ratio, rsi, sma_deviation). Requires price data cached first — use tushare_daily or llmquant_price first.",
  label: "Factor",
  parameters: S.ComputeFactor,
  executionMode: "sequential",
  async execute(_id: string, args: ComputeFactorArgs): Promise<AgentToolResult<unknown>> {
    const cached = await loadCachedBars(args.symbol);
    if (!cached) return err("DATA_NO_CACHE", `${args.symbol}. Call tushare_daily or llmquant_price first.`);

    const { computeFactor: compute } = await import("../services/factor.ts");
    const close = cached.bars.map((b) => b.close);
    const volume = cached.bars.map((b) => b.volume);
    const values = compute(args.factor, close, volume, args.period);
    const allValid = values.filter((v): v is number => v !== null);
    const last = allValid.pop();
    const mean = allValid.length > 0 ? allValid.reduce((a: number, b: number) => a + b, 0) / allValid.length : 0;
    const sorted = [...allValid].sort((a, b) => a - b);
    const pctRank = last !== undefined && sorted.length > 0
      ? sorted.filter((v) => v <= last).length / sorted.length : 0;

    return ok([
      `Factor: ${args.factor}_${args.period} — ${args.symbol} (via ${cached.source})`,
      `Latest: ${last?.toFixed(4) ?? "N/A"}  |  Mean: ${mean.toFixed(4)}`,
      `Percentile: ${(pctRank * 100).toFixed(0)}%`,
    ].join("\n"),
    { symbol: args.symbol, factor: args.factor, period: args.period, last, mean, percentile: pctRank });
  },
};

// ── run_backtest ──

export const runBacktestTool: AgentTool<typeof S.RunBacktest> = {
  name: "run_backtest",
  description: "Run SMA crossover backtest. Requires price data cached via tushare_daily or llmquant_price first.",
  label: "Backtest",
  parameters: S.RunBacktest,
  executionMode: "sequential",
  async execute(_id: string, args: RunBacktestArgs): Promise<AgentToolResult<unknown>> {
    const cached = await loadCachedBars(args.symbol);
    if (!cached) return err("DATA_NO_CACHE", `${args.symbol}. Call tushare_daily or llmquant_price first.`);
    if (cached.bars.length < args.slow + 10)
      return err("DATA_NOT_ENOUGH", `Need ${args.slow + 10}+ bars for SMA(${args.fast},${args.slow}), got ${cached.bars.length}.`);

    const { smaSignals, vectorizedBacktest, report } = await import("../services/backtest.ts");
    const close = cached.bars.map((b) => b.close);
    const signals = smaSignals(close, args.fast, args.slow);
    const { returns } = vectorizedBacktest(signals, close, args.cash);
    const r = report(returns);

    return ok([
      `SMA(${args.fast},${args.slow}) Backtest — ${args.symbol} (via ${cached.source})`,
      `──────────────────────────────────────`,
      `Total Return:  ${(r.totalReturn * 100).toFixed(2)}%    CAGR: ${(r.cagr * 100).toFixed(2)}%`,
      `Sharpe:        ${r.sharpe.toFixed(2)}         Max DD: ${(r.maxDrawdown * 100).toFixed(2)}%`,
      `Win Rate:      ${(r.winRate * 100).toFixed(1)}%        P/L Ratio: ${r.pnlRatio.toFixed(2)}`,
    ].join("\n"), { symbol: args.symbol, ...r });
  },
};

// ── check_risk ──

export const checkRiskTool: AgentTool<typeof S.CheckRisk> = {
  name: "check_risk",
  description: "Compute risk metrics: annual vol, VaR(95/99), CVaR(95/99), max drawdown. Requires cached price data.",
  label: "Risk",
  parameters: S.CheckRisk,
  executionMode: "sequential",
  async execute(_id: string, args: CheckRiskArgs): Promise<AgentToolResult<unknown>> {
    const cached = await loadCachedBars(args.symbol);
    if (!cached) return err("DATA_NO_CACHE", `${args.symbol}. Call tushare_daily or llmquant_price first.`);

    const { metrics } = await import("../services/risk.ts");
    const close = cached.bars.map((b) => b.close);
    const returns = close.slice(1).map((v, i) => v / close[i] - 1);
    const m = metrics(returns);

    return ok([
      `Risk Metrics — ${args.symbol} (via ${cached.source})`,
      `─────────────────────────────────────`,
      `Annual Vol:    ${(m.annualVol * 100).toFixed(2)}%    Downside Vol: ${(m.downsideVol * 100).toFixed(2)}%`,
      `VaR 95%:       ${(m.var95 * 100).toFixed(2)}% (hist) / ${(m.var95Parametric * 100).toFixed(2)}% (normal)`,
      `VaR 99%:       ${(m.var99 * 100).toFixed(2)}%     CVaR 95%:    ${(m.cvar95 * 100).toFixed(2)}%`,
      `Max Drawdown:  ${(m.maxDrawdown * 100).toFixed(2)}%  (${m.maxDdDays} days)`,
      `Skewness:      ${m.skewness.toFixed(3)}      Kurtosis:    ${m.kurtosis.toFixed(3)}`,
    ].join("\n"), { symbol: args.symbol, ...m });
  },
};

// ── score_benchmark ──

export const scoreBenchmarkTool: AgentTool<typeof S.ScoreBenchmark> = {
  name: "score_benchmark",
  description: "Run 3-dimension strategy evaluation (Return 40 + Risk 40 + Robustness 20 = 100). Fetches both strategy and benchmark data via MCP, runs backtest, scores, saves to .ohquant/.",
  label: "Score",
  parameters: S.ScoreBenchmark,
  executionMode: "sequential",
  async execute(_id: string, args: ScoreBenchmarkArgs): Promise<AgentToolResult<unknown>> {
    const { evaluate } = await import("../services/benchmark.ts");
    const { smaSignals, vectorizedBacktest } = await import("../services/backtest.ts");
    const { callTool } = await import("../data/mcp-client.ts");
    const { saveBars } = await import("../storage/bars.ts");
    const { emitFileEvent } = await import("../storage/fs-events.ts");
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");

    // Fetch both via MCP directly
    const fetchPrices = async (symbol: string) => {
      // Try tushare first for A-shares
      const result = await callTool("tushare", "daily", { ts_code: symbol });
      if (Array.isArray(result) && result.length > 0) {
        const bars = (result as Array<Record<string, string>>).map((r) => ({
          date: r.trade_date.length === 8 ? `${r.trade_date.slice(0, 4)}-${r.trade_date.slice(4, 6)}-${r.trade_date.slice(6, 8)}` : r.trade_date,
          open: Number(r.open), high: Number(r.high), low: Number(r.low),
          close: Number(r.close), volume: Number(r.vol), amount: Number(r.amount || 0),
        }));
        await saveBars(symbol, "tushare", bars);
        return bars;
      }
      return [] as Array<{ date: string; open: number; high: number; low: number; close: number; volume: number; amount: number }>;
    };

    const [stratBars, benchBars] = await Promise.all([
      fetchPrices(args.symbol),
      fetchPrices(args.benchmark_symbol),
    ]);
    if (stratBars.length === 0) return err("MCP_TOOL_FAILED", `No data for ${args.symbol}`);
    if (benchBars.length === 0) return err("MCP_TOOL_FAILED", `No data for ${args.benchmark_symbol}`);

    // Align dates
    const benchDates = new Set(benchBars.map((b) => b.date));
    const alignedStrat = stratBars.filter((b) => benchDates.has(b.date));
    const alignedBench = benchBars.filter((b) => benchDates.has(b.date));
    const stratClose = alignedStrat.map((b) => b.close);
    const benchClose = alignedBench.map((b) => b.close);

    const split = Math.floor(stratClose.length * 0.7);
    const signals = smaSignals(stratClose, args.fast, args.slow);
    const { returns: stratReturns } = vectorizedBacktest(signals, stratClose, args.cash);
    const benchReturns = benchClose.slice(1).map((v, i) => v / benchClose[i] - 1);

    const trainSig = smaSignals(stratClose.slice(0, split), args.fast, args.slow);
    const testSig = smaSignals(stratClose.slice(split), args.fast, args.slow);
    const { returns: trainR } = vectorizedBacktest(trainSig, stratClose.slice(0, split), args.cash);
    const { returns: testR } = vectorizedBacktest(testSig, stratClose.slice(split), args.cash);

    const score = evaluate(
      { returns: stratReturns.slice(1) },
      { returns: benchReturns },
      { returns: trainR.slice(1) },
      { returns: testR.slice(1) },
    );

    const dir = join(process.cwd(), ".ohquant", "benchmark", "results");
    try {
      mkdirSync(dir, { recursive: true });
      emitFileEvent({ operation: "MKDIR", path: dir, detail: "benchmark results" });
    } catch { /* ok */ }
    const now = new Date().toISOString().slice(0, 10);
    const name = args.label || `sma_${args.fast}_${args.slow}`;
    const filename = `${name}_${now}.json`;
    const outPath = join(dir, filename);
    const outText = JSON.stringify({
      strategy: name, date: now, symbol: args.symbol, benchmark_symbol: args.benchmark_symbol,
      window: { fast: args.fast, slow: args.slow },
      source: { strategy: { market: "A", fetcher: "tushare" }, benchmark: { market: "A", fetcher: "tushare" } },
      ...score,
    }, null, 2);
    writeFileSync(outPath, outText, "utf-8");
    emitFileEvent({ operation: "WRITE", path: outPath, bytes: outText.length, detail: "benchmark result" });

    return ok([
      `Benchmark — ${name}`,
      `─────────────────────────────────────`,
      `Grade: ${score.grade}  |  Score: ${score.totalScore}/100`,
      `Return: ${score.returnScore}/40 | Risk: ${score.riskScore}/40 | Robust: ${score.robustnessScore}/20`,
      `CAGR: ${(score.details.cagr * 100).toFixed(2)}%  |  Sharpe: ${score.details.sharpe}  |  Max DD: ${(score.details.maxDrawdown * 100).toFixed(2)}%`,
      `Saved: .ohquant/benchmark/results/${filename}`,
    ].join("\n"), { filename, ...score });
  },
};

// ── show_dashboard ──

export const showDashboardTool: AgentTool<typeof S.ShowDashboard> = {
  name: "show_dashboard",
  description: "Show benchmark results dashboard from .ohquant/benchmark/results/",
  label: "Dashboard",
  parameters: S.ShowDashboard,
  executionMode: "sequential",
  async execute(_id: string, _args: ShowDashboardArgs): Promise<AgentToolResult<unknown>> {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { collectResults, dashboardSummary } = await import("../services/dashboard.ts");
    const { emitFileEvent } = await import("../storage/fs-events.ts");

    const dir = join(process.cwd(), ".ohquant", "benchmark", "results");
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f: string) => f.endsWith(".json"));
      emitFileEvent({ operation: "READ", path: dir, detail: "benchmark index" });
    } catch { files = []; }
    if (files.length === 0) return ok("No benchmark results yet. Try: 'Run SMA 20/60 backtest on 000001.SZ'");

    const results = files.map((f) => {
      const path = join(dir, f);
      try {
        const text = readFileSync(path, "utf-8");
        emitFileEvent({ operation: "READ", path, bytes: text.length, detail: "benchmark result" });
        return JSON.parse(text);
      } catch { return null; }
    }).filter(Boolean) as Record<string, unknown>[];
    const rows = collectResults(results);
    const s = dashboardSummary(rows);
    const sorted = [...rows].sort((a, b) => b.totalScore - a.totalScore).slice(0, 10);

    return ok([
      `Dashboard — ${s.totalEvals} evaluations`,
      `Avg: ${s.avgScore}  Median: ${s.medianScore}  Best: ${s.bestStrategy} (${s.bestScore})`,
      `Grades: ${Object.entries(s.gradeDistribution).map(([g, n]) => `${g}:${n}`).join("  ")}`,
      "",
      ...sorted.map((r) => `  ${r.grade.padEnd(2)} ${r.strategy.padEnd(28)} score=${String(r.totalScore).padEnd(5)} sharpe=${r.sharpe}  dd=${(r.maxDrawdown * 100).toFixed(1)}%`),
    ].join("\n"), { summary: s });
  },
};

/** Computation tools (require cached data from MCP tools). */
export const COMPUTE_TOOLS: AgentTool[] = [
  computeFactorTool,
  runBacktestTool,
  checkRiskTool,
  scoreBenchmarkTool,
  showDashboardTool,
];
