# WhyJ Quant Source Providers

This document describes the market data sources used by WhyJ Quant: their official API/doc entrypoints, what the local adapter actually calls, the runtime priority order, and how those adapters are injected into the agent loop.

## 1. Provider matrix

| Provider | Official site / docs | WhyJ Quant adapter file | Markets | Auth |
|------|------|------|------|------|
| AKShare | https://akshare.akfamily.xyz/ | `src/source/src/akshare.ts` | A-share, index, fund | none |
| Tushare | https://tushare.pro/document/2 | `src/source/src/tushare.ts` | A-share | `TUSHARE_TOKEN` |
| Financial Datasets | https://docs.financialdatasets.ai/introduction | `src/source/src/financial-datasets.ts` | US equities | `FINANCIAL_DATASETS_KEY` |
| LLMQuant Data | `LLMQUANT_BASE_URL` / `https://api.llmquantdata.com` | `src/source/src/llmquant.ts` | US, HK | `LLMQUANT_API_KEY` |

Note: LLMQuant Data is wired as a direct HTTP adapter in this repo. At the time of writing, the repository relies on the configured API base URL rather than a checked-in public docs link.

## 2. Official interfaces and local usage

### AKShare

- Official docs:
  - homepage: https://akshare.akfamily.xyz/
- WhyJ Quant calls:
  - `ak.stock_zh_index_daily(...)`
  - `ak.fund_open_fund_info_em(..., indicator="单位净值走势")`
  - `ak.stock_zh_a_hist(..., period="daily", adjust="qfq")`
- Local role:
  - primary A-share / index / fund daily bars
  - zero-key local fallback for China market data
- Local wrapper shape:
  - Node spawns Python and executes the AKShare snippet
  - adapter normalizes result to internal `Bar[]`

### Tushare

- Official docs:
  - entry: https://tushare.pro/document/2
- WhyJ Quant calls:
  - `daily`
  - `stock_basic`
  - `daily_basic`
- Local role:
  - A-share fallback when AKShare returns empty or errors
  - symbol search for `/search`-style lookups
  - compact trading snapshot for A-share symbols
- Local wrapper shape:
  - POST `https://api.tushare.pro`
  - body includes `api_name`, `token`, `params`, `fields`

### Financial Datasets

- Official docs:
  - intro: https://docs.financialdatasets.ai/introduction
  - API family includes Stock Prices, Company, and Financial Metrics
- WhyJ Quant calls:
  - `GET /get_stock_prices`
  - `GET /get_financial_metrics_snapshot`
  - `GET /get_company_facts`
- Local role:
  - US equity bars fallback / explicit source
  - richer US snapshot data than local A-share adapters
- Local wrapper shape:
  - HTTP GET with `x-api-key`
  - accepts array payload or wrapped `{ prices: [...] }` / `{ data: [...] }`

### LLMQuant Data

- Runtime endpoint:
  - default base URL: `https://api.llmquantdata.com`
- WhyJ Quant calls:
  - `GET /equity_historical_prices`
- Local role:
  - preferred direct adapter for US/HK bars when configured
  - preserves `adj_close` into internal `adjClose`
- Local wrapper shape:
  - HTTP GET with `Authorization: Bearer <LLMQUANT_API_KEY>`
  - accepts wrapped `{ data: [...] }`

## 3. Data priority rules

Priority is not a static global list. It depends on market and call path.

### 3.1 `fetchBars()` priority

File: `src/source/src/sources.ts`

1. Resolve selected source from `settings.preferences.source` unless the caller passes an explicit source.
2. In auto mode only:
   - if selected-source cache is fresh, read local `.ohquant/data/{source}/{symbol}/daily.json`
3. If cache is absent/stale:
   - call `pullBarsFromProviders(...)`
4. If live pull still returns empty:
   - scan any existing cache in this order:
     - `akshare`
     - `tushare`
     - `llmquant-data`
     - `financial-datasets`

### 3.2 `pullBarsFromProviders()` priority

This is the authoritative live-provider fallback chain.

For market `A`:

1. `AKShare`
2. `Tushare`

For market `US` / `HK`:

1. `LLMQuant Data` when selected explicitly, or automatically for `US`/`HK`
2. `Financial Datasets` when selected explicitly, or automatically for `US`

Important nuance:

- A-share always tries `AKShare -> Tushare`, regardless of the configured selected source.
- US/HK do not try AKShare/Tushare.
- `Financial Datasets` is automatic for `US`, but not for `HK`.

### 3.3 `fetchLiveBars()` priority

This path is used by the Overview panel and intentionally avoids cache reads/writes.

1. call `pullBarsFromProviders(...)`
2. filter to requested date window
3. if the requested window is empty but provider returned older bars:
   - repull without date bounds
   - return the latest available bars and `asOfDate`

That last step is why Overview no longer shows a false "暂无数据" just because the local clock is ahead of the provider's latest trade date.

## 4. Agent loop injection path

There are two injection layers: tool registration and prompt/context injection.

### 4.1 Tool registration

Files:

- `src/tools/data-tools.ts`
- `src/source/index.ts`
- `src/source/src/*.ts`

Flow:

1. `DATA_TOOLS` registers:
   - `fetch_bars`
   - `search_symbols`
   - `fetch_snapshot`
2. those tool handlers call source-module exports:
   - `fetchBars(...)`
   - `searchSymbols(...)`
   - `fetchTushareSnapshot(...)`
   - `fetchFinancialDatasetsSnapshot(...)`
3. source orchestrator dispatches to concrete providers

### 4.2 Prompt injection

File: `src/agent/src/context.ts`

`BASE_SYSTEM_PROMPT` tells the model that:

- `fetch_bars` is the local market-data tool
- `search_symbols` is the symbol lookup tool
- `fetch_snapshot` is the compact symbol snapshot tool

`buildSystemPrompt(...)` also injects cached symbol inventory so the model sees what data is already available locally before choosing whether to fetch again.

### 4.3 Runtime event path

Primary runtime flow:

1. user enters natural language in TUI
2. `src/app-runtime.ts` calls `dispatchUserMessage(...)`
3. agent loop runs inside the harness facade
4. model chooses a tool call such as `fetch_bars`
5. `src/tools/data-tools.ts` executes
6. `src/source/index.ts` routes into `sources.ts`
7. provider adapter returns normalized `Bar[]`
8. tool result is emitted back into the harness event stream
9. TUI renders tool line, result text, and Overview source attribution

### 4.4 Overview injection

The right-side Overview panel does not come from agent tool text. It uses the source module directly:

1. `AppRuntime.refreshMarketPanel()`
2. `fetchQuoteBars(...)`
3. `fetchLiveBars(...)`
4. `buildSourceSection(...)`

This is why source attribution like `AKShare · 东方财富 + Tushare` can be shown even when the agent itself did not explicitly narrate the provider.

## 5. Test coverage

Module tests now cover every configured source adapter:

- `src/source/tests/akshare.test.ts`
- `src/source/tests/tushare.test.ts`
- `src/source/tests/financial-datasets.test.ts`
- `src/source/tests/llmquant.test.ts`
- `src/source/tests/sources.test.ts`

Coverage intent:

- adapter payload normalization
- snapshot mapping
- provider fallback order
- live-fetch empty-window fallback
- source attribution formatting

## 6. Maintenance rules

1. Add new providers under `src/source/src/`.
2. Export them only through `src/source/index.ts`.
3. Update this doc when endpoint shape or priority changes.
4. Add one adapter test file and at least one orchestration regression test.
