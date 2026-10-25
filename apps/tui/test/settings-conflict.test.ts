import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { lockSync } from "proper-lockfile";
import { loadSettings, saveSettings, resolveSettingsPath } from "../../../src/storage/index.ts";
import { PanelController } from "../src/panel.ts";
import { probeDataConnection } from "../../../src/runtime/data/data-readiness.ts";
import { setImmediate } from "node:timers/promises";
import { Buffer } from "../src/buffer.ts";

const dataOptions = { processEnv: {}, probe: ((cfg, request, options) => probeDataConnection(cfg, request, { ...options,
  adapters: { [request.source]: { fetchBars: async () => [{ date: request.start, open: 10, high: 10, low: 10, close: 10, volume: 1, amount: 10 }] } },
})) as typeof probeDataConnection };

let root: string;
let previous: string | undefined;
let panel: PanelController;
const key = (name: string) => ({ name, ctrl: false, meta: false, shift: false });
function screen(width = 80): string {
  const buffer = new Buffer(width, 24);
  panel.render(buffer);
  return buffer.toPlain().join("\n");
}
function select(label: string): void {
  for (let i = 0; i < 30; i++) {
    if (screen(120).split("\n").some(line => line.includes(`> ${label} `))) return;
    panel.handleKey("", key("down"));
  }
  throw new Error(`Could not select ${label}`);
}
beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "ohq-settings-ui-"));
  process.env.OHQUANT_DIR = root;
  const cfg = loadSettings();
  cfg.provider = "custom";
  cfg.model = "fixture-model";
  cfg.providers = { custom: { api: "openai-completions", baseUrl: "http://127.0.0.1:1234/v1", apiKey: "saved-fixture-key" } };
  saveSettings(cfg);
  panel = new PanelController(undefined, dataOptions);
  panel.open("config");
});
afterEach(() => {
  panel.close();
  if (previous === undefined) delete process.env.OHQUANT_DIR;
  else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected settings UI test directory");
  rmSync(root, { recursive: true, force: true });
});

it("keeps a conflicting model draft open and never overwrites the other terminal's credentials", () => {
  panel.handleKey("", key("return"));
  select("API key");
  panel.handleKey("", key("return"));
  panel.handleKey("unsaved-fixture-secret", key(""));
  panel.handleKey("", key("return"));
  const concurrent = loadSettings();
  concurrent.providers!.custom!.apiKey = "other-terminal-key";
  saveSettings(concurrent);
  select("Save & Verify");
  expect(panel.handleKey("", key("return"))).toEqual({});
  expect(screen()).toContain("Settings changed. Reopen /config; draft not saved.");
  expect(screen()).toContain("Model connection");
  expect(screen()).not.toContain("unsaved-fixture-secret");
  expect(loadSettings().providers!.custom!.apiKey).toBe("other-terminal-key");
  expect(panel.handleKey("", key("return"))).toEqual({});
  expect(loadSettings().providers!.custom!.apiKey).toBe("other-terminal-key");
});

it("retains a verified key draft after lock contention and saves it on retry", async () => {
  select("Data Token");
  panel.handleKey("", key("return"));
  panel.handleKey("draft-data-secret", key(""));
  panel.handleKey("", key("return"));
  select("Check data"); panel.handleKey("", key("return"));
  await setImmediate();
  select("Save verified");
  const release = lockSync(resolveSettingsPath(), { realpath: false, stale: 10_000, update: 2_000 });
  try {
    expect(panel.handleKey("", key("return"))).toEqual({});
    expect(screen()).toContain("Settings busy.");
    expect(screen()).not.toContain("draft-data-secret");
    expect(loadSettings().env.WHYJ_QUANT_LLMQUANT_API_KEY).toBeUndefined();
  } finally { release(); }
  panel.handleKey("", key("return"));
  expect(loadSettings().env.WHYJ_QUANT_LLMQUANT_API_KEY).toBe("draft-data-secret");
});

it("does not commit a cancelled failed key draft through an unrelated toggle", async () => {
  select("Data Token");
  panel.handleKey("", key("return"));
  panel.handleKey("cancelled-key", key(""));
  panel.handleKey("", key("return"));
  select("Check data"); panel.handleKey("", key("return"));
  await setImmediate();
  select("Save verified");
  const release = lockSync(resolveSettingsPath(), { realpath: false, stale: 10_000, update: 2_000 });
  try { panel.handleKey("", key("return")); } finally { release(); }
  panel.handleKey("", key("escape"));
  select("External Skills");
  panel.handleKey("", key("return"));
  expect(loadSettings().skillIntegrations.external).toBe(true);
  expect(loadSettings().env.WHYJ_QUANT_LLMQUANT_API_KEY).toBeUndefined();
});

it("rolls back a failed toggle and does not ask runtime to refresh", () => {
  const concurrent = loadSettings();
  concurrent.showPortfolioPanel = false;
  saveSettings(concurrent);
  select("External Skills");
  expect(panel.handleKey("", key("return"))).toEqual({});
  expect(screen()).toContain("Settings changed.");
  expect(panel.handleKey("", key("escape"))).toEqual({ close: true, refreshPanel: false });
  expect(loadSettings().skillIntegrations.external).toBe(false);
  expect(loadSettings().showPortfolioPanel).toBe(false);
});

it("keeps Settings rendering when the portfolio file becomes unreadable", () => {
  writeFileSync(join(root, "panel-portfolio.json"), '{"symbols":');
  expect(screen()).toContain("Portfolio file unavailable");
  expect(panel.handleKey("", key("escape"))).toEqual({ close: true, refreshPanel: false });
});
