# Agent Loop Context Assembly

Status: current as of June 18, 2026.

Recommended reading order:

- Read `docs/agent-system-spec.md` first for the full architecture and ownership boundaries.
- Read `docs/pi-agent-loop-harness.md` second for run-loop and harness mechanics.
- Read this file third when you specifically need the exact model-input vs UI-text assembly path.

This document describes the real context assembly path in the current WhyJ Quant agent loop.

## High-Level Path

User input path:

`src/app-runtime.ts`
-> `dispatchUserMessage()`
-> `QuantAgentSession.prompt()` or `followUp()` or `steer()`
-> prompt/context assembly in `src/agent/src/context.ts`
-> pi `AgentHarness`
-> tool calls / skill calls / assistant generation
-> runtime events back to the TUI

There are two distinct views of one turn:

1. model-facing context
2. user-facing TUI text

They are related but not byte-identical.

## Model-Facing Context Path

### 1. Raw user input enters from `AppRuntime`

File: [src/app-runtime.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/app-runtime.ts)

`runAgentPrompt(input)` forwards raw user input through:

`dispatchUserMessage(this.agent, input, input)`

The first `input` is model-facing text. The second is `displayText`, which preserves the clean user-visible copy.

### 2. Dispatch chooses turn mode

File: [src/agent/src/dispatch.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/dispatch.ts)

- idle -> `prompt()`
- streaming without pending tools -> `followUp()`
- streaming with pending tools -> `steer()`

All three routes now use the same turn-context injection logic inside `session.ts`.

### 3. Session owns turn injection

File: [src/agent/src/session.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/session.ts)

- `prompt()` -> `injectTurnContext(input, sessionCtx)`
- `followUp()` -> `injectTurnContext(extractMessageText(message), sessionCtx)`
- `steer()` -> `injectTurnContext(extractMessageText(message), sessionCtx)`
- `skill()` -> `injectSkillContext(name, additionalInstructions)`

This is the single source of truth for model-facing augmentation.

## Session Context Fields

File: [src/agent/src/context.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/context.ts)

`injectSessionContext()` appends a lightweight metadata block:

- `last_symbol`
- `last_market`
- `last_start`
- `last_end`
- `recent_tool_state`

### Meaning

- `last_symbol` / `last_market` help resolve follow-up references like “it”
- `recent_tool_state.tool` stores the latest tool family, such as `check_risk` or `show_dashboard`
- `recent_tool_state.result_shape` stores a more stable shape hint, such as:
  - `risk_metrics`
  - `backtest_metrics`
  - `dashboard_ranking`
  - `benchmark_score`
  - `factor_metrics`
  - `snapshot_kv`
  - `symbol_list`
  - `bars_summary`

`recent_tool_state.result_shape` is preferred over `recent_tool_state.tool` when recovering how a generic follow-up should stay structured.

The injected shape is now intentionally object-like instead of growing more flat fields:

```text
<!-- session context -->
last_symbol: 000300.SH
last_market: A
recent_tool_state:
  tool: show_dashboard
  result_shape: dashboard_ranking
```

## System Prompt Path

File: [src/agent/src/context.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/context.ts)

`buildSystemPrompt()` assembles:

1. `BASE_SYSTEM_PROMPT`
2. available cached data block
3. discovered skills block
4. optional extra text

The base prompt now includes:

- general output constraints
- a comparison-heavy structured-output preference
- a built-in tool-result preservation contract for:
  - `fetch_bars`
  - `search_symbols`
  - `fetch_snapshot`
  - `compute_factor`
  - `run_backtest`
  - `check_risk`
  - `score_benchmark`
  - `show_dashboard`

This keeps the model biased toward preserving important rows even when the user did not explicitly ask for a table.

## Turn-Level Render Guidance

File: [src/agent/src/context.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/context.ts)

`injectTurnContext()` does:

1. `injectSessionContext()`
2. conditional render guidance

The render guidance has two layers:

1. general structured-output rules
2. tool-family-specific rules

### When render guidance triggers

It triggers for explicit structured-output requests such as:

- `table`, `chart`, `compare`, `ranking`, `holdings`, `backtest`
- `表格`, `图表`, `比较`, `排行`, `持仓`, `回测`

It also triggers for generic follow-ups such as:

- `continue`
- `expand`
- `drill down`
- `继续`
- `展开讲一下`

but only when `recent_tool_state.tool` or `recent_tool_state.result_shape` is available.

### Why `recent_tool_state.result_shape` exists

If the user says only `继续`, the new turn may contain no tool keywords at all.

In that case:

- `recent_tool_state.tool=check_risk` is useful
- `recent_tool_state.result_shape=risk_metrics` is better

because the second value directly tells the prompt layer which row family to preserve.

## Tool-to-Shape Recovery Path

File: [src/agent/src/session.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/session.ts)

During tool lifecycle events:

- `tool_execution_start` stores:
  - `sessionCtx.recentToolState.toolName`
  - an initial `sessionCtx.recentToolState.resultShape`
- `tool_execution_end` stores:
  - final `sessionCtx.recentToolState.toolName`
  - final `sessionCtx.recentToolState.resultShape`

Current shape recovery is lightweight:

1. first inspect structured `result.details`
2. then map directly from tool name
3. then optionally refine from tool result text

Example mappings:

- `run_backtest` -> `backtest_metrics`
- `check_risk` -> `risk_metrics`
- `score_benchmark` -> `benchmark_score`
- `show_dashboard` -> `dashboard_ranking`
- `fetch_snapshot` -> `snapshot_kv`

## Compaction Context Design

`/compact` is not only a session-control slash command. In WhyJ Quant it is also part of the context design, because the output of compaction becomes future model-facing context.

Files:

- [src/cli/handlers/system.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/cli/handlers/system.ts)
- [src/agent/src/pi/harness/compaction/compaction.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/pi/harness/compaction/compaction.ts)
- [src/app-runtime.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/app-runtime.ts)
- [src/tui/src/render.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/tui/src/render.ts)

### Runtime path

The current `/compact` flow is:

`AppRuntime.submit("/compact ...")`
-> `compactHandler()`
-> `agent.waitForIdle()`
-> `agent.compact(customInstructions)`
-> pi harness `compact()`
-> append compaction entry to session tree
-> rebuild `agent.state.messages`
-> runtime syncs conversation from session state

Important boundary:

- `waitForIdle()` is required before `compact()`
- `compact()` is phase-owned by the harness, not by TUI state
- the resulting summary is persisted as a session-tree compaction entry, not just shown once in the UI

### Why this is a context-layer concern

Future turns do not re-read the old raw history once that history has been compacted.

Instead, `buildSessionContext()` reconstructs context using:

- retained recent messages after `firstKeptEntryId`
- the synthetic `compactionSummary` message generated from the compaction entry

So the quality of the compaction summary directly affects:

- what the model still remembers
- whether generic follow-ups like `继续` remain grounded
- whether quant output stays attached to the right symbols, date ranges, and strategy assumptions

### Quant-specific compaction requirements

WhyJ Quant now adds quant-aware instructions to the compaction summarization prompt. When a session involves quant research, the summary should preserve:

- symbols, benchmarks, universes, exchanges, and portfolio names
- date ranges, lookback windows, rebalance cadence, and timeframe assumptions
- factor definitions, signal rules, strategy parameters, and risk limits
- data providers, cache/local file paths, and any data-quality caveats
- validated findings, open hypotheses, and the metrics that matter for the next step
- output-shape preferences such as compact tables, rankings, and risk dashboards

This is intentionally stricter than generic coding-session compaction. The design goal is to preserve research state, not just implementation progress.

### `/compact` completion receipt

The slash-command receipt is also quant-aware now. On success it still shows:

- `first kept`
- `tokens before`

but it also extracts a compact research-state receipt from the generated summary:

- `scope`
- `dates/window`
- `params/risk`
- `open threads`

This receipt is not the authoritative context store. The authoritative store is still the compaction entry in the session tree. The receipt exists to let the user verify that the most important research state survived compaction.

### TUI visibility during compaction

The TUI now exposes compaction as an explicit activity, not just a silent slash command:

- runtime sets activity to `compacting` before the command runs
- if the agent is still finishing a turn, status first says that compaction is waiting for idle
- while compacting, the conversation panel uses the same ora-style spinner and animated gold banner treatment as `thinking`
- when the conversation is empty, the loading overlay copy changes from `WhyJ is thinking...` to `WhyJ is compacting...`

This matters because compaction can take long enough to feel broken if there is no visible progress, especially when the runtime is still draining the previous turn.

## Skill Path

File: [src/agent/src/context.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/context.ts)

`injectSkillContext()` appends a small structured-output contract to explicit skill runs.

For quant / trader / benchmark style skills, it explicitly reinforces:

- keep structured rows visible
- prefer compact plain-text tables or chart-style blocks
- preserve score rows, ranking rows, risk rows, and backtest metric rows

## User-Facing TUI Path

The TUI prefers clean display text instead of injected text.

Files:

- [src/agent/src/dispatch.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/dispatch.ts)
- [src/app-runtime.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/app-runtime.ts)

Relevant behavior:

- user turns carry `displayText`
- runtime prefers `displayText` when rendering queue/conversation text

So the model may see extra session context and render guidance, while the user still sees the original clean prompt.

## Queue Path

Queued follow-ups also flow through the same model-facing injection path when consumed later.

Runtime queue UI remains clean because it uses display text extraction, not injected text.

## Concrete Summary

### Normal user turn

`AppRuntime.submit()`
-> `runAgentPrompt(input)`
-> `dispatchUserMessage(agent, input, input)`
-> `session.prompt()/followUp()/steer()`
-> `injectTurnContext(rawInput, sessionCtx)`
-> optional session metadata block
-> optional structured render guidance block
-> `AgentHarness`

### Skill turn

`/skill:...`
-> `session.skill(name, extra)`
-> `injectSkillContext(name, extra)`
-> `AgentHarness.skill(...)`

### Generic follow-up after a tool result

previous tool ends
-> session stores `recent_tool_state.tool` and `recent_tool_state.result_shape`
-> user says `继续`
-> `injectTurnContext()` sees generic follow-up language
-> recovers the proper row family from `recent_tool_state.result_shape`
-> model stays aligned to the previous structured result

## Verification

Relevant tests:

- [src/agent/test/context.test.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/test/context.test.ts)
- [src/agent/test/session.test.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/test/session.test.ts)
