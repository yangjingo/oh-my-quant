import type { AgentTool } from "../agent/src/session-runtime/index.ts";
import { SYSTEM_TOOLS } from "./bash-tool.ts";
import { AKSHARE_FUND_TOOL_REGISTRATIONS } from "./akshare-fund-tools.ts";
import { DATA_TOOLS } from "./data-tools.ts";
import { COMPUTE_TOOLS, createPriceAnalysisTools } from "./quant-tools.ts";
import { analyzeArchivedBarsTool } from "./archived-analysis-tool.ts";
import { PORTFOLIO_TOOLS, createComparePortfoliosTool } from "./portfolio-tools.ts";
import { ALPHA_TOOLS, createAlphaTools } from "./alpha-tools.ts";
import { builtinToolDisplay, type BuiltinToolDomain, type ToolDisplay } from "./display.ts";
import { AKSHARE_PUBLIC_INDEX_ENDPOINTS } from "../source/index.ts";
import { akshareRequirements, dailyRequirements, priceAnalysisRequirements, ARCHIVED_BARS_REQUIREMENTS, ARCHIVED_ANALYSIS_REQUIREMENTS, INDEX_SPOT_REQUIREMENTS, localRequirements, SEARCH_REQUIREMENTS, portfolioRequirements, COMPARISON_REQUIREMENTS, alphaRequirements } from "./requirements.ts";
import type { ToolCapabilityManifest, ToolRequirements } from "../types/tool-capabilities.ts";
import { createResearchTaskTool } from "./research-task-tool.ts";
import { createNewsResearchTool, newsResearchTool } from "./news-tools.ts";
import { NEWS_REQUIREMENTS } from "./requirements.ts";
import { ANNUAL_TOOLS } from "./annual-tools.ts";
import { createFundDcaTool } from "./fund-dca-tools.ts";
import { calculatePositionScenariosTool } from "./position-scenarios-tool.ts";
import { calculateWeightedScoreTool } from "./weighted-score-tool.ts";
import { createMainboardScanTool, mainboardScanTool } from "./mainboard-scan-tool.ts";
import { MAINBOARD_SCAN_REQUIREMENTS } from "./requirements.ts";

export { builtinToolDisplay } from "./display.ts";
export type { BuiltinToolDomain, DataProvider, ToolDisplay } from "./display.ts";

export interface BuiltinToolRegistration {
  tool: AgentTool;
  domain: BuiltinToolDomain;
  display: ToolDisplay;
  requirements: ToolRequirements;
  enabledByDefault?: boolean;
}

function defineBuiltinTools(registrations: BuiltinToolRegistration[]): BuiltinToolRegistration[] {
  const seen = new Set<string>();
  for (const registration of registrations) {
    const name = registration.tool.name;
    if (seen.has(name)) throw new Error(`Duplicate built-in tool registration: ${name}`);
    if (!registration.requirements?.routes.length) throw new Error(`Missing built-in tool requirements: ${name}`);
    seen.add(name);
  }
  return registrations;
}

function mustTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing built-in tool implementation: ${name}`);
  return tool;
}

function mustDisplay(name: string): ToolDisplay {
  const display = builtinToolDisplay(name);
  if (!display) throw new Error(`Missing built-in tool display metadata: ${name}`);
  return display;
}

const DEFAULT_BUILTIN_TOOL_REGISTRATIONS: BuiltinToolRegistration[] = [
  { tool: mustTool(DATA_TOOLS, "fetch_bars"), domain: "data", display: mustDisplay("fetch_bars"), requirements: dailyRequirements() },
  { tool: mustTool(DATA_TOOLS, "search_symbols"), domain: "data", display: mustDisplay("search_symbols"), requirements: SEARCH_REQUIREMENTS },
  { tool: mustTool(DATA_TOOLS, "fetch_snapshot"), domain: "data", display: mustDisplay("fetch_snapshot"), requirements: dailyRequirements() },
  { tool: mustTool(DATA_TOOLS, "fetch_bars_archive"), domain: "data", display: mustDisplay("fetch_bars_archive"), requirements: ARCHIVED_BARS_REQUIREMENTS },
  { tool: mustTool(DATA_TOOLS, "fetch_index_spot"), domain: "data", display: mustDisplay("fetch_index_spot"), requirements: INDEX_SPOT_REQUIREMENTS },
  { tool: mustTool(DATA_TOOLS, "fetch_index_info"), domain: "data", display: mustDisplay("fetch_index_info"), requirements: akshareRequirements("index-catalog", ["index_stock_info"], ["A"]) },
  { tool: mustTool(DATA_TOOLS, "fetch_index_constituents"), domain: "data", display: mustDisplay("fetch_index_constituents"), requirements: akshareRequirements("index-constituents", ["index_stock_cons_csindex", "index_stock_cons_sina", "index_stock_cons"], ["A"]) },
  { tool: mustTool(DATA_TOOLS, "fetch_index_rows"), domain: "data", display: mustDisplay("fetch_index_rows"), requirements: akshareRequirements("index-endpoint", AKSHARE_PUBLIC_INDEX_ENDPOINTS, ["A"]) },
  ...AKSHARE_FUND_TOOL_REGISTRATIONS.map((entry) => ({
    tool: mustTool(DATA_TOOLS, entry.name),
    domain: "data" as const,
    display: mustDisplay(entry.name),
    requirements: entry.endpoint ? akshareRequirements("fund-endpoint", [entry.endpoint]) : fundRequirements(entry.name),
  })),

  { tool: mustTool(COMPUTE_TOOLS, "compute_factor"), domain: "quant", display: mustDisplay("compute_factor"), requirements: priceAnalysisRequirements() },
  { tool: newsResearchTool as AgentTool, domain: "quant", display: mustDisplay("research_news"), requirements: NEWS_REQUIREMENTS },
  { tool: mainboardScanTool as AgentTool, domain: "quant", display: mustDisplay("scan_mainboard"), requirements: MAINBOARD_SCAN_REQUIREMENTS },
  { tool: mustTool(COMPUTE_TOOLS, "run_backtest"), domain: "quant", display: mustDisplay("run_backtest"), requirements: priceAnalysisRequirements() },
  { tool: mustTool(COMPUTE_TOOLS, "check_risk"), domain: "quant", display: mustDisplay("check_risk"), requirements: priceAnalysisRequirements() },
  { tool: calculateWeightedScoreTool as AgentTool, domain: "quant", display: mustDisplay("calculate_weighted_score"), requirements: {
    capability: "weighted-score", routes: [{ provider: "local", markets: ["A", "US", "HK", "Fund"], dependencies: [],
      permission: "Pure arithmetic from supplied score components; no data, account, file or process access." }], effects: [],
    limitations: "Requires supplied 0..100 component scores and fractional weights summing to one. No raw-signal scoring, missing-input imputation, calibration or recommendation.",
  } },
  { tool: calculatePositionScenariosTool as AgentTool, domain: "quant", display: mustDisplay("calculate_position_scenarios"), requirements: {
    capability: "position-scenarios", routes: [{ provider: "local", markets: ["A", "US", "HK", "Fund"], dependencies: [],
      permission: "Pure arithmetic from explicit hypothetical long-position inputs; no account or market service access." }], effects: [],
    limitations: "Requires supplied shares, cost, dated close, currency and scenario changes. No fees, FX, option payoff, quote freshness, account verification or order permission.",
  } },
  { tool: analyzeArchivedBarsTool as AgentTool, domain: "quant", display: mustDisplay("analyze_archived_bars"), requirements: ARCHIVED_ANALYSIS_REQUIREMENTS },
  { tool: mustTool(COMPUTE_TOOLS, "fund_dca_backtest"), domain: "quant", display: mustDisplay("fund_dca_backtest"), requirements: {
    ...akshareRequirements("fund-nav", ["fund_open_fund_info_em"]), effects: ["public-network", "research-storage"],
    limitations: "Needs an adequate unit-NAV window. fund_purchase_em fee observation is optional; missing fees require an explicit zero-fee assumption. A sample does not validate DCA cash flows.",
  } },
  { tool: mustTool(COMPUTE_TOOLS, "score_benchmark"), domain: "quant", display: mustDisplay("score_benchmark"), requirements: { ...dailyRequirements(true), effects: ["public-network", "market-cache", "research-storage"] } },
  { tool: mustTool(COMPUTE_TOOLS, "show_dashboard"), domain: "quant", display: mustDisplay("show_dashboard"), requirements: localRequirements("benchmark-results") },
  ...PORTFOLIO_TOOLS.map(tool => ({ tool, domain: "quant" as const, display: mustDisplay(tool.name),
    requirements: tool.name === "compare_portfolios" ? COMPARISON_REQUIREMENTS
      : tool.name === "portfolio_comparisons" ? { ...portfolioRequirements(), capability: "comparison-results" as const,
        limitations: "List immutable comparison IDs; loading recomputes recorded inputs. No live data or account access." }
        : portfolioRequirements(tool.name === "edit_portfolio") })),

  ...ALPHA_TOOLS.map(tool => ({ tool, domain: "quant" as const, display: mustDisplay(tool.name),
    requirements: alphaRequirements(tool.name === "alpha_backtest" ? "backtest" : tool.name === "alpha_runs" ? "history" : "status") })),
  ...ANNUAL_TOOLS.map(tool => ({ tool, domain: "quant" as const, display: mustDisplay(tool.name), requirements: {
    capability: "annual-research" as const, routes: [{ provider: "local" as const, markets: ["A", "US", "HK", "Fund"] as const, dependencies: [] as const,
      permission: "Read archived public research and save local annual reports or explicit research decisions." }],
    effects: ["local-read", "research-storage"] as const,
    limitations: tool.name === "research_decisions" ? "Explicit research statements bound to archived comparisons, not verified approval or trades. No account access; declared dates may be retrospective."
      : "Requires an exact Jan 1 to cutoff comparison and original public archives. Optional decisions must match the groups and period. Observation research only; no account performance or proof of executed strategy.",
  } })),
  { tool: mustTool(SYSTEM_TOOLS, "bash"), domain: "system", display: mustDisplay("bash"), requirements: localRequirements("shell") },
];

function fundRequirements(name: string): ToolRequirements {
  switch (name) {
    case "akshare_fund_nav": return { ...akshareRequirements("fund-nav", ["fund_open_fund_info_em", "fund_etf_fund_info_em", "fund_graded_fund_info_em", "fund_financial_fund_info_em"]), effects: ["public-network", "research-storage"] };
    case "akshare_fund_profile": return akshareRequirements("fund-profile", ["fund_overview_em", "fund_info_ths", "fund_individual_basic_info_xq"]);
    case "akshare_fund_purchase": return akshareRequirements("fund-purchase", ["fund_purchase_em", "fund_open_fund_daily_em", "fund_etf_category_ths"]);
    case "akshare_fund_fee": return akshareRequirements("fund-fee", ["fund_fee_em", "fund_individual_detail_info_xq"]);
    case "akshare_fund_performance": return akshareRequirements("fund-performance", ["fund_individual_achievement_xq", "fund_open_fund_rank_em", "fund_individual_analysis_xq"]);
    default: throw new Error(`Missing fund tool requirements: ${name}`);
  }
}

export const BUILTIN_TOOL_REGISTRY = defineBuiltinTools(
  DEFAULT_BUILTIN_TOOL_REGISTRATIONS.map((registration) => ({ enabledByDefault: true, ...registration })),
);

export const BUILTIN_TOOLS: AgentTool[] = BUILTIN_TOOL_REGISTRY
  .filter((registration) => registration.enabledByDefault !== false)
  .map((registration) => registration.tool);

/** Host overrides share the registered schemas and implementations, not parallel evaluation tools. */
export function createBuiltinTools(options: { analysisData?: Parameters<typeof createPriceAnalysisTools>[0];
  archiveAnalysisData?: Parameters<typeof createPriceAnalysisTools>[1]; fundData?: Parameters<typeof createFundDcaTool>[0];
  comparison?: Parameters<typeof createComparePortfoliosTool>[0]; alpha?: Parameters<typeof createAlphaTools>[0];
  news?: Parameters<typeof createNewsResearchTool>[0]; mainboardScan?: Parameters<typeof createMainboardScanTool>[0] } = {}): AgentTool[] {
  // Registry erases each concrete schema type; Pi validates arguments before execute.
  const overrides = new Map<string, AgentTool>(Object.values(createPriceAnalysisTools(options.analysisData, options.archiveAnalysisData)).map(tool => [tool.name, tool as AgentTool]));
  if (options.alpha) for (const tool of Object.values(createAlphaTools(options.alpha))) overrides.set(tool.name, tool as AgentTool);
  if (options.news) overrides.set("research_news", createNewsResearchTool(options.news) as AgentTool);
  if (options.mainboardScan) overrides.set("scan_mainboard", createMainboardScanTool(options.mainboardScan) as AgentTool);
  if (options.fundData) overrides.set("fund_dca_backtest", createFundDcaTool(options.fundData) as AgentTool);
  if (options.comparison) overrides.set("compare_portfolios", createComparePortfoliosTool(options.comparison) as AgentTool);
  return BUILTIN_TOOLS.map(tool => overrides.get(tool.name) ?? tool);
}

/** Stateful control tools are bound once per Quant session, never to a global current agent. */
export function bindResearchTools(tools: AgentTool[], read: Parameters<typeof createResearchTaskTool>[0]): AgentTool[] {
  if (tools.some(tool => tool.name === "research_task")) throw new Error("Duplicate tool name: research_task is reserved by Quant Harness.");
  return [...tools, createResearchTaskTool(read)];
}

export function listBuiltinToolRegistrations(domain?: BuiltinToolDomain): BuiltinToolRegistration[] {
  return BUILTIN_TOOL_REGISTRY.filter((registration) => !domain || registration.domain === domain);
}

export function findBuiltinTool(name: string): AgentTool | undefined {
  return BUILTIN_TOOL_REGISTRY.find((registration) => registration.tool.name === name)?.tool;
}

/** Serializable projection of the exact executable registry; no parallel name/schema list. */
export function listBuiltinToolCapabilities(): ToolCapabilityManifest[] {
  return BUILTIN_TOOL_REGISTRY.map(entry => ({ name: entry.tool.name, label: entry.display.label, description: entry.tool.description,
    domain: entry.domain, enabled: entry.enabledByDefault !== false,
    parameters: { ...structuredClone(entry.tool.parameters) }, requirements: structuredClone(entry.requirements) }));
}
