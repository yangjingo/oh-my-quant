import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { AppRuntime, createInitialAppState } from "../../../src/app-runtime.ts";
import { OverviewRequestPool } from "../../../src/runtime/workspace/overview-data.ts";
import type { OverviewRefreshMeasurement } from "../../../src/runtime/workspace/overview-refresh.ts";
import { fetchLiveBars } from "../../../src/source/index.ts";
import type { BarProviderAdapter } from "../../../src/source/index.ts";
import { loadPanelPortfolio, savePanelPortfolio } from "../../../src/storage/index.ts";
import { ansi } from "../src/buffer.ts";
import { QuantTui } from "../src/tui.ts";
import type { PanelSection } from "../../../src/types/ui.ts";

const { values } = parseArgs({ args: process.argv.slice(2), options: {
  output: { type: "string" }, samples: { type: "string" },
}, allowPositionals: false });
if (!process.stdout.isTTY) throw new Error("Run in a native PTY; redirected stdout cannot measure terminal timing");
if (!values.output) throw new Error("Provide a new --output path");
const outputPath = resolve(values.output);
if (existsSync(outputPath)) throw new Error(`Refusing to overwrite ${outputPath}`);
const samples = values.samples === undefined ? 5 : Number(values.samples);
if (!Number.isSafeInteger(samples) || samples < 1 || samples > 20) throw new Error("--samples must be an integer from 1 to 20");
const root = mkdtempSync(join(tmpdir(), "ohq-pty-measure-"));
const previous = process.env.OHQUANT_DIR, previousNoProxy = process.env.NO_PROXY;
process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
const bars = Array.from({ length: 32 }, (_, i) => {
  const close = 100 + i / 10;
  return { date: new Date(Date.UTC(2026, 7, 13 + i)).toISOString().slice(0, 10), open: close, high: close, low: close, close, volume: 10, amount: close * 10 };
});
let mode = "success";
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const query = new URL(request.url).searchParams;
  const slow = query.get("symbol") === "000001.SH";
  await Bun.sleep(slow && query.get("mode") === "slow" ? 150
    : slow && query.get("mode") === "partial-timeout" ? 500 : 8);
  return Response.json(bars);
} });
const adapter: BarProviderAdapter = { async fetchBars(request) {
  const response = await fetch(`${server.url}?mode=${mode}&symbol=${encodeURIComponent(request.symbol)}`, { signal: request.signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json() as typeof bars;
} };

type Frame = { run: number; usable: boolean; completedAt: number | null; bytes: number };
type AnsiProbe = { run: number; replyAt: number | null };
const frames: Frame[] = [];
const probes: AnsiProbe[] = [], pendingProbes: AnsiProbe[] = [];
const queriedRuns = new Set<number>();
let run = -1, panelUsable = false, pendingWrites = 0;
const realOutput = process.stdout;
const write = realOutput.write.bind(realOutput);
const measuredOutput = {
  get columns() { return realOutput.columns; }, get rows() { return realOutput.rows; },
  write(chunk: string) {
    const isFrame = chunk.startsWith(ansi.syncOn) && chunk.endsWith(ansi.syncOff);
    const frame: Frame | undefined = isFrame ? { run, usable: panelUsable, completedAt: null, bytes: Buffer.byteLength(chunk) } : undefined;
    if (frame) { frames.push(frame); pendingWrites++; }
    return write(chunk, () => {
      if (frame) {
        frame.completedAt = performance.now(); pendingWrites--;
        if (frame.usable && !queriedRuns.has(frame.run)) {
          queriedRuns.add(frame.run);
          const probe: AnsiProbe = { run: frame.run, replyAt: null };
          probes.push(probe); pendingProbes.push(probe);
          write("\x1b[6n");
        }
      }
    });
  },
  once(event: string, listener: () => void) { realOutput.once(event, listener); return measuredOutput; },
  off(event: string, listener: () => void) { realOutput.off(event, listener); return measuredOutput; },
};
const tui = new QuantTui(createInitialAppState("PTY measurement"));
tui.state.activity = "ready";
tui.state.showPortfolioPanel = true;
tui.screen.out = measuredOutput as unknown as NodeJS.WriteStream;
const runningTui = tui as unknown as { running: boolean };
let inputBuffer = "";
function onTerminalInput(chunk: Buffer): void {
  inputBuffer += chunk.toString();
  while (true) {
    const reply = /\x1b\[\d+;\d+R/.exec(inputBuffer);
    if (!reply) { inputBuffer = inputBuffer.slice(-64); return; }
    inputBuffer = inputBuffer.slice(reply.index + reply[0].length);
    const probe = pendingProbes.shift();
    if (probe) probe.replyAt = performance.now();
  }
}
function hasCurrentQuote(panel: PanelSection[]): boolean {
  const marker = panel.find(section => section.title === "Market Refresh" && section.kind === "keyvalue");
  if (marker?.kind === "keyvalue" && !marker.rows.some(row => row.label === "status" && row.value.includes("已返回"))) return false;
  return panel.some(section => (section.kind === "holdings" || section.kind === "quotes" || section.kind === "group")
    && section.rows.some(row => Number.isFinite(row.price) && Number.isFinite(row.pct)));
}
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted.length ? Math.round(sorted[Math.ceil(p * sorted.length) - 1]! * 1000) / 1000 : null;
  return { count: sorted.length, p50: at(0.5), p95: at(0.95) };
}
async function waitForOutput(): Promise<void> {
  const until = performance.now() + 2000;
  while (pendingWrites || pendingProbes.length || (tui.screen as unknown as { blocked: boolean; pendingFrame: boolean }).blocked
    || (tui.screen as unknown as { pendingFrame: boolean }).pendingFrame) {
    if (performance.now() > until) throw new Error("PTY output did not drain within 2 seconds");
    await Bun.sleep(5);
  }
}

const cases: unknown[] = [];
try {
  process.stdin.setRawMode(true);
  process.stdin.on("data", onTerminalInput);
  process.stdin.resume();
  tui.screen.enter(); runningTui.running = true;
  await waitForOutput();
  for (const size of [1, 10, 50]) for (mode of ["success", "slow", "partial-timeout"]) {
    const portfolio = loadPanelPortfolio();
    portfolio.symbols = Array.from({ length: size }, (_, i) => ({ code: i ? `SYNTH${i}` : "000300.SH", name: `合成观察 ${i}`, added: "" }));
    portfolio.groups = []; savePanelPortfolio(portfolio);
    const measurements: OverviewRefreshMeasurement[] = [];
    const refreshMs: number[] = [], firstWriteCallbackMs: number[] = [], firstAnsiReplyMs: number[] = [], lastWriteCallbackMs: number[] = [];
    const frameCount: number[] = [], frameBytes: number[] = [];
    const runtime = new AppRuntime({ onActivity() {}, onMessages() {}, onMarketRefresh: measurement => { measurements.push(measurement); },
      onPanel: (panel, loading) => {
        panelUsable = hasCurrentQuote(panel);
        tui.update({ panel, panelLoading: loading });
      },
    }, undefined, undefined, () => { throw new Error("Measurement must not start a model"); }, undefined, undefined,
    mode === "partial-timeout" ? 250 : 5000, 0, { poolFactory: (signal, budget) => new OverviewRequestPool({ signal, budget,
      now: new Date("2026-09-14T00:00:00Z"),
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
    try {
      for (let sample = 0; sample < samples; sample++) {
        run++; panelUsable = false;
        const started = performance.now();
        await runtime.refreshOverviewPanel();
        await waitForOutput();
        const sent = frames.filter(frame => frame.run === run);
        const completed = sent.filter(frame => frame.completedAt !== null);
        const usable = completed.find(frame => frame.usable);
        if (!usable || completed.length !== sent.length) throw new Error(`Missing complete usable PTY frame in ${size}/${mode}/${sample}`);
        const probe = probes.find(probe => probe.run === run);
        if (!probe?.replyAt) throw new Error(`Missing ANSI cursor-position reply in ${size}/${mode}/${sample}`);
        const last = completed.at(-1)!;
        refreshMs.push(performance.now() - started);
        firstWriteCallbackMs.push(usable.completedAt! - started);
        firstAnsiReplyMs.push(probe.replyAt - started);
        lastWriteCallbackMs.push(last.completedAt! - started);
        frameCount.push(completed.length);
        frameBytes.push(completed.reduce((total, frame) => total + frame.bytes, 0));
      }
    } finally { runtime.dispose(); }
    const expected = mode === "partial-timeout" ? "timeout" : "success";
    if (measurements.length !== samples || measurements.some(m => m.outcome !== expected || m.requests.length !== size + 4))
      throw new Error(`Unexpected refresh result in ${size}/${mode}`);
    cases.push({ size, mode, samples, outcome: expected, firstPanelMs: stats(measurements.flatMap(m => m.firstResultMs === null ? [] : [m.firstResultMs])),
      firstFrameWriteCallbackMs: stats(firstWriteCallbackMs), firstFrameAnsiReplyMs: stats(firstAnsiReplyMs),
      lastFrameWriteCallbackMs: stats(lastWriteCallbackMs), refreshAndDrainMs: stats(refreshMs),
      frameWrites: stats(frameCount), frameBytes: stats(frameBytes), availableRows: measurements.map(m => m.availableRows) });
  }
  mkdirSync(resolve(outputPath, ".."), { recursive: true });
  writeFileSync(outputPath, JSON.stringify({ version: 2, measuredAt: new Date().toISOString(), platform: process.platform,
    bun: Bun.version, cpu: cpus()[0]?.model, terminal: { columns: realOutput.columns, rows: realOutput.rows }, samples,
    scope: "Real QuantTui/Screen full-frame ANSI writes through a native Windows PTY, AppRuntime refresh, live request pool and loopback adapters. No external market/account/model calls. Node stdout write callbacks confirm stream write completion. An ordered ESC[6n cursor-position reply after the first usable frame confirms terminal ANSI input was parsed up to that query; neither stage proves painted pixels or human-visible latency.",
    units: "Time fields are milliseconds; frameWrites and frameBytes are counts and bytes. Nearest-rank percentiles. firstFrameWriteCallbackMs is the first frame written after a current-generation usable panel callback; firstFrameAnsiReplyMs is the terminal cursor-position reply to a query written after that frame callback; lastFrameWriteCallbackMs is the last full-frame write callback after refresh. refreshAndDrainMs includes a 5 ms polling step. 50-row panels may scroll beyond the 80x24 viewport.",
    cases }, null, 2) + "\n");
} finally {
  runningTui.running = false;
  process.stdin.off("data", onTerminalInput);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  tui.screen.exit();
  server.stop(true);
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (previousNoProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = previousNoProxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected PTY measurement directory");
  rmSync(root, { recursive: true, force: true });
}
