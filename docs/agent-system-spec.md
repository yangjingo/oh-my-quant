# WhyJ Quant — AI Agent System Spec (v2, implemented)

## 1. Overview

The agent system wraps pi's `@earendil-works/pi-agent-core` Agent class with quant-specific tools, session management, context compaction, and prompt assembly.

**Design references:**
- pi `packages/agent/src/harness/agent-harness.ts` — harness lifecycle, hooks, queue management
- pi `packages/agent/src/harness/compaction/compaction.ts` — token estimation, cut points, summarization
- pi `packages/agent/src/harness/session/session.ts` — tree-based session storage
- pi `packages/agent/src/harness/messages.ts` — message conversion, compaction/branch summary messages

## 2. File Map

```
src/agent/
  session.ts          Agent wrapper (pi Agent + hooks + compaction + persistence)
  context.ts          Prompt assembly (base template + dynamic injection)
  session.test.ts     12 tests: estimateTokens, createAgent
  context.test.ts     9 tests: BASE_SYSTEM_PROMPT, injectSessionContext
  core/               Vendored pi agent core (agent-loop, types)

src/tools/
  mcp-tools.ts        7 MCP-backed tools (tushare x3, llmquant x1, fd x3)
  quant-tools.ts      5 computation tools (factor, backtest, risk, benchmark, dashboard)

src/storage/
  index.ts            .ohquant/ directory layout, settings load/save
  bars.ts             Daily bars: loadBars, saveBars, isCacheFresh, getMeta
```

## 3. Agent Architecture

```typescript
// src/agent/session.ts
createAgent(): Agent {
  const config = loadSettings()
  return new Agent({
    sessionId,
    initialState: {
      systemPrompt: buildSystemPrompt(),
      model,
      thinkingLevel,
      tools: [...MCP_TOOLS, ...COMPUTE_TOOLS],  // 12 tools total
    },
    convertToLlm,               // Filter to user/assistant/toolResult only
    streamFn: streamSimple,
    getApiKey: () => loadSettings().env["WHYJ_AUTH_TOKEN"],  // settings.json only
    transformContext: (msgs) => {  // Token estimate + compaction
      if (estimateContextTokens(msgs) >= 111616) return compactMessages(msgs)
      return msgs
    },
    toolExecution: "sequential",
    steeringMode: "one-at-a-time",
    followUpMode: "one-at-a-time",
  })
}
```

## 4. MCP-backed Tools (src/tools/mcp-tools.ts)

Each tool wraps `callTool(serverName, toolName, args)` → cache locally.

| Tool | Server | MCP Call | Caches? |
|------|--------|----------|---------|
| `tushare_daily` | tushare | `daily(ts_code, start_date, end_date)` | Yes |
| `tushare_stock_basic` | tushare | `stock_basic(name, exchange, list_status)` | No |
| `tushare_fina_indicator` | tushare | `fina_indicator(ts_code, period)` | No |
| `llmquant_price` | llmquant-data | `equity_historical_prices(ticker, start, end)` | Yes |
| `fd_price` | financial-datasets | `get_stock_prices(ticker, start, end)` | No |
| `fd_snapshot` | financial-datasets | `get_financial_metrics_snapshot(ticker)` | No |
| `fd_company` | financial-datasets | `get_company_facts(ticker)` | No |

Pattern: TypeBox schema → `callTool()` → normalize → `saveBars()` (if cacheable) → `ok(text)`.

## 5. Computation Tools (src/tools/quant-tools.ts)

| Tool | Requires | Output |
|------|----------|--------|
| `compute_factor` | Cached bars | momentum/reversal/volatility/volume_ratio/rsi/sma_deviation, percentile |
| `run_backtest` | Cached bars | total return, CAGR, Sharpe, max drawdown, win rate, P/L ratio |
| `check_risk` | Cached bars | annual vol, VaR(95/99), CVaR(95/99), max drawdown duration, skewness, kurtosis |
| `score_benchmark` | MCP (direct) | Fetch strategy + benchmark, backtest, 3-dimension score (100-point), save JSON |
| `show_dashboard` | .ohquant/ files | Read benchmark results, rank, display top 10 |

All use `loadCachedBars(symbol)` which tries sources in order. Returns `DATA_NO_CACHE` error if nothing found — agent should then call MCP data tools first.

## 6. Prompt Assembly (src/agent/context.ts)

### Base template (BASE_SYSTEM_PROMPT)
- Identity: "quantitative finance analyst in WhyJ Quant terminal"
- Lists all 12 tools with one-line descriptions
- Workflow: data → factor → backtest → risk → benchmark
- **Output constraints**: NO markdown, NO emoji, plain ASCII, SI suffixes, financial terminology
- Financial terms: annualized return, momentum premium, tail risk, tracking error, info ratio, etc.

### Dynamic injection
- `buildSystemPrompt(extra?)` appends cached symbols (up to 15) with source + bar count
- `injectSessionContext(input, ctx)` wraps input with `last_symbol`, `last_market` etc.

## 7. Token Estimation & Compaction

### Constants (from pi: DEFAULT_COMPACTION_SETTINGS)

| Constant | Value | Based on |
|----------|-------|----------|
| CONTEXT_WINDOW | 128,000 | deepseek-v4-pro |
| RESERVE_TOKENS | 16,384 | output buffer |
| KEEP_RECENT_TOKENS | 24,000 | ~20% of window |
| COMPACTION_THRESHOLD | 111,616 | window - reserve |

### Algorithm

```
compactMessages(messages):
  1. Walk backward, accumulate estimateTokens()
  2. When >= 24000: find user-message boundary, cut there
  3. Build heuristic summary (user queries, symbols, tools)
  4. Return [compactionMsg, ...recent]
```

No LLM call for summarization — heuristic only. Structured format: "Activity Summary" with queries, symbols, tools called.

## 8. Session Persistence

Format: Markdown files at `.ohquant/sessions/{YYYY-MM-DD}/session-{HHMMSS}.md`

```
# Session 2026-06-05 14:30:22
## 14:30:22 · User
analyze 000001.SZ momentum
## 14:30:25 · Assistant
Factor: momentum_20 — 000001.SZ  Latest: +0.0432  Percentile: 78%
<!-- tool result -->
> Downloaded 487 bars for 000001.SZ via tushare
```

Hook: `agent_end` event → `saveSession(event.messages)` in app.tsx.

## 9. Lifecycle

```
App mount
  → ensureDirs(), loadSettings(), connectAll()  // MCP servers
  → createAgent()                                // pi Agent
  → agent.subscribe()                            // Event → UI

User message
  → parseCommand(input)
    → /slash → direct executeCommand()
    → NL text → injectContext(input) → agent.prompt()
      → transformContext → compaction check
      → streamFn → LLM API
      → tool_execution_start/update/end → UI updates
      → agent_end → saveSession()
```

## 10. Configuration

Single source: `.ohquant/settings.json`

```json
{
  "version": 1,
  "env": { "WHYJ_AUTH_TOKEN": "sk-..." },
  "model": "sonnet",
  "thinkingLevel": "off",
  "preferences": {},
  "mcp": { "enabled": true }
}
```

Key is read via `loadSettings().env["WHYJ_AUTH_TOKEN"]` on every API call — no `.env` dependency.
