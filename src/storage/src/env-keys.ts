// Unified config naming: all app-managed env keys use the WHYJ_QUANT_* prefix.
// WHYJ_QUANT_API_KEY is the model/provider credential slot, analogous to Claude Code's Anthropic API key.
// WHYJ_QUANT_BASE_URL is the endpoint slot, analogous to Claude Code's Anthropic base URL / custom endpoint.
export const WHYJ_ENV_KEY_ALIASES = {
  authToken: ["WHYJ_QUANT_AUTH_TOKEN"],
  apiKey: ["WHYJ_QUANT_API_KEY"],
  baseUrl: ["WHYJ_QUANT_BASE_URL"],
  tushareToken: ["WHYJ_QUANT_TUSHARE_TOKEN", "TUSHARE_TOKEN"],
  financialDatasetsKey: ["WHYJ_QUANT_FINANCIAL_DATASETS_KEY", "FINANCIAL_DATASETS_KEY"],
  llmquantApiKey: ["WHYJ_QUANT_LLMQUANT_API_KEY", "LLMQUANT_API_KEY"],
} as const;

const WHYJ_ENV_KEY_NAMES = new Set<string>(
  Object.values(WHYJ_ENV_KEY_ALIASES).flat(),
);

/** Remove terminal control codes only for display safety; do not use this for config parsing. */
export function stripTerminalControlCodes(value: string): string {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9?;]*[ -/]*[@-~]/g, "")
    .replace(/\[(?:\??\d+(?:;\d+)*)[ -/]*[@-~]\]?/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .trim();
}

export type WhyjEnvAliasKey = keyof typeof WHYJ_ENV_KEY_ALIASES;

export function readWhyjEnvValue(
  env: Record<string, string | undefined>,
  key: WhyjEnvAliasKey,
): string | undefined {
  for (const name of WHYJ_ENV_KEY_ALIASES[key]) {
    const value = env[name];
    if (value) return value;
  }
  return undefined;
}

export function hasWhyjEnvValue(
  env: Record<string, string | undefined>,
  key: WhyjEnvAliasKey,
): boolean {
  return readWhyjEnvValue(env, key) !== undefined;
}

export function canonicalizeWhyjEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, aliases] of Object.entries(WHYJ_ENV_KEY_ALIASES) as Array<[WhyjEnvAliasKey, readonly string[]]>) {
    const value = readWhyjEnvValue(env, key);
    if (value) out[aliases[0]!] = value;
  }
  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    if (!WHYJ_ENV_KEY_NAMES.has(key)) out[key] = value;
  }
  return out;
}
