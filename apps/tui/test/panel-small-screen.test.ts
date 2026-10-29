import { expect, it } from "bun:test";
import { Buffer } from "../src/buffer.ts";
import { PanelController } from "../src/panel.ts";
import { nextInputAction } from "../src/input.ts";
import { DEFAULT_SETTINGS } from "../../../src/types/config.ts";
import type { PanelDataService, StoredSessionSummary, ArtifactMeta } from "../../../src/runtime/workspace/panel-data.ts";

const sizes = [[60, 20], [80, 24], [120, 32]];
function controller(sessions: StoredSessionSummary[] = [], artifacts: ArtifactMeta[] = []) {
  const unexpected = (): never => { throw new Error("Navigation must not save settings or edit portfolios"); };
  const data: PanelDataService = {
    cwd: () => "fixture", loadSettings: () => structuredClone(DEFAULT_SETTINGS), saveSettings: unexpected,
    listStoredSessions: () => sessions, listArtifacts: () => artifacts,
    loadPanelPortfolio: () => ({ updated: "", groups: [], symbols: [] }), editPortfolio: unexpected,
    hasWhyjEnvValue: () => false, stripTerminalControlCodes: value => value,
  };
  return new PanelController(data);
}
function raw(panel: PanelController, bytes: string) {
  const { action, rest } = nextInputAction(bytes);
  if (!action || action.type !== "key" || rest) throw new Error("Expected one complete key");
  return panel.handleKey(action.char ?? "", { ...action, name: action.name || undefined });
}
function screen(panel: PanelController, width: number, height: number) {
  const buf = new Buffer(width, height); panel.render(buf);
  return buf.toPlain().map(line => line.replace(/^[\s│]+|[\s│]+$/g, ""));
}

it("uses the selected Host cwd for report listing and clears stale choices until the next context arrives", () => {
  const seen: Array<string | undefined> = [];
  const data: PanelDataService = {
    cwd: () => "terminal-cwd", loadSettings: () => structuredClone(DEFAULT_SETTINGS), saveSettings: () => {},
    listStoredSessions: () => [], listArtifacts: cwd => { seen.push(cwd); return []; },
    loadPanelPortfolio: () => ({ updated: "", groups: [], symbols: [] }), editPortfolio: () => ({ updated: "", groups: [], symbols: [] }),
    hasWhyjEnvValue: () => false, stripTerminalControlCodes: value => value,
  };
  const panel = new PanelController(data);
  try {
    panel.setArtifactCwd(null); panel.open("artifact"); expect(seen).toEqual([]);
    panel.setArtifactCwd("host-first"); expect(seen).toEqual(["host-first"]);
    panel.setArtifactCwd("host-first"); expect(seen).toEqual(["host-first"]);
    panel.setArtifactCwd(null); expect(seen).toEqual(["host-first"]);
    panel.setArtifactCwd("host-second"); expect(seen).toEqual(["host-first", "host-second"]);
  } finally { panel.close(); }
});

it.each(sizes)("shows complete empty-state instructions at %s x %s", (width, height) => {
  const panel = controller();
  try {
    panel.open("artifact");
    let text = screen(panel, width, height).join(" ");
    expect(text).toContain("/config → Auto Artifacts 开启自动报告");
    expect(text).toContain("完成量化研究并通过核验");
    expect(text).toContain("Enter 恢复会话并打开报告");
    expect(text).toContain("0 reports");
    expect(raw(panel, "\r")).toEqual({});
    expect(raw(panel, "\x1b")).toEqual({ close: true });
    panel.open("resume");
    text = screen(panel, width, height).join(" ");
    expect(text).toContain("Start a conversation first, then come back to /resume.");
    expect(text).toContain("0 sessions");
    expect(raw(panel, "\r")).toEqual({});
  } finally { panel.close(); }
});

it.each(sizes)("keeps settings focus, draft, validation and controls separate at %s x %s", (width, height) => {
  const panel = controller();
  try {
    panel.open("config");
    const labels = ["Model 模型", "Market Data 行情", "Data Token 凭证", "Portfolios 观察组合", "External Skills", "Overview Dock", "Auto Artifacts 报告", "Market Colors", "Compact At"];
    for (const [index, label] of labels.entries()) {
      if (index) raw(panel, "\x1b[B");
      const lines = screen(panel, width, height);
      expect(lines.some(line => line.startsWith(`> ${label}`))).toBe(true);
      expect(lines).toContain("↑↓ 选择 · Enter 修改 · Esc 关闭");
    }
    raw(panel, "\r"); raw(panel, "a"); raw(panel, "b"); raw(panel, "c"); raw(panel, "\r");
    const lines = screen(panel, width, height);
    expect(lines).toContain("Compact At: abc|");
    expect(lines).toContain("Enter 保存 · Esc 取消");
    expect(lines.some(line => line.startsWith("Use auto or 1.."))).toBe(true);
    expect(lines.some(line => line.startsWith("> Compact At"))).toBe(true);
    expect(raw(panel, "\x1b")).toEqual({});
    expect(screen(panel, width, height)).toContain("↑↓ 选择 · Enter 修改 · Esc 关闭");
    raw(panel, "\x1b[B");
    expect(screen(panel, width, height).some(line => line.startsWith("> Model 模型"))).toBe(true);
  } finally { panel.close(); }
});

it.each(sizes)("fills the list viewport and restores the visible selection at %s x %s", (width, height) => {
  const sessions: StoredSessionSummary[] = Array.from({ length: 30 }, (_, index) => ({
    id: `session-${index}`, cwd: "fixture", path: `fixture/${index}.jsonl`, format: "jsonl",
    createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", messageCount: 3,
    preview: `会话 ${index}`, recentMessages: [{ role: "user", text: "中文预览" }, { role: "assistant", text: "Second preview" }, { role: "user", text: "Third preview" }],
    contextUsage: { tokens: 400, contextWindow: 1000, percent: 40 }, entryCount: { messages: 3, compactions: 0, branches: 0 },
  }));
  const artifacts: ArtifactMeta[] = sessions.map((session, index) => ({ sessionId: session.id, title: `报告 ${index}`, createdAt: session.createdAt, bytes: 2048, messageCount: 3 }));
  const panel = controller(sessions, artifacts);
  try {
    for (const mode of ["resume", "artifact"] as const) {
      panel.open(mode);
      for (let index = 0; index < 30; index++) {
        if (index) raw(panel, "\x1b[B");
        const lines = screen(panel, width, height);
        expect(lines.filter(line => line.startsWith("❯"))).toHaveLength(1);
        expect(lines.find(line => line.startsWith("❯"))).toContain(`${mode === "resume" ? "会话" : "报告"} ${index}`);
        // Leave only the reserved footer spacer between the list and its count.
        const countRow = lines.findIndex(line => line === `30 ${mode === "resume" ? "sessions" : "reports"}`);
        expect(lines[countRow - 2]).toMatch(/(?:会话|报告) \d+/);
      }
      expect(raw(panel, "\r")).toEqual(mode === "resume"
        ? { command: "/resume session-29", close: true }
        : { restoreArtifact: "session-29", close: true });
      raw(panel, "\x1b[B");
      expect(screen(panel, 60, 20).find(line => line.startsWith("❯"))).toContain(`${mode === "resume" ? "会话" : "报告"} 0`);
    }
  } finally { panel.close(); }
});
