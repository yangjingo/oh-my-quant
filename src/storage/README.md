# Storage Module

`src/storage/` owns all local filesystem I/O under `.ohquant/` for WhyJ Quant.

## Layout

- `src/storage/index.ts`
  - barrel re-export — public entrypoint for the rest of the app
- `src/storage/src/`
  - per-concern implementation files
- `src/storage/test/`
  - module behavior and regression tests

## Responsibilities

- define `.ohquant/` directory layout and path constants
- manage settings CRUD (load, save, normalize, migrate from legacy config)
- manage watchlist CRUD
- canonicalize env keys into the `WHYJ_QUANT_*` prefix system
- cache and serve market bar data under `.ohquant/data/{source}/{symbol}/`
- list agent session transcripts and compute context-usage summaries
- persist benchmark comparison artifacts
- manage Overview Portfolio symbol list (panel-portfolio.json)
- discover legacy portfolio files for one-shot migration
- publish file events (READ/WRITE/MKDIR/DELETE) for TUI visualization

## Internal module split

| File | Responsibility |
|------|----------------|
| `src/dirs.ts` | directory path constants + `ensureDirs()` + `resolveOhquantDir()` |
| `src/settings.ts` | `loadSettings()`, `saveSettings()`, `migrateOldConfig()`, normalization |
| `src/watchlist.ts` | `loadWatchlist()`, `saveWatchlist()`, Composer autocomplete symbol list |
| `src/env-keys.ts` | `WHYJ_QUANT_*` alias registry, `readWhyjEnvValue()`, `canonicalizeWhyjEnv()` |
| `src/fs-events.ts` | publish-subscribe file event bus for TUI file-activity visualization |
| `src/policy.ts` | storage class definitions (durable/cache/artifact/forbidden), portfolio guard |
| `src/bars.ts` | market bar cache: `loadBars()`, `saveBars()`, `isCacheFresh()`, `getMeta()` |
| `src/sessions.ts` | `listStoredSessions()` — JSONL parsing, branch reconstruction, context-usage estimation |
| `src/comparison.ts` | benchmark comparison artifact persistence under `.ohquant/benchmark/comparisons/` |
| `src/panel-portfolio.ts` | Overview Portfolio symbol list CRUD + group management |
| `src/local-portfolios.ts` | legacy `.ohquant/portfolio/holdings*.json` discovery (migration only) |
| `src/portfolio.ts` | portfolio facade: deprecated stubs + panel-portfolio delegation + sync helpers |

## Storage classes

| Class | Paths | Rule |
|-------|-------|------|
| **durable** | `settings.json`, `watchlist.json`, `panel-portfolio.json` | User-authored preferences. Never cache, never delete. |
| **cache** | `data/{source}/{symbol}/`, `cache/` | Recomputable/refetchable public market data. Safe to replace. |
| **artifact** | `sessions/`, `benchmark/comparisons/`, `benchmark/results/` | Explicit command outputs. Not cache, not durable settings. |
| **forbidden** | `portfolio/` | Holdings, NAV, allocations. Live-only, never read from disk. |

Full policy: [`docs/ohquant-storage-policy.md`](../../docs/ohquant-storage-policy.md).

## Import rules

1. External callers import from `src/storage/index.ts` (the barrel).
2. Tests may import deep paths (`src/storage/src/*.ts`) when targeting a single module directly.
3. Storage files do not import from external module barrels — they import specific source files.
4. File I/O always goes through storage; TUI renderers and CLI handlers do not call `fs` directly.

The barrel export is a compatibility boundary, not a convenience-only layer. Shared helpers such as `readWhyjEnvValue()` must remain importable from `src/storage/index.ts`, and regressions should be covered by `src/storage/test/`.

## Cross-module dependencies

- `sessions.ts` depends on `agent/src/pi/` for session tree model (`SessionTreeEntry`, `buildSessionContext`, `estimateContextTokens`) and model catalog (`getModels`). This is a deliberate one-way dependency: storage reads session files and needs agent-level primitives to compute context-usage summaries.
- `bars.ts`, `comparison.ts`, `panel-portfolio.ts`, and `local-portfolios.ts` depend on `types/` for shared data types (`Bar`, `SymbolMeta`, `HoldingsFile`, `FundHolding`, `GroupComparisonResult`).

## Test rules

- put module tests in `src/storage/test/`
- set `process.env.OHQUANT_DIR` to a test-only `.ohquant-test-*` path in `beforeEach`
- clean up with `rmSync` in `afterEach`; restore `OHQUANT_DIR` env
- mock external providers instead of writing real session files or hitting live APIs
- when a release changes the settings schema or env-key handling, add a normalization round-trip test

```bash
bun test src/storage/test
bun test src/app-runtime.test.ts src/cli/handlers/system.test.ts src/cli/handlers/workflow.test.ts
bun run typecheck
```

## Related docs

- [OhQuant Storage Policy](../../docs/ohquant-storage-policy.md)
- [Agent System Spec](../../docs/agent-system-spec.md)
- [Source Data Providers](../../docs/source-data-providers.md)
- [Interactive CLI Design](../../docs/interactive-cli-design.md)
