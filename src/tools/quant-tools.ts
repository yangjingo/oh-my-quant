/**
 * Quant computation tool definitions — pi AgentTool format.
 * These depend on local data tools having cached the price data first.
 */
import { Type } from "typebox";
import type { Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { ERRORS, formatError, type ErrorCode } from "../types/errors.ts";
import { fetchAkshareFundNav, fetchAkshareFundPurchase } from "../source/index.ts";
import { runDcaBacktest, type DcaFrequency } from "../quant/fund-dca.ts";

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
  FundDcaBacktest: Type.Object({
    symbol: Type.String({ description: "Fund code, e.g. 270042" }),
    start_date: Type.Optional(Type.String({ description: "DCA start date YYYY-MM-DD; default latest NAV date minus 5 years" })),
    end_date: Type.Optional(Type.String({ description: "DCA end date YYYY-MM-DD; default latest NAV date" })),
    frequency: Type.Optional(Type.Union([
      Type.Literal("weekly"),
      Type.Literal("biweekly"),
      Type.Literal("monthly"),
      Type.Literal("quarterly"),
    ], { description: "DCA frequency; default monthly" })),
    invest_amount: Type.Optional(Type.Number({ description: "Fixed investment amount per period; default 1000" })),
    invest_day: Type.Optional(Type.Number({ description: "Monthly day-of-month or weekday where Monday=1; default 1" })),
    purchase_fee_rate: Type.Optional(Type.Number({ description: "Purchase fee rate. 0.0013 means 0.13%; 0.13 is also treated as 0.13%" })),
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
type FundDcaBacktestArgs = Static<typeof S.FundDcaBacktest>;
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
  const { loadBars } = await import("../storage/index.ts");
  for (const src of ["akshare", "tushare", "llmquant-data", "financial-datasets"]) {
    const bars = await loadBars(symbol, src);
    if (bars.length > 0) return { bars, source: src };
  }
  return null;
}

// ── compute_factor ──

export const computeFactorTool: AgentTool<typeof S.ComputeFactor> = {
  name: "compute_factor",
  description: "Compute technical factor (momentum, reversal, volatility, volume_ratio, rsi, sma_deviation). Requires cached price data.",
  label: "Factor",
  parameters: S.ComputeFactor,
  executionMode: "sequential",
  async execute(_id: string, args: ComputeFactorArgs): Promise<AgentToolResult<unknown>> {
    const cached = await loadCachedBars(args.symbol);
    if (!cached) return err("DATA_NO_CACHE", `${args.symbol}. Call fetch_bars first.`);

    const { computeFactor: compute } = await import("../quant/factor.ts");
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
      `Factor  ${args.symbol}  ${args.factor}_${args.period}`,
      `Source      ${cached.source}`,
      `Latest      ${last?.toFixed(4) ?? "N/A"}`,
      `Mean        ${mean.toFixed(4)}`,
      `Percentile  ${(pctRank * 100).toFixed(0)}%`,
    ].join("\n"),
    { symbol: args.symbol, factor: args.factor, period: args.period, last, mean, percentile: pctRank });
  },
};

// ── run_backtest ──

export const runBacktestTool: AgentTool<typeof S.RunBacktest> = {
  name: "run_backtest",
  description: "Run SMA crossover backtest. Requires cached price data.",
  label: "Backtest",
  parameters: S.RunBacktest,
  executionMode: "sequential",
  async execute(_id: string, args: RunBacktestArgs): Promise<AgentToolResult<unknown>> {
    const cached = await loadCachedBars(args.symbol);
    if (!cached) return err("DATA_NO_CACHE", `${args.symbol}. Call fetch_bars first.`);
    if (cached.bars.length < args.slow + 10)
      return err("DATA_NOT_ENOUGH", `Need ${args.slow + 10}+ bars for SMA(${args.fast},${args.slow}), got ${cached.bars.length}.`);

    const { smaSignals, vectorizedBacktest, report } = await import("../quant/backtest.ts");
    const close = cached.bars.map((b) => b.close);
    const signals = smaSignals(close, args.fast, args.slow);
    const { returns } = vectorizedBacktest(signals, close, args.cash);
    const r = report(returns);

    return ok([
      `Backtest  ${args.symbol}  SMA(${args.fast},${args.slow})`,
      `Source        ${cached.source}`,
      `Total return  ${(r.totalReturn * 100).toFixed(2)}%`,
      `CAGR          ${(r.cagr * 100).toFixed(2)}%`,
      `Sharpe        ${r.sharpe.toFixed(2)}`,
      `Max DD        ${(r.maxDrawdown * 100).toFixed(2)}%`,
      `Win rate      ${(r.winRate * 100).toFixed(1)}%`,
      `P/L ratio     ${r.pnlRatio.toFixed(2)}`,
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
    if (!cached) return err("DATA_NO_CACHE", `${args.symbol}. Call fetch_bars first.`);

    const { metrics } = await import("../quant/risk.ts");
    const close = cached.bars.map((b) => b.close);
    const returns = close.slice(1).map((v, i) => v / close[i] - 1);
    const m = metrics(returns);

    return ok([
      `Risk  ${args.symbol}`,
      `Source        ${cached.source}`,
      `Annual vol    ${(m.annualVol * 100).toFixed(2)}%`,
      `Downside vol  ${(m.downsideVol * 100).toFixed(2)}%`,
      `VaR 95        ${(m.var95 * 100).toFixed(2)}% hist  /  ${(m.var95Parametric * 100).toFixed(2)}% norm`,
      `VaR 99        ${(m.var99 * 100).toFixed(2)}%`,
      `CVaR 95       ${(m.cvar95 * 100).toFixed(2)}%`,
      `Max DD        ${(m.maxDrawdown * 100).toFixed(2)}%  (${m.maxDdDays} days)`,
      `Skew/Kurt     ${m.skewness.toFixed(3)} / ${m.kurtosis.toFixed(3)}`,
    ].join("\n"), { symbol: args.symbol, ...m });
  },
};

// ── fund_dca_backtest ──

export const fundDcaBacktestTool: AgentTool<typeof S.FundDcaBacktest> = {
  name: "fund_dca_backtest",
  description: "Run fixed-investment DCA backtest on live AKShare fund NAV. No cache.",
  label: "Fund DCA",
  parameters: S.FundDcaBacktest,
  executionMode: "sequential",
  async execute(_id: string, args: FundDcaBacktestArgs): Promise<AgentToolResult<unknown>> {
    const [navData, purchaseData] = await Promise.all([
      fetchAkshareFundNav(args.symbol),
      args.purchase_fee_rate == null ? fetchAkshareFundPurchase(args.symbol) : Promise.resolve(null),
    ]);
    if (navData.nav.length === 0) {
      return ok(
        [`Fund DCA   ${args.symbol}`, "Tool       Tool.quant.fund.dca", "NAV Rows   0"].join("\n"),
        { tool: "Tool.quant.fund.dca", symbol: args.symbol, attempts: navData.attempts },
      );
    }

    const feeRate = args.purchase_fee_rate ?? inferPurchaseFeeRate(purchaseData?.purchase ?? {});
    const dca = runDcaBacktest(navData.nav, {
      startDate: args.start_date,
      endDate: args.end_date,
      frequency: args.frequency as DcaFrequency | undefined,
      investAmount: args.invest_amount,
      investDay: args.invest_day,
      purchaseFeeRate: feeRate,
    });
    const s = dca.summary;
    const latest = navData.nav[navData.nav.length - 1]!;

    return ok(
      [
        `Fund DCA   ${args.symbol}`,
        "Tool       Tool.quant.fund.dca",
        "Source     Tool.akshare.fund.nav",
        `Latest     ${latest.navDate}  NAV=${latest.unitNav.toFixed(4)}`,
        `DCA        ${dca.plan.startDate} -> ${dca.plan.endDate}  ${dca.plan.frequency}  ${money(dca.plan.investAmount)} x ${s.tradeCount}`,
        `Invested   ${money(s.totalPrincipal)}  Value ${money(s.finalMarketValue)}  Profit ${money(s.profit)}`,
        `Return     ${pctDecimal(s.returnRate)}  XIRR ${pctDecimal(s.xirr)}  MaxDD ${pctDecimal(s.maxDrawdown)}`,
        `Cost       Avg ${num(s.averageCost, 4)}  Breakeven ${num(s.breakevenNav, 4)}  Fee ${money(s.totalPurchaseFee)}`,
      ].join("\n"),
      {
        tool: "Tool.quant.fund.dca",
        sourceTool: "Tool.akshare.fund.nav",
        provider: "akshare",
        symbol: args.symbol,
        latestNav: latest,
        navCurve: navData.nav,
        purchase: purchaseData?.purchase ?? {},
        dcaPlan: dca.plan,
        dcaSummary: dca.summary,
        dcaTrades: dca.trades,
        dcaAccountCurve: dca.accountCurve,
        attempts: [...navData.attempts, ...(purchaseData?.attempts ?? [])],
      },
    );
  },
};

// ── score_benchmark ──

export const scoreBenchmarkTool: AgentTool<typeof S.ScoreBenchmark> = {
  name: "score_benchmark",
  description: "Run 3-dimension strategy evaluation (Return 40 + Risk 40 + Robustness 20 = 100). Fetches local bars, runs backtest, scores, saves to .ohquant/.",
  label: "Score",
  parameters: S.ScoreBenchmark,
  executionMode: "sequential",
  async execute(_id: string, args: ScoreBenchmarkArgs): Promise<AgentToolResult<unknown>> {
    const { evaluate } = await import("../quant/benchmark.ts");
    const { smaSignals, vectorizedBacktest } = await import("../quant/backtest.ts");
    const { fetchBars } = await import("../source/index.ts");
    const { emitFileEvent } = await import("../storage/index.ts");
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");

    const fetchPrices = async (symbol: string) => {
      const cached = await loadCachedBars(symbol);
      if (cached) return cached.bars;
      const market = inferMarket(symbol);
      const result = await fetchBars(symbol, market, undefined, undefined, market === "A" ? "akshare" : undefined);
      return result.bars;
    };

    const [stratBars, benchBars] = await Promise.all([
      fetchPrices(args.symbol),
      fetchPrices(args.benchmark_symbol),
    ]);
    if (stratBars.length === 0) return err("DATA_REQUEST_FAILED", `No local data for ${args.symbol}`);
    if (benchBars.length === 0) return err("DATA_REQUEST_FAILED", `No local data for ${args.benchmark_symbol}`);

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

    const root = process.env.OHQUANT_DIR || join(process.cwd(), ".ohquant");
    const dir = join(root, "benchmark", "results");
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
      source: {
        strategy: { market: inferMarket(args.symbol), fetcher: "local" },
        benchmark: { market: inferMarket(args.benchmark_symbol), fetcher: "local" },
      },
      ...score,
    }, null, 2);
    writeFileSync(outPath, outText, "utf-8");
    emitFileEvent({ operation: "WRITE", path: outPath, bytes: outText.length, detail: "benchmark result" });

    return ok([
      `Benchmark  ${name}`,
      `Grade         ${score.grade}`,
      `Score         ${score.totalScore}/100`,
      `Return/Risk   ${score.returnScore}/40  ·  ${score.riskScore}/40`,
      `Robustness    ${score.robustnessScore}/20`,
      `CAGR          ${(score.details.cagr * 100).toFixed(2)}%`,
      `Sharpe        ${score.details.sharpe}`,
      `Max DD        ${(score.details.maxDrawdown * 100).toFixed(2)}%`,
      `Saved         .ohquant/benchmark/results/${filename}`,
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
    const { collectResults, dashboardSummary } = await import("../quant/dashboard.ts");
    const { emitFileEvent } = await import("../storage/index.ts");

    const root = process.env.OHQUANT_DIR || join(process.cwd(), ".ohquant");
    const dir = join(root, "benchmark", "results");
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
      `Dashboard  ${s.totalEvals} evaluations`,
      `Avg ${s.avgScore}  Median ${s.medianScore}  Best ${s.bestStrategy} (${s.bestScore})`,
      `Grades  ${Object.entries(s.gradeDistribution).map(([g, n]) => `${g}:${n}`).join("  ")}`,
      "",
      ...sorted.map((r) => `  ${r.grade.padEnd(2)} ${r.strategy.padEnd(28)} score=${String(r.totalScore).padEnd(5)} sharpe=${r.sharpe} dd=${(r.maxDrawdown * 100).toFixed(1)}%`),
    ].join("\n"), { summary: s });
  },
};

function inferMarket(symbol: string): "A" | "US" | "HK" {
  if (/\.HK$/i.test(symbol)) return "HK";
  if (/^[A-Z][A-Z0-9.-]*$/i.test(symbol) && !/^\d{6}/.test(symbol)) return "US";
  return "A";
}

/** Computation tools (require cached data from local tools). */
export const COMPUTE_TOOLS: AgentTool[] = [
  computeFactorTool,
  runBacktestTool,
  checkRiskTool,
  fundDcaBacktestTool,
  scoreBenchmarkTool,
  showDashboardTool,
];

function inferPurchaseFeeRate(row: Record<string, unknown>): number {
  const raw = row["手续费"];
  const n = typeof raw === "number"
    ? raw
    : typeof raw === "string"
      ? Number(raw.replace("%", "").trim())
      : Number.NaN;
  return Number.isFinite(n) ? n / 100 : 0;
}

function money(value: number): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function pct(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "--" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function pctDecimal(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "--" : pct(value * 100);
}

function num(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? "--" : value.toFixed(digits);
}
