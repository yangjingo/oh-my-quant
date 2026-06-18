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

`injectSessionContext()` can append these fields:

- `last_symbol`
- `last_market`
- `last_start`
- `last_end`
- `last_tool`
- `last_result_shape`

### Meaning

- `last_symbol` / `last_market` help resolve follow-up references like “it”
- `last_tool` stores the latest tool family, such as `check_risk` or `show_dashboard`
- `last_result_shape` stores a more stable shape hint, such as:
  - `risk_metrics`
  - `backtest_metrics`
  - `dashboard_ranking`
  - `benchmark_score`
  - `factor_metrics`
  - `snapshot_kv`
  - `symbol_list`
  - `bars_summary`

`last_result_shape` is preferred over `last_tool` when recovering how a generic follow-up should stay structured.

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

but only when `last_tool` or `last_result_shape` is available.

### Why `last_result_shape` exists

If the user says only `继续`, the new turn may contain no tool keywords at all.

In that case:

- `last_tool=check_risk` is useful
- `last_result_shape=risk_metrics` is better

because the second value directly tells the prompt layer which row family to preserve.

## Tool-to-Shape Recovery Path

File: [src/agent/src/session.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/session.ts)

During tool lifecycle events:

- `tool_execution_start` stores:
  - `sessionCtx.lastToolName`
  - an initial `sessionCtx.lastResultShape`
- `tool_execution_end` stores:
  - final `sessionCtx.lastToolName`
  - final `sessionCtx.lastResultShape`

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
-> session stores `last_tool` and `last_result_shape`
-> user says `继续`
-> `injectTurnContext()` sees generic follow-up language
-> recovers the proper row family from `last_result_shape`
-> model stays aligned to the previous structured result

## Verification

Relevant tests:

- [src/agent/test/context.test.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/test/context.test.ts)
- [src/agent/test/session.test.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/test/session.test.ts)
