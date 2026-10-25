/** Actual production cadence in one AppRuntime, using an explicit public portfolio. */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { AppRuntime } from "../../../app-runtime.ts";
import { normalizeSymbol } from "../../../market/symbols.ts";
import { OverviewRequestPool, type OverviewQuote } from "../../workspace/overview-data.ts";
import { MARKET_INDICES } from "../../workspace/overview.ts";
import type { OverviewRefreshMeasurement } from "../../workspace/overview-refresh.ts";
import { fetchLiveBars } from "../../data/source-runtime.ts";
import type { LiveBarsFetchResult } from "../../../source/index.ts";
import { loadSettings, savePanelPortfolio, saveSettings } from "../../../storage/index.ts";
import { buildOverviewLines } from "../../../../apps/tui/src/overview-render.ts";
import { publicOverviewPortfolio } from "./public-overview-fixture.ts";
import { publicOverviewEvidence, type PublicOverviewEvidence } from "./public-overview-evidence.ts";

const { values } = parseArgs({ options: { output: { type: "string" }, samples: { type: "string" } }, allowPositionals: false });
const samples = values.samples === undefined ? 3 : Number(values.samples);
if (!values.output || !Number.isInteger(samples) || samples < 2 || samples > 5) throw new Error("Use --output NEW.json [--samples 2..5]");
const output = resolve(values.output), portfolio = publicOverviewPortfolio(50), intervalMs = 60000, timeoutMs = 120000;
const expectedSymbols = [...MARKET_INDICES, ...portfolio].map(item => normalizeSymbol(item.code));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ status: "running", scope: "public-periodic-overview" }), { flag: "wx" });
const root = mkdtempSync(join(tmpdir(), "whyj-public-overview-periodic-")), previous = process.env.OHQUANT_DIR;
type Observation = OverviewRefreshMeasurement & PublicOverviewEvidence & { sample: number; startedAt: string; finishedAt: string;
  scheduleGapMs: number | null; publicPanel: ReturnType<typeof buildOverviewLines> };
const observations: Observation[] = [];
let finish!: () => void;
const finished = new Promise<void>(resolve => { finish = resolve; });
let runtime: AppRuntime | undefined, interrupted = false, watchdogExpired = false;
let quotes: OverviewQuote[] = [], panel: ReturnType<typeof buildOverviewLines> = [], inputs = new Map<string, LiveBarsFetchResult>();
let startedAt = "", began = 0, previousEnd: number | null = null, gap: number | null = null;
const cancel = () => { interrupted = true; runtime?.dispose(); finish(); };
const watchdog = setTimeout(() => { watchdogExpired = true; runtime?.dispose(); finish(); }, samples * (intervalMs + timeoutMs) + 30000);
process.once("SIGINT", cancel);
try {
  process.env.OHQUANT_DIR = root;
  const settings = loadSettings(); settings.preferences.source = "akshare"; saveSettings(settings);
  savePanelPortfolio({ updated: "", groups: [], symbols: portfolio });
  runtime = new AppRuntime({ onActivity() {}, onMessages() {},
    onPanel(sections) { panel = buildOverviewLines(sections, 100); quotes = sections.flatMap(section => section.kind === "keyvalue" ? [] : section.rows); },
    onMarketRefresh(measure) {
      const ended = performance.now();
      observations.push({ ...measure, ...publicOverviewEvidence(quotes, inputs, expectedSymbols), sample: observations.length + 1,
        startedAt, finishedAt: new Date().toISOString(), scheduleGapMs: gap, publicPanel: structuredClone(panel) });
      previousEnd = ended;
      console.log(JSON.stringify({ generation: measure.generation, outcome: measure.outcome, rows: measure.availableRows, totalMs: measure.totalMs, scheduleGapMs: gap }));
      if (observations.length >= samples) { runtime?.dispose(); finish(); }
    } }, undefined, undefined, () => { throw new Error("Model initialization during data-only measurement"); }, undefined, undefined,
    timeoutMs, intervalMs, { poolFactory: (signal, budget) => {
      inputs = new Map(); startedAt = new Date().toISOString(); began = performance.now(); gap = previousEnd === null ? null : began - previousEnd;
      const generationInputs = inputs;
      return new OverviewRequestPool({ signal, budget, concurrency: 8, fetcher: async (symbol, market, start, end, options) => {
        const result = await fetchLiveBars(symbol, market, start, end, { providers: { ...options?.providers, fallbackOrder: { A: ["akshare"], US: ["akshare"], HK: ["akshare"] } } });
        if (!signal.aborted) generationInputs.set(normalizeSymbol(symbol), structuredClone(result));
        return result;
      } });
    } });
  void runtime.refreshOverviewPanel();
  await finished;
  const schedulePassed = observations.length === samples && observations.every((item, index) => item.generation === index + 1
    && (index === 0 ? item.scheduleGapMs === null : item.scheduleGapMs !== null && item.scheduleGapMs >= intervalMs - 20));
  const passed = !interrupted && !watchdogExpired && schedulePassed && observations.every(item => item.outcome === "success"
    && item.rows === expectedSymbols.length && item.availableRows === expectedSymbols.length && item.rowIdentitiesMatch
    && item.requests.length === new Set(expectedSymbols).size && item.quoteAudit.length === expectedSymbols.length && item.quoteAudit.every(check => check.passed));
  const codeFiles = ["src/app-runtime.ts", "src/runtime/workspace/overview-refresh.ts", "src/runtime/workspace/overview-data.ts", "src/runtime/data/source-runtime.ts",
    "src/source/src/sources.ts", "apps/tui/src/overview-render.ts", "src/runtime/dev/overview/public-overview-fixture.ts", "src/runtime/dev/overview/public-overview-evidence.ts", "src/runtime/dev/overview/measure-public-overview-periodic.ts"];
  const artifact = { version: 1, mode: "actual-public-akshare-app-runtime-overview", schedule: "one-runtime-production-60000ms", passed,
    measuredAt: new Date().toISOString(), samples, intervalMs, timeoutMs, portfolio: portfolio.map(item => item.code),
    expectedRows: expectedSymbols.length, expectedUniqueRequests: new Set(expectedSymbols).size, schedulePassed, interrupted, watchdogExpired,
    limitations: "Three to five in-session public refreshes only. Interval starts after completion, not on a fixed wall-clock minute. No account, paid source, cross-day, market-bar-finality or terminal-pixel validation.",
    codeFiles: codeFiles.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })), observations };
  writeFileSync(output, JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify({ output, passed, samples: observations.length, schedulePassed }));
  if (!passed) process.exitCode = interrupted ? 130 : 1;
} finally {
  clearTimeout(watchdog); process.off("SIGINT", cancel); runtime?.dispose();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected periodic measurement root");
  rmSync(root, { recursive: true, force: true });
}
