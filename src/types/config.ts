import type { Market } from "./data.ts";

export interface UserPreferences {
  defaultMarket: Market;
  defaultBenchmark: string;
  defaultCash: number;
  defaultFast: number;
  defaultSlow: number;
  portfolioVariant: string;
}

export interface McpConfig {
  enabled: boolean;
  autoConnect: boolean;
  servers?: Record<string, { enabled: boolean }>;
}

export interface OhQuantSettings {
  version: number;
  /** Claude Code-style env vars (API keys, base URLs, etc.) */
  env: Record<string, string>;
  /** Claude model: "sonnet" | "opus" | "haiku" */
  model: string;
  /** Thinking/reasoning level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" */
  thinkingLevel: string;
  /** Tool allow/deny lists */
  permissions: { allow?: string[]; deny?: string[] };
  /** User business preferences */
  preferences: UserPreferences;
  /** MCP server management */
  mcp: McpConfig;
}

export const DEFAULT_SETTINGS: OhQuantSettings = {
  version: 1,
  env: {},
  model: "sonnet",
  thinkingLevel: "off",
  permissions: {
    allow: [
      "mcp__financial-datasets__get_company_facts",
      "mcp__financial-datasets__get_financial_metrics_snapshot",
    ],
  },
  preferences: {
    defaultMarket: "A",
    defaultBenchmark: "000300.SH",
    defaultCash: 100_000,
    defaultFast: 20,
    defaultSlow: 60,
    portfolioVariant: "v1",
  },
  mcp: {
    enabled: true,
    autoConnect: true,
  },
};
