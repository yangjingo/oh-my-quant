import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setImmediate } from "node:timers/promises";
import { PanelController } from "../src/panel.ts";
import { DataSettingsPanel } from "../src/data-settings-panel.ts";
import { Buffer, strWidth } from "../src/buffer.ts";
import { loadSettings, saveSettings, resolveSettingsPath } from "../../../src/storage/index.ts";
import { probeDataConnection } from "../../../src/runtime/data/data-readiness.ts";
import type { PythonReadiness } from "../../../src/types/data-readiness.ts";

let root: string, previous: string | undefined, noProxy: string | undefined;
let panel: PanelController;
let server: ReturnType<typeof Bun.serve>;
let response: "success" | "empty" | "wait" | number;
let release: (() => void) | undefined;
let changes: number;
const key = (name: string) => ({ name });
function screen(width = 80, height = 24, target: Pick<PanelController, "render"> = panel): string {
  const buffer = new Buffer(width, height); target.render(buffer);
  expect(buffer.toPlain().every(line => strWidth(line) <= width)).toBe(true);
  return buffer.toPlain().join("\n");
}
function select(label: string, target: Pick<PanelController, "render" | "handleKey"> = panel, width = 80, height = 24): void {
  for (let i = 0; i < 15; i++) {
    if (screen(width, height, target).split("\n").some(line => line.includes(`> ${label} `))) return;
    target.handleKey("", key("down"));
  }
  throw new Error(`Could not focus ${label}`);
}
async function until(predicate: () => boolean): Promise<void> {
  const end = Date.now() + 2000;
  while (!predicate()) { if (Date.now() > end) throw new Error("Data check did not settle"); await setImmediate(); }
}
async function check(): Promise<void> {
  const count = changes; select("Check data"); panel.handleKey("", key("return"));
  await until(() => changes >= count + 2);
}
beforeEach(() => {
  previous = process.env.OHQUANT_DIR; noProxy = process.env.NO_PROXY;
  root = mkdtempSync(join(tmpdir(), "whyj-data-panel-")); process.env.OHQUANT_DIR = root;
  process.env.NO_PROXY = "127.0.0.1,localhost"; response = "success"; release = undefined; changes = 0;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch() {
    if (response === "wait") await new Promise<void>(resolve => { release = resolve; });
    if (typeof response === "number") return new Response("PRIVATE fixture-new-key", { status: response });
    return Response.json({ prices: response === "empty" ? [] : [{ date: new Date().toISOString().slice(0, 10), open: 10, high: 10, low: 10, close: 10, volume: 1 }] });
  } });
  const cfg = loadSettings(); cfg.preferences.source = "financial-datasets";
  cfg.env = { WHYJ_QUANT_FINANCIAL_DATASETS_KEY: "fixture-saved-key", FINANCIAL_DATASETS_BASE_URL: String(server.url).replace(/\/$/, "") }; saveSettings(cfg);
  panel = new PanelController(undefined, { processEnv: {}, onChange: () => changes++ });
  panel.open("config"); select("Market Data"); panel.handleKey("", key("return"));
});
afterEach(() => {
  panel.close(); release?.(); server.stop(true);
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (noProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = noProxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected data panel test directory");
  rmSync(root, { recursive: true, force: true });
});

it("verifies through real HTTP without writing, reports failures, and only persists an explicitly saved successful draft", async () => {
  const before = readFileSync(resolveSettingsPath(), "utf8");
  select("API key"); panel.handleKey("", key("return")); panel.handleKey("fixture-new-key", key(""));
  expect(screen()).not.toContain("fixture-new-key"); expect(screen()).toContain("••••");
  panel.handleKey("", key("return"));
  for (const [mode, detail] of [[401, "auth-failed"], [403, "permission-denied"], ["empty", "empty"], [503, "unavailable"]] as const) {
    response = mode; await check(); expect(screen()).toContain(detail); expect(screen()).not.toContain("PRIVATE");
    select("Save verified"); expect(panel.handleKey("", key("return"))).toEqual({});
    expect(readFileSync(resolveSettingsPath(), "utf8")).toBe(before);
  }
  response = "success"; await check(); expect(screen()).toContain("1 valid rows");
  expect(readFileSync(resolveSettingsPath(), "utf8")).toBe(before);
  select("Save verified"); expect(panel.handleKey("", key("return"))).toEqual({ refreshPanel: true });
  expect(loadSettings().env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY).toBe("fixture-new-key");
});

it("retains a conflicting verified draft without overwriting newer saved data", async () => {
  await check(); const other = loadSettings(); other.env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY = "other-terminal-key"; saveSettings(other);
  select("Save verified"); expect(panel.handleKey("", key("return"))).toEqual({});
  expect(screen()).toContain("Settings changed."); expect(screen()).toContain("Data connection");
  expect(loadSettings().env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY).toBe("other-terminal-key");
  panel.handleKey("", key("escape")); select("External Skills"); panel.handleKey("", key("return"));
  expect(loadSettings().env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY).toBe("other-terminal-key");
});

it("cancels a waiting request on Escape or parent replacement without later repaint or settings changes", async () => {
  const before = readFileSync(resolveSettingsPath(), "utf8"); response = "wait";
  select("Check data"); panel.handleKey("", key("return")); await until(() => !!release);
  expect(panel.handleKey("", key("escape"))).toEqual({}); expect(screen()).toContain("Check cancelled");
  const count = changes; release!(); await setImmediate(); expect(changes).toBe(count);
  release = undefined; select("Check data"); panel.handleKey("", key("return")); await until(() => !!release);
  panel.open("help"); const closedCount = changes;
  release!(); await setImmediate(); expect(changes).toBe(closedCount); expect(screen()).not.toContain("Data connection");
  expect(readFileSync(resolveSettingsPath(), "utf8")).toBe(before);
});

it("shows AKShare dependency failures and keeps every field and cursor reachable on narrow terminals", async () => {
  for (const [width, height] of [[60, 20], [80, 24], [120, 32]]) {
    let dependency: PythonReadiness = { status: "missing-python" };
    let updated = 0;
    const cfg = loadSettings(); cfg.preferences.source = "akshare"; cfg.preferences.defaultMarket = "A";
    const editor = new DataSettingsPanel(cfg, { processEnv: {}, onChange: () => updated++, probe: (s, r, o) => probeDataConnection(s, r, { ...o, checkDependency: async () => dependency }) });
    expect(screen(width, height, editor)).toContain("Requires Python 3 + akshare");
    for (const state of ["missing-python", "missing-package"] as const) {
      dependency = { status: state }; const count = updated;
      select("Check data", editor, width, height); editor.handleKey("", key("return"));
      await until(() => updated >= count + 2); expect(screen(width, height, editor)).toContain(state);
      select("Save verified", editor, width, height); expect(editor.handleKey("", key("return"))).toEqual({});
    }
    select("Symbol", editor, width, height); editor.handleKey("", key("return"));
    editor.handleKey("X".repeat(200), key("")); editor.handleKey("", key("home")); editor.handleKey("", key("right"));
    expect(screen(width, height, editor)).toContain("0|00001.SZ");
    editor.handleKey("", key("escape")); editor.dispose();
  }
});
