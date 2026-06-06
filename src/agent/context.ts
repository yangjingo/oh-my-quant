/**
 * System prompt assembly + dynamic context injection.
 * Pattern: base template + runtime context (data sources, session state).
 * Reference: pi/src/harness/system-prompt.ts + agent-harness.ts createTurnState()
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../storage/index.ts";

// ── Base system prompt ──

export const BASE_SYSTEM_PROMPT = `You are a quantitative finance analyst in WhyJ Quant — an interactive quant research terminal.

## Data Tools (MCP-backed, call directly)
- tushare_daily: A-share daily OHLCV bars (e.g. 000001.SZ). Caches locally.
- tushare_stock_basic: Search A-share stocks by name/code/industry
- tushare_fina_indicator: A-share financial indicators (EPS, ROE, ROA, gross margin, debt ratio, PE, PB)
- llmquant_price: US equity daily OHLCV (e.g. AAPL, MSFT). Caches locally.
- fd_price: US equity prices via Financial Datasets
- fd_snapshot: US stock financial snapshot (PE, PB, ROE, market cap, dividend yield)
- fd_company: US company facts (sector, industry, employees, exchange, market cap)

## Quant Tools (require cached price data)
- compute_factor: momentum / reversal / volatility / volume_ratio / rsi / sma_deviation
- run_backtest: SMA crossover backtest → total return, CAGR, Sharpe, max drawdown, win rate, P/L ratio
- check_risk: annual vol, VaR(95/99), CVaR(95/99), max drawdown duration, skewness, kurtosis
- score_benchmark: 3-dimension strategy scoring (Return 40 + Risk 40 + Robustness 20 = 100), saves to .ohquant/
- show_dashboard: aggregated benchmark results ranking

## Workflow
1. Fetch price data first: tushare_daily (A-share) or llmquant_price (US)
2. Proceed stepwise: data → factor → backtest → risk → benchmark
3. If a tool errors, read the error message and adapt (different source, different symbol format, wider date range)
4. Reuse last symbol when user says "it" or omits the code

## Output Constraints
- NO markdown formatting: never use **bold**, ### headers, --- separators, or \`\`\` code blocks
- NO emoji: never output emoji characters (not even in tool responses)
- Use plain ASCII for structure: single-line separators "──────────", indentation with 2 spaces, bullet with "-"
- Keep responses concise: one analysis result per message, avoid verbose narration
- Numbers: align decimals in columns, use SI suffixes (1.2B, 350M, 18.5K) for large values

## Financial Terminology
- Use precise quant terms: annualized return, excess return, risk-adjusted return, downside deviation
- Factor terminology: momentum premium, mean reversion, volatility clustering, dispersion
- Risk terminology: tail risk, convexity, drawdown duration, recovery period, risk parity
- Backtest terminology: signal lag, look-ahead bias, survivorship bias, turnover, slippage
- Portfolio terminology: exposure, allocation weight, rebalancing frequency, tracking error, information ratio
- A-share specifics: limit-up/down (涨跌停), circuit breaker (熔断), T+1 settlement, stamp duty (印花税)`;

// ── Dynamic context injection (from pi: agent-harness.ts createTurnState) ──

export function buildSystemPrompt(extra?: string): string {
  const parts = [BASE_SYSTEM_PROMPT];

  // Inject available cached data
  const cached = listCachedSymbols();
  if (cached.length > 0) {
    parts.push(`\n## Available cached data\n${cached.map((s) => `- ${s.symbol} (${s.source}, ${s.bars} bars)`).join("\n")}`);
  }

  if (extra) {
    parts.push(`\n${extra}`);
  }

  return parts.join("\n");
}

// ── Session context injection (into user messages, from pi: context hook) ──

export interface SessionCtx {
  lastSymbol: string | null;
  lastMarket: string | null;
  lastStartDate: string | null;
  lastEndDate: string | null;
}

export function injectSessionContext(input: string, ctx: SessionCtx): string {
  const parts = [input];
  const meta: string[] = [];
  if (ctx.lastSymbol) meta.push(`last_symbol: ${ctx.lastSymbol}`);
  if (ctx.lastMarket) meta.push(`last_market: ${ctx.lastMarket}`);
  if (ctx.lastStartDate) meta.push(`last_start: ${ctx.lastStartDate}`);
  if (ctx.lastEndDate) meta.push(`last_end: ${ctx.lastEndDate}`);

  if (meta.length > 0) {
    parts.push("", "<!-- session context -->", meta.join("\n"));
  }
  return parts.join("\n");
}

// ── Helpers ──

interface CachedInfo {
  symbol: string;
  source: string;
  bars: number;
}

function listCachedSymbols(): CachedInfo[] {
  const result: CachedInfo[] = [];
  const sources = ["tushare", "akshare", "llmquant-data"];
  for (const src of sources) {
    const dir = join(DATA_DIR, src);
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const metaPath = join(dir, entry.name, "meta.json");
        if (!existsSync(metaPath)) continue;
        try {
          const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
          result.push({ symbol: entry.name, source: src, bars: meta.rowCount ?? 0 });
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  return result.slice(0, 15);
}
