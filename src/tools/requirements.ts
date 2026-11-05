import type { ToolDataCapability, ToolDataRoute, ToolRequirements } from "../types/tool-capabilities.ts";

const AKSHARE: ToolDataRoute = { provider: "akshare", markets: ["A", "US", "HK", "Fund"], dependencies: ["python", "akshare"], permission: "Public endpoint access; each market endpoint may fail independently." };
const DAILY_ROUTES: ToolDataRoute[] = [
  AKSHARE,
  { provider: "tushare", markets: ["A", "Fund"], dependencies: [], credential: "WHYJ_QUANT_TUSHARE_TOKEN", permission: "Daily price or fund NAV API entitlement; other APIs have separate permissions." },
  { provider: "llmquant-data", markets: ["US", "HK"], dependencies: [], credential: "WHYJ_QUANT_LLMQUANT_API_KEY", permission: "Historical daily price API entitlement." },
  { provider: "financial-datasets", markets: ["US"], dependencies: [], credential: "WHYJ_QUANT_FINANCIAL_DATASETS_KEY", permission: "Historical prices API entitlement." },
];

export const NEWS_REQUIREMENTS: ToolRequirements = {
  capability: "news-research", routes: [
    { provider: "yahoo", markets: ["A", "US", "HK"], dependencies: [], endpoints: ["news-search", "ticker-news"], permission: "Public Yahoo Finance search and ticker news; each may be unavailable or rate limited. No API key required." },
    { ...AKSHARE, markets: ["A"], endpoints: ["stock_news_em"] },
    ...DAILY_ROUTES.map(route => ({ ...route, markets: route.markets.filter(market => market !== "Fund"), endpoints: ["daily-series"] })),
  ], effects: ["public-network", "market-cache"],
  limitations: "Needs a news route AND a market-compatible price route for the same stock/window. News search is incomplete and title sentiment uncalibrated. One endpoint sample does not verify the combined research or authorize orders.",
};

export const MAINBOARD_SCAN_REQUIREMENTS: ToolRequirements = {
  capability: "mainboard-scan", routes: [{ ...AKSHARE, markets: ["A"],
    endpoints: ["stock_info_sh_name_code", "stock_info_sz_name_code", "daily-series"] }],
  effects: ["public-network", "market-cache"],
  limitations: "Both public exchange rosters require Python/AKShare, without a token. Prices additionally need a configured A-share route (AKShare or entitled Tushare) or usable cache. A token or daily sample does not verify roster access, batch coverage, comparable price dates or ranking. Partial runs remain partial; no scheduler or restart recovery.",
};

export function dailyRequirements(computation = false): ToolRequirements {
  return { capability: "daily-bars", routes: DAILY_ROUTES, effects: ["public-network", "market-cache"],
    limitations: computation ? "A price sample only verifies an input dependency. Check sufficient observations, strategy parameters and benchmark coverage for each computation."
      : "Only the checked symbol/date window is evidenced; snapshot freshness, other symbols and corporate-action adjustments remain unverified." };
}
/** Primary current-price route plus an explicit archive-only branch on the three price analysis tools. */
export function priceAnalysisRequirements(): ToolRequirements {
  const current = dailyRequirements(true);
  return { ...current, effects: [...current.effects, "local-read"],
    limitations: `${current.limitations} Optional observed_before requires market/start/end and reads only a complete immutable app response observed by the UTC cutoff; it does not need a live provider. Use analyze_archived_bars for a provider-free Doctor route. Neither route proves historical publication or complete trading days.` };
}
export const ARCHIVED_BARS_REQUIREMENTS: ToolRequirements = {
  capability: "archived-bars",
  routes: [{ provider: "local", markets: ["A", "US", "HK"], dependencies: [],
    permission: "Read immutable app-observed daily-bar revisions at or before the requested UTC cutoff; no market provider or current cache head." }],
  effects: ["local-read"],
  limitations: "Local means provider access is unnecessary, not that a matching, intact prior response exists. Archive observation does not prove provider publication time or complete trading-calendar coverage.",
};
export const ARCHIVED_ANALYSIS_REQUIREMENTS: ToolRequirements = {
  capability: "archived-analysis",
  routes: [{ provider: "local", markets: ["A", "US", "HK"], dependencies: [],
    permission: "Read one immutable app-observed daily-bar response, then compute a factor, SMA backtest, or risk metrics locally." }],
  effects: ["local-read"],
  limitations: "Requires exact price dates, a UTC observation cutoff and a complete intact prior response with enough bars for the selected computation. Local readiness does not prove archive existence, provider publication, adjustment, or trading-day completeness.",
};
export function alphaRequirements(kind: "backtest" | "history" | "status"): ToolRequirements {
  if (kind === "backtest") return { capability: "alpha-backtest",
    routes: DAILY_ROUTES.map(route => ({ ...route, markets: route.markets.filter(market => market !== "Fund"), endpoints: ["daily-series"] })),
    engine: { name: "akquant", version: "0.3.58", configurationKey: "WHYJ_QUANT_AKQUANT_PYTHON" },
    effects: ["public-network", "market-cache", "engine-process", "research-storage"],
    limitations: "Requires pinned AKQuant in addition to a price route; call alpha_engine_status. A daily sample cannot verify the engine. Generic next-open integer-share SMA simulation; all cost/size/window assumptions explicit; no real orders." };
  return { capability: kind === "history" ? "alpha-results" : "alpha-engine-status",
    routes: [{ provider: "local", markets: ["A", "US", "HK", "Fund"], dependencies: [],
      permission: kind === "history" ? "Read alpha research and original public observations." : "Inspect the configured Python/AKQuant import and versions; no strategy execution." }],
    effects: kind === "history" ? ["local-read"] : ["local-read", "engine-process"],
    limitations: kind === "history" ? "No Python required. Loading verifies original input and receipt consistency, not a fresh matching-engine run."
      : "No automatic install; set WHYJ_QUANT_AKQUANT_PYTHON. Ready means import/version only, not market data or strategy validation." };
}
export function akshareRequirements(capability: ToolDataCapability, endpoints: readonly string[], markets: ToolDataRoute["markets"] = ["Fund"]): ToolRequirements {
  return { capability, routes: [{ ...AKSHARE, markets, endpoints }], effects: ["public-network"],
    limitations: "Requires an actual response from the selected endpoint and parameters. Importing akshare or checking another endpoint does not verify access." };
}
export const SEARCH_REQUIREMENTS: ToolRequirements = {
  capability: "symbol-search", routes: [{ ...DAILY_ROUTES[1]!, markets: ["A"], endpoints: ["stock_basic"], permission: "Tushare stock_basic permission; a successful daily request is insufficient." }],
  effects: ["public-network"], limitations: "A-share catalogue search only; US/HK symbol search is not implemented.",
};
export const INDEX_SPOT_REQUIREMENTS: ToolRequirements = {
  ...akshareRequirements("index-spot", ["stock_zh_index_spot_em"], ["A"]),
  routes: [{ provider: "sina", markets: ["A"], dependencies: [], permission: "Public Sina index quotes endpoint; freshness must be checked from its response." },
    { ...AKSHARE, markets: ["A"], endpoints: ["stock_zh_index_spot_em"] }],
  limitations: "Tries Sina HTTP before AKShare. Missing Python blocks only the AKShare route; no daily-bar probe establishes spot access or freshness.",
};
export function localRequirements(capability: "benchmark-results" | "shell"): ToolRequirements {
  return { capability, routes: [{ provider: "local", markets: ["A", "US", "HK", "Fund"], dependencies: [], permission: capability === "shell" ? "Local shell execution; external commands need their own dependencies and authorization." : "Read saved benchmark results; no results means an empty dashboard." }],
    effects: capability === "shell" ? ["shell-execution"] : ["local-read"],
    limitations: capability === "shell" ? "Doctor does not execute a shell command or authorize account/order operations." : "Local computation only. Result existence, parameters and provenance must be checked when loading." };
}

export function portfolioRequirements(edit = false): ToolRequirements {
  return { capability: "observation-portfolios", routes: [{ provider: "local", markets: ["A", "US", "HK", "Fund"], dependencies: [],
    permission: "Observation groups only; no account positions. Edits require the exact reviewed revision." }],
    effects: edit ? ["local-read", "portfolio-preferences"] : ["local-read"], limitations: "Local observation preferences. Does not establish market data or account access." };
}
export const COMPARISON_REQUIREMENTS: ToolRequirements = {
  capability: "portfolio-comparison", routes: [
    ...DAILY_ROUTES.map(route => ({ ...route, markets: route.markets.filter(market => market !== "Fund"), endpoints: ["daily-series"] })),
    { ...AKSHARE, markets: ["Fund"], endpoints: ["fund_open_fund_info_em"] },
    { provider: "frankfurter", markets: ["A", "HK", "US", "Fund"], dependencies: [], endpoints: ["ecb-fx"], permission: "ECB daily reference rates via Frankfurter v2; both currencies and the selected dates must be covered." },
  ], effects: ["local-read", "public-network", "market-cache", "research-storage"],
  limitations: "Needs two nonempty groups, an explicit quote currency per member/benchmark, common dates and all required FX. Price routes are alternatives; FX is an additional dependency for foreign quotes. One endpoint sample never proves the full comparison. No account orders or preference writes.",
};
