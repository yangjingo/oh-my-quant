# TUI Table/Chart Render Guidance

Status: implemented for the current agent flow on June 18, 2026.

## Goal

When the user asks for comparison-heavy output such as holdings, rankings, trade logs, signals, or backtest summaries, the agent should keep the structured result visible instead of collapsing it into long prose.

This repository does not ship a separate `quant-render` package. The current solution is intentionally lightweight:

1. Keep the existing TUI message pipeline unchanged.
2. Inject a small render contract into agent prompts only when the request is likely to produce tables or charts.
3. Inject the same contract when invoking skills, so skill-driven workflows keep structured output visible too.

## Current Architecture

The live path in this repo is:

`AppRuntime.submit()`
-> `dispatchUserMessage()`
-> `QuantAgentSession.prompt()/followUp()/steer()/skill()`
-> prompt injection in `src/agent/src/context.ts`
-> pi harness
-> tool / skill execution
-> textual results rendered back into the TUI conversation panel

The TUI still renders plain text. This change does not add a new renderer widget layer. It improves output quality by constraining the agent before it decides how to format the answer.

## Why This Approach

The earlier design draft assumed:

- a standalone renderer package
- artifact schemas
- renderer themes
- MCP render tools

That design is heavier than the current codebase needs. The real code today already has:

- a stable agent session wrapper
- a single prompt assembly layer
- explicit skill invocation
- a TUI that already displays multi-line structured text well

Given those constraints, the cheapest high-leverage fix is prompt shaping, not a renderer subsystem.

## Implemented Rules

The base system prompt now includes a compact structured-output contract:

- for rankings, holdings, trades, signals, and other comparison-heavy output, prefer compact plain-text tables
- when a tool or skill already produced structured rows, preserve them
- keep commentary short
- do not hand-write markdown tables unless the user explicitly asks for markdown

It also now includes a built-in tool-result preservation contract, so the model has a default rule for which rows to keep visible after common quant/data tools complete:

- `fetch_bars`, `search_symbols`, `fetch_snapshot`
- `compute_factor`, `run_backtest`, `check_risk`
- `score_benchmark`, `show_dashboard`

In addition, `injectTurnContext()` adds a render hint only for likely structured-output requests, based on keywords such as:

- `table`, `chart`, `compare`, `ranking`, `holdings`, `trade log`, `backtest`
- `表格`, `图表`, `对比`, `比较`, `排行`, `持仓`, `交易记录`, `回测`

This keeps the common path light. Normal chat-style requests do not receive extra guidance.

The injected hint is two-stage:

1. a general structured-output reminder
2. optional tool-family-specific hints for:
   - backtest
   - risk
   - benchmark / dashboard
   - factor
   - symbol search
   - snapshot

That second stage is still textual only. It does not add a renderer layer; it only nudges the model to preserve the rows those tools naturally produce.

The hint can now also fall back to the latest tool family through session context. This matters for turns like:

- `继续`
- `展开讲一下`
- `drill down`

If the previous tool was `check_risk`, `run_backtest`, `score_benchmark`, or `show_dashboard`, the follow-up turn can still recover the right structured row preference without the user repeating the tool name.

The recovery key is now two-part:

- `recent_tool_state`

`recent_tool_state.result_shape` is the more stable hint because it stores the row family directly, such as `risk_metrics`, `backtest_metrics`, or `dashboard_ranking`.

## Injection Points

### 1. User turn injection

File: [src/agent/src/context.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/context.ts)

- `injectTurnContext(input, ctx)` appends session context first
- if the request looks comparison-heavy, it appends a small `render guidance` block

### 2. Session-level enforcement

File: [src/agent/src/session.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/session.ts)

The session facade applies the same policy across:

- `prompt()`
- `followUp()`
- `steer()`
- `skill()`

This is important because the prompt contract must survive queued follow-ups and explicit skill invocation, not only the first user turn.

### 3. App runtime simplification

File: [src/app-runtime.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/app-runtime.ts)

`AppRuntime` no longer pre-injects prompt text. Raw user input is forwarded, and the session layer owns all prompt augmentation. This avoids duplicated or drifting injection logic.

## Resulting Behavior

### User asks for a comparison

Example:

`compare top 5 holdings and show a table`

The session sends the raw request plus a short render hint that says:

- prefer a compact aligned plain-text table
- keep commentary to at most 3 short lines around it
- do not flatten the result into bullets

### User triggers a skill

Example:

`/skill:whyj-quant focus on benchmark drift`

The session passes the original instruction plus a small skill-side addendum:

- keep structured rows visible
- prefer compact plain-text tables or chart-style blocks
- keep interpretation short

## What This Does Not Do

This change does not:

- add new TUI widgets for tables or charts
- add renderer MCP tools
- add artifact schemas
- convert tool JSON into dedicated visual components

Those can still be added later if the TUI needs richer rendering. The current change is scoped to output discipline for the existing terminal workflow.

## Tests

Covered by:

- [src/agent/test/context.test.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/test/context.test.ts)
  - structured-output requests receive render guidance
  - ordinary chat requests do not
  - skill invocation receives compact render guidance
- [src/agent/test/session.test.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/test/session.test.ts)
  - `prompt()`, `followUp()`, and `skill()` all pass through the injected guidance

## Next Step If Needed

If prompt shaping is not enough, the next increment should still stay incremental:

1. Add one structured text helper for slash-command tables.
2. Add one chart-style helper for compact bar or sparkline output.
3. Reuse the same prompt contract so the agent knows when to ask for those helpers.

Do not jump straight to a separate renderer package unless the current TUI text path proves insufficient.
