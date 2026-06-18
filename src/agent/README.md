# Agent Module

This directory contains the WhyJ Quant agent adapter and the minimal pi harness subset it needs.

## Layout

```text
src/agent/
  src/
    session.ts      WhyJ Quant facade over pi AgentHarness
    dispatch.ts     prompt / steer / followUp routing
    context.ts      system prompt and lightweight session-context injection
    skills.ts       local skill discovery
    pi/             minimal vendored pi harness/runtime subset
  test/
    *.test.ts       unit tests for the public agent adapter
```

## Public Entry Points

- `createAgent()` in `src/session.ts`
- `dispatchUserMessage()` and `isAgentTurnActive()` in `src/dispatch.ts`
- `buildSystemPrompt()` and `injectSessionContext()` in `src/context.ts`
- `discoverSkills()` in `src/skills.ts`

Other app layers should import only from these files. `src/pi/` is intentionally treated as an internal runtime dependency.

## Runtime Responsibilities

`session.ts` owns the app-facing agent session:

- creates `NodeExecutionEnv`
- opens JSONL session storage under `.ohquant/sessions/`
- wires `AgentHarness`
- registers WhyJ tools: data tools, quant tools, and bash
- mirrors harness state for the TUI (`isStreaming`, pending tools, messages, thinking text)
- exposes session navigation, compaction, resume, skill invocation, and context usage

`dispatch.ts` decides how user input enters an active agent turn:

- idle agent: `prompt()`
- streaming without pending tools: `followUp()`
- streaming with pending tools: `steer()`

`context.ts` builds the quant-specific system prompt and injects lightweight symbol context.

`skills.ts` discovers local skill files from project and user directories.

## Vendored pi Subset

`src/pi/` keeps only the code required by the current adapter:

- `harness/agent-harness.ts`
- `agent-loop.ts`
- `types.ts`
- JSONL session storage
- compaction and branch summarization
- skill/system-prompt helpers
- shell-output utilities for the bash tool
- pi-ai model/provider glue used by `@earendil-works/pi-ai`

Removed from the local subset:

- legacy standalone `Agent` class
- proxy utilities
- in-memory session repository

Do not re-add broad `export *` barrels unless a caller needs the symbol. Keep `src/pi/index.ts` as a narrow compatibility surface.

## Test Boundary

Agent tests live in `src/agent/test`, mirroring `src/tui/test`.

Primary verification:

```bash
bun test src/agent/test
bun test src/app-runtime.test.ts src/cli/handlers/system.test.ts src/cli/handlers/skill.test.ts
bun run typecheck
```
