import { expect, it } from "bun:test";
import { Buffer } from "../src/buffer.ts";
import { PanelController } from "../src/panel.ts";
import { nextInputAction } from "../src/input.ts";
import type { PanelDataService } from "../../../src/runtime/workspace/panel-data.ts";
import { DEFAULT_SETTINGS } from "../../../src/types/config.ts";
import type { DoctorResult } from "../../../src/types/doctor.ts";
import { DoctorPanel, type DoctorPanelView } from "../src/doctor-panel.ts";

function report(): DoctorResult {
  return { ready: true, mode: "diagnostic", overall: "partial_fail", auth: {},
    config: { model: "fixture-model", baseUrl: "http://127.0.0.1/model", endpointMode: "Fixture protocol", dataSource: "akshare", settingsPath: "fixture/settings.json" },
    phases: [
      { phase: "model", label: "Model", status: "pass", detail: "Model response observed", warnings: Array.from({ length: 12 }, (_, i) => `Warning ${i}: 这是诊断说明，必须能够完整阅读。`) },
      { phase: "tools", label: "Tools", status: "pass", detail: "Tool metadata observed" },
      { phase: "data", label: "Data", status: "fail", detail: "DATA_FAILURE_MARKER", action: "REPAIR_MARKER: choose another available endpoint." },
    ], hints: ["LAST_HINT_MARKER: retry after changing the configuration."], logPath: "fixture/DIAGNOSTIC_LOG_MARKER.log" };
}

function controller(): PanelController {
  const unexpected = (): never => { throw new Error("Viewing diagnostics must not request data or save settings"); };
  const data: PanelDataService = { loadSettings: () => structuredClone(DEFAULT_SETTINGS), cwd: unexpected, saveSettings: unexpected,
    listStoredSessions: unexpected, listArtifacts: unexpected, loadPanelPortfolio: unexpected, editPortfolio: unexpected,
    hasWhyjEnvValue: unexpected, stripTerminalControlCodes: value => value };
  const panel = new PanelController(data); panel.open("doctor"); panel.setDoctor(report()); return panel;
}

function raw(panel: PanelController, bytes: string) {
  const { action, rest } = nextInputAction(bytes);
  if (!action || action.type !== "key" || rest) throw new Error("Expected one complete key");
  return panel.handleKey(action.char ?? "", { ...action, name: action.name || undefined });
}

function visible(panel: PanelController, width: number, height: number): string {
  const buf = new Buffer(width, height); panel.render(buf); return buf.toPlain().join("\n");
}

it.each([[60, 20], [80, 24], [120, 32]])("shows blocking failures and their repair before nonblocking warnings at %s x %s", (width, height) => {
  const panel = controller();
  try {
    const first = visible(panel, width, height);
    expect(first).toContain("DATA_FAILURE_MARKER");
    expect(first).toContain("REPAIR_MARKER");
    expect(first.indexOf("DATA_FAILURE_MARKER")).toBeLessThan(first.indexOf("Warn") === -1 ? first.length : first.indexOf("Warn"));
  } finally { panel.close(); }
});

it.each([[60, 20], [80, 24], [120, 32]])("makes late failures, repairs and logs reachable without running checks at %s x %s", (width, height) => {
  const panel = controller();
  try {
    const pages: string[] = [];
    for (let i = 0; i < 100; i++) {
      pages.push(visible(panel, width, height));
      expect(raw(panel, "\x1b[B")).toEqual({});
    }
    const all = pages.join("\n");
    for (const marker of ["DATA_FAILURE_MARKER", "REPAIR_MARKER", "LAST_HINT_MARKER", "DIAGNOSTIC_LOG_MARKER", "fixture-model"]) expect(all).toContain(marker);
    expect(pages.every(page => page.includes("c Configure") && page.includes("escape close"))).toBe(true);
    expect(raw(panel, "\x1b")).toEqual({ close: true });
  } finally { panel.close(); }
});

it("pages and clamps on resize, resets on retry and never carries an old report into reopening", () => {
  const panel = controller();
  try {
    const first = visible(panel, 80, 24);
    raw(panel, "\x1b[6~"); expect(visible(panel, 80, 24)).not.toBe(first);
    raw(panel, "\x1b[5~"); expect(visible(panel, 80, 24)).toBe(first);
    raw(panel, "\x1b[F"); const last = visible(panel, 80, 24); expect(last).toContain("LAST_HINT_MARKER");
    raw(panel, "\x1b[B"); expect(visible(panel, 80, 24)).toBe(last);
    expect(visible(panel, 60, 20)).toContain("c Configure");
    const updated = report(); updated.phases[0].warnings = []; updated.hints = ["Updated hint"];
    panel.setDoctor(updated); expect(visible(panel, 120, 32)).toContain("Updated hint");
    expect(raw(panel, "r")).toEqual({ command: "/doctor" });
    const loading = visible(panel, 80, 24); expect(loading).toContain("running"); expect(loading).not.toContain("Updated hint");
    panel.setDoctor(report()); expect(visible(panel, 80, 24)).toBe(first);
    raw(panel, "\x1b[F"); visible(panel, 80, 24);
    panel.close(); panel.open("doctor"); panel.setDoctor(report());
    expect(visible(panel, 80, 24)).toBe(first);
  } finally { panel.close(); }
});

it("uses remapped scrolling and close controls without stealing unbound keys", () => {
  const panel = new DoctorPanel({ next: ["j"], previous: ["k"], doctorPageDown: ["ctrl+d"], doctorPageUp: ["ctrl+u"], home: ["g"], end: ["G"], cancel: ["ctrl+q"] });
  const data: DoctorPanelView = { title: "Fixture", status: "partial_fail", mode: "diagnostic", model: "fixture", baseUrl: "", endpointMode: "", dataSource: "fixture", settingsPath: "fixture",
    phases: [{ phase: "model", status: "fail", detail: Array.from({ length: 30 }, (_, i) => `Detail ${i}`).join("\n") }], hints: ["Last hint"] };
  const screen = () => { const buf = new Buffer(80, 24); panel.render(buf, data); return buf.toPlain().join("\n"); };
  const first = screen(); expect(first).toContain("k/j scroll"); expect(first).toContain("ctrl+q close");
  expect(panel.handleKey("", { name: "down" })).toBeUndefined();
  expect(panel.handleKey("", { name: "escape" })).toBeUndefined();
  expect(panel.handleKey("j", { name: "j" })).toEqual({}); expect(screen()).not.toBe(first);
  panel.handleKey("k", { name: "k" }); expect(screen()).toBe(first);
  panel.handleKey("", { name: "d", ctrl: true }); expect(screen()).not.toBe(first);
  panel.handleKey("g", { name: "g" }); expect(screen()).toBe(first);
  expect(panel.handleKey("", { name: "q", ctrl: true })).toEqual({ close: true });
});
