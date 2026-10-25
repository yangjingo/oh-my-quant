import { expect, it } from "bun:test";
import { ToolCapabilitiesPanel } from "../src/tool-capabilities-panel.ts";
import { DataSettingsPanel } from "../src/data-settings-panel.ts";
import { Buffer, strWidth } from "../src/buffer.ts";
import { DEFAULT_SETTINGS } from "../../../src/types/config.ts";
import { inspectToolReadiness } from "../../../src/runtime/data/tool-readiness.ts";
import { probeToolEndpoint } from "../../../src/runtime/data/tool-probe.ts";
import { ToolProbePanel } from "../src/tool-probe-panel.ts";
import { setImmediate } from "node:timers/promises";
import { PanelController } from "../src/panel.ts";
import { createStoragePanelDataService } from "../../../src/runtime/workspace/panel-data.ts";
import type { DoctorResult } from "../../../src/types/doctor.ts";

const key = (name: string) => ({ name });
function screen(panel: { render(buffer: Buffer): void }, width: number, height: number): string {
  const buffer = new Buffer(width, height); panel.render(buffer);
  const rendered = buffer.render().replace(/\x1b\[[0-9;]*m/g, "").split(/\x1b\[\d+;1H/).slice(1);
  expect(rendered.every(line => strWidth(line) <= width)).toBe(true);
  return buffer.toPlain().join("\n");
}
it("searches the real registry and exposes the full endpoint and requirements on narrow screens without running it", () => {
  for (const [width, height] of [[60, 20], [80, 24], [120, 32]]) {
    const entries = inspectToolReadiness(DEFAULT_SETTINGS, { market: "Fund", python: { status: "missing-python" } }, {});
    const panel = new ToolCapabilitiesPanel(entries);
    panel.handleKey("fund_individual_detail_hold_xq", key(""));
    expect(screen(panel, width, height)).toContain("1 tools");
    expect(screen(panel, width, height)).toContain("missing-python");
    panel.handleKey("", key("return"));
    const frames: string[] = [];
    for (let i = 0; i < 40; i++) { frames.push(screen(panel, width, height)); panel.handleKey("", key("down")); }
    expect(frames.join("\n")).toContain("Required inputs: symbol, date");
    expect(frames.join("\n")).toContain("fund_individual_detail_hold_xq");
    expect(frames.join("\n")).toContain("public-network");
    expect(panel.handleKey("", key("escape"))).toEqual({});
    expect(panel.handleKey("", key("escape"))).toEqual({ close: true });
  }
});

it("opens inspection from the data draft and returns without saving or probing", () => {
  let calls = 0;
  const panel = new DataSettingsPanel(DEFAULT_SETTINGS, { processEnv: {}, probe: async () => { calls++; throw new Error("Must not probe from inspection"); } });
  for (let i = 0; i < 15; i++) {
    if (screen(panel, 80, 24).includes("> Tool capabilities")) break;
    panel.handleKey("", key("down"));
  }
  expect(panel.handleKey("", key("return"))).toEqual({});
  expect(screen(panel, 80, 24)).toContain("Read only");
  panel.handleKey("", key("escape")); expect(screen(panel, 80, 24)).toContain("Data connection");
  expect(calls).toBe(0); panel.dispose();
});

it("reaches the endpoint check from Data connection and uses only the draft credential without saving", async () => {
  for (const [width, height] of [[60, 20], [80, 24], [120, 32]]) {
    const cfg = structuredClone(DEFAULT_SETTINGS); cfg.env.WHYJ_QUANT_TUSHARE_TOKEN = "draft-secret";
    cfg.preferences.source = "tushare"; cfg.preferences.defaultMarket = "A";
    const before = JSON.stringify(cfg); let calls = 0, repaints = 0;
    const panel = new DataSettingsPanel(cfg, { processEnv: {}, onChange: () => { repaints++; }, toolProbe: (settings, request, options) =>
      probeToolEndpoint(settings, request, { ...options, adapters: { search: async (_keyword, opts) => {
        calls++; expect(opts?.token).toBe("draft-secret"); return [{ code: "000001.SZ", name: "平安银行", market: "A", exchange: "SZSE", type: "stock" }];
      } } }) });
    for (let i = 0; i < 10; i++) panel.handleKey("", key("down"));
    panel.handleKey("", key("return")); panel.handleKey("search_symbols", key("")); panel.handleKey("", key("return"));
    expect(screen(panel, width, height)).toContain("p Check endpoint");
    panel.handleKey("p", key("p")); expect(calls).toBe(0);
    expect(screen(panel, width, height)).toContain("Endpoint check");
    panel.handleKey("", key("down")); panel.handleKey("", key("down")); panel.handleKey("", key("return"));
    for (let i = 0; i < 5; i++) await setImmediate();
    expect(screen(panel, width, height)).toContain("ready · 1 rows"); expect(screen(panel, width, height)).not.toContain("draft-secret");
    expect(calls).toBe(1); expect(repaints).toBeGreaterThan(0); expect(JSON.stringify(cfg)).toBe(before); panel.dispose();
  }
});

it("requires endpoint arguments, shows bounded input/cursor, and invalidates the result after selecting another endpoint", async () => {
  let calls = 0;
  const panel = new ToolProbePanel("akshare_fund_profile", { settings: DEFAULT_SETTINGS, market: "Fund", processEnv: {},
    probe: (cfg, request, options) => probeToolEndpoint(cfg, request, { ...options, checkDependency: async () => ({ status: "ready" }), adapters: { fundRows: async (endpoint, params = {}) => {
      calls++; expect(params).toEqual({ symbol: "270042" }); return { endpoint, params, fetchedAt: "fixture", rowCount: 1, rows: [{ value: "基金概况" }] };
    } } }) });
  panel.handleKey("", key("down")); panel.handleKey("", key("down")); panel.handleKey("", key("return")); await setImmediate();
  expect(screen(panel, 60, 20)).toContain("invalid-input"); expect(calls).toBe(0);
  panel.handleKey("", key("up")); panel.handleKey("", key("return"));
  panel.handleKey("", key("home")); panel.handleKey("", key("delete")); panel.handleKey("", key("delete"));
  panel.handleKey('{"symbol":"270042"}', key("")); expect(screen(panel, 60, 20)).toContain('|');
  panel.handleKey("", key("return")); panel.handleKey("", key("down")); panel.handleKey("", key("return")); await setImmediate();
  expect(screen(panel, 60, 20)).toContain("ready · 1 rows"); expect(calls).toBe(1);
  panel.handleKey("", key("up")); panel.handleKey("", key("up")); panel.handleKey("", key("return"));
  expect(screen(panel, 60, 20)).not.toContain("ready · 1 rows"); expect(screen(panel, 60, 20)).toContain("fund_info_ths"); panel.dispose();
});

it("cancels a pending endpoint request when its containing settings panel is disposed", async () => {
  let signal: AbortSignal | undefined;
  const cfg = structuredClone(DEFAULT_SETTINGS); cfg.preferences.source = "tushare"; cfg.preferences.defaultMarket = "A";
  const panel = new DataSettingsPanel(cfg, { toolProbe: async (_cfg, _request, options) => {
    signal = options?.signal; return new Promise(() => {});
  } });
  for (let i = 0; i < 10; i++) panel.handleKey("", key("down"));
  panel.handleKey("", key("return")); panel.handleKey("search_symbols", key("")); panel.handleKey("", key("return")); panel.handleKey("p", key("p"));
  panel.handleKey("", key("down")); panel.handleKey("", key("down")); panel.handleKey("", key("return"));
  expect(signal?.aborted).toBe(false); panel.dispose(); expect(signal?.aborted).toBe(true); await setImmediate();
});

it("opens a live endpoint editor from Doctor and cancels it on parent replacement", async () => {
  const cfg = structuredClone(DEFAULT_SETTINGS); cfg.preferences.source = "tushare"; cfg.preferences.defaultMarket = "A";
  let signal: AbortSignal | undefined;
  const data = { ...createStoragePanelDataService(), loadSettings: () => structuredClone(cfg), saveSettings: () => { throw new Error("Must not save"); } };
  const panel = new PanelController(data, { processEnv: {}, toolProbe: async (_cfg, _req, options) => { signal = options?.signal; return new Promise(() => {}); } });
  const report: DoctorResult = { ready: true, mode: "diagnostic", overall: "partial_fail", auth: {}, hints: [],
    phases: [{ phase: "model", label: "Model", status: "pending", detail: "Not checked" },
      { phase: "tools", label: "Tools", status: "pending", detail: "Not checked" }, { phase: "data", label: "Data", status: "pending", detail: "Not checked" }],
    config: { settingsPath: "fixture", model: "fixture", baseUrl: "", endpointMode: "fixture", dataSource: "tushare",
      dataRequest: { source: "tushare", market: "A", symbol: "000001.SZ", start: "2025-01-06", end: "2025-01-17" } },
    capabilities: inspectToolReadiness(cfg, { market: "A" }, {}) };
  panel.open("doctor"); panel.setDoctor(report); panel.handleKey("v", key("v"));
  expect(screen(panel, 80, 24)).toContain("Tool capabilities");
  panel.handleKey("search_symbols", key("")); panel.handleKey("", key("return")); panel.handleKey("p", key("p"));
  panel.handleKey("", key("down")); panel.handleKey("", key("down")); panel.handleKey("", key("return"));
  expect(signal?.aborted).toBe(false); panel.setDoctor(report);
  expect(screen(panel, 80, 24)).toContain("Endpoint check");
  panel.open("help"); expect(signal?.aborted).toBe(true); panel.close(); await setImmediate();
});
