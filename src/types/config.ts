import type { Market } from "./data.ts";

export type DataSource = "akshare" | "tushare" | "llmquant-data" | "financial-datasets";

export interface UserPreferences {
  defaultMarket: Market;
  defaultBenchmark: string;
  defaultCash: number;
  defaultFast: number;
  defaultSlow: number;
  currentPortfolioFile: string;
  source: DataSource;
}

export interface SkillIntegrationSettings {
  /** Load user-level Codex skills from ~/.codex/skills. */
  codex: boolean;
  /** Load user-level Claude/agent skills from ~/.claude/skills, ~/.agents/skills, and ~/.pi/agent/skills. */
  claude: boolean;
}

export interface OhQuantSettings {
  version: number;
  /** Claude Code-style env vars (API keys, base URLs, etc.) */
  env: Record<string, string>;
  /** Claude model: "sonnet" | "opus" | "haiku" */
  model: string;
  /** Thinking/reasoning level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" */
  thinkingLevel: string;
  /** Whether the insight panel is shown and auto-derived from the conversation. */
  insightEnabled: boolean;
  /** Whether the right-side overview/portfolio panel is visible. */
  showPortfolioPanel: boolean;
  /** Optional user-level skill integrations. Project quant skills are always loaded. */
  skillIntegrations: SkillIntegrationSettings;
  /** Tool allow/deny lists */
  permissions: { allow?: string[]; deny?: string[] };
  /** User business preferences */
  preferences: UserPreferences;
}

export const DEFAULT_SETTINGS: OhQuantSettings = {
  version: 1,
  env: {},
  model: "sonnet",
  thinkingLevel: "high",
  insightEnabled: true,
  showPortfolioPanel: true,
  skillIntegrations: {
    codex: false,
    claude: false,
  },
  permissions: {},
  preferences: {
    defaultMarket: "A",
    defaultBenchmark: "000300.SH",
    defaultCash: 100_000,
    defaultFast: 20,
    defaultSlow: 60,
    currentPortfolioFile: "holdings.json",
    source: "llmquant-data",
  },
};
