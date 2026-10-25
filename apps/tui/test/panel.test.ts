import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Buffer } from "../src/buffer.ts";
import { PanelController } from "../src/panel.ts";
import { probeDataConnection } from "../../../src/runtime/data/data-readiness.ts";
import { setImmediate } from "node:timers/promises";
import { saveArtifact, savePanelPortfolio, loadSettings, saveSettings } from "../../../src/storage/index.ts";
import type { DoctorResult } from "../../../src/cli/doctor.ts";
import { resolveConfiguredModel } from "../../../src/runtime/models/model-settings.ts";

const dataOptions = { processEnv: {}, probe: ((cfg, request, options) => probeDataConnection(cfg, request, { ...options,
  adapters: { [request.source]: { fetchBars: async () => [{ date: request.start, open: 10, high: 10, low: 10, close: 10, volume: 1, amount: 10 }] } },
})) as typeof probeDataConnection };

const OHQ = join(process.cwd(), ".ohquant-test-panel-ctrl");

beforeEach(() => {
  process.env.OHQUANT_DIR = OHQ;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
  mkdirSync(OHQ, { recursive: true });
  savePanelPortfolio({ updated: "", symbols: [], groups: [] });
});

afterEach(() => {
  delete process.env.OHQUANT_DIR;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
});

function key(name: string, char = "") {
  return { name, sequence: char, shift: false, ctrl: false, meta: false };
}

function selectField(panel: PanelController, label: string): void {
  for (let count = 0; count < 25; count++) {
    const buffer = new Buffer(120, 32);
    panel.render(buffer);
    if (buffer.toPlain().some(line => line.includes(`> ${label} `))) return;
    panel.handleKey("", key("down"));
  }
  throw new Error(`Field not found: ${label}`);
}

function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

describe("PanelController portfolio UI", () => {
  it("renders a doctor panel with report data", () => {
    const panel = new PanelController(undefined, dataOptions);
    panel.open("doctor");
    panel.setDoctor({
      ready: true,
      mode: "diagnostic",
      overall: "partial_fail",
      phases: [
        { phase: "model", status: "pass", label: "Model", detail: "Anthropic Messages HTTP 200", warnings: ["Network probe skipped by WHYJ_DOCTOR_SKIP_NETWORK."] },
        { phase: "tools", status: "pass", label: "Tools", detail: "schemas loaded" },
        { phase: "data", status: "fail", label: "Data", detail: "Missing WHYJ_QUANT_LLMQUANT_API_KEY", error: "Missing WHYJ_QUANT_LLMQUANT_API_KEY", action: "Open /doctor Configure and set WHYJ_QUANT_LLMQUANT_API_KEY." },
      ],
      auth: {
        WHYJ_QUANT_API_KEY: { available: true, source: "env", value: "test...1234 · fp:abcd1234" },
        WHYJ_QUANT_AUTH_TOKEN: { available: false, source: "missing", value: "-" },
        WHYJ_QUANT_BASE_URL: { available: true, source: "env", value: "https://api.deepseek.com/anthropic" },
        WHYJ_QUANT_TUSHARE_TOKEN: { available: false, source: "missing", value: "-" },
        WHYJ_QUANT_LLMQUANT_API_KEY: { available: false, source: "missing", value: "-" },
        WHYJ_QUANT_FINANCIAL_DATASETS_KEY: { available: false, source: "missing", value: "-" },
      },
      config: {
        settingsPath: ".ohquant/settings.json",
        model: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com/anthropic",
        endpointMode: "Anthropic Messages",
        dataSource: "llmquant-data",
      },
      hints: ["Open /doctor Configure and set WHYJ_QUANT_LLMQUANT_API_KEY."],
      logPath: ".ohquant/logs/doctor/latest.log",
    } as DoctorResult);

    const buf = new Buffer(120, 36);
    panel.render(buf);
    const plain = buf.toPlain().join("\n");
    expect(plain).toContain("WhyJ Doctor");
    expect(plain).toContain("partial_fail");
    expect(plain).toContain("Missing WHYJ_QUANT_LLMQUANT_API_KEY");
    expect(plain).toContain("Warn · Network probe skipped by WHYJ_DOCTOR_SKIP_NETWORK.");
    expect(plain).toContain("r Retry all  ·  m Model");
    expect(panel.handleKey("", key("escape"))).toEqual({ close: true });
    panel.close();
  });

  it("labels a successful data-only Doctor run without implying the pending phases passed", () => {
    const panel = new PanelController(undefined, dataOptions);
    panel.open("doctor");
    const doctor: DoctorResult = { ready: true, mode: "diagnostic", overall: "all_pass", requestedPhases: ["data"],
      phases: [
        { phase: "model", status: "pending", label: "Model", detail: "pending" },
        { phase: "tools", status: "pending", label: "Tools", detail: "pending" },
        { phase: "data", status: "pass", label: "Data", detail: "23 valid rows" },
      ], auth: {}, config: { settingsPath: "fixture", model: "fixture", baseUrl: "", endpointMode: "",
        dataSource: "akshare" }, hints: [] };
    panel.setDoctor(doctor);
    const scoped = new Buffer(80, 24);
    panel.render(scoped);
    expect(scoped.toPlain().join("\n")).toContain("WhyJ Doctor · data pass · model+tools untested");

    panel.setDoctor({ ...doctor, requestedPhases: ["model", "tools", "data"],
      phases: doctor.phases.map(phase => ({ ...phase, status: "pass" as const })) as DoctorResult["phases"] });
    const complete = new Buffer(80, 24);
    panel.render(complete);
    expect(complete.toPlain().join("\n")).toContain("WhyJ Doctor · all_pass");
  });

  it("retries doctor directly from the diagnostic panel", () => {
    const panel = new PanelController(undefined, dataOptions);
    panel.open("doctor");
    panel.setDoctor({
      ready: false,
      mode: "diagnostic",
      overall: "partial_fail",
      phases: [
        { phase: "model", status: "fail", label: "Model", detail: "Missing WHYJ_QUANT_API_KEY" },
        { phase: "tools", status: "pass", label: "Tools", detail: "schemas loaded" },
        { phase: "data", status: "fail", label: "Data", detail: "Missing WHYJ_QUANT_LLMQUANT_API_KEY" },
      ],
      auth: {},
      config: {
        settingsPath: ".ohquant/settings.json",
        model: "sonnet",
        baseUrl: "",
        endpointMode: "Custom",
        dataSource: "llmquant-data",
      },
      hints: [],
    } as DoctorResult);

    expect(panel.handleKey("r", key("", "r"))).toEqual({ command: "/doctor" });
  });

  it("retries tools and data phases from the diagnostic panel", () => {
    const panel = new PanelController(undefined, dataOptions);
    panel.open("doctor");
    panel.setDoctor({
      ready: false,
      mode: "diagnostic",
      overall: "partial_fail",
      phases: [
        { phase: "model", status: "pass", label: "Model", detail: "model ok" },
        { phase: "tools", status: "fail", label: "Tools", detail: "Python missing" },
        { phase: "data", status: "fail", label: "Data", detail: "Missing WHYJ_QUANT_LLMQUANT_API_KEY" },
      ],
      auth: {},
      config: {
        settingsPath: ".ohquant/settings.json",
        model: "sonnet",
        baseUrl: "",
        endpointMode: "Custom",
        dataSource: "llmquant-data",
      },
      hints: [],
    } as DoctorResult);

    expect(panel.handleKey("t", key("", "t"))).toEqual({ command: "/doctor --phase tools" });
    panel.setDoctor({
      ready: false,
      mode: "diagnostic",
      overall: "partial_fail",
      phases: [
        { phase: "model", status: "pass", label: "Model", detail: "model ok" },
        { phase: "tools", status: "fail", label: "Tools", detail: "Python missing" },
        { phase: "data", status: "fail", label: "Data", detail: "Missing WHYJ_QUANT_LLMQUANT_API_KEY" },
      ],
      auth: {},
      config: {
        settingsPath: ".ohquant/settings.json",
        model: "sonnet",
        baseUrl: "",
        endpointMode: "Custom",
        dataSource: "llmquant-data",
      },
      hints: [],
    } as DoctorResult);
    expect(panel.handleKey("d", key("", "d"))).toEqual({ command: "/doctor --phase data" });
  });

  it("enters configure mode from the diagnostic panel", () => {
    const panel = new PanelController(undefined, dataOptions);
    panel.open("doctor");
    panel.setDoctor({
      ready: false,
      mode: "diagnostic",
      overall: "partial_fail",
      phases: [
        { phase: "model", status: "fail", label: "Model", detail: "Missing WHYJ_QUANT_API_KEY" },
        { phase: "tools", status: "pass", label: "Tools", detail: "schemas loaded" },
        { phase: "data", status: "fail", label: "Data", detail: "Missing WHYJ_QUANT_LLMQUANT_API_KEY" },
      ],
      auth: {},
      config: {
        settingsPath: ".ohquant/settings.json",
        model: "sonnet",
        baseUrl: "",
        endpointMode: "Custom",
        dataSource: "llmquant-data",
      },
      hints: [],
    } as DoctorResult);

    panel.handleKey("c", key("", "c"));
    const buf = new Buffer(120, 28);
    panel.render(buf);
    const plain = buf.toPlain().join("\n");
    expect(plain).toContain("Doctor · Configure");
    expect(plain).toContain("Model connection");
    expect(plain).toContain("Run diagnostics");
  });

  it("keeps doctor first-setup edits in draft until save", () => {
    const panel = new PanelController(undefined, dataOptions);
    panel.open("doctor");
    panel.setDoctor({
      ready: false,
      mode: "first_setup",
      overall: "unconfigured",
      phases: [
        { phase: "model", status: "fail", label: "Model", detail: "Missing WHYJ_QUANT_API_KEY" },
        { phase: "tools", status: "pending", label: "Tools", detail: "" },
        { phase: "data", status: "fail", label: "Data", detail: "Missing WHYJ_QUANT_LLMQUANT_API_KEY" },
      ],
      auth: {},
      config: {
        settingsPath: ".ohquant/settings.json",
        model: "sonnet",
        baseUrl: "",
        endpointMode: "Custom",
        dataSource: "llmquant-data",
      },
      hints: ["Configure API and data credentials."],
    } as DoctorResult);

    selectField(panel, "Market Data");
    panel.handleKey("", key("return"));
    selectField(panel, "API key");
    panel.handleKey("", key("return"));
    for (const ch of "sk-draft-only") panel.handleKey(ch, key("", ch));
    panel.handleKey("", key("return"));
    expect(loadSettings().env.WHYJ_QUANT_LLMQUANT_API_KEY).toBeUndefined();
    panel.handleKey("", key("escape"));

    selectField(panel, "Model connection");
    panel.handleKey("", key("return"));
    selectField(panel, "API key");
    panel.handleKey("", key("return"));
    panel.handleKey("saved-model-key", key("", "saved-model-key"));
    panel.handleKey("", key("return"));
    selectField(panel, "Save");
    panel.handleKey("", key("return"));
    expect(loadSettings().providers?.deepseek?.apiKey).toBe("saved-model-key");
    expect(loadSettings().env.WHYJ_QUANT_LLMQUANT_API_KEY).toBeUndefined();

    expect(panel.handleKey("", key("escape"))).toEqual({ close: true });
    expect(loadSettings().env.WHYJ_QUANT_LLMQUANT_API_KEY).toBeUndefined();
  });

  it("verifies data before saving and runs diagnostics independently of model saving", async () => {
    const panel = new PanelController(undefined, dataOptions);
    panel.open("doctor");
    panel.setDoctor({
      ready: false,
      mode: "first_setup",
      overall: "unconfigured",
      phases: [
        { phase: "model", status: "fail", label: "Model", detail: "Missing WHYJ_QUANT_API_KEY" },
        { phase: "tools", status: "pending", label: "Tools", detail: "" },
        { phase: "data", status: "fail", label: "Data", detail: "Missing WHYJ_QUANT_LLMQUANT_API_KEY" },
      ],
      auth: {},
      config: {
        settingsPath: ".ohquant/settings.json",
        model: "sonnet",
        baseUrl: "",
        endpointMode: "Custom",
        dataSource: "llmquant-data",
      },
      hints: ["Configure API and data credentials."],
    } as DoctorResult);

    selectField(panel, "Model connection");
    panel.handleKey("", key("return"));
    selectField(panel, "API key");
    panel.handleKey("", key("return"));
    for (const ch of "sk-live-1234") panel.handleKey(ch, key("", ch));
    panel.handleKey("", key("return"));

    selectField(panel, "Save");
    panel.handleKey("", key("return"));

    selectField(panel, "Market Data");
    panel.handleKey("", key("return"));
    selectField(panel, "API key");
    panel.handleKey("", key("return"));
    for (const ch of "llmq-key-5678") panel.handleKey(ch, key("", ch));
    panel.handleKey("", key("return"));

    expect(loadSettings().env.WHYJ_QUANT_LLMQUANT_API_KEY).toBeUndefined();
    selectField(panel, "Check data");
    panel.handleKey("", key("return"));
    await setImmediate();
    selectField(panel, "Save verified");
    expect(panel.handleKey("", key("return"))).toEqual({ refreshPanel: true });
    selectField(panel, "Run diagnostics");
    const result = panel.handleKey("", key("return"));
    expect(result).toEqual({ command: "/doctor" });

    const settings = loadSettings();
    expect(settings.providers?.deepseek?.apiKey).toBe("sk-live-1234");
    expect(resolveConfiguredModel(settings).baseUrl).toBe("https://api.deepseek.com");
    expect(settings.env.WHYJ_QUANT_LLMQUANT_API_KEY).toBe("llmq-key-5678");
  });

  it("maps the MiniMax doctor preset to the supported runtime endpoint", () => {
    const panel = new PanelController(undefined, dataOptions);
    panel.open("doctor");
    panel.setDoctor({
      ready: false,
      mode: "first_setup",
      overall: "unconfigured",
      phases: [
        { phase: "model", status: "fail", label: "Model", detail: "Missing WHYJ_QUANT_API_KEY" },
        { phase: "tools", status: "pending", label: "Tools", detail: "" },
        { phase: "data", status: "fail", label: "Data", detail: "Missing WHYJ_QUANT_LLMQUANT_API_KEY" },
      ],
      auth: {},
      config: {
        settingsPath: ".ohquant/settings.json",
        model: "sonnet",
        baseUrl: "",
        endpointMode: "Custom",
        dataSource: "llmquant-data",
      },
      hints: [],
    } as DoctorResult);

    panel.handleKey("", key("return"));
    selectField(panel, "Provider");
    panel.handleKey("", key("return"));
    panel.handleKey("(minimax-cn)", key("", "(minimax-cn)"));
    panel.handleKey("", key("return"));
    selectField(panel, "Save");
    panel.handleKey("", key("return"));
    expect(loadSettings().provider).toBe("minimax-cn");
    expect(resolveConfiguredModel(loadSettings()).baseUrl).toBe("https://api.minimaxi.com/anthropic");
  });

  it("accepts a legacy auth token when saving doctor configure flow", () => {
    const settings = loadSettings();
    settings.env.WHYJ_QUANT_AUTH_TOKEN = "legacy-provider-token";
    settings.env.WHYJ_QUANT_BASE_URL = "https://api.deepseek.com/anthropic";
    settings.env.WHYJ_QUANT_LLMQUANT_API_KEY = "llmq-key-5678";
    saveSettings(settings);

    const panel = new PanelController(undefined, dataOptions);
    panel.open("doctor");
    panel.setDoctor({
      ready: true,
      mode: "diagnostic",
      overall: "partial_fail",
      phases: [
        { phase: "model", status: "pass", label: "Model", detail: "model ok" },
        { phase: "tools", status: "pass", label: "Tools", detail: "tools ok" },
        { phase: "data", status: "fail", label: "Data", detail: "data missing" },
      ],
      auth: {},
      config: {
        settingsPath: ".ohquant/settings.json",
        model: "sonnet",
        baseUrl: "https://api.deepseek.com/anthropic",
        endpointMode: "Anthropic Messages",
        dataSource: "llmquant-data",
      },
      hints: [],
    } as DoctorResult);

    panel.handleKey("c", key("", "c"));
    selectField(panel, "Run diagnostics");
    const result = panel.handleKey("", key("return"));
    expect(result).toEqual({ command: "/doctor" });
  });

  it("opens the custom portfolio editor from config without reading legacy files", () => {
    const configPanel = new PanelController(undefined, dataOptions);
    configPanel.open("config");
    const buf = new Buffer(120, 28);
    configPanel.render(buf);
    expect(buf.toPlain().join("\n")).toContain("No portfolios");
    expect(buf.toPlain().join("\n")).toContain("Portfolios");
    selectField(configPanel, "Portfolios");
    expect(configPanel.handleKey("", key("return"))).toEqual({ command: "/portfolio", close: true });
  });

  it("keeps Settings free of per-field explanation rows", () => {
    const panel = new PanelController(undefined, dataOptions);
    panel.open("config");

    for (let index = 0; index < 10; index++) {
      const buf = new Buffer(120, 28);
      panel.render(buf);
      expect(buf.toPlain().join("\n")).not.toContain("About ·");
      panel.handleKey("", key("down"));
    }

    panel.close();
  });

  it("masks provider credentials while they are being edited", () => {
    const panel = new PanelController(undefined, dataOptions);
    panel.open("config");
    panel.handleKey("", key("return"));
    selectField(panel, "API key");
    panel.handleKey("", key("return"));
    for (const ch of "super-secret-key") panel.handleKey(ch, key("", ch));

    const buf = new Buffer(120, 28);
    panel.render(buf);
    const plain = buf.toPlain().join("\n");
    expect(plain).not.toContain("super-secret-key");
    expect(plain).toContain("••••");
    expect(plain).not.toContain("code or code name");
    panel.close();
  });

  it("lets config save a source-specific key after successful verification", async () => {
    const panel = new PanelController(undefined, dataOptions);
    panel.open("config");
    selectField(panel, "Data Token");
    panel.handleKey("", key("return"));
    for (const ch of "test-llmquant-key") {
      panel.handleKey(ch, key("", ch));
    }
    panel.handleKey("", key("return"));
    expect(loadSettings().env.WHYJ_QUANT_LLMQUANT_API_KEY).toBeUndefined();
    selectField(panel, "Check data"); panel.handleKey("", key("return"));
    await setImmediate();
    selectField(panel, "Save verified"); panel.handleKey("", key("return"));
    panel.close();

    const settings = loadSettings();
    expect(settings.env.WHYJ_QUANT_LLMQUANT_API_KEY).toBe("test-llmquant-key");
  });

  it("keeps a changed data source in draft until it is checked and saved", async () => {
    const cfg = loadSettings(); cfg.env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY = "fixture-fd-key"; saveSettings(cfg);
    const panel = new PanelController(undefined, dataOptions);
    panel.open("config");
    selectField(panel, "Market Data");
    panel.handleKey("", key("return"));
    selectField(panel, "Source"); panel.handleKey("", key("return"));
    expect(loadSettings().preferences.source).toBe("llmquant-data");
    selectField(panel, "Check data"); panel.handleKey("", key("return"));
    await setImmediate();
    selectField(panel, "Save verified"); panel.handleKey("", key("return"));
    panel.close();

    const settings = loadSettings();
    expect(settings.preferences.source).toBe("financial-datasets");
  });

  it("lets config toggle user-level skill integrations", () => {
    const panel = new PanelController(undefined, dataOptions);
    panel.open("config");
    selectField(panel, "External Skills");
    panel.handleKey("", key("return"));
    panel.close();

    const settings = loadSettings();
    expect(settings.skillIntegrations).toEqual({ external: true });
  });

  it("lets config enable automatic artifact generation", () => {
    const panel = new PanelController(undefined, dataOptions);
    panel.open("config");
    selectField(panel, "Auto Artifacts");
    panel.handleKey("", key("return"));
    panel.close();

    expect(loadSettings().artifactGeneration.auto).toBe(true);
  });

  it("renders a dedicated resume selector and returns a resume command", () => {
    const cwdDir = join(OHQ, "sessions", encodeCwd(process.cwd()));
    const otherDir = join(OHQ, "sessions", encodeCwd("C:\\tmp\\other-project"));
    mkdirSync(cwdDir, { recursive: true });
    mkdirSync(otherDir, { recursive: true });

    const activeId = "019eaf98-85f6-7ddc-96c1-1a32a2389963";
    const otherId = "019eaf98-85f6-7ddc-96c1-1a32a2389977";
    writeFileSync(
      join(cwdDir, `2026-06-13T08-00-00-000Z_${activeId}.jsonl`),
      [
        JSON.stringify({ type: "session", version: 3, id: activeId, timestamp: "2026-06-13T08:00:00.000Z", cwd: process.cwd() }),
        JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-06-13T08:03:00.000Z", message: { role: "user", content: "请你参考 https://github.com/earendil-works/pi 这个进行一次修改" } }),
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(otherDir, `2026-06-10T08-00-00-000Z_${otherId}.jsonl`),
      [
        JSON.stringify({ type: "session", version: 3, id: otherId, timestamp: "2026-06-10T08:00:00.000Z", cwd: "C:\\tmp\\other-project" }),
        JSON.stringify({ type: "message", id: "m2", parentId: null, timestamp: "2026-06-10T08:05:00.000Z", message: { role: "user", content: "Install gstack: run git clone --single-branch" } }),
      ].join("\n"),
      "utf-8",
    );

    const panel = new PanelController(undefined, dataOptions);
    panel.open("resume");
    panel.setCurrentSessionMeta({
      id: activeId,
      createdAt: "2026-06-13T08:00:00.000Z",
      usage: { tokens: 100, contextWindow: 1000, percent: 10 },
      entryCount: { messages: 1, compactions: 0, branches: 0 },
    });
    expect((panel as any)["mode"]).toBe("resume");

    const buf = new Buffer(120, 28);
    panel.render(buf);
    const plain = buf.toPlain().join("\n");
    expect(plain).toContain("Resume a previous session");
    expect(plain).not.toContain("↑↓ move");
    expect(plain).not.toContain("esc close");
    expect(plain).toContain("U: 请你参考");

    const result = panel.handleKey("", key("return"));
    expect(result?.command).toContain("/resume ");
    expect(result?.close).toBe(true);
    panel.close();
  });

  it("resumes the arrow-key selected JSONL session instead of the first item", () => {
    const cwdDir = join(OHQ, "sessions", encodeCwd(process.cwd()));
    mkdirSync(cwdDir, { recursive: true });

    const firstId = "019eaf98-85f6-7ddc-96c1-1a32a2381111";
    const secondId = "019eaf98-85f6-7ddc-96c1-1a32a2382222";
    writeFileSync(
      join(cwdDir, `2026-06-13T08-00-00-000Z_${firstId}.jsonl`),
      [
        JSON.stringify({ type: "session", version: 3, id: firstId, timestamp: "2026-06-13T08:00:00.000Z", cwd: process.cwd() }),
        JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-06-13T08:03:00.000Z", message: { role: "user", content: "第一个会话" } }),
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(cwdDir, `2026-06-12T08-00-00-000Z_${secondId}.jsonl`),
      [
        JSON.stringify({ type: "session", version: 3, id: secondId, timestamp: "2026-06-12T08:00:00.000Z", cwd: process.cwd() }),
        JSON.stringify({ type: "message", id: "m2", parentId: null, timestamp: "2026-06-12T08:05:00.000Z", message: { role: "user", content: "第二个会话" } }),
        JSON.stringify({
          type: "message",
          id: "m3",
          parentId: "m2",
          timestamp: "2026-06-12T08:06:00.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "第二个会话回答" }],
            provider: "openrouter",
            model: "openai/gpt-5.5",
            api: "responses",
            usage: {
              input: 300,
              output: 100,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 400,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "end_turn",
            timestamp: Date.now(),
          },
        }),
      ].join("\n"),
      "utf-8",
    );

    const panel = new PanelController(undefined, dataOptions);
    panel.open("resume");
    panel.handleKey("", key("down"));
    const buf = new Buffer(120, 28);
    panel.render(buf);
    const plain = buf.toPlain().join("\n");
    expect(plain).toContain(`Selected: ${secondId}`);
    expect(plain).toContain("400/1,050,000");

    const result = panel.handleKey("", key("return"));
    expect(result).toEqual({ command: `/resume ${secondId}`, close: true });
    panel.close();
  });

  it("marks legacy markdown session history as unsupported in resume panel", () => {
    const legacyDir = join(OHQ, "sessions", "2026-06-10");
    const cwdDir = join(OHQ, "sessions", encodeCwd(process.cwd()));
    mkdirSync(legacyDir, { recursive: true });
    mkdirSync(cwdDir, { recursive: true });

    const legacyPath = join(legacyDir, "session-031036.md");
    writeFileSync(
      legacyPath,
      [
        "# Session 2026-06-10 031036",
        "",
        "## 03:08:19 · User",
        "股票代码 — 比如 000001.SZ 或 AAPL",
        "",
        "## 03:08:24 · Assistant",
        "数据拉取遇到点问题，加日期参数再试。",
      ].join("\n"),
      "utf-8",
    );
    const activeId = "019eaf98-85f6-7ddc-96c1-1a32a2389963";
    writeFileSync(
      join(cwdDir, `2026-06-13T08-00-00-000Z_${activeId}.jsonl`),
      [
        JSON.stringify({ type: "session", version: 3, id: activeId, timestamp: "2026-06-13T08:00:00.000Z", cwd: process.cwd() }),
        JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-06-13T08:03:00.000Z", message: { role: "user", content: "新的 JSONL 会话" } }),
      ].join("\n"),
      "utf-8",
    );
    const future = new Date("2026-06-14T00:00:00.000Z");
    utimesSync(legacyPath, future, future);

    const panel = new PanelController(undefined, dataOptions);
    panel.open("resume");
    const buf = new Buffer(120, 28);
    panel.render(buf);
    const plain = buf.toPlain().join("\n");
    expect(plain).toContain("[legacy]");
    expect(plain).toContain("Legacy transcript");
    expect(plain).toContain("U: 股票代码");
    expect(plain).toContain("A: 数据拉取遇到点问题");

    const result = panel.handleKey("", key("return"));
    expect(result?.command).toBeUndefined();
    const after = new Buffer(120, 28);
    panel.render(after);
    expect(after.toPlain().join("\n")).toContain("Unsupported legacy session archive");
    panel.close();
  });


  it("renders a dedicated artifact panel and returns an internal restore intent", () => {
    const sessionDir = join(OHQ, "sessions", encodeCwd(process.cwd()));
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "2026-07-13T00-00-00-000Z_sess-artifact-1.jsonl"),
      JSON.stringify({
        type: "session",
        version: 3,
        id: "sess-artifact-1",
        timestamp: "2026-07-13T00:00:00.000Z",
        cwd: process.cwd(),
      }),
      "utf-8",
    );
    saveArtifact("sess-artifact-1", "<html><body>artifact</body></html>", { title: "Analysis artifact", messageCount: 3 });

    const panel = new PanelController(undefined, dataOptions);
    panel.open("artifact");
    const buf = new Buffer(120, 28);
    panel.render(buf);
    const plain = buf.toPlain().join("\n");
    expect(plain).toContain("Artifacts");
    expect(plain).toContain("Analysis artifact");
    expect(plain).not.toContain("Hotkeys");
    expect(plain).not.toContain("↑↓ select");
    expect(plain).not.toContain("restore & open");
    expect(plain).not.toContain("esc close");

    const open = panel.handleKey("", key("return"));
    expect(open).toEqual({ restoreArtifact: expect.stringMatching(/^sess-artifact-1@[a-f0-9]{64}$/), close: true });

    const ignored = panel.handleKey("g", key("g", "g"));
    expect(ignored).toEqual({});
    panel.close();
  });
  it("uses the same panel frame size for config, resume, and portfolio", () => {
    const configPanel = new PanelController(undefined, dataOptions);
    configPanel.open("config");
    const resumePanel = new PanelController(undefined, dataOptions);
    resumePanel.open("resume");
    const portfolioPanel = new PanelController(undefined, dataOptions);
    portfolioPanel.open("portfolio");

    const configBuf = new Buffer(120, 28);
    const resumeBuf = new Buffer(120, 28);
    const portfolioBuf = new Buffer(120, 28);
    configPanel.render(configBuf);
    resumePanel.render(resumeBuf);
    portfolioPanel.render(portfolioBuf);

    const configLines = configBuf.toPlain();
    const resumeLines = resumeBuf.toPlain();
    const portfolioLines = portfolioBuf.toPlain();
    const configTop = configLines.find((line) => line.includes("Settings"));
    const resumeTop = resumeLines.find((line) => line.includes("Resume a previous session"));
    const portfolioTop = portfolioLines.find((line) => line.includes("Portfolios"));
    expect(configTop).toBeDefined();
    expect(resumeTop).toBeDefined();
    expect(portfolioTop).toBeDefined();
    expect(configTop!.indexOf("╭")).toBe(resumeTop!.indexOf("╭"));
    expect(configTop!.lastIndexOf("╮")).toBe(resumeTop!.lastIndexOf("╮"));
    expect(configTop!.indexOf("╭")).toBe(portfolioTop!.indexOf("╭"));
    expect(configTop!.lastIndexOf("╮")).toBe(portfolioTop!.lastIndexOf("╮"));
  });
});
