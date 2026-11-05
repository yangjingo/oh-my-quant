import type { DataMarket, DataReadiness, PythonReadiness } from "./data-readiness.ts";

export type ToolDataCapability = "daily-bars" | "archived-bars" | "archived-analysis" | "symbol-search" | "index-spot" | "index-catalog" | "index-constituents"
  | "index-endpoint" | "fund-nav" | "fund-profile" | "fund-purchase" | "fund-fee" | "fund-performance" | "fund-endpoint"
  | "benchmark-results" | "shell" | "observation-portfolios" | "portfolio-comparison" | "comparison-results"
  | "alpha-backtest" | "alpha-results" | "alpha-engine-status" | "news-research" | "annual-research" | "position-scenarios" | "weighted-score" | "mainboard-scan";
export type ToolProvider = "akshare" | "tushare" | "llmquant-data" | "financial-datasets" | "sina" | "local" | "frankfurter" | "yahoo";
export interface ToolDataRoute {
  provider: ToolProvider;
  markets: readonly DataMarket[];
  dependencies: readonly ("python" | "akshare")[];
  credential?: string;
  permission: string;
  endpoints?: readonly string[];
}
export interface ToolRequirements {
  capability: ToolDataCapability;
  routes: readonly ToolDataRoute[];
  /** Required in addition to every alternative data route. */
  engine?: { name: "akquant"; version: string; configurationKey: string };
  /** Additional inputs or endpoints which a daily-series sample does not establish. */
  limitations: string;
  effects: readonly ("public-network" | "market-cache" | "research-storage" | "local-read" | "shell-execution" | "portfolio-preferences" | "engine-process")[];
}
export interface ToolCapabilityManifest {
  name: string;
  label: string;
  description: string;
  domain: "data" | "quant" | "system";
  enabled: boolean;
  parameters: Record<string, unknown>;
  requirements: ToolRequirements;
}
export type ToolReadinessStatus = "blocked" | "unverified" | "sample-verified" | "local";
export interface ToolRouteReadiness {
  provider: ToolProvider;
  status: ToolReadinessStatus;
  reason: string;
  action: string;
}
export interface ToolReadiness {
  name: string;
  label: string;
  capability: ToolDataCapability;
  status: ToolReadinessStatus;
  routes: ToolRouteReadiness[];
  limitations: string;
  /** Only a data prerequisite, never evidence that this tool's computation was executed. */
  sample?: Pick<DataReadiness, "source" | "market" | "symbol" | "start" | "end" | "rowCount" | "asOfDate" | "observedAt">;
}
export interface ToolReadinessEvidence {
  market: DataMarket;
  data?: DataReadiness | null;
  python?: PythonReadiness;
}
