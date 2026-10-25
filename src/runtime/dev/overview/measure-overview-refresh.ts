import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { AppRuntime } from "../../../app-runtime.ts";
import { OverviewRequestPool } from "../../workspace/overview-data.ts";
import type { OverviewRefreshMeasurement } from "../../workspace/overview-refresh.ts";
import { fetchLiveBars } from "../../../source/index.ts";
import type { BarProviderAdapter } from "../../../source/index.ts";
import { loadPanelPortfolio, savePanelPortfolio } from "../../../storage/index.ts";
import { buildOverviewView } from "../../../../apps/tui/src/overview-render.ts";

const samples = 10, delayMs = 8;
const { values } = parseArgs({ args: process.argv.slice(2), options: { output: { type: "string" } }, allowPositionals: false });
const outputPath = values.output ? resolve(values.output) : resolve(import.meta.dir, "../../../../output/overview-refresh-baseline.json");
const root = mkdtempSync(join(tmpdir(), "ohq-overview-measure-"));
const previous = process.env.OHQUANT_DIR, previousNoProxy = process.env.NO_PROXY;
process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
const bars = Array.from({ length: 32 }, (_, i) => {
  const close = 100 + i / 10;
  return { date: new Date(Date.UTC(2026, 7, 13 + i)).toISOString().slice(0, 10), open: close, high: close, low: close, close, volume: 10, amount: close * 10 };
});
let mode = "success", transportCalls = 0;
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const query = new URL(request.url).searchParams;
  const scenario = query.get("mode"), slow = query.get("symbol") === "000001.SH";
  await Bun.sleep(scenario === "timeout" ? 70 : slow && scenario === "slow" ? 150 : slow && scenario === "partial-timeout" ? 500 : delayMs);
  return query.get("mode") === "partial" && query.get("symbol") === "000001.SH"
    ? new Response("Synthetic HTTP failure", { status: 503 }) : Response.json(bars);
} });
const adapter: BarProviderAdapter = { async fetchBars(request) {
  transportCalls++;
  const response = await fetch(`${server.url}?mode=${mode}&symbol=${encodeURIComponent(request.symbol)}`, { signal: request.signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json() as typeof bars;
} };
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted.length ? Math.round(sorted[Math.ceil(p * sorted.length) - 1]! * 1000) / 1000 : null;
  return { count: sorted.length, p50Ms: at(0.5), p95Ms: at(0.95) };
}
const cases: unknown[] = [];
try {
  for (const size of [1, 10, 50]) for (mode of ["success", "partial", "timeout", "slow", "partial-timeout"]) {
    const records: OverviewRefreshMeasurement[] = [], renderMs: number[] = [];
    const portfolio = loadPanelPortfolio();
    portfolio.symbols = Array.from({ length: size }, (_, i) => ({ code: i ? `SYNTH${i}` : "000300.SH", name: `合成观察 ${i}`, added: "" }));
    portfolio.groups = []; savePanelPortfolio(portfolio);
    transportCalls = 0;
    const runtime = new AppRuntime({ onActivity() {}, onMessages() {}, onMarketRefresh: measurement => { records.push(measurement); },
      onPanel: panel => {
        const began = performance.now();
        const view = buildOverviewView(panel, { x: 0, y: 0, w: 40, h: 24 });
        if (!view.lines.length) throw new Error("Empty Overview view");
        renderMs.push(performance.now() - began);
      },
    }, undefined, undefined, () => { throw new Error("Measurement must not start a model"); }, undefined, undefined,
    mode === "timeout" ? 20 : mode === "partial-timeout" ? 250 : 5000, 0, { poolFactory: (signal, budget) => new OverviewRequestPool({ signal, budget, now: new Date("2026-09-14T00:00:00Z"),
      fetcher: (symbol, market, start, end, options) => fetchLiveBars(symbol, market, start, end, {
        deps: {
          getPreferredSource: market => market === "A" ? "akshare" : "financial-datasets",
          loadCache: async () => { throw new Error("Live Overview must not read a cache"); },
          saveBars: async () => { throw new Error("Live Overview must not write a cache"); },
        },
        providers: { signal: options?.providers?.signal, adapters: { akshare: adapter, "financial-datasets": adapter },
          fallbackOrder: { A: ["akshare"], US: ["financial-datasets"] } },
      }),
    }) });
    try { for (let sample = 0; sample < samples; sample++) await runtime.refreshOverviewPanel(); }
    finally { runtime.dispose(); }
    const expectedUnique = size + 4;
    const expectedOutcome = mode === "slow" ? "success" : mode === "partial-timeout" ? "timeout" : mode;
    if (records.length !== samples || records.some(record => record.outcome !== expectedOutcome)) throw new Error(`Unexpected refresh outcomes in ${size}/${mode}`);
    if (records.some(record => record.requests.length !== expectedUnique)) throw new Error("Unexpected request deduplication count");
    if (expectedOutcome !== "timeout" && transportCalls !== samples * expectedUnique) throw new Error("Unexpected duplicate transport calls");
    if ((mode === "slow" || mode === "partial-timeout") && records.some(record => record.firstResultMs === null || record.firstResultMs >= record.totalMs || !record.availableRows)) {
      throw new Error("Slow-request fixture did not preserve an earlier usable result");
    }
    const requests = records.flatMap(record => record.requests);
    const result = { size, mode, samples, uniqueRequestsPerGeneration: expectedUnique, transportCalls,
      outcomes: Object.fromEntries(["success", "partial", "timeout", "error"].map(outcome => [outcome, records.filter(record => record.outcome === outcome).length])),
      requestOutcomes: Object.fromEntries(["success", "empty", "error", "cancelled"].map(outcome => [outcome, requests.filter(request => request.outcome === outcome).length])),
      total: stats(records.map(record => record.totalMs)), queue: stats(requests.map(request => request.queueMs)),
      firstResult: stats(records.flatMap(record => record.firstResultMs === null ? [] : [record.firstResultMs])),
      availableRows: records.map(record => record.availableRows),
      fetch: stats(requests.flatMap(request => request.fetchMs === null ? [] : [request.fetchMs])),
      pull: stats(records.map(record => record.pullMs)), build: stats(records.flatMap(record => record.buildMs === null ? [] : [record.buildMs])),
      publish: stats(records.flatMap(record => record.publishMs === null ? [] : [record.publishMs])), renderView: stats(renderMs) };
    cases.push(result); process.stdout.write(JSON.stringify(result) + "\n");
  }
  mkdirSync(resolve(outputPath, ".."), { recursive: true });
  writeFileSync(outputPath, JSON.stringify({ version: 2, measuredAt: new Date().toISOString(),
    bun: Bun.version, platform: process.platform, cpu: cpus()[0]?.model, samples, concurrency: 8, delayMs,
    timeoutDeadlineMs: 20, timeoutFixtureDelayMs: 70, barsPerSymbol: bars.length,
    slowFixtureDelayMs: 150, partialTimeoutDeadlineMs: 250, partialTimeoutFixtureDelayMs: 500,
    scope: "Real AppRuntime refresh, source orchestration, live queue/deduplication, local metadata storage and Overview view construction with loopback adapters. No market/account/model calls, periodic 60-second cadence or terminal flush measurement.",
    units: "milliseconds; nearest-rank percentiles; ten-sample p95 is the maximum; overlapping phases must not be added; absent phases are null; build/publish sum each generation's progressive and final work; renderView samples individual callbacks including loading; firstResult ends after the first usable current-generation panel callback", cases }, null, 2) + "\n");
} finally {
  server.stop(true);
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (previousNoProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = previousNoProxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected Overview measurement directory");
  rmSync(root, { recursive: true, force: true });
}
