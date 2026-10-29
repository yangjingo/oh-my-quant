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

- define `.ohquant/` directory layout through runtime resolver functions
- manage settings CRUD (load, save, normalize, migrate from legacy config)
- manage watchlist CRUD
- canonicalize env keys into the `WHYJ_QUANT_*` prefix system
- cache and serve market bar data under `.ohquant/data/{source}/{symbol}/`
- list agent session transcripts and compute context-usage summaries
- atomically commit version-checked session bytes through `SessionFilePort`
- save versioned Workbench presentation checkpoints with integrity and compare-and-swap checks
- persist benchmark comparison artifacts and benchmark result dashboards
- retain checksummed report revisions and repair their HTML views without regeneration
- manage Overview Portfolio symbol list (panel-portfolio.json)
- discover legacy portfolio files only for explicit `/portfolio` migration/selection flows
- publish file events (READ/WRITE/MKDIR/DELETE) for TUI visualization

## Internal module split

| File | Responsibility |
|------|----------------|
| `src/dirs.ts` | runtime path resolvers + `ensureDirs()`; no import-time path constants |
| `src/settings.ts` | `loadSettings()`, `saveSettings()`, `migrateOldConfig()`, normalization |
| `src/pi-config.ts` | explicit read-only snapshots of Pi models/auth/settings files; bounded JSON, safe errors and revision hashing |
| `src/model-auth.ts` | private OAuth login generations, atomic rotation and asynchronous heartbeat locks shared by refresh/logout |
| `src/watchlist.ts` | `loadWatchlist()`, `saveWatchlist()`, Composer autocomplete symbol list |
| `src/env-keys.ts` | `WHYJ_QUANT_*` alias registry, `readWhyjEnvValue()`, `canonicalizeWhyjEnv()` |
| `src/fs-events.ts` | publish-subscribe file event bus for TUI file-activity visualization |
| `src/policy.ts` | storage class definitions (durable/cache/artifact/forbidden), portfolio guard |
| `src/bars.ts` | async/cancellable daily cache and archive requests, immutable revisions, synchronous exact `loadDataset()`, and bar/meta facades |
| `src/atomic-file.ts` | sync preference writes plus async daily-bar temporary files, fsync/rename, process writer locks and cancellable lock waits |
| `src/durable-json.ts` | settings/portfolio content revisions, conflict detection, safe JSON errors and atomic commits |
| `src/sessions.ts` | `listStoredSessions()` — JSONL parsing, branch reconstruction, context-usage estimation |
| `src/session-file.ts` | `LocalSessionFile` — byte revisions, append-only commits, process locks and checked deletion |
| `src/comparison.ts` | benchmark comparison artifact persistence under `.ohquant/benchmark/comparisons/` |
| `src/benchmark-results.ts` | benchmark dashboard result persistence under `.ohquant/benchmark/results/` |
| `src/alpha-runs.ts` | immutable UUID alpha runs, integrity checks and history listing; runtime verifies receipts and original datasets |
| `src/artifacts.ts` | atomic report heads, immutable revisions, legacy migration and HTML materialization |
| `src/insights.ts` | insight cache persistence under `.ohquant/insights.json` |
| `src/panel-portfolio.ts` | Overview Portfolio symbol list CRUD + group management |
| `src/local-portfolios.ts` | legacy `.ohquant/portfolio/holdings*.json` discovery (migration only) |
| `src/portfolio.ts` | portfolio facade: deprecated stubs + panel-portfolio delegation + sync helpers |

## Storage classes

| Class | Paths | Rule |
|-------|-------|------|
| **durable** | `settings.json`, `watchlist.json`, `panel-portfolio.json` | User-authored preferences. Never cache, never delete. |
| **private credentials** | `model-auth/{UUID}.json` | Plaintext OAuth generations; never cache or publish. Explicit logout deletes the selected generation. |
| **cache** | `data/{source}/{symbol}/snapshot.json`, `cache/` | Recomputable/refetchable public market data. Safe to replace. |
| **research data** | `data/{source}/{symbol}/revisions/` | Immutable public observations pinned by DatasetRef; no automatic pruning. Missing revisions fail explicitly. |
| **artifact** | `sessions/`, `benchmark/comparisons/`, `benchmark/results/`, `alpha/runs/`, `artifacts/` | Explicit research outputs. Report revisions are retained; missing source sessions hide listings without deleting evidence. |
| **forbidden** | `portfolio/` | Holdings, NAV, allocations. Default flows never read this path; explicit migration/selection commands may inspect legacy files to populate `panel-portfolio.json`. |

Full policy: [`docs/agent-runtime/ohquant-storage-policy.md`](../../docs/agent-runtime/storage.md).

Daily snapshots retain merged history, while `meta.fetchedDates` identifies the normalized rows in the latest successful response. `loadCachedBars()` uses only that response's dates for both fresh reuse and stale fallback; it never fills missing dates from older pulls. Freshness also requires a covered request window and age under five minutes. Older snapshots without response membership remain readable but stale. `loadBars()` explicitly reads accumulated history without a freshness guarantee; `loadDataset()` continues to resolve immutable versions. Membership is validated and hashed with the snapshot. See the [response consistency tests](./test/bars.test.ts).

Ordinary source requests use async `readFile`/`readdir`, async proper-lockfile acquisition, and async durable temporary-file writes. One request signal reaches cache, historical scans, settings snapshots, credential snapshots and save boundaries. `loadDataset()` remains synchronous because it resolves an already-fixed local revision outside provider refresh; configuration editors retain their short synchronous compare-and-swap writes.

OAuth uses a separate asynchronous heartbeat lease while Pi exchanges a token. Do not put network operations under the short synchronous settings/session locks. Login/logout coordination is implemented in [Model OAuth](../runtime/models/model-oauth.ts).

Settings and portfolio drafts carry an in-memory `revision`. Call `loadSettings()` / `loadPanelPortfolio()` before replacing an existing file, preserve the revision when cloning, and retain the draft if saving fails. A successful save updates the passed object's revision; persisted JSON excludes it. `ESTORAGECONFLICT` requires a fresh read, `ELOCKED` can be retried, and `ESTORAGEFORMAT` requires file repair. Never turn these failures into an unconditional overwrite. `updatePanelPortfolio()` applies a synchronous local edit under one lock; callbacks must not perform network I/O or asynchronous work. Corrupt durable files are preserved, not silently reset.

Reports use an atomic `{id}.report.json` head containing HTML/meta/provenance. Every committed revision also lives at `.revisions/{id}/{revision}/report.json`; the neighboring `{id}.html` is a repairable view. Use `artifactReference(meta)` for selection, `listArtifactVersions(id)` for committed history, and `materializeArtifact(ref)` before opening a saved version. A damaged head never falls back to legacy HTML/sidecar files. Legacy reports are archived on their first new save. Listing never deletes reports; explicit `deleteArtifact(id)` removes the head and legacy files but keeps immutable revisions addressable. No automatic archive garbage collection is implemented.

## Import rules

`LocalSessionFile` implements the shared `src/types/session-file.ts` port. It verifies the exact byte revision under a writer lock and atomically replaces the complete transcript, preserving JSONL v3's logical append-only history. Session tree parsing, active-leaf transactions and fork construction remain in the agent layer. Stale writers must reopen; they cannot silently merge stale research context. `listStoredSessions()` excludes damaged/cyclic/truncated trees without rewriting them. Process crash and eight-writer tests live in `session-process.test.ts`; large synthetic transcript timings can be measured with `bun run src/storage/dev/measure-session-storage.ts`.

1. External callers import from `src/storage/index.ts` (the barrel).
2. Tests may import deep paths (`src/storage/src/*.ts`) when targeting a single module directly.
3. Storage files do not import from external module barrels — they import specific source files.
4. File I/O always goes through storage; TUI renderers and CLI handlers do not call `fs` directly.
5. Callers use resolver functions or higher-level APIs; `storage/index.ts` does not expose import-time path constants.

The barrel export is a compatibility boundary, not a convenience-only layer. Shared helpers such as `readWhyjEnvValue()` must remain importable from `src/storage/index.ts`, and regressions should be covered by `src/storage/test/`.

## Cross-module dependencies

- `sessions.ts` reads JSONL/legacy transcript files through plain storage-local summary parsing. It does not import agent/pi session primitives.
- `bars.ts`, `comparison.ts`, `panel-portfolio.ts`, and `local-portfolios.ts` depend only on shared DTOs from `src/types` (`Bar`, `SymbolMeta`, `HoldingsFile`, `FundHolding`, `GroupComparisonResult`).

## Test rules

- put module tests in `src/storage/test/`
- set `process.env.OHQUANT_DIR` to a test-only `.ohquant-test-*` path in `beforeEach`
- clean up with `rmSync` in `afterEach`; restore `OHQUANT_DIR` env
- use isolated temporary roots for real filesystem/session fixtures; mock external providers and run live APIs separately
- when a release changes the settings schema or env-key handling, add a normalization round-trip test

```bash
bun test src/storage/test
bun test tests/app/app-runtime.test.ts src/cli/test/handlers/system.test.ts src/cli/test/handlers/workflow.test.ts
bun run typecheck
```

## Related docs

- [OhQuant Storage Policy](../../docs/agent-runtime/storage.md)
- [Quant Harness](../../docs/quant-harness/README.md)
- [Source Data Providers](../../docs/quant-harness/source-data-providers.md)
- [Quant UI/UX](../../docs/quant-harness/uiux.md#uiux)
