import type { CommandHandler } from "../types.ts";
import { runComparison, type ComparisonConfig, type ComparisonContext } from "../../quant/comparison.ts";
import { volatilityRule, drawdownRule, sectorRule, type ClassificationRule } from "../../quant/auto-classify.ts";
import { loadPanelPortfolio, loadBars as loadBarsFromStorage } from "../../storage/index.ts";
import { metrics } from "../../quant/risk.ts";

const compareUsage = "Use /compare run --rule volatility|drawdown|sector";

export const compareHandler: CommandHandler = async (flags, positional) => {
  const action = positional[0] || "run";
  if (action !== "run") {
    return { success: false, message: compareUsage };
  }

  const ruleType = String(flags.rule || flags.r || "");
  if (!ruleType) {
    return { success: false, message: compareUsage };
  }

  const portfolio = loadPanelPortfolio();
  const symbolCodes = portfolio.symbols.map((s) => s.code);
  if (symbolCodes.length === 0) {
    return { success: false, message: "The panel portfolio is empty. Ask the agent to update local portfolio files, then reopen /portfolio." };
  }

  let rules: ClassificationRule[];
  const threshold = Number(flags.threshold || flags.t || 0);

  if (ruleType === "volatility") {
    if (!threshold) return { success: false, message: "The volatility rule needs --threshold, for example: /compare run --rule volatility --threshold 0.25" };
    const sampleProfile = { code: "sample", name: "sample", riskMetrics: { annualVol: threshold * 1.1 } as any };
    rules = [volatilityRule(sampleProfile, threshold)];
  } else if (ruleType === "drawdown") {
    if (!threshold) return { success: false, message: "The drawdown rule needs --threshold, for example: /compare run --rule drawdown --threshold -0.20" };
    const sampleProfile = { code: "sample", name: "sample", riskMetrics: { maxDrawdown: threshold * 1.1 } as any };
    rules = [drawdownRule(sampleProfile, threshold)];
  } else if (ruleType === "sector") {
    const sectorName = String(flags.name || flags.n || flags.sector || "");
    if (!sectorName) return { success: false, message: "The sector rule needs --name, for example: /compare run --rule sector --name Semiconductor" };
    rules = [sectorRule(sectorName)];
  } else {
    return { success: false, message: `Unknown rule type "${ruleType}". Supported rules: volatility, drawdown, sector.` };
  }

  const config: ComparisonConfig = {
    name: `${ruleType}-comparison`,
    rules,
  };

  const context: ComparisonContext = {
    fetchSymbolProfile: async (code: string) => {
      let bars = await loadBarsFromStorage(code, "akshare");
      if (bars.length === 0) bars = await loadBarsFromStorage(code, "tushare");
      if (bars.length === 0) bars = await loadBarsFromStorage(code, "llmquant-data");
      if (bars.length === 0) bars = await loadBarsFromStorage(code, "financial-datasets");
      if (bars.length < 2) return null;
      const close = bars.map((b) => b.close);
      const returns = close.slice(1).map((v, i) => v / close[i] - 1);
      try {
        const m = metrics(returns);
        return { code, name: code, riskMetrics: m };
      } catch {
        return null;
      }
    },
    fetchSymbolReturns: async (code: string) => {
      let bars = await loadBarsFromStorage(code, "akshare");
      if (bars.length === 0) bars = await loadBarsFromStorage(code, "tushare");
      if (bars.length === 0) bars = await loadBarsFromStorage(code, "llmquant-data");
      if (bars.length === 0) bars = await loadBarsFromStorage(code, "financial-datasets");
      if (bars.length < 2) return new Map();
      const returns = new Map<string, number>();
      const close = bars.map((b) => b.close);
      for (let i = 1; i < close.length; i++) {
        if (close[i - 1] > 0) {
          returns.set(bars[i].date, close[i] / close[i - 1] - 1);
        }
      }
      return returns;
    },
  };

  try {
    const artifactId = await runComparison(symbolCodes, config, context);
    return { success: true, message: `Comparison saved\n  id    ${artifactId}\n  path  .ohquant/benchmark/comparisons/` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Comparison failed.\nCause: ${msg}\nNext: Check whether the selected symbols already have enough local price history, then retry.` };
  }
};
