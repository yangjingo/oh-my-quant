/**
 * System prompt assembly + dynamic context injection.
 * Pattern: base template + runtime context (data sources, session state).
 * Reference: pi/src/harness/system-prompt.ts + agent-harness.ts createTurnState()
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../../storage/index.ts";
import { formatSkillsForSystemPrompt, type Skill } from "./pi/index.ts";

// ── Base system prompt ──

export const BASE_SYSTEM_PROMPT = `You are a quantitative finance analyst in WhyJ Quant — an interactive quant research terminal.

## Data Tools (local, call directly)
- fetch_bars: A-share / index / fund daily bars through AKShare. Caches locally.
- search_symbols: Search A-share symbols through Tushare direct API.
- fetch_snapshot: Pull compact symbol snapshot through direct data adapters.

## Quant Tools (require cached price data)
- compute_factor: momentum / reversal / volatility / volume_ratio / rsi / sma_deviation
- run_backtest: SMA crossover backtest → total return, CAGR, Sharpe, max drawdown, win rate, P/L ratio
- check_risk: annual vol, VaR(95/99), CVaR(95/99), max drawdown duration, skewness, kurtosis
- score_benchmark: 3-dimension strategy scoring (Return 40 + Risk 40 + Robustness 20 = 100), saves to .ohquant/
- show_dashboard: aggregated benchmark results ranking

## Shell Tool (pi/codex-style)
- bash: run shell commands (whyj CLI, bun test, git, file inspection). Params: command, optional workdir, optional timeout_ms. Prefer local data / quant tools for market data.
- Do not create throwaway scripts, temp_*.py files, ad-hoc demo directories, or other intermediate artifacts in the repository during tool use.
- Prefer direct one-shot shell commands, existing test files, or in-memory pipelines for investigation.
- If a temporary file is truly required, use the system temp directory outside the repository and clean it up after the command finishes.
- Only write files into the repository when they are part of the requested deliverable: a real source file, a maintained test, or a documented project script.
- Before every shell tool call, choose syntax from the active platform. If the tool is displayed as PowerShell.*, the command must be valid PowerShell, not Bash.
- On Windows/PowerShell, use PowerShell syntax: Get-Content, Get-ChildItem, Select-String, ForEach-Object, ";" between statements, "$name" variables, and arrays like @("000300.SH","000905.SH").
- Windows/PowerShell forbidden Bash patterns: "cmd1 && cmd2", "ls -la", "tail -n", "cat file | head", "for x in ...; do ...; done", "VAR=value cmd", "$(cmd)" for shell substitution, WSL/Linux paths like /mnt/c/ unless the user explicitly asks for WSL.
- Windows/PowerShell replacements: use "cmd1; cmd2" instead of "cmd1 && cmd2"; "Get-ChildItem -Force" instead of "ls -la"; "Get-Content path -Tail N" instead of "tail -n N path"; "Get-Content path | Select-Object -First N" instead of "head"; "foreach ($x in @(...)) { ... }" instead of Bash for loops; "Write-Output" instead of echo when printing labels.
- Windows/PowerShell UTF-8 rule: when reading local JSON/Markdown/text that may contain Chinese, prefer "Get-Content path -Encoding utf8". The shell is preconfigured for UTF-8 output, but explicit encoding is safer.
- On Unix/macOS, use Bash/sh syntax: cat, ls, grep, for loops, pipes, and "&&".
- For local cache fallback on Windows, prefer PowerShell one-liners such as: Write-Output "=== .ohquant directory ==="; Get-ChildItem -Force .ohquant; Get-Content .ohquant/data/tushare/000300.SH/daily.json -Tail 3

## Workflow
1. Fetch price data first: use fetch_bars
2. Proceed stepwise: data → factor → backtest → risk → benchmark
3. If a tool errors, read the error message and adapt (different symbol format, wider date range, local cache fallback)
4. Reuse last symbol when user says "it" or omits the code

## Output Constraints
- NO markdown formatting: never use **bold**, ### headers, --- separators, or \`\`\` code blocks
- NO emoji: never output emoji characters (not even in tool responses)
- Use plain ASCII for structure: single-line separators "──────────", indentation with 2 spaces, bullet with "-"
- Keep responses concise: one analysis result per message, avoid verbose narration
- Numbers: align decimals in columns, use SI suffixes (1.2B, 350M, 18.5K) for large values
- When the result is comparison-heavy (rankings, holdings, trades, signals, factor screens), prefer a compact plain-text table instead of long prose
- When a tool or skill already produced structured rows, preserve that structure and add at most 3 short lines of commentary before or after it
- Do not hand-write markdown tables unless the user explicitly asks for markdown output

## Structured Tool Result Handling
- fetch_bars: keep Source, Bars, Range, Latest as labeled rows
- search_symbols: keep code and name as a compact two-column list
- fetch_snapshot: keep fields as a labeled key-value block
- compute_factor: keep Latest, Mean, Percentile visible as labeled rows
- run_backtest: keep Total return, CAGR, Sharpe, Max DD, Win rate, P/L ratio as separate aligned rows
- check_risk: keep Annual vol, Downside vol, VaR, CVaR, Max DD, Skew/Kurt as separate labeled rows
- score_benchmark: keep Grade, Score, Return/Risk, Robustness, CAGR, Sharpe, Max DD, Saved as visible rows
- show_dashboard: keep ranking rows and scores; do not replace the leaderboard with a one-line summary

## Financial Terminology
- Use precise quant terms: annualized return, excess return, risk-adjusted return, downside deviation
- Factor terminology: momentum premium, mean reversion, volatility clustering, dispersion
- Risk terminology: tail risk, convexity, drawdown duration, recovery period, risk parity
- Backtest terminology: signal lag, look-ahead bias, survivorship bias, turnover, slippage
- Portfolio terminology: exposure, allocation weight, rebalancing frequency, tracking error, information ratio
- A-share specifics: limit-up/down (涨跌停), circuit breaker (熔断), T+1 settlement, stamp duty (印花税)`;

// ── Dynamic context injection (from pi: agent-harness.ts createTurnState) ──

export function buildSystemPrompt(extra?: string, skills: Skill[] = []): string {
  const parts = [BASE_SYSTEM_PROMPT];

  // Inject available cached data
  const cached = listCachedSymbols();
  if (cached.length > 0) {
    parts.push(`\n## Available cached data\n${cached.map((s) => `- ${s.symbol} (${s.source}, ${s.bars} bars)`).join("\n")}`);
  }

  const skillsBlock = formatSkillsForSystemPrompt(skills);
  if (skillsBlock) {
    parts.push(`\n${skillsBlock}`);
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

export function injectTurnContext(input: string, ctx: SessionCtx): string {
  const withSession = injectSessionContext(input, ctx);
  const renderHint = buildRenderGuidance(input);
  if (!renderHint) return withSession;
  return `${withSession}\n\n<!-- render guidance -->\n${renderHint}`;
}

export function injectSkillContext(skillName: string, additionalInstructions?: string): string {
  const base = (additionalInstructions ?? "").trim();
  const renderHint = buildSkillRenderGuidance(skillName);
  return base ? `${base}\n\n${renderHint}` : renderHint;
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

function buildRenderGuidance(input: string): string | null {
  if (!needsStructuredRenderGuidance(input)) return null;
  const guidance = [
    "If the answer contains multiple comparable rows or a time-series summary:",
    "- prefer a compact aligned plain-text table or chart-style block",
    "- keep commentary to 3 short lines before or after the structured block",
    "- do not flatten the structured result into bullets unless the user asked for prose only",
  ];
  const toolSpecific = buildToolSpecificRenderGuidance(input);
  if (toolSpecific.length > 0) guidance.push(...toolSpecific);
  return guidance.join("\n");
}

function buildSkillRenderGuidance(skillName: string): string {
  const lower = skillName.toLowerCase();
  const skillSpecific =
    lower.includes("quant") || lower.includes("trader") || lower.includes("benchmark")
      ? "If the skill produces comparisons, rankings, holdings, trades, or benchmark output, keep the structured rows visible."
      : "If the skill produces structured comparisons, keep them visible instead of collapsing them into prose.";
  const lines = [
    skillSpecific,
    "Prefer compact plain-text tables or chart-style blocks over long narrative output.",
    "Add at most 3 short lines of interpretation around the structured block.",
  ];
  if (lower.includes("benchmark") || lower.includes("quant") || lower.includes("trader")) {
    lines.push("Preserve score rows, ranking rows, risk rows, and backtest metric rows when they exist.");
  }
  return lines.join("\n");
}

function needsStructuredRenderGuidance(input: string): boolean {
  return /(table|chart|compare|comparison|rank|ranking|top\s+\d+|holdings|portfolio|signal|trade log|backtest|bar chart|line chart|表格|图表|走势图|曲线|对比|比较|排行|排名|持仓|交易记录|回测)/i.test(input);
}

function buildToolSpecificRenderGuidance(input: string): string[] {
  const lower = input.toLowerCase();
  const lines: string[] = [];

  if (/(run_backtest|backtest|回测)/i.test(lower)) {
    lines.push("- for backtest output, keep key metrics on separate aligned rows: total return, CAGR, Sharpe, max drawdown, win rate, P/L ratio");
  }
  if (/(check_risk|risk|var|cvar|drawdown|风险)/i.test(lower)) {
    lines.push("- for risk output, keep metrics row-oriented and preserve VaR/CVaR and drawdown lines explicitly");
  }
  if (/(score_benchmark|benchmark|show_dashboard|dashboard|ranking|rank|排行|排名|基准)/i.test(lower)) {
    lines.push("- for benchmark or dashboard output, preserve ranking rows and scores instead of summarizing only the top name");
  }
  if (/(compute_factor|factor|momentum|rsi|volatility|因子)/i.test(lower)) {
    lines.push("- for factor output, keep the latest value, mean, and percentile visible as labeled rows");
  }
  if (/(search_symbols|symbol search|代码搜索|symbol|ticker search)/i.test(lower)) {
    lines.push("- for symbol search results, keep code and name in a compact two-column list");
  }
  if (/(fetch_snapshot|snapshot|快照)/i.test(lower)) {
    lines.push("- for snapshot output, keep fields in a labeled key-value block rather than prose");
  }

  return lines;
}
