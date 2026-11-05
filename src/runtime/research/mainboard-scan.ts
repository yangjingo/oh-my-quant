import { fetchMainboardUniverse, type MainboardUniverse, type BarsFetchResult } from "../../source/index.ts";
import { momentum, rsi } from "../../quant/index.ts";
import { isDailyDate } from "../../market/bars.ts";
import { loadAnalysisBars } from "../data/analysis-data.ts";
import type { DatasetRef } from "../../types/data.ts";

export interface MainboardScanOptions {
  start: string; end: string; momentumPeriod?: number; rsiPeriod?: number;
  concurrency?: number; budgetMs?: number; limit?: number;
}
export interface ScanCoverage { universe: number; attempted: number; succeeded: number; failed: number; unattempted: number }
export interface ScanRow {
  symbol: string; name: string; source: string; origin: string; priceDate: string;
  dataset: DatasetRef | null; momentum: number; rsi: number; rank: number | null; excluded: string | null;
}
export interface MainboardScanDeps {
  universe?: typeof fetchMainboardUniverse;
  bars?: typeof loadAnalysisBars;
}

/** Await cancellation even if an adapter ignores its signal; discard late results. */
function cancellable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); })
      .then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

function factors(data: BarsFetchResult, options: MainboardScanOptions, momentumPeriod: number, rsiPeriod: number) {
  const bars = data.bars;
  if (bars.length < Math.max(momentumPeriod, rsiPeriod) + 1) throw new Error("Insufficient observations for both factors.");
  if (bars.some((bar, i) => !isDailyDate(bar.date) || bar.date < options.start || bar.date > options.end
    || i > 0 && bar.date <= bars[i - 1]!.date || !Number.isFinite(bar.close) || bar.close <= 0))
    throw new Error("Invalid, unordered or out-of-window prices.");
  const close = bars.map(bar => bar.close);
  const m = momentum(close, momentumPeriod).at(-1)!, r = rsi(close, rsiPeriod).at(-1)!;
  if (m === null || r === null || !Number.isFinite(m) || !Number.isFinite(r)) throw new Error("Non-finite factor result.");
  return { momentum: m, rsi: r, priceDate: bars.at(-1)!.date };
}

/** Bounded discovery, not a durable job or an expansion of a declared symbol task. */
export async function scanMainboard(options: MainboardScanOptions, deps: MainboardScanDeps = {},
  signal?: AbortSignal, progress?: (coverage: ScanCoverage) => void) {
  if (!isDailyDate(options.start) || !isDailyDate(options.end) || options.start > options.end)
    throw new Error("An explicit valid start/end price window is required.");
  const momentumPeriod = options.momentumPeriod ?? 20, rsiPeriod = options.rsiPeriod ?? 14;
  const concurrency = options.concurrency ?? 4, budgetMs = options.budgetMs ?? 120_000;
  for (const [name, value, max] of [["momentumPeriod", momentumPeriod, 1000], ["rsiPeriod", rsiPeriod, 1000],
    ["concurrency", concurrency, 8], ["budgetMs", budgetMs, 600_000], ["limit", options.limit ?? 100_000, 100_000]] as const)
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${name}: expected 1..${max}.`);
  const started = performance.now(), controller = new AbortController();
  const active = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(new Error("Scan time budget expired.")), budgetMs);
  const stopped = () => {
    if (performance.now() - started >= budgetMs) controller.abort(new Error("Scan time budget expired."));
    return active.aborted;
  };
  let universe: MainboardUniverse;
  const rows: ScanRow[] = [], failures: { symbol: string; error: string }[] = [];
  try {
    universe = await cancellable(() => (deps.universe ?? fetchMainboardUniverse)({ signal: active }), active);
    const members = universe.members;
    if (!members.length || new Set(members.map(m => m.symbol)).size !== members.length
      || !["SH", "SZ"].every(exchange => universe.sources.some(source => source.exchange === exchange && source.count > 0)))
      throw new Error("Both deduplicated exchange rosters are required.");
    let next = 0, attempted = 0;
    const selected = Math.min(members.length, options.limit ?? members.length);
    const coverage = (): ScanCoverage => ({ universe: members.length, attempted, succeeded: rows.length,
      failed: failures.length, unattempted: members.length - attempted });
    progress?.(coverage());
    await Promise.all(Array.from({ length: Math.min(concurrency, selected) }, async () => {
      while (next < selected && !stopped()) {
        const member = members[next++]!;
        attempted++;
        try {
          const data = await cancellable(() => (deps.bars ?? loadAnalysisBars)(member.symbol,
            Math.max(momentumPeriod, rsiPeriod) + 1, options.start, options.end, active), active);
          if (stopped()) throw active.reason;
          const values = factors(data, options, momentumPeriod, rsiPeriod);
          const dataset = data.dataset ?? null;
          const excluded = data.origin === "stale-cache" ? "stale-cache" : values.priceDate !== options.end ? "price-date-mismatch"
            : !dataset ? "missing-dataset" : dataset.symbol !== member.symbol || dataset.market !== "A"
              || dataset.source !== data.source || dataset.dates.join() !== data.bars.map(bar => bar.date).join() ? "dataset-mismatch"
            : !["forward-adjusted", "unadjusted"].includes(dataset.adjustment) ? "unknown-price-adjustment" : null;
          rows.push({ ...member, ...values, source: data.source, origin: data.origin, dataset, rank: null, excluded });
        } catch (error) {
          failures.push({ symbol: member.symbol, error: active.aborted ? signal?.aborted ? "cancelled" : "time-budget"
            : error instanceof Error ? error.message : "Price preparation failed." });
        }
        progress?.(coverage());
      }
    }));
    rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
    // Rank only the largest comparable cohort; ties choose the first canonical symbol.
    const cohorts = new Map<string, ScanRow[]>();
    for (const row of rows.filter(row => !row.excluded)) {
      const key = JSON.stringify([row.dataset!.adjustment, row.dataset!.dates]);
      if (!cohorts.has(key)) cohorts.set(key, []);
      cohorts.get(key)!.push(row);
    }
    const comparable = [...cohorts.values()].sort((a, b) => b.length - a.length)[0] ?? [];
    const comparableSet = new Set(comparable);
    for (const row of rows) if (!row.excluded && !comparableSet.has(row)) row.excluded = "non-comparable-calendar-or-adjustment";
    comparable.sort((a, b) => b.momentum - a.momentum || a.symbol.localeCompare(b.symbol))
      .forEach((row, index) => { row.rank = index + 1; });
    failures.sort((a, b) => a.symbol.localeCompare(b.symbol));
    const counts = coverage();
    return { status: counts.succeeded === counts.universe && comparable.length === counts.universe && !stopped() ? "complete" as const : "partial" as const,
      stopReason: active.aborted ? signal?.aborted ? "cancelled" : "time-budget" : selected < members.length ? "limit" : "finished",
      coverage: counts, ranked: comparable.length, excluded: rows.length - comparable.length,
      universe, window: { start: options.start, end: options.end }, momentumPeriod, rsiPeriod,
      ranking: { metric: "momentum", direction: "descending", dates: comparable[0]?.dataset?.dates ?? [],
        adjustment: comparable[0]?.dataset?.adjustment ?? null, symbols: comparable.map(row => row.symbol) },
      rows, failures, elapsedMs: Math.round(performance.now() - started),
      evidenceBoundary: "Current roster observed from both exchanges, not historical membership or an independent completeness audit. Ranks apply only to the reported comparable cohort at the requested price date. Trading-day completeness, predictive value and current tradability are unverified." };
  } finally { clearTimeout(timer); controller.abort(); }
}
