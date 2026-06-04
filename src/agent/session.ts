/**
 * AgentSession — pi Agent + WhyJ Quant tools + Anthropic model.
 */
import { Agent, type AgentMessage, type StreamFn } from "@earendil-works/pi-agent-core";
import {
  getEnvApiKey,
  getModels,
  streamSimple,
  type KnownProvider,
  type Message,
  type Model,
} from "@earendil-works/pi-ai";
import { QUANT_TOOLS } from "../tools/quant-tools.ts";
import { loadSettings } from "../storage/index.ts";

const SYSTEM_PROMPT = `You are a quantitative finance analyst in WhyJ Quant terminal.

## Tools
- fetch_bars: download OHLCV price data (A-share/US/HK)
- compute_factor: momentum, reversal, volatility, volume_ratio, rsi, sma_deviation
- run_backtest: SMA crossover backtest with full metrics
- check_risk: VaR, CVaR, max drawdown, Sharpe, skewness, kurtosis
- score_benchmark: 3-dimension strategy evaluation, saves to .ohquant/
- show_dashboard: aggregated benchmark results

## Rules
1. Call fetch_bars before any analysis that needs price data
2. Work step by step: data → factor → backtest → risk → score
3. Interpret results in plain Chinese or English
4. Mark positive results with [OK], negative with [ERR]
5. Reuse last symbol if user says "it" or omits the code
6. End with one actionable suggestion
7. Keep responses concise`;

export function createAgent(): Agent {
  const config = loadSettings();
  const modelId = resolveModelId(config.model || "sonnet", config.env);
  const provider = inferProvider(modelId);
  const model = resolveModel(provider, modelId);

  const agent = new Agent({
    sessionId: `whyj-${Date.now()}`,
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model,
      thinkingLevel: (config.thinkingLevel as any) ?? "off",
      tools: QUANT_TOOLS.slice(),
    },
    convertToLlm,
    streamFn: streamSimple as StreamFn,
    getApiKey: (_provider: string) => {
      return config.env["WHYJ_AUTH_TOKEN"]
        ?? process.env["WHYJ_AUTH_TOKEN"]
        ?? config.env["WHYJ_API_KEY"]
        ?? process.env["WHYJ_API_KEY"]
        ?? undefined;
    },
    transport: "auto",
    maxRetryDelayMs: 60_000,
    toolExecution: "sequential",
    steeringMode: "one-at-a-time",
    followUpMode: "one-at-a-time",
  });

  return agent;
}

function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages
    .filter((m): m is Message => m.role === "user" || m.role === "assistant" || m.role === "toolResult");
}

export function resolveModelId(model: string, env: Record<string, string>): string {
  const envKey = `WHYJ_DEFAULT_${model.toUpperCase()}_MODEL`;
  return env[envKey] || process.env[envKey] || inferModelId(model);
}

/** Map shorthand names to concrete model IDs. */
export function inferModelId(model: string): string {
  switch (model) {
    case "sonnet": return "deepseek-v4-pro";
    case "opus": return "deepseek-v4-pro";
    case "haiku": return "deepseek-v4-flash";
    case "gpt-5.5": return "openai/gpt-5.5";
    default: return model;
  }
}

function inferProvider(modelId: string): string {
  if (modelId.startsWith("openai/")) return "openrouter";
  if (modelId.startsWith("deepseek-")) return "deepseek";
  if (modelId.startsWith("claude-")) return "anthropic";
  if (modelId.startsWith("gpt-") || modelId.startsWith("o")) return "openai";
  if (modelId.startsWith("gemini-")) return "google";
  if (modelId.startsWith("mistral-")) return "mistral";
  return "deepseek";
}

function resolveModel(provider: string, id: string): Model<any> {
  const models = getModels(provider as KnownProvider);
  const model = models.find((candidate) => candidate.id === id);
  if (!model) {
    // fallback: try finding any model matching the ID prefix
    const prefix = models.find((candidate) => id.startsWith(candidate.id));
    if (prefix) return prefix;
    throw new Error(`pi-ai model not found: ${provider}/${id}`);
  }
  return model;
}
