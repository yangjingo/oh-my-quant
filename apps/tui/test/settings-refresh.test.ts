import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setImmediate } from "node:timers/promises";
import { QuantTui } from "../src/tui.ts";
import { PanelController } from "../src/panel.ts";
import type { InputAction } from "../src/input.ts";
import { AppRuntime, createInitialAppState } from "../../../src/app-runtime.ts";
import { createQuantResearchAgent } from "../../../src/runtime/quant-harness.ts";
import { createDefaultSessionDependencies } from "../../../src/runtime/session-dependencies.ts";
import { loadSettings, saveSettings } from "../../../src/storage/index.ts";

let root: string, previous: string | undefined, tui: QuantTui;
let refreshes: number, configurationChanges: number;
let dispatch: (action: Extract<InputAction, { type: "key" }>) => void;
const press = (name: string, char?: string) => dispatch({ type: "key", name, char, ctrl: false, meta: false, shift: false });
function select(label: string): void {
  for (let i = 0; i < 30; i++) {
    Reflect.get(tui, "paint").call(tui);
    if (tui.screen.buf.toPlain().some(line => line.includes(`> ${label} `))) return;
    press("down");
  }
  throw new Error(`Missing visible field: ${label}`);
}
beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "whyj-settings-refresh-")); process.env.OHQUANT_DIR = root;
  const cfg = loadSettings(); cfg.provider = "custom"; cfg.model = "fixture"; cfg.thinkingLevel = "off";
  cfg.providers = { custom: { baseUrl: "http://127.0.0.1:1234/v1", api: "openai-completions", apiKey: "fixture" } };
  saveSettings(cfg); refreshes = 0; configurationChanges = 0;
  tui = new QuantTui(createInitialAppState("fixture"));
  tui.screen.out = { columns: 80, rows: 24, write: () => true } as unknown as NodeJS.WriteStream;
  tui.screen.resize(); tui.onPanelRefresh(() => { refreshes++; });
  tui.onConfigurationChange(() => { configurationChanges++; });
  dispatch = Reflect.get(tui, "handleKeyAction").bind(tui);
});
afterEach(() => {
  (Reflect.get(tui, "panel") as PanelController).close();
  const timer = Reflect.get(tui, "portfolioStatusTimer") as ReturnType<typeof setTimeout> | null;
  if (timer) clearTimeout(timer);
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected settings fixture path");
  rmSync(root, { recursive: true, force: true });
});

it.each([60, 80, 120].flatMap(width => ["External Skills", "Auto Artifacts", "Model"].map(label => ({ width, label }))))("saves $label at width $width without requesting market quotes", ({ width, label }) => {
  tui.screen.out.columns = width; tui.screen.out.rows = width === 60 ? 20 : width === 80 ? 24 : 32; tui.screen.resize();
  tui.openConfig(); select(label); press("return");
  if (label === "Model") { select("Save"); press("return"); }
  press("escape");
  expect(refreshes).toBe(0);
  expect(configurationChanges).toBe(1);
  expect(tui.state.composerStatus).toBeNull();
  if (label === "External Skills") expect(loadSettings().skillIntegrations.external).toBe(true);
  if (label === "Auto Artifacts") expect(loadSettings().artifactGeneration.auto).toBe(true);
});

it("does not notify configuration or market changes for browsing, cancelled drafts or a save conflict", () => {
  tui.openConfig(); press("escape");
  tui.openConfig(); select("Model"); press("return"); select("API key"); press("return");
  press("", "unsaved-fixture"); press("escape"); press("escape");
  const other = loadSettings(); other.artifactGeneration.auto = true; saveSettings(other);
  select("External Skills"); press("return");
  Reflect.get(tui, "paint").call(tui);
  expect(tui.screen.buf.toPlain().join("\n")).toContain("Settings changed");
  press("escape"); expect(configurationChanges).toBe(0); expect(refreshes).toBe(0);
  expect(loadSettings().providers!.custom!.apiKey).toBe("fixture");
  expect(loadSettings().skillIntegrations.external).toBe(false);
});

it("keeps Save & Verify restricted to the model diagnostic", () => {
  const commands: string[] = []; tui.onSubmit(command => commands.push(command));
  tui.openConfig(); select("Model"); press("return"); select("Save & Verify"); press("return");
  expect(commands).toEqual(["/doctor --phase model"]);
  expect(configurationChanges).toBe(1); expect(refreshes).toBe(0);
  expect((Reflect.get(tui, "panel") as PanelController).isOpen()).toBe(false);
});

it("refreshes market data once after a verified save, with no second refresh on closing Settings", async () => {
  const noProxy = process.env.NO_PROXY; process.env.NO_PROXY = "127.0.0.1,localhost";
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ prices: [
    { date: new Date().toISOString().slice(0, 10), open: 10, high: 10, low: 10, close: 10, volume: 1 },
  ] }) });
  try {
    const cfg = loadSettings(); cfg.preferences.source = "financial-datasets"; cfg.preferences.defaultMarket = "US";
    cfg.env = { WHYJ_QUANT_FINANCIAL_DATASETS_KEY: "fixture-data", FINANCIAL_DATASETS_BASE_URL: String(server.url).replace(/\/$/, "") }; saveSettings(cfg);
    tui.openConfig(); select("Market Data"); press("return"); select("Check data"); press("return");
    const deadline = Date.now() + 3000;
    while (true) {
      Reflect.get(tui, "paint").call(tui);
      if (tui.screen.buf.toPlain().join("\n").includes("1 valid rows")) break;
      if (Date.now() > deadline) throw new Error("Data check did not settle");
      await setImmediate();
    }
    expect(configurationChanges).toBe(0); expect(refreshes).toBe(0);
    select("Save verified"); press("return");
    expect(configurationChanges).toBe(1); expect(refreshes).toBe(1);
    press("escape"); expect(configurationChanges).toBe(1); expect(refreshes).toBe(1);
  } finally {
    server.stop(true);
    if (noProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = noProxy;
  }
});

it("applies saved configuration to the running app and skill discovery without resetting the session or fetching quotes", async () => {
  const dependencies = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions") });
  const agent = createQuantResearchAgent({ dependencies: { ...dependencies, tools: [], loadSkills: async () => [] } });
  let quotes = 0, skills = 0;
  const runtime = new AppRuntime({ onMessages: () => {}, onActivity: () => {}, onModel: model => tui.update(model),
    onLocalState: state => tui.update(state), onSkillsChanged: () => { skills++; } },
    async () => { quotes++; return []; }, async () => { quotes++; return []; }, () => agent);
  try {
    await runtime.bootstrap(); await runtime.refreshOverviewPanel();
    await agent.appendContextNote("fixture", "Existing research must survive configuration changes", { version: 1 });
    const before = quotes, metadata = await agent.getSessionMetadata();
    expect(metadata?.id).toBeString();
    const branch = await agent.getSessionBranch();
    tui.onConfigurationChange(() => runtime.refreshConfiguration());
    tui.onPanelRefresh(() => { void runtime.refreshOverviewPanel(); });
    tui.openConfig(); select("Model"); press("return"); select("Save"); press("return");
    select("External Skills"); press("return"); select("Auto Artifacts"); press("return"); press("escape");
    await setImmediate();
    expect(tui.state.model).toBe("fixture"); expect(skills).toBe(3); expect(quotes).toBe(before);
    expect((await agent.getSessionMetadata())?.id).toBe(metadata?.id);
    expect(await agent.getSessionBranch()).toEqual(branch);
    expect(loadSettings().artifactGeneration.auto).toBe(true);
  } finally { await runtime.shutdown(); }
});
