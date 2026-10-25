import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setImmediate } from "node:timers/promises";
import { AppRuntime, createInitialAppState } from "../../src/app-runtime.ts";
import { QuantTui } from "../../apps/tui/src/tui.ts";
import { loadSettings, saveSettings } from "../../src/storage/index.ts";
import type { DoctorResult } from "../../src/types/doctor.ts";

let root: string;
let previous: Record<string, string | undefined>;
let runtime: AppRuntime;
let server: ReturnType<typeof Bun.serve>;
let held: Array<() => void>;
let snapshots: Array<DoctorResult | undefined>;
let hold = true;
async function until(predicate: () => boolean): Promise<void> {
  const end = Date.now() + 2000;
  while (!predicate()) { if (Date.now() > end) throw new Error("Expected Doctor event did not arrive"); await setImmediate(); }
}
beforeEach(() => {
  previous = { OHQUANT_DIR: process.env.OHQUANT_DIR, NO_PROXY: process.env.NO_PROXY, WHYJ_DOCTOR_SKIP_NETWORK: process.env.WHYJ_DOCTOR_SKIP_NETWORK };
  root = mkdtempSync(join(tmpdir(), "whyj-doctor-lifetime-"));
  process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost"; delete process.env.WHYJ_DOCTOR_SKIP_NETWORK;
  held = []; snapshots = []; hold = true;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch() {
    if (hold) await new Promise<void>(resolve => held.push(resolve));
    return Response.json({ prices: [{ date: new Date().toISOString().slice(0, 10), open: 10, high: 10, low: 10, close: 10, volume: 1 }] });
  } });
  const cfg = loadSettings(); cfg.preferences.source = "financial-datasets";
  cfg.env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY = "fixture-data-key";
  cfg.env.FINANCIAL_DATASETS_BASE_URL = String(server.url).replace(/\/$/, ""); saveSettings(cfg);
  runtime = new AppRuntime({ onMessages: () => {}, onActivity: () => {}, onDoctorRequest: doctor => snapshots.push(doctor as DoctorResult | undefined) });
});
afterEach(() => {
  runtime.dispose(); for (const release of held) release(); server.stop(true);
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected Doctor test directory");
  rmSync(root, { recursive: true, force: true });
});

it("settles a cancelled real data request without publishing late progress, and can start a new diagnostic", async () => {
  let settled = false;
  const run = runtime.submit("/doctor --phase data").then(() => { settled = true; });
  await until(() => held.length === 1);
  runtime.cancelDoctor(); const count = snapshots.length;
  await until(() => settled); await run;
  expect(snapshots).toHaveLength(count);
  held[0]!(); await setImmediate(); expect(snapshots).toHaveLength(count);
  hold = false;
  await runtime.submit("/doctor --phase data");
  expect(snapshots.at(-1)?.phases.find(phase => phase.phase === "data")).toMatchObject({ status: "pass", data: { rowCount: 1 } });
});

it("supersedes an older diagnostic and lets only the current run publish its result", async () => {
  const first = runtime.submit("/doctor --phase data"); await until(() => held.length === 1);
  hold = false;
  await runtime.submit("/doctor --phase data"); await first;
  const final = snapshots.at(-1), count = snapshots.length;
  expect(final?.phases[2]?.status).toBe("pass");
  held[0]!(); await setImmediate();
  expect(snapshots).toHaveLength(count); expect(snapshots.at(-1)).toBe(final);
});

it("cancels a slash endpoint check through the runtime without opening a three-phase Doctor report", async () => {
  const date = new Date().toISOString().slice(0, 10);
  const command = `/doctor --tool fetch_bars --market US --provider financial-datasets --symbol AAPL --start ${date} --end ${date}`;
  let settled = false;
  const first = runtime.submit(command).then(() => { settled = true; });
  await until(() => held.length === 1); expect(snapshots).toHaveLength(0);
  runtime.cancelDoctor(); await until(() => settled); await first;
  held[0]!(); await setImmediate(); expect(snapshots).toHaveLength(0);
  hold = false; await runtime.submit(command); expect(snapshots).toHaveLength(0);
});

it("wires Doctor replacement and Escape to cancellation so the old request cannot reopen the TUI", async () => {
  const tui = new QuantTui(createInitialAppState("test"));
  const flush = spyOn(tui.screen, "flush").mockImplementation(() => {});
  runtime.dispose();
  let publications = 0;
  runtime = new AppRuntime({ onMessages: () => {}, onActivity: () => {}, onDoctorRequest: doctor => { publications++; tui.openDoctor(doctor); } });
  tui.onDoctorClose(() => runtime.cancelDoctor());
  try {
    const first = runtime.submit("/doctor --phase data"); await until(() => held.length === 1);
    tui.openConfig(); const count = publications;
    await first; held[0]!(); await setImmediate();
    expect(publications).toBe(count); expect(tui.screen.buf.toPlain().join("\n")).toContain("Settings");
    const next = runtime.submit("/doctor --phase data"); await until(() => held.length === 2);
    const keyboard = tui as unknown as { handleKeyAction(action: { type: "key"; name: string }): void };
    keyboard.handleKeyAction({ type: "key", name: "escape" });
    const closedCount = publications;
    await next; held[1]!(); await setImmediate(); expect(publications).toBe(closedCount);
  } finally { flush.mockRestore(); }
});
