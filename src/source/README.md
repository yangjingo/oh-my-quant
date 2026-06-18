# Source Module

`src/source/` owns market data provider access for WhyJ Quant.

## Layout

- `src/source/index.ts`
  - public entrypoint for the rest of the app
- `src/source/src/`
  - provider adapters and cross-provider orchestration
- `src/source/tests/`
  - regression and module behavior tests

## Responsibilities

- normalize configured source selection
- fetch bars from AKShare, Tushare, LLMQuant, and Financial Datasets
- fall back across providers when one source is empty, stale, or unavailable
- merge provider results with local cache behavior
- expose source attribution metadata for TUI Overview

## Internal module split

| File | Responsibility |
|------|----------------|
| `src/source/src/sources.ts` | provider selection, fallback order, cache-aware live fetch |
| `src/source/src/akshare.ts` | A-share/index fetch via AKShare |
| `src/source/src/tushare.ts` | Tushare-backed fetch |
| `src/source/src/llmquant.ts` | LLMQuant-backed market fetch |
| `src/source/src/financial-datasets.ts` | Financial Datasets-backed fetch |
| `src/source/src/http.ts` | shared HTTP helpers and transport defaults |

## Import rules

1. External callers import from `src/source/index.ts`.
2. Tests may import deep module paths when they are targeting one adapter directly.
3. Cross-provider policy belongs in `sources.ts`, not in individual adapters.
4. Provider-specific parsing or transport logic stays in the adapter file.

## Test rules

- put provider parsing tests in `src/source/tests/`
- when a live-source bug causes Overview to show empty quotes or wrong source labels, add a regression test in `sources.test.ts`
- keep tests deterministic; mock provider adapters instead of hitting network paths

## Related docs

- [Module Architecture](../../docs/module-architecture.md)
- [Source Providers](../../docs/source-data-providers.md)
- [OhQuant Storage Policy](../../docs/ohquant-storage-policy.md)
