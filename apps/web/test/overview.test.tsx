import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Overview } from "../src/components/Research";
import { createWorkbenchStore } from "../src/state/workbench-store";
import { createDemoClient } from "../dev/demo-client";
import { isMarketSnapshot, type MarketSnapshot, type WorkbenchEvent } from "../src/client/contract";

const market: MarketSnapshot = { refreshedAt: "2026-10-24 12:00", status: "timeout", retryable: true,
  source: { provider: "AKShare", updatedAt: null, available: 0, total: 1 },
  quotes: [{ code: "000001.SH", name: "上证指数", value: 100, change: 1, asOfDate: "2026-10-23", provider: "AKShare", freshness: "stale" }] };
test("accepted source changes replace the independent market view without forcing a provider refresh", async () => {
  const base = createDemoClient(); let refreshes = 0;
  const store = createWorkbenchStore({ ...base, refreshMarket: async () => { refreshes++; return base.market(); } });
  const release = store.connect(); await Bun.sleep(15);
  try {
    expect(store.getSnapshot().market!.quotes.length).toBeGreaterThan(0);
    await store.preferences({ ...store.getSnapshot().preferences!, source: "akshare" });
    expect(store.getSnapshot().market!.quotes).toHaveLength(0);
    expect(refreshes).toBe(0);
    await store.preferences({ ...store.getSnapshot().preferences!, source: "demo" });
    expect(store.getSnapshot().market!.quotes.length).toBeGreaterThan(0);
  } finally { release(); }
});
test("overview distinguishes refresh time, trading date, stale values and retry", () => {
  const html = renderToStaticMarkup(<Overview snapshot={market} portfolio="" demo={false} onRefresh={() => {}} onClose={() => {}} />);
  for (const text of ["2026-10-24 12:00", "2026-10-23", "旧值", "刷新超时", "重试失败项", "非实时行情", "AKShare"]) expect(html).toContain(text);
  expect(isMarketSnapshot({ ...market, status: "fake" })).toBe(false);
  expect(isMarketSnapshot({ ...market, colorScheme: "fake" })).toBe(false);
  expect(renderToStaticMarkup(<Overview snapshot={{ ...market, colorScheme: "green-up" }} portfolio="" demo={false} onClose={() => {}} />)).toContain('data-market-colors="green-up"');
  const snapshotHtml = renderToStaticMarkup(<Overview snapshot={{ ...market, quotes: [{ ...market.quotes[0]!, basis: "snapshot", asOfTime: "15:00:03" }] }} portfolio="" demo={false} onClose={() => {}} />);
  expect(snapshotHtml).toContain("相对前收涨跌"); expect(snapshotHtml).toContain("15:00:03");
  expect(html).toContain("相邻日线涨跌，非当日快照");
  expect(isMarketSnapshot({ ...market, quotes: [{ ...market.quotes[0], value: Infinity }] })).toBe(false);
});
test("workspace market events update ended sessions and reject foreign workspaces and late RPC", async () => {
  const base = createDemoClient(); let emit!: (event: WorkbenchEvent) => void; let resolve!: (m: MarketSnapshot) => void;
  const store = createWorkbenchStore({ ...base, market: () => new Promise(done => { resolve = done; }), subscribe(listener) { emit = listener; return () => {}; } });
  const release = store.connect(); await Bun.sleep(15);
  try {
    const identity = store.getSnapshot().snapshot!.identity;
    emit({ type: "market", identity: { ...identity, sessionId: "other-session", runId: null }, snapshot: market });
    expect(store.getSnapshot().market).toEqual(market);
    resolve({ ...market, quotes: [] }); await Bun.sleep(2); expect(store.getSnapshot().market?.quotes).toHaveLength(1);
    emit({ type: "market", identity: { ...identity, workspaceId: "foreign" }, snapshot: { ...market, quotes: [] } });
    expect(store.getSnapshot().market?.quotes).toHaveLength(1);
  } finally { release(); }
});
