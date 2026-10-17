import { afterEach, beforeEach, expect, it, setSystemTime } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setImmediate } from "node:timers/promises";
import { AppRuntime } from "../../app-runtime.ts";
import { OverviewRefresh } from "../workspace/overview-refresh.ts";
import type { OverviewRefreshMeasurement } from "../workspace/overview-refresh.ts";
import { OverviewRequestPool } from "../workspace/overview-data.ts";
import { savePanelPortfolio, loadPanelPortfolio } from "../../storage/index.ts";
import { buildOverviewLines } from "../../tui/src/overview-render.ts";
import type { PanelSection } from "../../types/ui.ts";
import type { LiveBarsFetchResult } from "../../source/index.ts";

let root: string, previous: string | undefined;
const disposables: Array<{ dispose(): void }> = [];
beforeEach(() => {
  previous = process.env.OHQUANT_DIR; root = mkdtempSync(join(tmpdir(), "ohq-overview-refresh-")); process.env.OHQUANT_DIR = root;
  savePanelPortfolio({ updated: "", groups: [], symbols: [{ code: "000300.SH", name: "shared index", added: "" }, { code: "AAPL", name: "Apple", added: "" }] });
});
afterEach(() => {
  setSystemTime();
  disposables.splice(0).forEach(item => item.dispose());
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected refresh fixture directory");
  rmSync(root, { recursive: true, force: true });
});
function bars(): LiveBarsFetchResult {
  return { source: "akshare", window: "requested", asOfDate: "2026-09-11", attempts: [{ source: "akshare", status: "success" }],
    bars: [100, 105].map((close, i) => ({ date: `2026-09-${10 + i}`, open: close, high: close, low: close, close, volume: 1, amount: close })) };
}

it("uses the shared live pool and reports timings through the real AppRuntime entry without starting an agent", async () => {
  const seen: string[] = [], panels: PanelSection[][] = [], measurements: OverviewRefreshMeasurement[] = [];
  const runtime = new AppRuntime({ onActivity() {}, onMessages() {}, onPanel: panel => panels.push(panel), onMarketRefresh: value => { measurements.push(value); } },
    undefined, undefined, () => { throw new Error("No model initialization allowed"); }, undefined, undefined, 1000, 0,
    { poolFactory: (signal, budget) => new OverviewRequestPool({ signal, budget, fetcher: async symbol => { seen.push(symbol); return bars(); } }) });
  disposables.push(runtime);
  await runtime.submit("/help"); expect(seen).toHaveLength(0);
  await runtime.refreshOverviewPanel();
  expect(seen).toHaveLength(6); expect(seen.filter(symbol => symbol === "000300.SH")).toHaveLength(1);
  expect(measurements[0]).toMatchObject({ outcome: "success", rows: 7, availableRows: 7 });
  expect(measurements[0]!.requests).toHaveLength(6);
  expect(measurements[0]!.buildMs).toBeGreaterThanOrEqual(0); expect(measurements[0]!.publishMs).toBeGreaterThanOrEqual(0);
  const lines = buildOverviewLines(panels.at(-1)!, 48).map(line => line.text).join("\n");
  expect(lines).toContain("000300.SH"); expect(lines).toContain("2026-09-11"); expect(lines).toContain("AKShare");
});

it("supersedes a hung generation immediately, reads the latest portfolio, and rejects late publication", async () => {
  let release!: (result: LiveBarsFetchResult) => void, rounds = 0;
  const panels: PanelSection[][] = [], measurements: OverviewRefreshMeasurement[] = [], seen: string[][] = [];
  const refresh = new OverviewRefresh({ intervalMs: 0, timeoutMs: 1000,
    onPanel: panel => panels.push(panel), onMeasurement: value => { measurements.push(value); },
    poolFactory: (signal, budget) => {
      const thisRound = ++rounds, symbols: string[] = []; seen.push(symbols);
      return new OverviewRequestPool({ signal, budget, fetcher: async symbol => {
        symbols.push(symbol);
        if (thisRound === 1) return new Promise(resolve => { release = resolve; });
        return bars();
      } });
    },
  });
  disposables.push(refresh);
  const first = refresh.refresh(), next = refresh.refresh();
  expect(refresh.refresh()).toBe(next);
  savePanelPortfolio({ ...loadPanelPortfolio(), symbols: [{ code: "MSFT", name: "New selection", added: "" }] });
  await Promise.all([first, next]);
  expect(rounds).toBe(2); expect(seen[1]).toContain("MSFT"); expect(seen[1]).not.toContain("AAPL");
  expect(measurements.map(value => value.outcome)).toEqual(["superseded", "success"]);
  expect(measurements[0]!.requests.every(value => value.outcome === "cancelled")).toBe(true);
  const before = structuredClone(panels);
  release(bars()); await setImmediate();
  expect(panels).toEqual(before);
});

it("keeps the last values visibly stale after failure or timeout and recovers on the following refresh", async () => {
  setSystemTime(new Date(2026, 9, 17, 17, 15, 59));
  let mode = "success";
  const panels: PanelSection[][] = [], measures: OverviewRefreshMeasurement[] = [];
  // Test lifecycle outcomes, not whether filesystem reads finish within a 10 ms deadline.
  const refresh = new OverviewRefresh({ intervalMs: 0, timeoutMs: 1000, loadPortfolio: () => ({ symbols: [] }),
    onPanel: panel => panels.push(panel), onMeasurement: value => { measures.push(value); },
    quoteFetcher: async entries => {
      if (mode === "error") throw new Error("PRIVATE provider detail");
      if (mode === "timeout") return new Promise(() => {});
      return entries.map(entry => ({ ...entry, price: 105, pct: 5 }));
    }, holdingFetcher: async () => [],
  });
  disposables.push(refresh);
  await refresh.refresh(); const first = panels.at(-1)!;
  expect(measures[0]!.outcome).toBe("success");
  expect(JSON.stringify(first)).toContain('"price":105');
  for (mode of ["error", "timeout"]) {
    await refresh.refresh();
    const panel = panels.at(-1)!;
    const retained = panel.find(section => section.kind === "quotes");
    expect(retained?.kind).toBe("quotes");
    if (retained?.kind === "quotes") {
      expect(retained.rows.every(row => row.price === 105 && row.refreshState === "stale")).toBe(true);
    }
    const text = JSON.stringify(panel);
    expect(text).toContain(mode); expect(text).toContain("stale"); expect(text).not.toContain("PRIVATE");
  }
  setSystemTime(new Date(2026, 9, 17, 17, 16, 0));
  mode = "success"; await refresh.refresh();
  // Quotes and cleared stale state must match; the successful refresh owns a new timestamp.
  const expected = structuredClone(first);
  const source = expected.find(section => section.kind === "keyvalue" && section.title === "Source");
  expect(source?.kind).toBe("keyvalue");
  if (source?.kind === "keyvalue") {
    const updated = source.rows.find(row => row.label === "更新");
    expect(updated).toEqual({ label: "更新", value: "2026-10-17 17:15" });
    updated!.value = "2026-10-17 17:16";
  }
  expect(panels.at(-1)).toEqual(expected);
  expect(measures.map(value => value.outcome)).toEqual(["success", "error", "timeout", "success"]);
});

it("distinguishes unavailable rows and isolates rejected metric observers from refresh success", async () => {
  let allEmpty = false;
  const panels: PanelSection[][] = [], outcomes: string[] = [];
  const refresh = new OverviewRefresh({ intervalMs: 0, onPanel: panel => panels.push(panel), onMeasurement: async value => {
    outcomes.push(value.outcome); throw new Error("observer failed");
  }, poolFactory: (signal, budget) => new OverviewRequestPool({ signal, budget, fetcher: async symbol => allEmpty || symbol === "AAPL"
    ? { ...bars(), bars: [], source: "unavailable", window: "unavailable", asOfDate: "" } : bars() }) });
  disposables.push(refresh);
  await refresh.refresh(); expect(JSON.stringify(panels.at(-1))).toContain("partial");
  allEmpty = true; await refresh.refresh(); expect(JSON.stringify(panels.at(-1))).toContain("unavailable");
  expect(outcomes).toEqual(["partial", "unavailable"]);
});

it("publishes usable rows before a slow request finishes and retains this generation's partial results on timeout", async () => {
  const panels: Array<{ panel: PanelSection[]; loading: boolean }> = [], measures: OverviewRefreshMeasurement[] = [], seen: string[] = [];
  let release!: (result: LiveBarsFetchResult) => void;
  const refresh = new OverviewRefresh({ intervalMs: 0, timeoutMs: 100,
    onPanel: (panel, loading) => panels.push({ panel, loading }), onMeasurement: value => { measures.push(value); },
    poolFactory: (signal, budget) => new OverviewRequestPool({ signal, budget, fetcher: async symbol => {
      seen.push(symbol);
      return symbol === "AAPL" ? new Promise(resolve => { release = resolve; }) : bars();
    } }),
  });
  disposables.push(refresh);
  const pending = refresh.refresh();
  await setImmediate();
  const interim = panels.at(-1)!;
  expect(interim.loading).toBe(true);
  expect(JSON.stringify(interim.panel)).toContain("6/7 已返回");
  expect(JSON.stringify(interim.panel)).toContain("6/7 可用");
  expect(JSON.stringify(interim.panel)).toContain('"price":105');
  expect(measures).toHaveLength(0);
  await pending;
  expect(panels.at(-1)!.loading).toBe(false);
  expect(JSON.stringify(panels.at(-1)!.panel)).toContain("timeout");
  expect(JSON.stringify(panels.at(-1)!.panel)).toContain("6/7 已返回 · 未返回项 --");
  expect(JSON.stringify(panels.at(-1)!.panel)).not.toContain("stale");
  expect(panels.at(-1)!.panel.slice(1)).toEqual(interim.panel.slice(1));
  expect(seen).toHaveLength(6);
  expect(measures[0]).toMatchObject({ outcome: "timeout", rows: 7, availableRows: 6 });
  expect(measures[0]!.firstResultMs).toBeGreaterThanOrEqual(0);
  expect(measures[0]!.firstResultMs!).toBeLessThan(measures[0]!.totalMs);
  expect(measures[0]!.requests.filter(request => request.outcome === "cancelled")).toHaveLength(1);
  const saved = structuredClone(panels);
  release(bars()); await setImmediate();
  expect(panels).toEqual(saved);
});

it("labels retained previous quotes during partial refresh and rejects callbacks after superseding it", async () => {
  const panels: PanelSection[][] = [], measures: OverviewRefreshMeasurement[] = [];
  let round = 0, late: (() => void) | undefined;
  const refresh = new OverviewRefresh({ intervalMs: 0, timeoutMs: 1000, loadPortfolio: () => ({ symbols: [] }),
    onPanel: panel => panels.push(panel), onMeasurement: value => { measures.push(value); },
    quoteFetcher: async (entries, meta) => {
      round++;
      const rows = entries.map(entry => ({ code: entry.code, name: entry.name, price: round * 100, pct: 5 }));
      if (round === 2) {
        meta.onRow?.(rows[0]!, 0);
        late = () => meta.onRow?.({ ...rows[1]!, price: 999 }, 1);
        return new Promise(() => {});
      }
      return rows;
    }, holdingFetcher: async () => [],
  });
  disposables.push(refresh);
  await refresh.refresh();
  const second = refresh.refresh(); await setImmediate();
  const interim = JSON.stringify(panels.at(-1));
  expect(interim).toContain('"price":200'); expect(interim).toContain('"price":100');
  expect(interim).toContain('"refreshState":"refreshing"');
  expect(interim).toContain("1/5 已返回");
  const third = refresh.refresh();
  await Promise.all([second, third]);
  expect(measures.map(value => value.outcome)).toEqual(["success", "superseded", "success"]);
  const before = structuredClone(panels);
  late?.(); await setImmediate();
  expect(panels).toEqual(before);
  expect(JSON.stringify(panels.at(-1))).toContain('"price":300');
});

it("closes a disposed partial refresh without publishing queued or late rows", async () => {
  const panels: PanelSection[][] = [];
  let late: (() => void) | undefined;
  const refresh = new OverviewRefresh({ intervalMs: 0, timeoutMs: 1000, onPanel: panel => panels.push(panel),
    quoteFetcher: async (entries, meta) => {
      meta.onRow?.({ ...entries[0]!, price: 105, pct: 5 }, 0);
      late = () => meta.onRow?.({ ...entries[1]!, price: 999, pct: 5 }, 1);
      return new Promise(() => {});
    }, holdingFetcher: async () => [],
  });
  disposables.push(refresh);
  const pending = refresh.refresh(); await setImmediate();
  expect(JSON.stringify(panels.at(-1))).toContain('"price":105');
  refresh.dispose(); await pending;
  const before = structuredClone(panels);
  late?.(); await setImmediate(); refresh.render();
  expect(panels).toEqual(before);
});

it("ends loading when a progressive panel callback throws instead of leaving an unhandled microtask", async () => {
  const measures: OverviewRefreshMeasurement[] = [];
  let rejectProgress = true;
  const refresh = new OverviewRefresh({ intervalMs: 0, timeoutMs: 1000,
    onPanel: (panel, loading) => { if (rejectProgress && loading && JSON.stringify(panel).includes("已返回")) throw new Error("view failed"); },
    onMeasurement: value => { measures.push(value); }, poolFactory: (signal, budget) => new OverviewRequestPool({ signal, budget, fetcher: async () => bars() }),
  });
  disposables.push(refresh);
  await refresh.refresh(); expect(measures[0]?.outcome).toBe("error");
  rejectProgress = false;
  await refresh.refresh(); expect(measures[1]?.outcome).toBe("success");
});

it("flushes settled rows waiting for a coalesced update when the batch fails", async () => {
  const panels: PanelSection[][] = [], measures: OverviewRefreshMeasurement[] = [];
  const refresh = new OverviewRefresh({ intervalMs: 0, timeoutMs: 1000,
    onPanel: panel => panels.push(panel), onMeasurement: value => { measures.push(value); },
    quoteFetcher: async (entries, meta) => {
      meta.onRow?.({ ...entries[0]!, price: 101, pct: 1 }, 0);
      await setImmediate();
      expect(JSON.stringify(panels.at(-1))).toContain('"price":101');
      for (let index = 1; index < entries.length; index++) meta.onRow?.({ ...entries[index]!, price: 102, pct: 2 }, index);
      throw new Error("Remaining batch failed");
    }, holdingFetcher: async () => [],
  });
  disposables.push(refresh);
  await refresh.refresh();
  expect(panels).toHaveLength(3);
  expect(JSON.stringify(panels.at(-1))).toContain("5/7 已返回");
  expect(JSON.stringify(panels.at(-1))).toContain("error");
  expect(measures[0]).toMatchObject({ outcome: "error", rows: 7, availableRows: 5 });
  const before = structuredClone(panels);
  await Bun.sleep(25);
  expect(panels).toEqual(before);
});

it("stops dispatching queued quotes when response processing exhausts the round budget before its timer runs", async () => {
  const measures: OverviewRefreshMeasurement[] = [], seen: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const refresh = new OverviewRefresh({ intervalMs: 0, timeoutMs: 20,
    loadPortfolio: () => ({ updated: "", groups: [], symbols: Array.from({ length: 50 }, (_, index) => ({ code: `SYNTH${index}`, name: "fixture", added: "" })) }),
    onMeasurement: value => { measures.push(value); },
    poolFactory: (signal, budget) => new OverviewRequestPool({ signal, budget, fetcher: async symbol => {
      seen.push(symbol);
      await gate;
      // Simulate synchronous response decoding: promise continuations run before the timeout callback.
      if (symbol === "000001.SH") {
        const end = performance.now() + 40;
        while (performance.now() < end) { /* deliberately occupy this event-loop turn */ }
      }
      return bars();
    } }),
  });
  disposables.push(refresh);
  const pending = refresh.refresh(); release(); await pending;
  expect(seen).toHaveLength(8);
  expect(measures[0]?.outcome).toBe("timeout");
  expect(measures[0]!.requests.filter(request => request.fetchMs === null)).toHaveLength(47);
  expect(measures[0]!.requests.every(request => request.outcome === "cancelled")).toBe(true);
});

it("retains only on-time partial rows after synchronous work overruns the budget and recovers next round", async () => {
  const panels: PanelSection[][] = [], measures: OverviewRefreshMeasurement[] = [];
  let overrun = true;
  const refresh = new OverviewRefresh({ intervalMs: 0, timeoutMs: 20, loadPortfolio: () => ({ symbols: [] }),
    onPanel: panel => panels.push(panel), onMeasurement: value => { measures.push(value); },
    quoteFetcher: async (entries, meta) => {
      const rows = entries.map((entry, index) => ({ ...entry, price: 100 + index, pct: 5 }));
      if (overrun) {
        meta.onRow?.(rows[0]!, 0);
        await setImmediate();
        const end = performance.now() + 40;
        while (performance.now() < end) { /* delay the timer while already-published data remains valid */ }
      }
      return rows;
    }, holdingFetcher: async () => [],
  });
  disposables.push(refresh);
  await refresh.refresh();
  expect(measures[0]).toMatchObject({ outcome: "timeout", availableRows: 1 });
  const panel = JSON.stringify(panels.at(-1));
  expect(panel).toContain('"price":100');
  expect(panel).not.toContain('"price":101');
  expect(panel).toContain("1/5 已返回 · 未返回项 --");
  expect(panel).not.toContain("stale");
  overrun = false; await refresh.refresh();
  expect(measures[1]).toMatchObject({ outcome: "success", availableRows: 5 });
});

it("rejects invalid round budgets before starting refresh work", () => {
  for (const timeoutMs of [0, -1, 0.5, Number.NaN, Infinity, 2147483648]) {
    expect(() => new OverviewRefresh({ timeoutMs })).toThrow("timeout");
  }
});
