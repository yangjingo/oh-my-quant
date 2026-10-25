import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fetchBars } from "../../source/index.ts";
import type { BarProviderAdapter, SourceRuntimeDeps } from "../../source/index.ts";
import { loadCachedBars, saveBars } from "../../storage/index.ts";
import { normalizeBarSeries } from "../../market/bars.ts";
import { buildOverviewPanelSections } from "../workspace/overview.ts";
import { buildOverviewView } from "../../../apps/tui/src/overview-render.ts";
import type { Bar } from "../../types/data.ts";

// Public ports and real local storage/TUI view construction, with synthetic loopback transport.
// This measures neither an upstream provider nor terminal output/GPU latency.
const sampleArg = process.argv.indexOf("--samples");
const samples = sampleArg < 0 ? 10 : Number(process.argv[sampleArg + 1]);
if (!Number.isInteger(samples) || samples < 1 || samples > 100) throw new Error("--samples must be 1–100");
const root = mkdtempSync(join(tmpdir(), "ohq-data-measure-")), previous = process.env.OHQUANT_DIR;
const previousNoProxy = process.env.NO_PROXY;
// Keep the loopback fixture off any inherited outbound proxy, as in model-request.test.ts.
process.env.NO_PROXY = "127.0.0.1,localhost";
const concurrency = 8, providerDelayMs = 8;
const bars: Bar[] = Array.from({ length: 260 }, (_, i) => {
  const close = 100 + i * 0.1;
  return { date: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10), open: close, high: close, low: close, close, volume: 100, amount: 1000 };
});
const start = bars[0]!.date, end = bars.at(-1)!.date;
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const mode = new URL(request.url).searchParams.get("mode");
  await Bun.sleep(mode === "timeout" ? 60 : providerDelayMs);
  return mode === "error" ? new Response("Synthetic provider error", { status: 503 }) : Response.json(bars);
} });
type Phase = "queue" | "transport" | "decode" | "adapterNormalize" | "cacheRead" | "cacheWrite" | "request" | "viewModel" | "renderView" | "batch";
const phases: Phase[] = ["queue", "transport", "decode", "adapterNormalize", "cacheRead", "cacheWrite", "request", "viewModel", "renderView", "batch"];
type Mode = "cold" | "hot" | "error" | "timeout";
const cases: unknown[] = [];

function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted.length ? Math.round(sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]! * 1000) / 1000 : null;
  return { count: sorted.length, p50Ms: at(0.5), p95Ms: at(0.95), maxMs: at(1) };
}

try {
  for (const size of [1, 10, 50]) for (const mode of ["cold", "hot", "error", "timeout"] as Mode[]) {
    const timings = Object.fromEntries(phases.map(phase => [phase, [] as number[]])) as Record<Phase, number[]>;
    let successes = 0, failures = 0, timeouts = 0, requests = 0;
    const transportStatuses: Record<string, number> = {};
    const diagnostics = new Set<string>();
    const entries = Array.from({ length: size }, (_, i) => ({ code: `SYNTH${i}`, name: `Synthetic ${i}` }));
    for (let sample = 0; sample < samples; sample++) {
      process.env.OHQUANT_DIR = join(root, `${size}-${mode}-${sample}`);
      let record = mode !== "hot";
      const measure = async <T>(phase: Phase, action: () => Promise<T>): Promise<T> => {
        const started = performance.now();
        try { return await action(); } finally { if (record) timings[phase].push(performance.now() - started); }
      };
      const deps: SourceRuntimeDeps = {
        getPreferredSource: () => "financial-datasets",
        loadCache: (...args) => measure("cacheRead", () => loadCachedBars(...args)),
        saveBars: (...args) => measure("cacheWrite", () => saveBars(...args)),
      };
      const adapter: BarProviderAdapter = { async fetchBars(request) {
        if (record) requests++;
        const raw = await measure("transport", async () => {
          const response = await fetch(`${server.url}?mode=${mode}`, { signal: request.signal });
          if (record) transportStatuses[response.status] = (transportStatuses[response.status] ?? 0) + 1;
          if (!response.ok) throw new Error(`Synthetic HTTP ${response.status}`);
          return response.text();
        });
        let began = performance.now();
        const decoded = JSON.parse(raw) as Bar[];
        if (record) timings.decode.push(performance.now() - began);
        began = performance.now();
        const result = normalizeBarSeries(decoded, request.start, request.end);
        if (record) timings.adapterNormalize.push(performance.now() - began);
        return result;
      } };
      const batch = async () => {
        const submittedAt = performance.now();
        const results = new Array<Bar[]>(entries.length);
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(concurrency, size) }, async () => {
          while (next < entries.length) {
            const i = next++, began = performance.now();
            if (record) timings.queue.push(began - submittedAt);
            const signal = AbortSignal.timeout(mode === "timeout" ? 20 : 5000);
            try {
              const result = await fetchBars(entries[i]!.code, "US", start, end, undefined, {
                deps, providers: { signal, adapters: { "financial-datasets": adapter }, fallbackOrder: { US: ["financial-datasets"] } },
              });
              results[i] = result.bars;
              if (record) { if (result.bars.length === bars.length) successes++; else { failures++; diagnostics.add(JSON.stringify(result.attempts)); } }
            } catch (error) {
              results[i] = [];
              if (record) { failures++; if (signal.aborted) timeouts++; diagnostics.add(error instanceof Error ? error.message : String(error)); }
            } finally { if (record) timings.request.push(performance.now() - began); }
          }
        }));
        if (!record) return;
        let began = performance.now();
        const sections = buildOverviewPanelSections({ portfolio: { symbols: entries }, marketQuotes: [],
          portfolioRows: results.map((values, i) => {
            const last = values.at(-1), prev = values.at(-2);
            return { ...entries[i]!, price: last?.close ?? NaN, pct: last && prev ? (last.close / prev.close - 1) * 100 : NaN };
          }), pullMeta: { sources: results.some(values => values.length) ? ["financial-datasets"] : [], asOfDates: results.some(values => values.length) ? [end] : [] },
        });
        timings.viewModel.push(performance.now() - began);
        began = performance.now();
        const view = buildOverviewView(sections, { x: 0, y: 0, w: 40, h: 24 }, 0);
        if (!view.lines.length) throw new Error("Overview failed to render fixture");
        timings.renderView.push(performance.now() - began);
        timings.batch.push(performance.now() - submittedAt);
      };
      if (mode === "hot") { await batch(); record = true; }
      await batch();
    }
    if ((mode === "cold" || mode === "hot") && successes !== size * samples) throw new Error(`Unexpected failures in ${size}/${mode}: ${[...diagnostics].join("; ")}`);
    if ((mode === "error" || mode === "timeout") && failures !== size * samples) throw new Error(`Missing failure observations in ${size}/${mode}`);
    if (mode === "error" && transportStatuses[503] !== size * samples) throw new Error("Error fixture did not return the intended HTTP 503");
    if (mode === "timeout" && timeouts !== size * samples) throw new Error("Timeout fixture did not abort every request");
    if (mode === "hot" && requests !== 0) throw new Error("Warm requests unexpectedly reached transport");
    const result = { size, mode, samples, successes, failures, timeouts, failureRate: failures / (size * samples), timeoutRate: timeouts / (size * samples), measuredTransportCalls: requests, transportStatuses,
      phases: Object.fromEntries(phases.map(phase => [phase, summarize(timings[phase])])) };
    cases.push(result);
    process.stdout.write(JSON.stringify(result) + "\n");
  }
  const output = resolve(import.meta.dir, "../../../output/data-refresh-baseline.json");
  mkdirSync(join(import.meta.dir, "../../../output"), { recursive: true });
  writeFileSync(output, JSON.stringify({ version: 1, measuredAt: new Date().toISOString(), bun: Bun.version, environment: "synthetic-loopback",
    platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model ?? "unknown", syntheticMarket: "US",
    concurrency, providerDelayMs, timeoutFixtureDelayMs: 60, timeoutDeadlineMs: 20, barsPerSymbol: bars.length, samplesPerCase: samples,
    scope: "Source orchestration, actual disk cache, loopback adapter and Overview view construction. No upstream providers, actual accounts, AppRuntime scheduling or terminal flush.",
    units: "milliseconds; nearest-rank percentiles; per-request phases overlap across concurrency and must not be added to batch wall time; absent phases are null",
    cases }, null, 2) + "\n");
} finally {
  server.stop(true);
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (previousNoProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = previousNoProxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected data measurement directory");
  rmSync(root, { recursive: true, force: true });
}
