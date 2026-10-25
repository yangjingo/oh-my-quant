import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { savePanelPortfolio } from "../../storage/index.ts";
import { OverviewRefresh } from "../workspace/overview-refresh.ts";
import { OverviewRequestPool, type OverviewQuote } from "../workspace/overview-data.ts";
import { buildOverviewLines } from "../../../apps/tui/src/overview-render.ts";
import { drawPortfolio, layout } from "../../../apps/tui/src/render.ts";
import { Buffer } from "../../../apps/tui/src/buffer.ts";
import type { PanelSection } from "../../types/ui.ts";
import type { LiveBarsFetchResult } from "../../source/index.ts";
import type { OverviewRefreshMeasurement } from "../workspace/overview-refresh.ts";

it("does not count healthy retained rows as a new result when the failed-only retry times out", async () => {
  let round = 1;
  const measurements: OverviewRefreshMeasurement[] = [];
  const refresh = new OverviewRefresh({ intervalMs: 0, timeoutMs: 100,
    loadPortfolio: () => ({ symbols: [{ code: "AAPL", name: "Apple" }], groups: [] }),
    quoteFetcher: async entries => entries.map(entry => ({ ...entry, price: 100, pct: 1 })),
    holdingFetcher: async entries => round === 3 ? new Promise(() => {})
      : entries.map(entry => ({ ...entry, price: round === 2 ? Number.NaN : 100, pct: 1 })),
    onMeasurement: measurement => { measurements.push(measurement); },
  });
  try {
    await refresh.refresh();
    round = 2; await refresh.refresh();
    round = 3; await refresh.retryFailed();
    expect(measurements.at(-1)).toMatchObject({ outcome: "timeout", firstResultMs: null, availableRows: 5 });
  } finally { refresh.dispose(); }
});

it("retains an unavailable symbol's original observation and retries only the failed symbol", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-retained-quotes-"));
  const previous = process.env.OHQUANT_DIR;
  process.env.OHQUANT_DIR = root;
  savePanelPortfolio({ updated: "", groups: [], symbols: [{ code: "AAPL", name: "Apple", added: "" }] });
  let round = 0;
  const seen: string[][] = [];
  let panel: PanelSection[] = [];
  let refreshingText = "";
  let initializationFails = false;
  const rows = (): OverviewQuote[] => panel.flatMap(section => section.kind === "quotes" || section.kind === "holdings" || section.kind === "group" ? section.rows : []);
  const refresh = new OverviewRefresh({ intervalMs: 0, loadPortfolio: () => {
    if (initializationFails) throw new Error("portfolio read failed");
    return { symbols: [{ code: "AAPL", name: "Apple" }], groups: [] };
  }, onPanel: (value, loading) => {
    panel = value;
    if (loading && rows().some(row => row.refreshState === "refreshing" && row.code === "AAPL")) {
      const buffer = new Buffer(160, 48);
      drawPortfolio(buffer, layout(160, 48).portfolio, panel, loading);
      refreshingText = buffer.toPlain().join("\n");
    }
  },
    poolFactory: (signal, budget) => {
      round++;
      const requests: string[] = []; seen.push(requests);
      return new OverviewRequestPool({ signal, budget, fetcher: async symbol => {
        requests.push(symbol);
        const date = round === 1 ? "2026-09-11" : "2026-09-12";
        const close = round === 1 ? 105 : 110;
        const result: LiveBarsFetchResult = { source: "akshare", window: "requested", asOfDate: date,
          attempts: [{ source: "akshare", status: "success" }], bars: [100, close].map((value, index) => ({ date: index ? date : "2026-09-10", open: value, high: value, low: value, close: value, volume: 1, amount: value })) };
        return round === 2 && symbol === "AAPL" ? { ...result, source: "unavailable", window: "unavailable", asOfDate: "", bars: [] } : result;
      } });
    } });
  try {
    await refresh.refresh();
    const original = structuredClone(rows().find(row => row.code === "AAPL")!);
    await refresh.refresh();
    expect(refreshingText).toContain("AAPL");
    expect(refreshingText).toContain("2026-09-11");
    const retained = rows().find(row => row.code === "AAPL")!;
    expect(retained.price).toBe(105);
    expect(retained.observation).toEqual(original.observation);
    expect(retained.refreshState).toBe("stale");
    expect(buildOverviewLines(panel, 48).map(line => line.text).join("\n")).toContain("2026-09-11");
    await refresh.retryFailed();
    expect(seen[2]).toEqual(["AAPL"]);
    const recovered = rows().find(row => row.code === "AAPL")!;
    expect(recovered.price).toBe(110);
    expect(recovered.refreshState).toBeUndefined();
    expect(recovered.observation?.asOfDate).toBe("2026-09-12");
    await refresh.retryFailed();
    expect(seen.length).toBe(3);
    initializationFails = true;
    await refresh.refresh();
    expect(rows().filter(row => Number.isFinite(row.price)).every(row => row.refreshState === "stale")).toBe(true);
    expect(rows().find(row => row.code === "AAPL")?.observation?.asOfDate).toBe("2026-09-12");
    expect(buildOverviewLines(panel, 48).map(line => line.text).join("\n")).toContain("0 本轮可用");
  } finally {
    refresh.dispose();
    if (previous === undefined) delete process.env.OHQUANT_DIR;
    else process.env.OHQUANT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
