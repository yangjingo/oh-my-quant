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

## Fintech Color Plan

The next rendering increment should not use generic CLI red/green defaults. The target is a more institutional fintech terminal look:

- use restrained saturation for semantic red/green instead of neon terminal colors
- treat amber / cash gold as the primary accent family for selection, focus, headers, and key emphasis
- keep neutral text warm and slightly desaturated so the screen reads closer to a market terminal than a developer console

Recommended semantic palette:

- accent amber: Bloomberg-like amber for focus, selected state, active meters, and header motion
- cash gold: `#E8B339` for cash / liquidity / money-tone semantics when needed
- warning red: restrained red for negative / drawdown / breach / removal states
- warm neutrals: cream, muted taupe, charcoal separators, dim code gray

Important semantic note:

- color is not the only signal
- tables and figures must still read correctly in monochrome via labels, alignment, arrows, bar length, and explicit status words

## Rollout Plan

The rollout should stay incremental and text-native.

### Phase 1: Palette foundation

- centralize the terminal palette in `src/tui/src/styles.ts`
- align animated amber ranges in `src/tui/src/render.ts` with the same accent family
- update existing tests that pin exact color hex values

### Phase 2: Structured text coloring

- add one small helper for color-aware plain-text tables
- add one small helper for color-aware compact figures such as bar blocks or sparklines
- support cell-level semantic styling for:
  - headers
  - positive / negative values
  - selected or highlighted rows
  - secondary notes / muted metadata

### Phase 3: `/compact` as the first mockup

Use `/compact` as the pilot surface before wider rollout.

Why `/compact` first:

- it already returns a dense summary with stable fields
- it already combines metrics and quant context
- it is a local slash-command path, so formatting can be iterated without disturbing the agent generation flow

The `/compact` mockup should combine:

- one aligned metric table
- one `quant context kept` table
- one small retention figure or meter block

Color plan for the `/compact` mockup:

- metric headers and section titles -> amber
- retained / healthy rows -> restrained green
- missing / risk / drop rows -> restrained red
- secondary explanation and notes -> muted neutral

### Phase 4: Expand to agent outputs

After `/compact` feels right, apply the same text helpers to:

- benchmark leaderboards
- holdings comparisons
- backtest metric summaries
- risk dashboards

Keep the same semantic palette and avoid per-feature one-off color systems.

## Next Step If Needed

If prompt shaping is not enough, the next increment should still stay incremental:

1. Implement the fintech palette foundation in `src/tui/src/styles.ts` and `src/tui/src/render.ts`.
2. Use `/compact` to prototype one colored structured table and one colored compact figure.
3. Reuse the same helpers for leaderboard, holdings, and risk output.

Do not jump straight to a separate renderer package unless the current TUI text path proves insufficient.
