import { runQuantTool } from "../params.ts";
import type { CommandHandler } from "../types.ts";
import { runComparison, type ComparisonConfig, type ComparisonContext } from "../../services/comparison-orchestrator.ts";
import { volatilityRule, drawdownRule, sectorRule, type ClassificationRule } from "../../services/auto-classify.ts";
import { loadPanelPortfolio } from "../../storage/panel-portfolio.ts";

const FACTORS = ["momentum", "reversal", "volatility", "volume_ratio", "rsi", "sma_deviation"];

export const factorHandler: CommandHandler = async (flags, positional) => {
  const action = positional[0] || "analyze";
  if (action === "list") {
    return { success: true, message: ["Factors", "───────", ...FACTORS.map((f) => `  ${f}`)].join("\n"), data: FACTORS };
  }
  if (action === "analyze" || action === "compute") {
    const symbol = String(flags.symbol || flags.code || flags.s || flags.c || positional[1] || "");
    const factor = String(flags.factor || flags.f || positional[2] || "");
    if (!symbol || !factor) return { success: false, message: "Usage: /factor analyze --symbol CODE --factor momentum [--period 20]" };
    return runQuantTool("compute_factor", { ...flags, symbol, factor }, { period: 20 });
  }
  return { success: false, message: "Usage: /factor list | /factor analyze --symbol CODE --factor NAME" };
};

export const backtestHandler: CommandHandler = async (flags, positional) => {
  const action = positional[0] || "run";
  if (action !== "run") return { success: false, message: "Usage: /backtest run --symbol CODE [--fast 20 --slow 60]" };
  const symbol = String(flags.symbol || flags.code || flags.s || flags.c || positional[1] || "");
  if (!symbol) return { success: false, message: "Usage: /backtest run --symbol CODE [--fast 20 --slow 60]" };
  return runQuantTool("run_backtest", { ...flags, symbol }, { fast: 20, slow: 60, cash: 100_000 });
};

export const riskHandler: CommandHandler = async (flags, positional) => {
  const action = positional[0] || "check";
  if (action !== "check") return { success: false, message: "Usage: /risk check --symbol CODE" };
  const symbol = String(flags.symbol || flags.code || flags.s || flags.c || positional[1] || "");
  if (!symbol) return { success: false, message: "Usage: /risk check --symbol CODE" };
  return runQuantTool("check_risk", { ...flags, symbol });
};

export const benchmarkHandler: CommandHandler = async (flags, positional) => {
  const action = positional[0] || "dashboard";
  if (action === "run" || action === "score") {
    const symbol = String(flags.symbol || flags.code || flags.s || flags.c || positional[1] || "");
    if (!symbol) return { success: false, message: "Usage: /benchmark run --symbol CODE [--benchmark-symbol 000300.SH]" };
    return runQuantTool("score_benchmark", { ...flags, symbol }, {
      benchmark_symbol: "000300.SH",
      fast: 20,
      slow: 60,
      cash: 100_000,
    });
  }
  if (action !== "dashboard" && action !== "list") {
    return { success: false, message: "Usage: /benchmark run --symbol CODE | /benchmark dashboard" };
  }

  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { emitFileEvent } = await import("../../storage/fs-events.ts");
  const dir = join(process.cwd(), ".ohquant", "benchmark", "results");
  const { collectResults, dashboardSummary } = await import("../../quant/dashboard.ts");
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f: string) => f.endsWith(".json"));
    emitFileEvent({ operation: "READ", path: dir, detail: "benchmark index" });
  } catch { files = []; }
  if (files.length === 0) return { success: true, message: "No results. Ask AI agent: run SMA 20/60 on 000001.SZ and score it." };
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
  return { success: true, message: [`Dashboard · ${s.totalEvals} runs  Avg: ${s.avgScore}  Best: ${s.bestStrategy} (${s.bestScore})`, ...sorted.map((r) => `  ${r.grade.padEnd(2)} ${r.strategy.padEnd(28)} score=${String(r.totalScore).padEnd(5)} sharpe=${r.sharpe}  dd=${(r.maxDrawdown * 100).toFixed(1)}%`)].join("\n") };
};

export const compareHandler: CommandHandler = async (flags, positional) => {
  const action = positional[0] || "run";
  if (action !== "run") {
    return { success: false, message: "Usage: /compare run --rule volatility --threshold 0.25" };
  }

  const ruleType = String(flags.rule || flags.r || "");
  if (!ruleType) {
    return { success: false, message: "Usage: /compare run --rule volatility|drawdown|sector --threshold VALUE" };
  }

  const portfolio = loadPanelPortfolio();
  const symbolCodes = portfolio.symbols.map((s) => s.code);
  if (symbolCodes.length === 0) {
    return { success: false, message: "No symbols in panel portfolio. Use /portfolio add CODE first." };
  }

  let rules: ClassificationRule[];
  const threshold = Number(flags.threshold || flags.t || 0);

  if (ruleType === "volatility") {
    if (!threshold) return { success: false, message: "Volatility rule requires --threshold (e.g., 0.25)" };
    const sampleProfile = { code: "sample", name: "sample", riskMetrics: { annualVol: threshold * 1.1 } as any };
    rules = [volatilityRule(sampleProfile, threshold)];
  } else if (ruleType === "drawdown") {
    if (!threshold) return { success: false, message: "Drawdown rule requires --threshold (e.g., -0.20)" };
    const sampleProfile = { code: "sample", name: "sample", riskMetrics: { maxDrawdown: threshold * 1.1 } as any };
    rules = [drawdownRule(sampleProfile, threshold)];
  } else if (ruleType === "sector") {
    const sectorName = String(flags.name || flags.n || flags.sector || "");
    if (!sectorName) return { success: false, message: "Sector rule requires --name SECTOR_NAME" };
    rules = [sectorRule(sectorName)];
  } else {
    return { success: false, message: `Unknown rule type: ${ruleType}. Use volatility|drawdown|sector` };
  }

  const config: ComparisonConfig = {
    name: `${ruleType}-comparison`,
    rules,
  };

  const context: ComparisonContext = {
    fetchSymbolProfile: async (code: string) => {
      const result = await runQuantTool("check_risk", { symbol: code }, {});
      if (!result.success) return null;
      const data = result.data as any;
      return {
        code,
        name: data?.name || code,
        sector: data?.sector,
        riskMetrics: data?.riskMetrics,
      };
    },
    fetchSymbolReturns: async (code: string) => {
      const result = await runQuantTool("compute_factor", { symbol: code, factor: "momentum" }, { period: 20 });
      if (!result.success) return new Map();
      const data = result.data as any;
      const returns = new Map<string, number>();
      if (data?.dailyReturns) {
        for (const [date, ret] of Object.entries(data.dailyReturns)) {
          returns.set(date, ret as number);
        }
      }
      return returns;
    },
  };

  try {
    const artifactId = await runComparison(symbolCodes, config, context);
    return { success: true, message: `Comparison complete. Artifact ID: ${artifactId}\nGroups classified and saved to .ohquant/benchmark/comparisons/` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Comparison failed: ${msg}` };
  }
};
