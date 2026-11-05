import { expect, it } from "bun:test";
import { createBuiltinTools, findBuiltinTool, builtinToolDisplay, listBuiltinToolCapabilities } from "../registry.ts";

it("dispatches the real registered scanner and exposes partial coverage through tool updates/results", async () => {
  let calls = 0;
  const tools = createBuiltinTools({ mainboardScan: {
    universe: async () => ({ members: [{ symbol: "000001.SZ", name: "SZ", exchange: "SZ" }, { symbol: "600000.SH", name: "SH", exchange: "SH" }],
      sources: ["SH", "SZ"].map(exchange => ({ exchange: exchange as "SH" | "SZ", endpoint: exchange, observedAt: new Date().toISOString(), count: 1 })) }),
    bars: async () => { calls++; throw new Error("fixture endpoint failure"); },
  } });
  const scanner = tools.find(tool => tool.name === "scan_mainboard")!;
  expect(scanner.parameters).toBe(findBuiltinTool("scan_mainboard")!.parameters);
  const updates: unknown[] = [];
  const result = await scanner.execute("scan-call", { start: "2026-01-01", end: "2026-01-31", limit: 1 }, undefined, update => updates.push(update));
  expect(calls).toBe(1); expect(updates.length).toBe(2);
  expect(result.details).toMatchObject({ status: "partial", coverage: { universe: 2, attempted: 1, succeeded: 0, failed: 1, unattempted: 1 } });
  expect(JSON.stringify(result.content)).toContain("partial");
  expect(builtinToolDisplay("scan_mainboard")?.label).toBe("Quant.MainboardScan");
  expect(listBuiltinToolCapabilities().find(tool => tool.name === "scan_mainboard")!.requirements).toMatchObject({ capability: "mainboard-scan" });
});

it("returns both factor values and pinned provenance through the registered success path", async () => {
  const scanner = createBuiltinTools({ mainboardScan: {
    universe: async () => ({ members: [{ symbol: "000001.SZ", name: "SZ", exchange: "SZ" }, { symbol: "600000.SH", name: "SH", exchange: "SH" }],
      sources: ["SH", "SZ"].map(exchange => ({ exchange: exchange as "SH" | "SZ", endpoint: exchange, observedAt: new Date().toISOString(), count: 1 })) }),
    bars: async symbol => ({ bars: [10, 12].map((close, i) => ({ date: `2026-01-0${i + 1}`, open: close, high: close, low: close, close, volume: 1, amount: 1 })),
      source: "akshare", origin: "cache", attempts: [], asOfDate: "2026-01-02",
      dataset: { version: 1, kind: "daily-bars", symbol, market: "A", source: "akshare", revision: "tool-fixture", contentHash: "fixture",
        dates: ["2026-01-01", "2026-01-02"], requested: { start: "2026-01-01", end: "2026-01-02" },
        snapshotAt: "2026-01-03T00:00:00.000Z", adjustment: "forward-adjusted", availability: "observed-at-fetch" } }),
  } }).find(tool => tool.name === "scan_mainboard")!;
  const result = await scanner.execute("scan-success", { start: "2026-01-01", end: "2026-01-02", momentum_period: 1, rsi_period: 1 });
  expect(result.details).toMatchObject({ status: "complete", ranked: 2, coverage: { succeeded: 2, failed: 0 },
    rows: [{ symbol: "000001.SZ", rsi: 100, dataset: { revision: "tool-fixture" } }, { symbol: "600000.SH", rsi: 100 }] });
  expect(JSON.stringify(result.content)).toContain("momentum 0.2000");
  expect(JSON.stringify(result.content)).toContain("dataset tool-fixture");
});
