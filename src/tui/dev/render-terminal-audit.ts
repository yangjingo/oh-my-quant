import { WHYJ_THEME } from "../../types/theme-colors.ts";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { QuantTui } from "../src/tui.ts";
import { PanelController } from "../src/panel.ts";
import { nextInputAction } from "../src/input.ts";
import { charWidth } from "../src/buffer.ts";
import type { PanelDataService, StoredSessionSummary } from "../../runtime/workspace/panel-data.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import type { DoctorResult } from "../../types/doctor.ts";
import type { CommandContext } from "../../types/commands.ts";
import { skillHandler } from "../../cli/handlers/skill.ts";
import { manageMcpPresets } from "../../runtime/skills/mcp-config.ts";
import { shouldRenderCommandResultAsMessage } from "../../runtime/workspace/messages.ts";

const { values } = parseArgs({ args: process.argv.slice(2), options: { output: { type: "string" }, community: { type: "boolean" } }, allowPositionals: false });
if (!values.output) throw new Error("Pass --output NEW_DIRECTORY.");
const root = resolve(values.output);
if (existsSync(root)) throw new Error("Output must be a new directory.");
mkdirSync(root, { recursive: true });
if (values.community) {
  process.env.OHQUANT_DIR = join(root, "fixture", "state");
  process.env.OHQUANT_SKILLS_DIR = join(root, "fixture", "skills");
}
const unexpected = (): never => { throw new Error("Read-only rendering must not save or execute research."); };
const settings = { ...structuredClone(DEFAULT_SETTINGS), provider: "custom", model: "visual-fixture", thinkingLevel: "off",
  providers: { custom: { api: "openai-completions" as const, apiKey: "synthetic-fixture", baseUrl: "http://127.0.0.1/fixture" } } };
let populated = false;
const sessions: StoredSessionSummary[] = Array.from({ length: 30 }, (_, index) => ({
  id: `fixture-${index}`, cwd: "fixture", path: `fixture/${index}.jsonl`, format: "jsonl",
  createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", messageCount: 3,
  preview: `会话 ${index}`, recentMessages: [{ role: "user", text: "中文预览" }, { role: "assistant", text: "Second preview" }, { role: "user", text: "Third preview" }],
  contextUsage: { tokens: 400, contextWindow: 1000, percent: 40 }, entryCount: { messages: 3, compactions: 0, branches: 0 },
}));
const data: PanelDataService = { cwd: () => root, loadSettings: () => structuredClone(settings), saveSettings: unexpected,
  listStoredSessions: () => populated ? sessions : [],
  listArtifacts: () => populated ? sessions.map((session, index) => ({ sessionId: session.id, title: `报告 ${index}`, createdAt: session.createdAt, bytes: 2048, messageCount: 3 })) : [],
  loadPanelPortfolio: () => ({ updated: "", groups: [], symbols: [] }),
  editPortfolio: unexpected, hasWhyjEnvValue: () => false, stripTerminalControlCodes: value => value };
const report: DoctorResult = { ready: true, mode: "diagnostic", overall: "partial_fail", auth: {},
  config: { model: "visual-fixture", baseUrl: "http://127.0.0.1/fixture", endpointMode: "Fixture protocol", dataSource: "akshare", settingsPath: "fixture/settings.json" },
  phases: [
    { phase: "model", label: "Model", status: "pass", detail: "Synthetic model check passed", warnings: Array.from({ length: 10 }, (_, i) => `Warning ${i}: 中文诊断说明，用于核对换行与完整阅读。`) },
    { phase: "tools", label: "Tools", status: "pass", detail: "Synthetic tool schema check passed" },
    { phase: "data", label: "Data", status: "fail", detail: "Fixture endpoint denied access. No market observation was returned.", action: "Configure a supported data connection before retrying." },
  ], hints: ["This is a rendering fixture, not a real provider diagnosis."], logPath: "fixture/doctor.log" };
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const frames: Array<{ name: string; columns: number; rows: number }> = [];
for (const [columns, rows] of [[60, 20], [80, 24], [120, 32]] as const) {
  if (values.community && columns === 80) continue;
  populated = false;
  const panel = new PanelController(data);
  const tui = new QuantTui({ model: "visual-fixture", modelLabel: "visual-fixture", version: "audit", user: "fixture", activity: "ready",
    cost: 0, cacheHit: 0, messages: [{ role: "assistant", text: "研究先核对数据来源、日期和缺项。\nRendering fixture only." }],
    panel: [{ kind: "quotes", title: "Synthetic observations", rows: [{ code: "AAPL", name: "上涨样例", price: 100, pct: 1.2 }, { code: "MSFT", name: "下跌样例", price: 90, pct: -1.2 }, { code: "SPY", name: "零变化", price: 100, pct: 0 }] }],
    panelLoading: false, input: "", composerQueue: [], composerStatus: null, activePortfolio: "No portfolios", source: "fixture", showPortfolioPanel: true });
  Reflect.set(tui, "panel", panel);
  tui.screen.out = { columns, rows, write: () => true } as unknown as NodeJS.WriteStream;
  tui.screen.resize(); tui.onSubmit(unexpected); tui.onPanelRefresh(unexpected);
  const key = (bytes: string) => {
    const { action, rest } = nextInputAction(bytes);
    if (!action || action.type !== "key" || rest) throw new Error("Expected one complete key.");
    Reflect.get(tui, "handleKeyAction").call(tui, action);
  };
  const capture = (label: string) => {
    Reflect.get(tui, "paint").call(tui);
    const name = `${columns}x${rows}-${label}`, buf = tui.screen.buf;
    const elements = buf.cells.flatMap((cell, index) => {
      if (cell.cont || cell.ch === " " && !cell.bg) return [];
      const x = index % columns * 10, y = Math.floor(index / columns) * 20;
      return [`${cell.bg ? `<rect x="${x}" y="${y}" width="${charWidth(cell.ch) * 10}" height="20" fill="${cell.bg}"/>` : ""}<text x="${x}" y="${y + 16}" fill="${cell.fg ?? WHYJ_THEME.cream}"${cell.bold ? ' font-weight="700"' : ""}${cell.dim ? ' opacity="0.6"' : ""}>${escape(cell.ch)}</text>`];
    });
    writeFileSync(join(root, `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="${columns * 10}" height="${rows * 20}" viewBox="0 0 ${columns * 10} ${rows * 20}"><rect width="100%" height="100%" fill="${WHYJ_THEME.canvas}"/><g font-family="Cascadia Mono, Consolas, monospace" font-size="16">${elements.join("")}</g></svg>`);
    writeFileSync(join(root, `${name}.ansi`), buf.render());
    frames.push({ name, columns, rows });
  };
  try {
    if (values.community) {
      tui.state.showPortfolioPanel = false;
      const source = join(process.env.OHQUANT_SKILLS_DIR!, "LLMQuant-skills", "skills", "llmquant-risk");
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "SKILL.md"), "---\nname: llmquant-risk\ndescription: Synthetic risk workflow for renderer review\n---\nFixture only.");
      const ctx = {} as CommandContext;
      const mcpOptions = { agentDir: join(root, "fixture", "pi"), cwd: join(root, "fixture", "project") };
      const commands: Array<[string, () => ReturnType<typeof skillHandler>]> = [
        ["skill-available", () => skillHandler({}, ["catalog"], ctx)],
        ["skill-selected", async () => { await skillHandler({}, ["install", "llmquant-risk"], ctx); return skillHandler({}, ["catalog"], ctx); }],
        ["skill-removed", async () => { await skillHandler({}, ["remove", "llmquant-risk"], ctx); return skillHandler({}, ["catalog"], ctx); }],
        ["mcp-empty", async () => manageMcpPresets("list", [], mcpOptions)],
        ["mcp-installed", async () => { manageMcpPresets("install", ["web-reader"], mcpOptions); return manageMcpPresets("list", [], mcpOptions); }],
        ["mcp-removed", async () => { manageMcpPresets("remove", ["web-reader"], mcpOptions); return manageMcpPresets("list", [], mcpOptions); }],
        ["mcp-error", async () => manageMcpPresets("install", ["unknown"], mcpOptions)],
      ];
      // Keep the same initial selection at both terminal widths.
      await skillHandler({}, ["remove", "llmquant-risk"], ctx);
      for (const [label, run] of commands) {
        const result = await run(), message = result.message.replaceAll(root, "fixture");
        tui.state.messages = shouldRenderCommandResultAsMessage(message) ? [{ role: result.success ? "assistant" : "error", text: message }] : [];
        tui.state.composerStatus = shouldRenderCommandResultAsMessage(message) ? null : { kind: result.success ? "info" : "error", text: message };
        Reflect.set(tui, "convScrollUp", 0);
        capture(label);
        if (label === "skill-selected") { key("\x1b[5~"); capture(`${label}-page-up`); }
      }
      continue;
    }
    capture("research-red-up"); tui.state.marketColorScheme = "green-up"; capture("research-green-up");
    for (const mode of ["config", "portfolio", "resume", "artifact", "help"] as const) { panel.open(mode); capture(mode); panel.close(); }
    panel.open("config");
    for (let i = 0; i < 9; i++) key("\x1b[B");
    capture("config-last"); key("\r"); key("a"); key("b"); key("c"); capture("config-edit");
    key("\r"); capture("config-validation"); key("\x1b"); panel.close();
    populated = true;
    for (const mode of ["resume", "artifact"] as const) {
      panel.open(mode); for (let i = 0; i < 29; i++) key("\x1b[B"); capture(`${mode}-last`); panel.close();
    }
    panel.open("config"); key("\r"); await Promise.resolve(); capture("model"); panel.close();
    panel.open("doctor"); capture("doctor-loading"); panel.setDoctor(report); capture("doctor-top");
    key("\x1b[6~"); capture("doctor-page"); key("\x1b[F"); capture("doctor-bottom");
    key("\x1b"); capture("doctor-closed");
  } finally { panel.close(); }
}
writeFileSync(join(root, "index.html"), `<!doctype html><meta charset="utf-8"><title>WhyJ terminal renderer audit</title><style>body{background:${WHYJ_THEME.surfaceHigh};color:${WHYJ_THEME.cream};font:16px system-ui;margin:24px}section{margin:32px 0}img{display:block;max-width:100%;border:1px solid ${WHYJ_THEME.hairline}}a{color:${WHYJ_THEME.gold}}</style><h1>Terminal renderer audit</h1><p>Production QuantTui frames with synthetic data. SVG cell projection; not a native terminal or font/IME certification. Each frame includes the emitted ANSI stream.</p>${frames.map(frame => `<section id="${frame.name}"><h2>${frame.name}</h2><a href="${frame.name}.ansi">ANSI output</a><img src="${frame.name}.svg" alt="${frame.name}"></section>`).join("")}`);
writeFileSync(join(root, "evidence.json"), JSON.stringify({ createdAt: new Date().toISOString(), bun: Bun.version, scope: "Production QuantTui, in-memory panel data and raw key decoder. No user settings, credentials, real model or market requests. SVG projects cells; native terminal rendering remains unverified.", frames }, null, 2));
process.stdout.write(`Rendered ${frames.length} frames in ${root}\n`);
