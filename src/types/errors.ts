/**
 * Structured error system — problem + cause + fix.
 * DX principle: every error tells the developer what happened, why, and how to fix it.
 */

export type ErrorCategory = "auth" | "network" | "data" | "config" | "input" | "internal";

export interface QuantError {
  code: string;          // machine-readable, e.g. "AUTH_NO_KEY"
  category: ErrorCategory;
  problem: string;       // what went wrong
  cause: string;         // why it happened
  fix: string;           // how to resolve it (actionable)
  docs?: string;         // optional: link or command reference
}

/** Predefined error catalog */
export const ERRORS = {
  AUTH_NO_ANTHROPIC_KEY: {
    code: "AUTH_NO_ANTHROPIC_KEY",
    category: "auth" as const,
    problem: "Cannot use AI agent — auth token is missing",
    cause: "WHYJ_AUTH_TOKEN is not set in .env or .ohquant/settings.json",
    fix: "Run /config for setup guide, or add: WHYJ_AUTH_TOKEN=sk-... to .env file",
    docs: "/config",
  },
  AUTH_NO_TUSHARE_KEY: {
    code: "AUTH_NO_TUSHARE_KEY",
    category: "auth" as const,
    problem: "Cannot fetch A-share data — Tushare token is missing",
    cause: "TUSHARE_TOKEN is not set in .env",
    fix: "Register at https://tushare.pro, get your token, add to .env: TUSHARE_TOKEN=your_token",
    docs: "/config",
  },
  AUTH_NO_FINANCIAL_KEY: {
    code: "AUTH_NO_FINANCIAL_KEY",
    category: "auth" as const,
    problem: "Cannot fetch US stock data — Financial Datasets key is missing",
    cause: "FINANCIAL_DATASETS_KEY is not set in .env",
    fix: "Register at https://financialdatasets.ai, get your key, add to .env: FINANCIAL_DATASETS_KEY=your_key",
    docs: "/config",
  },
  MCP_NOT_CONNECTED: {
    code: "MCP_NOT_CONNECTED",
    category: "network" as const,
    problem: "MCP data servers are not connected",
    cause: "MCP servers require API keys and explicit connection",
    fix: "Run /mcp connect to connect to data sources. Check /config show for key status.",
    docs: "/mcp connect",
  },
  MCP_TOOL_FAILED: {
    code: "MCP_TOOL_FAILED",
    category: "network" as const,
    problem: "Data request to MCP server failed",
    cause: "The MCP server returned an error or timed out",
    fix: "Check your internet connection and API key validity. Run /config show to verify keys.",
    docs: "/mcp status",
  },
  DATA_NO_CACHE: {
    code: "DATA_NO_CACHE",
    category: "data" as const,
    problem: "No cached data for this symbol",
    cause: "Data must be downloaded before analysis. The symbol may not exist or has never been fetched.",
    fix: "Use the AI agent: 'Download data for SYMBOL' or /skill trigger --name fetch_bars --code SYMBOL",
    docs: "/skill trigger --name fetch_bars --code 000001.SZ",
  },
  DATA_NOT_ENOUGH: {
    code: "DATA_NOT_ENOUGH",
    category: "data" as const,
    problem: "Not enough bars for the requested analysis",
    cause: "Analysis needs a minimum number of data points that aren't available",
    fix: "Fetch a wider date range or choose a stock with more trading history",
    docs: undefined,
  },
  INPUT_INVALID_SYMBOL: {
    code: "INPUT_INVALID_SYMBOL",
    category: "input" as const,
    problem: "Invalid or unrecognized stock symbol",
    cause: "The symbol format is wrong or the stock doesn't exist in the target market",
    fix: "A-shares: use format like 000001.SZ or 600519.SH. US: use ticker like AAPL. Use /claw --code CODE to verify.",
    docs: "/claw --code 000001.SZ",
  },
  INPUT_MISSING_ARG: {
    code: "INPUT_MISSING_ARG",
    category: "input" as const,
    problem: "Required argument is missing",
    cause: "The command needs a required flag that wasn't provided",
    fix: "Check the command help or use /help to see required flags",
    docs: "/help",
  },
  CONFIG_MISSING: {
    code: "CONFIG_MISSING",
    category: "config" as const,
    problem: "Configuration file is missing or corrupted",
    cause: ".ohquant/settings.json doesn't exist or is invalid JSON",
    fix: "Delete .ohquant/settings.json and restart — it will be recreated with defaults",
    docs: undefined,
  },
  INTERNAL_UNEXPECTED: {
    code: "INTERNAL_UNEXPECTED",
    category: "internal" as const,
    problem: "An unexpected internal error occurred",
    cause: "This is a bug in whyj-quant — something that should have been handled",
    fix: "Report the issue with the error details. Try restarting the CLI.",
    docs: undefined,
  },
} as const satisfies Record<string, QuantError>;

export type ErrorCode = keyof typeof ERRORS;

/** Format an error for display in the CLI */
export function formatError(err: QuantError, detail?: string): string {
  const lines = [
    `✗ ${err.problem}`,
    `  Cause: ${err.cause}`,
    `  Fix:   ${err.fix}`,
  ];
  if (err.docs) lines.push(`  Docs:  ${err.docs}`);
  if (detail) lines.push(`  Detail: ${detail}`);
  return lines.join("\n");
}
