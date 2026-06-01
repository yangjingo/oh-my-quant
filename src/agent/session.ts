/**
 * AgentSession — pi Agent + WhyJ Quant tools + Anthropic model.
 */
import { Agent } from "./core/agent.ts";
import type { AgentMessage, StreamFn } from "./core/types.ts";
import { QUANT_TOOLS } from "../tools/quant-tools.ts";
import { loadSettings } from "../storage/index.ts";
import { streamSimple } from "./core/shim/anthropic-stream.ts";

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
4. Use ✓ for positive, ✗ for negative
5. Reuse last symbol if user says "it" or omits the code
6. End with one actionable suggestion
7. Keep responses concise`;

export function createAgent(): Agent {
  const config = loadSettings();

  const agent = new Agent({
    sessionId: `whyj-${Date.now()}`,
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model: {
        id: config.anthropic.model,
        name: config.anthropic.model,
        api: "anthropic-messages" as const,
        provider: "anthropic" as const,
        baseUrl: "https://api.anthropic.com",
        reasoning: true,
        input: ["text" as const],
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        contextWindow: 200_000,
        maxTokens: 8192,
      },
      thinkingLevel: config.anthropic.thinkingLevel,
      tools: QUANT_TOOLS.slice(),
    },
    convertToLlm,
    streamFn: ((model, context, options) => streamSimple(model, context, options)) as StreamFn,
  });

  return agent;
}

function convertToLlm(messages: AgentMessage[]) {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult")
    .map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp })) as Parameters<typeof streamSimple>[1]["messages"];
}
