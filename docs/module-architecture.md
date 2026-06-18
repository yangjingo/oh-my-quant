# WhyJ Quant Module Architecture

This document is the maintainer-facing map of the codebase. It explains which module owns what, where data is allowed to flow, and which entrypoints other modules should use.

## Top-level layout

| Path | Role | Notes |
|------|------|------|
| `src/cli/` | slash command parsing, local command handlers, JSON one-shot mode | Local UI/session control only |
| `src/tui/` | terminal rendering, panels, input, layout, display widgets | Consumes runtime events; should not own business state |
| `src/app-runtime.ts` | bridge from TUI/CLI into agent session and local panels | Orchestrates UI state refresh |
| `src/agent/` | vendored pi harness wrapper, runtime context, session facade | Owns prompt loop, compaction, resume |
| `src/tools/` | built-in agent tools | Data tools, quant tools, shell tool, registry |
| `src/source/` | market data provider adapters and fallback orchestration | Public entrypoint is `src/source/index.ts` |
| `src/storage/` | `.ohquant` persistence, cache, session summaries, portfolio discovery | Single place for local durable state rules |
| `src/types/` | shared domain contracts | Keep provider-independent |
| `docs/` | design, architecture, operator docs | Keep implementation notes here, not buried in code comments |

## Boundary rules

1. `tui` renders state; it does not decide session truth.
2. `cli` handles deterministic slash commands; natural language goes to agent.
3. `agent` owns harness lifecycle, `compact`, `resume`, and session reconstruction.
4. `tools` are the only agent-callable execution surface.
5. `source` fetches and normalizes provider data; it does not decide portfolio semantics.
6. `storage` owns filesystem layout and dedupe/cache rules; callers should not hand-roll `.ohquant` paths.

## Module contracts

### `src/source/`

- Responsibility:
  - provider-specific market data fetch
  - source fallback order
  - cache-aware live bar refresh
  - source attribution text for Overview/TUI
- Public import:
  - `src/source/index.ts`
- Internal split:
  - `src/source/src/` implementation
  - `src/source/tests/` module tests

### `src/storage/`

- Responsibility:
  - settings, bars cache, comparison artifacts, sessions, local portfolio discovery
  - local portfolio dedupe and condensed summary generation
  - `.ohquant` policy enforcement
- Public import:
  - `src/storage/index.ts` or the specific storage module when the dependency is intentionally narrow

### `src/tools/`

- Responsibility:
  - expose stable tool contracts to the agent
  - translate tool IO into domain/storage/source calls
  - surface user-facing errors cleanly
- Rule:
  - new built-in tools should register through the registry path documented in `docs/builtin-tool-registry.md`

### `src/agent/`

- Responsibility:
  - harness phase, run loop, session tree, compaction, resume
  - system prompt/context assembly
- Rule:
  - UI should call the facade, not mutate agent state directly

## Recommended dependency direction

```text
cli/tui
  -> app-runtime
    -> agent
    -> storage
    -> tools

tools
  -> source
  -> storage
  -> types

source
  -> storage
  -> types

storage
  -> types
```

Avoid reverse dependencies from `storage` into `source`, or from `tui` directly into provider adapters.

## Testing layout

Keep tests near the module they validate, but grouped by module:

- `src/source/tests/`
- `src/storage/*.test.ts`
- `src/tui/test/`
- `src/agent/test/`

For provider bugs, add a regression test in the module test folder before or alongside the fix.

## Current docs

- [CLI Design & Reference](./interactive-cli-design.md)
- [Agent System Spec](./agent-system-spec.md)
- [pi Agent Loop 与 Harness](./pi-agent-loop-harness.md)
- [OhQuant Storage Policy](./ohquant-storage-policy.md)
- [Built-in Tool Registry](./builtin-tool-registry.md)
