/** Actual public AKShare -> AppRuntime Overview -> TUI line construction timing. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { AppRuntime } from "../../../app-runtime.ts";
import { OverviewRequestPool } from "../../workspace/overview-data.ts";
import type { OverviewQuote } from "../../workspace/overview-data.ts";
import { MARKET_INDICES } from "../../workspace/overview.ts";
import { normalizeSymbol } from "../../../market/symbols.ts";
import type { LiveBarsFetchResult } from "../../../source/index.ts";
import { fetchLiveBars } from "../../data/source-runtime.ts";
import { loadSettings, savePanelPortfolio, saveSettings } from "../../../storage/index.ts";
import { buildOverviewLines } from "../../../../apps/tui/src/overview-render.ts";
import type { OverviewRefreshMeasurement } from "../../workspace/overview-refresh.ts";
import { publicOverviewPortfolio } from "./public-overview-fixture.ts";
import { publicOverviewEvidence, type PublicOverviewEvidence } from "./public-overview-evidence.ts";

const PUBLIC_ORDER = { A: ["akshare"], US: ["akshare"], HK: ["akshare"] } as const;
interface Observation extends Partial<PublicOverviewEvidence> {
  sample: number; startedAt: string; outcome: OverviewRefreshMeasurement["outcome"] | "error";
  totalMs: number; firstResultMs: number | null; pullMs?: number; buildMs?: number | null; publishMs?: number | null;
  rows?: number; availableRows?: number; panelCallbacks?: number; renderedLines?: number;
  publicPanel?: ReturnType<typeof buildOverviewLines>;
  requests?: OverviewRefreshMeasurement["requests"]; failure?: string;
}
function percentile(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted.length ? Math.round(sorted[Math.ceil(sorted.length * p) - 1]! * 1000) / 1000 : null;
  return { count: sorted.length, p50Ms: at(0.5), p95Ms: at(0.95), maxMs: at(1) };
}
function stats(items: Observation[]) {
  const completed = items.filter(item => item.outcome === "success" && item.availableRows === item.rows && item.rowIdentitiesMatch
    && item.quoteAudit !== undefined && item.quoteAudit.length === item.rows && item.quoteAudit.every(check => check.passed));
  return { attempts: items.length, complete: completed.length, incomplete: items.length - completed.length,
    incompleteRate: items.length ? (items.length - completed.length) / items.length : null,
    firstResultMs: percentile(items.map(item => item.firstResultMs).filter((value): value is number => value !== null)),
    totalMs: percentile(items.map(item => item.totalMs)), completeTotalMs: percentile(completed.map(item => item.totalMs)) };
}

const { values } = parseArgs({ args: process.argv.slice(2), options: {
  samples: { type: "string" }, "timeout-ms": { type: "string" }, output: { type: "string" }, "portfolio-size": { type: "string" },
}, allowPositionals: false });
const samples = values.samples === undefined ? 5 : Number(values.samples);
const timeoutMs = values["timeout-ms"] === undefined ? 60_000 : Number(values["timeout-ms"]);
const size = values["portfolio-size"] === undefined ? 4 : Number(values["portfolio-size"]);
const portfolio = publicOverviewPortfolio(size);
const expectedRows = MARKET_INDICES.length + portfolio.length;
const expectedUniqueRequests = new Set([...MARKET_INDICES, ...portfolio].map(entry => normalizeSymbol(entry.code))).size;
const expectedRowSymbols = [...MARKET_INDICES, ...portfolio].map(entry => normalizeSymbol(entry.code)).sort();
if (!Number.isInteger(samples) || samples < 1 || samples > 20) throw new Error("--samples must be 1–20.");
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) throw new Error("--timeout-ms must be 1000–120000.");
const output = values.output ? resolve(values.output) : resolve(import.meta.dir, "../../../../output/public-overview-runtime-latency.json");
if (existsSync(output)) throw new Error("Output already exists; choose a new artifact path.");

const root = mkdtempSync(join(tmpdir(), "whyj-public-overview-runtime-"));
const previous = process.env.OHQUANT_DIR;
const interrupted = new AbortController();
const cancel = () => interrupted.abort(new Error("Public Overview measurement cancelled"));
process.once("SIGINT", cancel);
const observations: Observation[] = [];
try {
  for (let sample = 1; sample <= samples; sample++) {
    if (interrupted.signal.aborted) break;
    process.env.OHQUANT_DIR = join(root, String(sample));
    const settings = loadSettings();
    settings.preferences.source = "akshare";
    saveSettings(settings);
    savePanelPortfolio({ updated: "", groups: [], symbols: portfolio });
    let panelCallbacks = 0, renderedLines = 0;
    let publicPanel: ReturnType<typeof buildOverviewLines> = [];
    let publicQuotes: OverviewQuote[] = [];
    const inputs = new Map<string, LiveBarsFetchResult>();
    let measure: OverviewRefreshMeasurement | undefined;
    const startedAt = new Date().toISOString(), began = performance.now();
    const runtime = new AppRuntime({ onActivity() {}, onMessages() {},
      onPanel(panel) { panelCallbacks++; publicPanel = buildOverviewLines(panel, 100); renderedLines = publicPanel.length;
        publicQuotes = panel.flatMap(section => section.kind === "keyvalue" ? [] : section.rows); },
      onMarketRefresh(value) { measure = value; } },
      undefined, undefined, () => { throw new Error("Model initialization during data-only measurement"); },
      undefined, undefined, timeoutMs, 0,
      { poolFactory: (signal, budget) => new OverviewRequestPool({ signal, budget, concurrency: 8,
        fetcher: async (symbol, market, start, end, options) => {
          const result = await fetchLiveBars(symbol, market, start, end, { providers: { ...options?.providers, fallbackOrder: PUBLIC_ORDER } });
          if (!signal.aborted) inputs.set(normalizeSymbol(symbol), structuredClone(result));
          return result;
        } }) });
    try {
      await runtime.refreshOverviewPanel();
      const elapsed = Math.round((performance.now() - began) * 1000) / 1000;
      const evidence = publicOverviewEvidence(publicQuotes, inputs, expectedRowSymbols);
      const receipt: Observation = measure ? { sample, startedAt, outcome: measure.outcome, totalMs: measure.totalMs,
        firstResultMs: measure.firstResultMs, pullMs: measure.pullMs, buildMs: measure.buildMs, publishMs: measure.publishMs,
        rows: measure.rows, availableRows: measure.availableRows, requests: measure.requests, panelCallbacks, renderedLines, publicPanel, ...evidence }
        : { sample, startedAt, outcome: "error", totalMs: elapsed, firstResultMs: null,
          panelCallbacks, renderedLines, publicPanel, failure: "missing-measurement" };
      observations.push(receipt); process.stdout.write(JSON.stringify(receipt) + "\n");
    } catch (error) {
      const receipt: Observation = { sample, startedAt, outcome: "error",
        totalMs: Math.round((performance.now() - began) * 1000) / 1000, firstResultMs: null,
        panelCallbacks, renderedLines, publicPanel, failure: error instanceof Error ? error.name : "unknown" };
      observations.push(receipt); process.stdout.write(JSON.stringify(receipt) + "\n");
    } finally { runtime.dispose(); }
    if (interrupted.signal.aborted) break;
  }
  const codeFiles = ["src/app-runtime.ts", "src/runtime/workspace/overview-refresh.ts", "src/runtime/workspace/overview-data.ts", "src/source/src/sources.ts", "src/source/src/source-providers.ts",
    "src/source/src/akshare.ts", "src/source/src/akshare-python.ts", "src/source/src/akshare-scripts.ts", "src/source/src/akshare-global-bars.ts", "src/source/src/eastmoney-fund-nav.ts",
    "src/source/src/sina-a-history.ts", "src/source/src/sina-global-history.ts", "src/source/src/sina-history-payload.ts", "src/source/src/http.ts", "src/source/src/vendor/sina-history-decoder.js",
    "src/runtime/data/source-runtime.ts", "src/market/symbols.ts", "apps/tui/src/overview-render.ts", "src/runtime/dev/overview/measure-public-overview-runtime.ts", "src/runtime/dev/overview/public-overview-fixture.ts", "src/runtime/dev/overview/public-overview-evidence.ts"];
  const artifact = { version: 1, measuredAt: new Date().toISOString(), bun: Bun.version, platform: process.platform,
    mode: "actual-public-akshare-app-runtime-overview", portfolio: portfolio.map(item => item.code),
    defaultMarketIndices: MARKET_INDICES.length, expectedUniqueRequests, expectedRows, concurrency: 8, samples, timeoutMs,
    scope: "Production AppRuntime/OverviewRefresh, five default indices and an explicit public benchmark portfolio, public AKShare live bars, progressive panel callbacks and TUI line construction. Prices, daily percentage changes, sources and dates compared with the same-run returned bars. No model, account, cache or terminal flush.",
    limitations: "Source live bars are requested in a rolling 45-day window; each sample has a later clock time. The injected pool restricts fallback to public AKShare and sets an isolated preference. firstResultMs ends at the application callback, not terminal visibility. A single-run p95 from fewer than 20 samples is the maximum.",
    codeFiles: codeFiles.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(resolve(import.meta.dir, "../../../..", path))).digest("hex") })),
    summary: stats(observations), observations };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(artifact, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify({ output, summary: artifact.summary }) + "\n");
  if (observations.length !== samples || observations.some(item => item.outcome !== "success"
    || item.availableRows !== item.rows || item.requests?.length !== expectedUniqueRequests || item.rows !== expectedRows
    || !item.rowIdentitiesMatch || item.quoteAudit?.length !== expectedRows || item.quoteAudit.some(check => !check.passed)))
    process.exitCode = interrupted.signal.aborted ? 130 : 1;
} finally {
  process.off("SIGINT", cancel);
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  const absoluteRoot = resolve(root), absoluteTemp = resolve(tmpdir());
  if (!absoluteRoot.startsWith(absoluteTemp + sep)) throw new Error("Unexpected Overview measurement directory.");
  rmSync(absoluteRoot, { recursive: true, force: true });
}
