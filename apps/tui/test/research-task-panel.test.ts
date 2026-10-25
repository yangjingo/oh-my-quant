import { expect, it } from "bun:test";
import { ResearchTaskPanel } from "../src/research-task-panel.ts";
import { Buffer, strWidth } from "../src/buffer.ts";
import type { ResearchTaskSnapshot } from "../../../src/types/research-task.ts";
import { researchTaskLines } from "../../../src/runtime/workspace/research-task-view.ts";
import { PanelController } from "../src/panel.ts";
import type { PanelDataService } from "../../../src/runtime/workspace/panel-data.ts";
import { DEFAULT_SETTINGS } from "../../../src/types/config.ts";

function snapshot(): ResearchTaskSnapshot {
  return { leafId: "leaf", taskErrors: [], unresolved: [{ callEntryId: "failed-entry", callId: "failed-call", tool: "run_backtest", reason: "Provider unavailable", capabilityAvailable: true }],
    task: { revision: "revision", startedEntryId: "start", status: "blocked", reportRef: null, reportEntryId: null, reportAvailable: null,
      spec: { id: "study", request: "核验收益与风险。".repeat(12), goal: "核验收益与风险", scope: { symbols: ["AAPL"], market: "US", start: "2026-01-01", end: "2026-02-09" },
        constraints: { allowedTools: ["run_backtest"], notes: ["只研究"] }, dataRefs: [], reportRequired: true,
        criteria: [{ id: "return", description: "归档支持收益", tool: "run_backtest", parameters: { symbol: "AAPL" }, metrics: ["Total return"] }] },
      criteria: [{ id: "return", status: "blocked", reason: "No verified result", evidence: null }], resolutions: [],
      unresolved: [{ callEntryId: "failed-entry", callId: "failed-call" }], reasons: ["Missing return evidence"] } };
}

function render(panel: ResearchTaskPanel, width = 80, height = 24): string {
  const buffer = new Buffer(width, height); panel.render(buffer);
  const lines = buffer.toPlain();
  expect(lines).toHaveLength(height);
  // toPlain pads by string length; actual terminal output skips wide-glyph continuation cells.
  expect(Array.from({ length: height }, (_, row) => strWidth(buffer.cells.slice(row * width, (row + 1) * width)
    .filter(cell => !cell.cont).map(cell => cell.ch).join(""))).every(value => value === width)).toBe(true);
  return lines.join("\n");
}

it.each([[60, 20], [80, 24], [120, 32]])("keeps controls visible and all evidence reachable at %s x %s", (width, height) => {
  const panel = new ResearchTaskPanel(snapshot());
  let screen = render(panel, width, height), visited = screen;
  expect(screen).toContain("Snapshot · blocked"); expect(screen).toContain("Goal: 核验收益与风险");
  for (let index = 0; index < 80; index++) {
    panel.handleKey("", { name: "down" }); screen = render(panel, width, height); visited += screen;
    expect(screen).toContain("return refresh"); expect(screen).toContain("escape close");
  }
  for (const text of ["Acceptance: 0/1", "No verified result", "Provider unavailable", "Report: required, missing", "Task revision: revision"]) expect(visited).toContain(text);
  for (let index = 0; index < 80; index++) panel.handleKey("", { name: "up" });
  expect(render(panel, width, height)).toContain("Goal: 核验收益与风险");
});

it("holds a read-only snapshot, refreshes explicitly and respects remapped keys", () => {
  const state = snapshot(), original = structuredClone(state);
  const panel = new ResearchTaskPanel(state, { confirm: ["ctrl+r"], cancel: ["ctrl+q"], next: ["j"], previous: ["k"] });
  const first = render(panel);
  expect(panel.handleKey("", { name: "return" })).toEqual({});
  expect(panel.handleKey("", { name: "escape" })).toEqual({});
  panel.handleKey("j", { name: "j" }); expect(render(panel)).not.toBe(first);
  panel.handleKey("k", { name: "k" }); expect(render(panel)).toBe(first);
  expect(state).toEqual(original);
  state.task!.status = "complete"; state.task!.spec.goal = "Changed outside the panel";
  expect(render(panel)).toBe(first);
  expect(panel.handleKey("", { name: "r", ctrl: true })).toEqual({ command: "/resume --task", close: true });
  expect(panel.handleKey("", { name: "q", ctrl: true })).toEqual({ close: true });
});

it("clamps scrolling after resize and shows empty or cancelled task states", () => {
  const panel = new ResearchTaskPanel(snapshot()); render(panel, 60, 20);
  for (let index = 0; index < 100; index++) panel.handleKey("", { name: "down" });
  const resized = render(panel, 120, 32);
  expect(resized).toContain("Task revision: revision"); expect(resized).toContain("escape close");
  const empty = new ResearchTaskPanel({ leafId: null, task: null, taskErrors: [{ entryId: "bad", reason: "Invalid declaration" }], unresolved: [] });
  expect(render(empty)).toContain("No declared research task."); expect(render(empty)).toContain("Invalid declaration");
  const cancelled = snapshot(); cancelled.task!.status = "cancelled";
  expect(render(new ResearchTaskPanel(cancelled))).toContain("Snapshot · cancelled");
});

it("labels an unavailable task report in the read-only task view", () => {
  const state = snapshot();
  state.task!.reportRef = "saved-report@revision";
  state.task!.reportAvailable = false;
  expect(researchTaskLines(state)).toContain("Report available: false");
});

it("routes controller keys to the task view and clears it when another panel opens", () => {
  const unexpected = (): never => { throw new Error("Task view must not access unrelated storage"); };
  const data: PanelDataService = { loadSettings: () => structuredClone(DEFAULT_SETTINGS), cwd: unexpected, saveSettings: unexpected,
    listStoredSessions: unexpected, listArtifacts: unexpected, loadPanelPortfolio: unexpected, editPortfolio: unexpected,
    hasWhyjEnvValue: unexpected, stripTerminalControlCodes: value => value };
  const controller = new PanelController(data);
  controller.open("research"); controller.setResearchSnapshot(snapshot());
  const buffer = new Buffer(80, 24); controller.render(buffer);
  expect(buffer.toPlain().join("\n")).toContain("Snapshot · blocked");
  expect(controller.handleKey("", { name: "return" })).toEqual({ command: "/resume --task", close: true });
  controller.close(); expect(controller.isOpen()).toBe(false); expect(controller.handleKey("", { name: "down" })).toBeNull();
  controller.open("research"); controller.setResearchSnapshot(snapshot()); controller.open("help");
  buffer.clear(); controller.render(buffer);
  expect(buffer.toPlain().join("\n")).not.toContain("Snapshot · blocked");
  expect(controller.handleKey("", { name: "return" })?.command).toBe("/compact");
  controller.close();
});
