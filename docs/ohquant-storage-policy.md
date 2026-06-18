# OhQuant Storage Policy

ohmyquant follows the same local filesystem split used by Codex and pi-style agents: durable user settings, recomputable cache, explicit artifacts, and forbidden private state are separate.

## Directory Classes

| Path | Class | Cacheable | Rule |
|------|-------|-----------|------|
| `.ohquant/settings.json` | durable | No | User configuration, model preferences, backend toggles, and redacted auth references. |
| `.ohquant/watchlist.json` | durable | No | Composer autocomplete symbol list. |
| `.ohquant/panel-portfolio.json` | durable | No | Overview Portfolio symbol list (code/name only). Live quotes fetched on refresh. |
| `.ohquant/data/{source}/{symbol}/` | cache | Yes | Public or provider-sourced market bars and metadata. Safe to refetch and replace. |
| `.ohquant/cache/` | cache | Yes | Short-lived derived artifacts with TTL semantics. |
| `.ohquant/benchmark/results/` | artifact | No | Explicit strategy scoring outputs produced by the built-in `Quant.Benchmark` tool. |
| `.ohquant/sessions/` | artifact | No | Human-readable session transcripts. |
| `.ohquant/portfolio/` | forbidden | No | Holdings, NAV snapshots, allocations, and personal positions must not be cached or inferred from local files. |

## Cacheability Rule

Cache only data that can be safely recomputed or refetched without encoding a user's private financial position:

- Cacheable: market bars, public metadata, factor inputs, temporary backend responses, derived benchmark intermediates.
- Durable but not cache: settings and watchlists, because they are user-authored preferences.
- Artifact but not cache: sessions and benchmark result files, because they are explicit outputs.
- Forbidden: portfolio holdings, NAV history, allocations, trade history, position size, cost basis, and any inferred personal exposure.

## Portfolio Rule

Portfolio data is live-only. Commands may ask for it, receive it from a live provider, or use it in-memory for the current request, but they must not write it under `.ohquant/` and must not read legacy `.ohquant/portfolio/` files.

Existing local `.ohquant/portfolio/` files are treated as legacy user files. The app does not delete them automatically and no longer reads or writes them.

## TUI Visibility

All `.ohquant` local filesystem activity should flow through storage, `src/cli/`, or agent tools and emit a file event. READ/WRITE visualization belongs in the agent/tool-call conversation stream, not the right sidebar:

- `READ`: settings, watchlist autocomplete, market cache, benchmark result, session reads.
- `WRITE`: settings, watchlist, market cache, benchmark result, session transcript writes.
- `MKDIR`: local state directories created by storage initialization or cache writes.
- `DELETE`: legacy migration cleanup.

TUI renderers should not call `fs` directly. The Overview dock is refreshed by `AppRuntime`: it reads `.ohquant/panel-portfolio.json` for Portfolio symbols and fetches live quotes through data providers. `.ohquant/watchlist.json` is Composer autocomplete only.
