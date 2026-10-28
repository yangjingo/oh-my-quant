import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkbenchService } from "../service.ts";
import { createMarketOverview } from "../market.ts";

test("failed refresh keeps dated cache and retry requests only failed rows", async () => {
  let round = 0; const batches: string[][] = [];
  const overview = createMarketOverview(() => {}, { intervalMs: 0, loadPortfolio: () => ({ symbols: [] }), quoteFetcher: async entries => {
    batches.push(entries.map(entry => entry.code));
    return entries.map((entry, index) => ({ ...entry, price: round === 1 && index === 0 ? NaN : 100, pct: 1,
      observation: { symbol: entry.code, source: "akshare", sourceLabel: "AKShare", asOfDate: "2026-10-23", fetchedAt: "2026-10-24T00:00:00Z", state: "available", fallback: false } }));
  } }, () => "green-up");
  const settled = async () => { for (let i = 0; i < 100 && overview.snapshot().status === "fetching"; i++) await Bun.sleep(2); await Bun.sleep(2); };
  try {
    overview.read(); await settled(); expect(overview.snapshot().source.available).toBe(5);
    expect(overview.snapshot().colorScheme).toBe("green-up");
    round = 1; overview.refresh(false); await settled();
    expect(overview.snapshot().quotes[0]).toMatchObject({ value: 100, freshness: "stale", asOfDate: "2026-10-23" });
    expect(overview.snapshot().status).toBe("partial"); expect(overview.snapshot().retryable).toBe(true);
    round = 2; overview.refresh(true); await settled(); expect(batches[2]).toEqual(["000001.SH"]);
    expect(overview.snapshot().source.available).toBe(5);
  } finally { overview.close(); }
});

test("deadline returns explicit timeout and disposal aborts provider work", async () => {
  let signal: AbortSignal | undefined;
  const overview = createMarketOverview(() => {}, { timeoutMs: 10, intervalMs: 0, loadPortfolio: () => ({ symbols: [] }), quoteFetcher: async (_entries, meta) => {
    signal = meta.signal; return new Promise((_resolve, reject) => meta.signal!.addEventListener("abort", () => reject(meta.signal!.reason), { once: true }));
  } });
  overview.read(); await Bun.sleep(30);
  expect(signal?.aborted).toBe(true); expect(overview.snapshot().status).toBe("timeout"); overview.close();
});

test("closing the overview aborts an unfinished request and suppresses late publication", async () => {
  let signal: AbortSignal | undefined, count = 0;
  const overview = createMarketOverview(() => { count++; }, { intervalMs: 0, loadPortfolio: () => ({ symbols: [] }), quoteFetcher: async (_entries, meta) => {
    signal = meta.signal; return new Promise((_resolve, reject) => meta.signal!.addEventListener("abort", () => reject(meta.signal!.reason), { once: true }));
  } });
  overview.read(); await Bun.sleep(2); overview.close(); const before = count; await Bun.sleep(2);
  expect(signal?.aborted).toBe(true); expect(count).toBe(before);
});

test("configured overview publishes quotes independently of a completed research run", async () => {
  const previous = process.env.OHQUANT_DIR;
  const root = mkdtempSync(join(tmpdir(), "whyj-market-")); process.env.OHQUANT_DIR = root;
  const service = createWorkbenchService({ overview: { intervalMs: 0, loadPortfolio: () => ({ symbols: [] }),
    quoteFetcher: async entries => entries.map(entry => ({ ...entry, price: 100, pct: 1.5,
      observation: { symbol: entry.code, source: "akshare", sourceLabel: "AKShare", asOfDate: "2026-10-23", fetchedAt: "2026-10-24T00:00:00Z", state: "available", fallback: false } })) } });
  try {
    const events: unknown[] = []; const release = service.client.subscribe(event => { if (event.type === "market") events.push(event); });
    await service.client.market();
    for (let i = 0; i < 50 && !(await service.client.market()).quotes.length; i++) await Bun.sleep(2);
    const market = await service.client.market();
    expect(market.quotes).toHaveLength(5);
    expect(market.quotes[0]).toMatchObject({ value: 100, change: 1.5, asOfDate: "2026-10-23", provider: "AKShare" });
    expect(events.length).toBeGreaterThan(0);
    release();
  } finally { await service.close(); if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous; rmSync(root, { recursive: true, force: true }); }
});
