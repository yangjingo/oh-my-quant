# WhyJ Quant — AI Agent System Spec (v3, implemented)

> last-updated: 2026-06-18

**Recommended reading order**
- Start here for the system-level architecture and ownership boundaries.
- Then read `docs/pi-agent-loop-harness.md` for loop/harness lifecycle and queue semantics.
- Then read `docs/agent-loop-context.md` for prompt assembly, `displayUser`, and model-vs-UI text flow.

## 1. Overview

The agent system now vendors the minimal pi harness subset needed by WhyJ Quant and wraps it with a thin adapter. The runtime uses pi's harness lifecycle, JSONL tree session storage, compaction, and branch-summary machinery, while preserving WhyJ Quant tools, prompting, and TUI behavior.

**Design references:**
- `docs/pi-agent-loop-harness.md` — technical blog for pi agent loop, harness phase, session tree, compaction, resume boundaries
- `docs/builtin-tool-registry.md` — lightweight registry for future built-in agent tools
- pi `packages/agent/src/harness/agent-harness.ts` — harness lifecycle, hooks, queue management
- pi `packages/agent/src/harness/compaction/compaction.ts` — token estimation, cut points, summarization
- pi `packages/agent/src/harness/session/session.ts` — tree-based session storage
- pi `packages/agent/src/harness/messages.ts` — message conversion, compaction/branch summary messages

## 2. File Map

```
src/agent/
  src/
    pi/               Minimal vendored pi harness subset (harness + loop + session + compaction)
    session.ts        WhyJ Quant facade over AgentHarness; owns prompt/turn context injection and queue forwarding
    dispatch.ts       prompt/steer/followUp routing against the facade
    context.ts        Prompt assembly (base template + dynamic injection)
    skills.ts         Skill discovery and diagnostics
  test/
    session.test.ts   estimateTokens, estimateContextTokens, createAgent
    context.test.ts   BASE_SYSTEM_PROMPT, injectSessionContext
    dispatch.test.ts  prompt/steer/followUp routing

src/cli/
  catalog.ts          Slash command catalog (help text, autocomplete, one-shot help)
  registry.ts         parseCommand(), executeCommand(), slash handlers
  registry.test.ts    Parser tests

src/tools/
  registry.ts        Built-in tool registration, display metadata, CLI lookup, enabled agent tool order
  data-tools.ts       local data fetch tools
  quant-tools.ts      5 computation tools (factor, backtest, risk, benchmark, dashboard)
  bash-tool.ts        Shell tool (pi NodeExecutionEnv + codex-style params)

src/storage/
  index.ts            .ohquant/ directory layout, settings load/save
  bars.ts             Daily bars: loadBars, saveBars, isCacheFresh, getMeta
```

## 3. Agent Architecture

`createAgent()` now returns a facade that:

- creates a `NodeExecutionEnv` rooted at the current cwd
- opens or creates a pi `JsonlSessionRepo` session under `.ohquant/sessions/`
- instantiates pi `AgentHarness` with WhyJ Quant tools and system prompt callback
- mirrors core `AgentEvent` state (`isStreaming`, `pendingToolCalls`, `messages`) so the existing TUI runtime can keep its event-driven UI flow
- forwards harness `queue_update` events so Composer queue state comes from the real harness queues, not a runtime-side shadow queue
- preserves lightweight per-turn symbol memory via `injectSessionContext()`

### 3.1 Message model split: model text vs display text

WhyJ now distinguishes between:

- model-facing user text: what the LLM should actually see after session/turn context injection
- UI-facing user text: the raw string the human typed in Composer

To keep those two concerns separate without reintroducing a runtime-side pending-input ledger, the harness uses a custom `displayUser` message type in `src/agent/src/pi/harness/messages.ts`.

- `displayUser.displayText` is the raw user input shown in Composer / Conversation
- `displayUser.content` is the model-facing text payload
- `convertToLlm()` converts `displayUser` back into a standard provider `user` message before the model request

This keeps UI rendering, queue state, session persistence, and compaction aligned while still allowing prompt/turn context injection in the session layer.

## 4. Data Tools (src/tools/data-tools.ts)

Each tool wraps the repo's local data adapter path and caches locally when appropriate.

| Tool | Backend | Call | Caches? |
|------|--------|----------|---------|
| `fetch_bars` | akshare | `fetchBars(symbol, market, start, end)` | Yes |

Pattern: TypeBox schema → `fetchBars()` → `saveBars()` → `ok(text)`.

## 5. Computation Tools (src/tools/quant-tools.ts)

Quant tools are built-in agent tools, not slash commands. Full functional design: `docs/quant-tools-design.md`.

| Tool | Requires | Output |
|------|----------|--------|
| `compute_factor` | Cached bars | momentum/reversal/volatility/volume_ratio/rsi/sma_deviation, percentile |
| `run_backtest` | Cached bars | total return, CAGR, Sharpe, max drawdown, win rate, P/L ratio |
| `check_risk` | Cached bars | annual vol, VaR(95/99), CVaR(95/99), max drawdown duration, skewness, kurtosis |
| `score_benchmark` | direct data fetch | Fetch strategy + benchmark, backtest, 3-dimension score (100-point), save JSON |
| `show_dashboard` | .ohquant/ files | Read benchmark results, rank, display top 10 |

`compute_factor`, `run_backtest`, and `check_risk` use `loadCachedBars(symbol)` which tries sources in order. They return `DATA_NO_CACHE` if nothing is found, so the agent should call `fetch_bars` first. `score_benchmark` fetches strategy and benchmark bars directly and saves a result artifact. `show_dashboard` reads saved artifacts only.

## 5b. Shell Tool (src/tools/bash-tool.ts)

Reference: pi `NodeExecutionEnv` + `executeShellWithCapture`; codex `shell` tool parameters.

| Tool | Params | Behavior |
|------|--------|----------|
| `bash` | `command`, optional `workdir`, optional `timeout_ms` | Run shell via pi harness (bash on Unix, Git Bash on Windows). `executionMode: sequential`. Non-zero exit throws. Output tail-truncated at pi defaults (~50KB). |

Use for `whyj` CLI, `bun test`, git, file inspection. Market data should still go through data tools.

## 6. Prompt Assembly (src/agent/src/context.ts)

### Base template (BASE_SYSTEM_PROMPT)
- Identity: "quantitative finance analyst in WhyJ Quant terminal"
- Lists local data, quant, and shell tools with one-line descriptions
- Shell/tool discipline: repository-local temp scripts and ad-hoc demo folders are forbidden during investigation; use one-shot commands or OS temp paths and clean them up
- Workflow: data → factor → backtest → risk → benchmark
- **Output constraints**: NO markdown, NO emoji, plain ASCII, SI suffixes, financial terminology
- Financial terms: annualized return, momentum premium, tail risk, tracking error, info ratio, etc.

### Dynamic injection
- `buildSystemPrompt(extra?)` appends cached symbols (up to 15) with source + bar count
- `injectSessionContext(input, ctx)` wraps the first prompt turn with `last_symbol`, `last_market` etc.
- `injectTurnContext(input, ctx)` wraps queued follow-up / steering turns with the same session memory

Important boundary: `AppRuntime` no longer injects prompt text itself. Raw Composer input is forwarded into `dispatchUserMessage(agent, input, input)`, and the session facade is the only layer allowed to augment user text before it reaches the harness.

## 7. Token Estimation & Compaction

Compaction is no longer a local heuristic in `src/agent/src/session.ts`. WhyJ Quant now reuses pi harness compaction directly:

- token estimation delegates to vendored pi `estimateTokens()` / `estimateContextTokens()`
- session history is compacted through pi `prepareCompaction()` and `compact()`
- compaction summaries and branch summaries are stored as explicit session-tree entries
- `displayUser` is treated as a user-equivalent message during token estimation, cut-point selection, turn-start discovery, summary serialization, and branch navigation/editor restore
- the current adapter exposes token estimation helpers for tests and small utilities, but the authoritative compaction behavior lives in vendored pi code

## 8. Session Persistence

Primary storage is now pi JSONL tree sessions under `.ohquant/sessions/<encoded-cwd>/...jsonl`.

- entries are append-only and include message, compaction, branch_summary, label, and leaf records
- `app-runtime` no longer serializes Markdown transcripts on `agent_end`
- session replay is derived from the stored branch path via pi `buildSessionContext()`

## 9. Lifecycle

```
App mount
  → ensureDirs(), loadSettings()
  → createAgent()                                // WhyJ Quant facade over pi AgentHarness
  → agent.subscribe()                            // Core AgentEvent → UI

User message
  → src/cli/registry.ts: parseCommand(input)
    → /slash → executeCommand()
    → NL text → dispatchUserMessage(agent, input, input)
      → idle           → session.prompt()      → injectSessionContext()
      → active + tools → session.steer()       → injectTurnContext()
      → active + no tools → session.followUp() → injectTurnContext()
      → harness queue_update drives Composer queue
      → pi compaction / branch-summary hooks when needed
      → streamFn → LLM API
      → tool_execution_start/update/end → UI updates
      → agent_end → session already persisted by harness
```

The key architectural change is that the Composer queue shown in TUI is now derived from harness `steer/followUp/nextTurn` queues via `queue_update`. `AppRuntime` no longer owns a parallel `composerQueue` source of truth.

## 10. Configuration

Single source: `.ohquant/settings.json`

```json
{
  "version": 1,
  "env": { "WHYJ_AUTH_TOKEN": "sk-..." },
  "model": "sonnet",
  "thinkingLevel": "off",
  "preferences": {},
}
```

Key is read via `loadSettings().env["WHYJ_AUTH_TOKEN"]` on every API call — no `.env` dependency.

## 9. Insight system & tips

Investment tips displayed during agent thinking are driven by the insight pipeline:

```
notes/quant/funder.md  ──┐
                         ├──→ src/quant/insight-generator.ts
notes/quant/notes.md   ──┘         │
                                   ▼
                          .ohquant/insights.json  (auto-regenerated on startup)
                                   │
                                   ▼
                          insight.ts → getQuotes() → thinking bar spinner + tips
                                      → getInsightRules() → conversation keyword matching
```

**Components:**

| File | Role |
|------|------|
| `src/quant/insight-generator.ts` | Parses `notes/quant/*.md` → `InsightEntry[]` (quote, author, title, principle, wisdom, keywords) |
| `src/quant/insight.ts` | Loading overlay quotes + conversation insight derivation + built-in risk rules |
| `scripts/generate-insights.ts` | CLI command for manual regeneration: `bun scripts/generate-insights.ts` |
| `.ohquant/insights.json` | Cached output; auto-regenerated when notes source files are newer |

**Auto-regeneration:** On each `loadEntries()` call (first `getQuotes()` or `getInsightRules()` call), the system compares `mtime` of `notes/quant/funder.md` and `notes/quant/notes.md` against `.ohquant/insights.json`. If the notes are newer, regeneration runs automatically. No manual script invocation needed.

**Thinking bar:** During agent `"thinking"` or `"running tool"` activity with conversation content, a reserved bottom line shows: `⠋ "quote" — Author` cycling every 5s with ora spinner frames every 80ms.

**Loading overlay:** When conversation is empty and agent is starting, replaces the conversation area with a centered display of spinner + staircase animation + multi-line investment quote (Chinese + English + author).

**Fallback:** When `.ohquant/insights.json` is missing or empty, 16 hardcoded quant tips in `fallbackQuotes()` serve as the default set.
