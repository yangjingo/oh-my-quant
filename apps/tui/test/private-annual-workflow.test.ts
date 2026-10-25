import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { AppRuntime } from "../../../src/app-runtime.ts";
import { accountHistoryFixture } from "../../../src/performance/test/fixture.ts";
import { annualComparisonFixture } from "../../../src/research/test/annual-fixture.ts";
import { listAnnualReports } from "../../../src/runtime/research/annual-reports.ts";
import { QuantTui } from "../src/tui.ts";
import { Buffer } from "../src/buffer.ts";
import type { PrivateAnnualExportRequest } from "../../../src/types/private-annual-export.ts";
import type { AppState } from "../../../src/types/ui.ts";

let stateRoot: string, exportRoot: string, previous: string | undefined;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  stateRoot = mkdtempSync(join(tmpdir(), "whyj-private-panel-state-"));
  exportRoot = mkdtempSync(join(tmpdir(), "whyj-private-panel-export-"));
  process.env.OHQUANT_DIR = stateRoot;
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  for (const path of [stateRoot, exportRoot]) {
    if (!resolve(path).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected private panel test directory");
    rmSync(path, { recursive: true, force: true });
  }
});

function state(): AppState {
  return { model: "test", modelLabel: "test", version: "test", user: "test", activity: "ready", cost: 0, cacheHit: 0,
    messages: [], panel: [], panelLoading: false, input: "", composerQueue: [], composerStatus: null,
    activePortfolio: "holdings.json", source: "llmquant-data", showPortfolioPanel: true };
}
function press(tui: QuantTui, name: string, char = "") {
  (tui as unknown as { handleKeyAction: (action: unknown) => void }).handleKeyAction({ type: "key", name, char, shift: false, ctrl: false, meta: false });
}
function fill(tui: QuantTui, value: string) {
  press(tui, "return");
  for (const char of value) press(tui, "", char);
  press(tui, "return");
  press(tui, "down");
}

test("artifact panel's explicit review exports a private annual file without Agent messages or app reports", async () => {
  const comparison = (await annualComparisonFixture()).save();
  const history = accountHistoryFixture();
  const endAt = Date.parse("2025-12-31T23:59:59.999Z");
  history.request.endAt = endAt;
  history.request.accountRef = "PRIVATE_PANEL_ACCOUNT_SENTINEL_6802";
  history.valuations.at(-1)!.at = endAt;
  history.source.observedAt = endAt + 1000;
  const input = join(exportRoot, "history.json"), output = join(exportRoot, "private.html");
  writeFileSync(input, JSON.stringify(history));

  const statuses: string[] = [], messages: string[] = [];
  const runtime = new AppRuntime({ onMessages: rows => messages.push(JSON.stringify(rows)), onActivity() {},
    onComposerStatus: status => { if (status?.text) statuses.push(status.text); } }, async () => [], async () => []);
  const tui = new QuantTui(state());
  (tui.screen as unknown as { flush: () => void; exit: () => void }).flush = () => {};
  (tui.screen as unknown as { flush: () => void; exit: () => void }).exit = () => {};
  tui.screen.buf = new Buffer(60, 20);
  (tui as unknown as { running: boolean }).running = true;
  let operation: Promise<void> | undefined, selected: PrivateAnnualExportRequest | undefined;
  tui.onPrivateAnnualExport(request => { selected = request; operation = runtime.exportPrivateAnnual(request); });
  try {
    tui.openArtifact();
    press(tui, "", "p");
    fill(tui, comparison.id);
    fill(tui, "2025");
    fill(tui, "2025-12-31");
    fill(tui, input);
    fill(tui, output);
    press(tui, "down"); // Skip optional selected decision IDs.
    press(tui, "return"); // Review requires a second explicit Enter.
    (tui as unknown as { paint: () => void }).paint();
    expect(tui.screen.buf.toPlain().join("\n")).toContain("private.html");
    expect(existsSync(output)).toBe(false);
    expect(operation).toBeUndefined();
    press(tui, "return");
    expect(selected).toMatchObject({ comparisonId: comparison.id, year: 2025, historyFile: input, output });
    await operation;

    expect(readFileSync(output, "utf8")).toContain(history.request.accountRef);
    expect(readFileSync(output, "utf8")).toContain("data-account-performance");
    expect(messages.join("\n")).not.toContain(history.request.accountRef);
    expect(statuses.join("\n")).not.toContain(history.request.accountRef);
    expect(listAnnualReports().items).toHaveLength(0);
    expect(existsSync(join(stateRoot, "reports", "annual"))).toBe(false);

    await runtime.exportPrivateAnnual(selected!);
    expect(readFileSync(output, "utf8")).toContain(history.request.accountRef);
    expect(statuses.at(-1)).toContain("already exists");
  } finally {
    runtime.dispose();
    tui.stop();
  }
}, 20_000);

test("private annual panel stays discoverable on a small terminal and cancel never sends an export", () => {
  const tui = new QuantTui(state());
  (tui.screen as unknown as { flush: () => void; exit: () => void }).flush = () => {};
  (tui.screen as unknown as { flush: () => void; exit: () => void }).exit = () => {};
  (tui as unknown as { running: boolean }).running = true;
  tui.screen.buf = new Buffer(60, 20);
  let exports = 0;
  tui.onPrivateAnnualExport(() => { exports++; });
  try {
    tui.openArtifact();
    expect(tui.screen.buf.toPlain().join("\n")).toContain("P private annual export");
    press(tui, "", "p");
    (tui as unknown as { paint: () => void }).paint();
    expect(tui.screen.buf.toPlain().join("\n")).toContain("Private annual export");
    press(tui, "return"); // Editing the comparison field.
    press(tui, "return"); // Empty required field stays in edit mode.
    (tui as unknown as { paint: () => void }).paint();
    expect(tui.screen.buf.toPlain().join("\n")).toContain("Comparison ID is required.");
    press(tui, "escape"); // Cancel field edit.
    press(tui, "escape"); // Close the whole private wizard.
    expect(exports).toBe(0);
    expect(existsSync(join(exportRoot, "private.html"))).toBe(false);
  } finally { tui.stop(); }
});
