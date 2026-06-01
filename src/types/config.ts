import type { Market } from "./data.ts";

export interface UserPreferences {
  defaultMarket: Market;
  defaultBenchmark: string;
  defaultCash: number;
  defaultFast: number;
  defaultSlow: number;
  portfolioVariant: string;
}

export interface AnthropicConfig {
  model: string;
  maxTokens: number;
  thinkingLevel: "off" | "minimal" | "low" | "medium" | "high";
}

export interface McpConfig {
  enabled: boolean;
  autoConnect: boolean;
}

export interface ApiKeys {
  ANTHROPIC_API_KEY?: string;
  TUSHARE_TOKEN?: string;
  FINANCIAL_DATASETS_KEY?: string;
  LLMQUANT_API_KEY?: string;
}

export interface OhQuantSettings {
  version: number;
  preferences: UserPreferences;
  mcp: McpConfig;
  anthropic: AnthropicConfig;
  apiKeys: ApiKeys;
}

export const DEFAULT_SETTINGS: OhQuantSettings = {
  version: 1,
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
  anthropic: {
    model: "claude-sonnet-4-6",
    maxTokens: 4096,
    thinkingLevel: "off",
  },
  apiKeys: {},
};
