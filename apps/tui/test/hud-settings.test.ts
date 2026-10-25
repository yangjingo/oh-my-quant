import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { QuantTui } from "../src/tui.ts";
import { PanelController } from "../src/panel.ts";
import { Buffer } from "../src/buffer.ts";
import type { InputAction } from "../src/input.ts";
import { createInitialAppState } from "../../../src/app-runtime.ts";
import { loadSettings, saveSettings } from "../../../src/storage/index.ts";
import { resolveCompactTriggerTokens, resolveConfiguredModel } from "../../../src/runtime/models/model-settings.ts";

let root: string, previous: string | undefined;
let panel: PanelController;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "whyj-hud-settings-"));
  process.env.OHQUANT_DIR = root;
});
afterEach(() => {
  panel?.close();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected HUD settings path");
  rmSync(root, { recursive: true, force: true });
});

function rendered(width = 80, height = 24): string {
  const buffer = new Buffer(width, height); panel.render(buffer); return buffer.toPlain().join("\n");
}
function select(label: string): void {
  for (let index = 0; index < 20; index++) {
    if (rendered().includes(`> ${label} `)) return;
    panel.handleKey("", { name: "down" });
  }
  throw new Error(`Missing setting ${label}`);
}

it("removes the obsolete HUD control while keeping compaction settings and market refresh isolated", () => {
  const tui = new QuantTui(createInitialAppState("fixture"));
  tui.screen.out = { columns: 120, rows: 32, write: () => true } as unknown as NodeJS.WriteStream;
  tui.screen.resize();
  let refreshes = 0;
  tui.onPanelRefresh(() => { refreshes++; });
  const dispatch = Reflect.get(tui, "handleKeyAction").bind(tui) as (action: Extract<InputAction, { type: "key" }>) => void;
  tui.openConfig();
  panel = Reflect.get(tui, "panel") as PanelController;
  select("Compact At");
  for (const [width, height] of [[60, 20], [80, 24], [120, 32]]) {
    expect(rendered(width, height)).toContain("> Compact At");
    expect(rendered(width, height)).not.toContain("Status HUD");
  }
  dispatch({ type: "key", name: "escape", ctrl: false, meta: false, shift: false });
  expect(refreshes).toBe(0);
  expect(tui.state.composerStatus).toBeNull();
});

it("validates and persists the actual compaction threshold with cancel and auto reset", () => {
  panel = new PanelController(); panel.open(); select("Compact At");
  const path = join(root, "settings.json");
  const original = readFileSync(path, "utf8");
  panel.handleKey("", { name: "return" });
  expect(rendered()).toContain("token count or auto");
  panel.handleKey("0", {}); panel.handleKey("", { name: "return" });
  expect(rendered()).toContain("Use auto or");
  expect(readFileSync(path, "utf8")).toBe(original);
  panel.handleKey("", { name: "escape" });
  panel.handleKey("", { name: "return" }); panel.handleKey("20000", {}); panel.handleKey("", { name: "return" });
  const saved = loadSettings();
  expect(resolveCompactTriggerTokens(saved.env, resolveConfiguredModel(saved).contextWindow)).toBe(20000);
  expect(panel.handleKey("", { name: "escape" })).toEqual({ close: true, refreshPanel: false });
  panel.close(); panel.open(); select("Compact At");
  expect(rendered()).toContain("20000 tokens");
  panel.handleKey("", { name: "return" }); panel.handleKey("auto", {}); panel.handleKey("", { name: "return" });
  const automatic = loadSettings(), window = resolveConfiguredModel(automatic).contextWindow;
  expect(resolveCompactTriggerTokens(automatic.env, window)).toBe(Math.max(1, window - 16384));
});

it("keeps compaction drafts on concurrent save conflicts", () => {
  panel = new PanelController(); panel.open(); select("Compact At");
  const external = loadSettings(); external.model = "sonnet"; external.preferences.defaultBenchmark = "SPY"; saveSettings(external);
  panel.handleKey("", { name: "return" }); panel.handleKey("12000", {}); panel.handleKey("", { name: "return" });
  expect(rendered()).toContain("Settings changed");
  expect(loadSettings().env.WHYJ_QUANT_COMPACT_TRIGGER_TOKENS).toBeUndefined();
});
