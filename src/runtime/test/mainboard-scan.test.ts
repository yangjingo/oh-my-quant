import { expect, it } from "bun:test";
import { scanMainboard, type MainboardScanDeps, type ScanCoverage } from "../research/mainboard-scan.ts";
import type { BarsFetchResult, MainboardUniverse } from "../../source/index.ts";

const options = { start: "2026-01-01", end: "2026-01-03", momentumPeriod: 2, rsiPeriod: 2 };
function universe(count = 5): MainboardUniverse {
  return { members: Array.from({ length: count }, (_, i) => ({ symbol: `${i === 0 ? "000001.SZ" : `${600000 + i}.SH`}`,
    name: `Stock ${i}`, exchange: i === 0 ? "SZ" : "SH" })),
  sources: [{ exchange: "SH", endpoint: "sh", observedAt: "2026-01-04T00:00:00.000Z", count: count - 1 },
    { exchange: "SZ", endpoint: "sz", observedAt: "2026-01-04T00:00:00.000Z", count: 1 }] };
}
function prices(symbol: string, close = [10, 11, 12]): BarsFetchResult {
  const bars = close.map((value, i) => ({ date: `2026-01-0${i + 1}`, open: value, high: value, low: value,
    close: value, volume: 100, amount: 1000 }));
  return { bars, source: "akshare", origin: "cache", attempts: [], asOfDate: bars.at(-1)!.date,
    dataset: { version: 1, kind: "daily-bars", symbol, market: "A", source: "akshare", revision: "fixture", contentHash: "fixture",
      dates: bars.map(bar => bar.date), requested: { start: options.start, end: options.end },
      snapshotAt: "2026-01-04T00:00:00.000Z", adjustment: "forward-adjusted", availability: "observed-at-fetch" } };
}
const deps: MainboardScanDeps = { universe: async () => universe(), bars: async symbol => prices(symbol) };
function conserved(coverage: ScanCoverage) {
  expect(coverage.attempted).toBe(coverage.succeeded + coverage.failed);
  expect(coverage.universe).toBe(coverage.attempted + coverage.unattempted);
}

it("schedules an entire 3200-symbol fixture exactly once with bounded concurrency", async () => {
  const seen = new Set<string>(); let active = 0, peak = 0;
  const result = await scanMainboard({ ...options, concurrency: 4 }, { universe: async () => universe(3200), bars: async symbol => {
    expect(seen.has(symbol)).toBe(false); seen.add(symbol); peak = Math.max(peak, ++active);
    await Promise.resolve(); active--; return prices(symbol);
  } });
  expect(seen.size).toBe(3200); expect(peak).toBe(4);
  expect(result.status).toBe("complete"); expect(result.ranked).toBe(3200); conserved(result.coverage);
  expect(result.rows[0]!.momentum).toBeCloseTo(0.2); expect(result.rows[0]!.rsi).toBe(100);
});

it("preserves individual failures, deterministic momentum ranking, and limited-probe coverage", async () => {
  const result = await scanMainboard({ ...options, limit: 3 }, { ...deps, bars: async symbol => {
    if (symbol === "600001.SH") throw new Error("endpoint unavailable");
    return prices(symbol, symbol === "000001.SZ" ? [10, 11, 12] : [10, 12, 14]);
  } });
  expect(result.status).toBe("partial"); expect(result.stopReason).toBe("limit");
  expect(result.coverage).toEqual({ universe: 5, attempted: 3, succeeded: 2, failed: 1, unattempted: 2 });
  expect(result.ranking.symbols).toEqual(["600002.SH", "000001.SZ"]);
  expect(result.failures).toEqual([{ symbol: "600001.SH", error: "endpoint unavailable" }]);
  conserved(result.coverage);
});

it("excludes stale, older, unpinned and unknown-adjustment rows from the requested date ranking", async () => {
  const result = await scanMainboard(options, { ...deps, bars: async symbol => {
    const data = prices(symbol);
    if (symbol === "600001.SH") data.origin = "stale-cache";
    if (symbol === "600002.SH") { data.bars[2]!.date = "2026-01-02"; }
    if (symbol === "600003.SH") delete data.dataset;
    if (symbol === "600004.SH") data.dataset!.adjustment = "provider-unspecified";
    return data;
  } });
  expect(result.ranking.symbols).toEqual(["000001.SZ"]); expect(result.status).toBe("partial");
  expect(result.rows.filter(row => row.rank === null).map(row => row.excluded)).toEqual(["stale-cache", "missing-dataset", "unknown-price-adjustment"]);
  expect(result.failures[0]!.error).toContain("unordered"); conserved(result.coverage);
  const older = await scanMainboard({ ...options, end: "2026-01-04" }, deps);
  expect(older.ranked).toBe(0); expect(older.rows.every(row => row.excluded === "price-date-mismatch")).toBe(true);
});

it("does not rank different trading calendars or adjustment bases in one cohort", async () => {
  const result = await scanMainboard({ ...options, start: "2025-12-31" }, { ...deps, bars: async symbol => {
    const data = prices(symbol);
    if (symbol === "600003.SH") { data.bars[0]!.date = "2025-12-31"; data.dataset!.dates[0] = "2025-12-31"; }
    if (symbol === "600004.SH") data.dataset!.adjustment = "unadjusted";
    return data;
  } });
  expect(result.ranked).toBe(3); expect(result.excluded).toBe(2);
  expect(result.rows.slice(3).every(row => row.excluded === "non-comparable-calendar-or-adjustment")).toBe(true);
});

it("stops new dispatch after progress-driven cancellation and conserves settled counts", async () => {
  const controller = new AbortController(), progress: ScanCoverage[] = [];
  const result = await scanMainboard({ ...options, concurrency: 1 }, deps, controller.signal, counts => {
    progress.push(counts);
    if (counts.succeeded === 2) controller.abort();
  });
  expect(result.stopReason).toBe("cancelled"); expect(result.status).toBe("partial");
  expect(result.coverage.attempted).toBe(2); expect(progress[0]!.attempted).toBe(0); conserved(result.coverage);
});

it("bounds a signal-ignoring adapter and discards its late response", async () => {
  let resolveLate!: (result: BarsFetchResult) => void, calls = 0;
  const result = await scanMainboard({ ...options, concurrency: 1, budgetMs: 30 }, { ...deps, bars: () => {
    calls++; return new Promise(resolve => { resolveLate = resolve; });
  } });
  expect(result.stopReason).toBe("time-budget"); expect(result.status).toBe("partial"); expect(calls).toBe(1);
  expect(result.coverage.failed).toBe(1); conserved(result.coverage);
  resolveLate(prices("000001.SZ")); await Promise.resolve();
  expect(result.rows).toHaveLength(0);
});

it("rejects mismatching dataset identities from ranking even when factor values exist", async () => {
  const result = await scanMainboard(options, { ...deps, bars: async symbol => {
    const data = prices(symbol); data.dataset!.symbol = "999999.SH"; return data;
  } });
  expect(result.ranked).toBe(0); expect(result.rows.every(row => row.excluded === "dataset-mismatch")).toBe(true);
  expect(result.status).toBe("partial"); conserved(result.coverage);
});

it("settles all in-flight cancellations without dispatching remaining symbols", async () => {
  const controller = new AbortController(); let calls = 0;
  const result = await scanMainboard({ ...options, concurrency: 2 }, { ...deps, bars: () => {
    if (++calls === 2) controller.abort();
    return new Promise(() => {});
  } }, controller.signal);
  expect(calls).toBe(2); expect(result.coverage).toEqual({ universe: 5, attempted: 2, succeeded: 0, failed: 2, unattempted: 3 });
  expect(result.stopReason).toBe("cancelled"); conserved(result.coverage);
});

it("never loads prices or claims coverage after a roster failure or pre-cancellation", async () => {
  let calls = 0;
  const broken: MainboardScanDeps = { universe: async () => { throw new Error("missing SZ roster"); }, bars: async symbol => { calls++; return prices(symbol); } };
  await expect(scanMainboard(options, broken)).rejects.toThrow("missing SZ roster");
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await expect(scanMainboard(options, broken, controller.signal)).rejects.toThrow("cancelled"); expect(calls).toBe(0);
});

it("rejects invalid options before any provider call", async () => {
  for (const invalid of [{ start: "2026-02-30" }, { end: "2025-01-01" }, { concurrency: 9 }, { budgetMs: 0 }, { limit: 0 }, { rsiPeriod: 0 }])
    await expect(scanMainboard({ ...options, ...invalid }, deps)).rejects.toThrow();
});
