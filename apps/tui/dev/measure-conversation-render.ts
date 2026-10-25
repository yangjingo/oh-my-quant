/** Production repaint CPU timings with synthetic history and sink output, not physical terminal latency. */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createInitialAppState } from "../../../src/app-runtime.ts";
import { QuantTui } from "../src/tui.ts";

const { values } = parseArgs({ options: { output: { type: "string" }, check: { type: "boolean" } }, allowPositionals: false });
const root = mkdtempSync(join(tmpdir(), "whyj-render-measurement-"));
const previous = process.env.OHQUANT_DIR;
process.env.OHQUANT_DIR = root;
const results = [];
try {
  for (const messages of [10, 100, 1000, 5000]) {
    const state = createInitialAppState("render measurement");
    state.activity = "ready";
    state.showPortfolioPanel = false;
    state.messages = Array.from({ length: messages }, (_, index) => ({ role: "assistant" as const,
      text: `Synthetic research ${index}: ` + "价格数据、窗口和风险依据需要明确。".repeat(20) }));
    const tui = new QuantTui(state);
    let bytes = 0;
    const sink = { columns: 120, rows: 32, write: (value: string) => { bytes += Buffer.byteLength(value); return true; } };
    tui.screen.out = sink as unknown as NodeJS.WriteStream;
    tui.screen.resize();
    let began = performance.now();
    tui.syncCurrentSessionMeta();
    const coldMs = performance.now() - began;
    bytes = 0;
    const elapsed = [];
    for (let sample = 0; sample < 20; sample++) {
      began = performance.now();
      tui.syncCurrentSessionMeta();
      elapsed.push(performance.now() - began);
    }
    const bytesPerFrame = bytes / elapsed.length;
    elapsed.sort((a, b) => a - b);
    state.messages.at(-1)!.text += " incremental update";
    began = performance.now();
    tui.syncCurrentSessionMeta();
    const changedLastMessageMs = performance.now() - began;
    sink.columns = 80;
    tui.screen.resize();
    began = performance.now();
    tui.syncCurrentSessionMeta();
    const resizeMs = performance.now() - began;
    results.push({ messages, viewport: "120x32", samples: elapsed.length, coldMs, p50Ms: elapsed[9]!, p95Ms: elapsed[18]!,
      maxMs: elapsed[19]!, changedLastMessageMs, resizedViewport: "80x32", resizeMs, bytesPerFrame });
  }
  const report = { version: 1, measuredAt: new Date().toISOString(), platform: process.platform, bun: Bun.version,
    scope: "Public QuantTui repaint entry, production layout/ANSI, synthetic Chinese history, sink output. Cold and resize observations are single samples; warm p95 is nearest-rank from 20 samples. No physical pixels, input latency, live model, market or private session.",
    renderLinesSha256: createHash("sha256").update(readFileSync(resolve(import.meta.dir, "../src/render-lines.ts"))).digest("hex"),
    targets: { warm1000P95Ms: 30, warm5000P95Ms: 80 }, results };
  if (values.output) {
    const output = resolve(values.output);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  }
  process.stdout.write(JSON.stringify(report) + "\n");
  if (values.check && results.some(item => item.messages === 1000 && item.p95Ms > 30 || item.messages === 5000 && item.p95Ms > 80)) process.exitCode = 1;
} finally {
  if (previous === undefined) delete process.env.OHQUANT_DIR;
  else process.env.OHQUANT_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
