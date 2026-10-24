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
- fall back across AKShare upstream endpoints before falling through to another provider
- merge provider results with cache behavior only through injectable runtime deps
- expose source attribution metadata for TUI Overview

## Internal module split

| File | Responsibility |
|------|----------------|
| `src/source/src/source-contracts.ts` | shared source DTOs, runtime deps, provider options, and attribution labels |
| `src/source/src/source-providers.ts` | provider registry, symbol normalization, fallback order, and symbol search |
| `src/source/src/sources.ts` | cache-aware fetch facade and live fetch attribution over provider pulls |
| `src/source/src/akshare.ts` | AKShare fetch orchestration and compatibility re-exports |
| `src/source/src/akshare-global-bars.ts` | market-checked Python US/HK daily histories and exact native-block fallback dispatch |
| `src/source/src/sina-global-history.ts` | bounded Sina US/HK encoded history parsing, identity/window validation and native-free fetch |
| `src/source/src/sina-a-history.ts` | native-free A-share/index history, strict JSON qfq factors and date-effective adjustment |
| `src/source/src/sina-history-payload.ts` | shared identity-matched encoded payload, trailing-comment and selected OHLCV validation |
| `src/source/src/vendor/sina-history-decoder.js` | static MIT-licensed AKShare decoder; unknown return type validated by the owned adapter |
| `src/source/src/akshare-types.ts` | AKShare DTOs shared by parser, client, and tools |
| `src/source/src/akshare-normalize.ts` | AKShare payload parsers and row normalizers |
| `src/source/src/akshare-python.ts` | Python interpreter discovery and subprocess execution |
| `src/source/src/akshare-dependency.ts` | network-free import and optional MiniRacer runtime diagnosis |
| `src/source/src/eastmoney-fund-nav.ts` | bounded public fund HTTP and JSON literal parsing after an exact native DLL block; no JavaScript evaluation |
| `src/source/src/akshare-scripts.ts` | Python script payloads used by AKShare subprocess calls |
| `src/source/src/akshare-endpoints.ts` | AKShare public endpoint whitelists and endpoint types |
| `src/source/src/sina-index-client.ts` | Sina A-index quote fallback client |
| `src/source/src/tushare.ts` | Tushare-backed fetch |
| `src/source/src/llmquant.ts` | LLMQuant-backed market fetch |
| `src/source/src/financial-datasets.ts` | Financial Datasets-backed fetch |
| `src/source/src/http.ts` | shared JSON/text transport, body-inclusive deadline, cancellation and bounded UTF-8 text reads |

## Import rules

1. External callers import from `src/source/index.ts`.
2. Tests may import deep module paths when they are targeting one adapter directly.
3. Cross-provider policy belongs in `source-providers.ts`, not in individual adapters.
4. AKShare endpoint fallback belongs inside the AKShare adapter; runtime callers must not select Eastmoney/Sina/Tencent directly.
5. Provider-specific parsing or transport logic stays in the adapter file.
6. Raw provider adapters do not import storage; callers pass explicit provider options or rely on canonical environment variables.
7. Storage-backed cache/settings defaults live in `src/runtime/data/source-runtime.ts`, not in this module.

## Fallback model

For ordinary A-share daily bars, fallback is deliberately layered:

1. AKShare tries Eastmoney (`stock_zh_a_hist`), Sina (`stock_zh_a_daily`), then Tencent (`stock_zh_a_hist_tx`).
2. Symbol classification keeps suffixed stocks, `.OF` funds, and known indexes on separate endpoint families.
3. Empty/error endpoint attempts are retained by `fetchFromAKShareDetailed()`.
4. If AKShare returns no bars or raises an adapter-level error, `source-providers.ts` tries Tushare.
5. `fetchBars()` may finally use date-matching provider cache; `fetchLiveBars()` never reads or writes cache.
6. Cross-provider `attempts.error` carries a stable failure category only; arbitrary provider exception text can contain private URLs, headers or response bodies and must not enter research/Agent output.

`SourceRuntimeDeps.loadCache()` returns bars/freshness/DatasetRef together from one snapshot. Cache, archive, preferred-source and credential ports receive the active AbortSignal; the storage-backed runtime implements them with async file I/O. `saveBars()` accepts the same signal and returns the reference for the exact returned observations. Storage adapters preserve immutable revisions; source does not construct paths or read paired metadata separately. Cancellation is rechecked after preference/settings reads, cache lookup, provider pull, lock acquisition and each commit boundary. Host replacements may still be synchronous, so their own JavaScript cannot be preempted by the facade.

US defaults to LLMQuant → Financial Datasets → AKShare `stock_us_daily`; HK defaults to LLMQuant → AKShare `stock_hk_daily`. The public Python adapter accepts only the matching market symbol, strips `.HK` for the Hong Kong endpoint, and returns unadjusted daily bars. It does not turn a data subscription failure into a verified subscription.

An explicit WinError 4551 from these two Python routes activates the independent Sina HTTP adapter. It accepts only the expected encoded-string declaration and trailing closed comments, then calls a static local decoder; network text is never evaluated. Successful routes are `sina_us_daily_native_free` / `sina_hk_daily_native_free`, with the original failed attempt retained. Dates are validated across the decoded history; OHLCV is validated for the requested window (last 30 observations when unbounded), rejecting the whole window if any selected row is invalid. Raw numeric precision remains unchanged. US amount is null; HK amount retains the provider value without unit certification. Other failures, successful empty responses and cancellation do not activate this fallback. Decoder provenance and license are recorded in [vendor/README.md](./src/vendor/README.md).

Explicit SH/SZ stocks whose source priority includes Sina, and known A indexes, can also use a native-free Sina route after the Python chain process times out or every completed attempt explicitly reports WinError 4551. The eligible Python chain has a 15-second limit to leave room inside Doctor's 30-second overall deadline; other paths retain their 30-second Python limit. Genuine empty responses and unrelated failures do not activate it. Stock OHLC is divided by the latest provider qfq factor effective on each observation date; missing factors fail the request, future factors are not backfilled. Index levels are unchanged. Volume, available amount and numeric precision are preserved. Actual endpoints are `sina_a_daily_qfq_native_free` / `sina_a_index_daily_native_free`; the shared payload module owns parsing for all four markets. BJ/ambiguous symbols keep existing routes. Current factors do not prove historically published or independently calibrated company actions.

The completed native-block attempts must include the matching stock/index Sina endpoint. An error for a fund endpoint cannot activate stock HTTP fallback; the full-suite regression covers this instrument boundary.

For `.OF` fund bars and dedicated fund NAV, empty data with every internal attempt explicitly failing with WinError 4551 activates the literal-only Eastmoney fallback. The successful endpoint is `eastmoney_fund_net_worth`; the logical provider family remains `akshare`. NAV/DCA callers archive the resolved endpoint, and generic bars preserve `unit-nav` rather than inferring stock prices or total return. Real empty responses and other failures retain their existing behavior. Exact Python endpoint diagnostics remain separate from successful fallback data checks.

Callers may configure `providers.akshare.sourcePriority`, override a `BarProviderAdapter`, or set a market
`fallbackOrder`. These are separate controls: endpoint order is internal to AKShare, while fallback order chooses
between top-level providers.

## Test rules

- put provider parsing tests in `src/source/tests/`
- when a live-source bug causes Overview to show empty quotes or wrong source labels, add a regression test in `sources.test.ts`
- test AKShare endpoint payloads, priorities, and embedded chain behavior in `akshare.test.ts`
- cover both endpoint-level and provider-level empty/error fallback paths
- keep tests deterministic; mock provider adapters instead of hitting network paths

## Related docs

- [Module Architecture](../../docs/agent-runtime/architecture.md)
- [Source Providers](../../docs/quant-harness/source-data-providers.md)
- [OhQuant Storage Policy](../../docs/agent-runtime/storage.md)
