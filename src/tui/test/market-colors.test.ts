import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Buffer, strWidth } from "../src/buffer.ts";
import { buildConversationLines, type RenderLine } from "../src/render-lines.ts";
import { buildOverviewLines } from "../src/overview-render.ts";
import { marketForegrounds, S } from "../src/styles.ts";
import { PanelController } from "../src/panel.ts";
import { loadSettings, saveSettings } from "../../storage/index.ts";
import { buildLocalStorageState } from "../../runtime/workspace/panel-service.ts";
import { WHYJ_THEME } from "../../types/theme-colors.ts";
import { QuantTui } from "../src/tui.ts";
import { createInitialAppState } from "../../app-runtime.ts";
import type { InputAction } from "../src/input.ts";

let root: string, previous: string | undefined;
let panel: PanelController | undefined;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "whyj-market-colors-"));
  process.env.OHQUANT_DIR = root;
});
afterEach(() => {
  panel?.close(); panel = undefined;
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected market color test path");
  rmSync(root, { recursive: true, force: true });
});

function paintLines(lines: RenderLine[], scheme: "red-up" | "green-up", width = 120): Buffer {
  const buffer = new Buffer(width, Math.max(1, lines.length));
  buffer.foregrounds = marketForegrounds(scheme);
  lines.forEach((line, y) => {
    let x = 0;
    for (const segment of line.segments ?? [{ text: line.text, style: line.style }]) {
      x = buffer.text(x, y, segment.text, segment.style);
    }
  });
  return buffer;
}
function colorAt(buffer: Buffer, text: string): string | undefined {
  const y = buffer.toPlain().findIndex(line => line.includes(text));
  expect(y).toBeGreaterThanOrEqual(0);
  const row = buffer.toPlain()[y]!;
  const x = strWidth(row.slice(0, row.indexOf(text)));
  return buffer.cells[y * buffer.w + x]?.fg;
}

it("repaints cached table lines per buffer while risk, status, zero and missing values stay independent", () => {
  const lines = buildConversationLines([{ role: "assistant", text: [
    "| metric | value | status |", "| --- | --- | --- |",
    "| Return | +2.50% | ready |", "| Return | -1.25% | failed |",
    "| Max DD | -8.20% | breach |", "| VaR | +3.10% | risk |",
    "| Return | +0.00% | missing |", "| Return | -0.00% | N/A |",
  ].join("\n") }], 120);
  const red = paintLines(lines, "red-up"), green = paintLines(lines, "green-up");
  expect(colorAt(red, "+2.50%")).toBe(WHYJ_THEME.marketUp);
  expect(colorAt(green, "+2.50%")).toBe(WHYJ_THEME.marketDown);
  expect(colorAt(red, "-1.25%")).toBe(WHYJ_THEME.marketDown);
  expect(colorAt(green, "-1.25%")).toBe(WHYJ_THEME.marketUp);
  for (const buffer of [red, green]) {
    for (const text of ["-8.20%", "+3.10%", "failed"]) expect(colorAt(buffer, text)).toBe(WHYJ_THEME.negative);
    expect(colorAt(buffer, "ready")).toBe(WHYJ_THEME.positive);
    for (const text of ["+0.00%", "-0.00%", "N/A", "missing"]) expect(colorAt(buffer, text)).toBe(WHYJ_THEME.muted);
  }
  expect(colorAt(red, "+2.50%")).toBe(WHYJ_THEME.marketUp);
  red.text(0, 0, "selected", S.selection);
  expect(red.cells[0]?.bg).toBe(WHYJ_THEME.selectionBg);
});

it("renders mixed-market Overview with the chosen convention, signed values and neutral rounded zeros", () => {
  for (const width of [28, 40, 60]) {
    const lines = buildOverviewLines([{ kind: "quotes", title: "Mixed markets", rows: [
      { code: "000001.SZ", name: "A", price: 10, pct: 1.25 },
      { code: "AAPL", name: "US", price: 20, pct: -2.5 },
      { code: "00700.HK", name: "HK", price: 30, pct: -0.004 },
      { code: "006265.OF", name: "Fund", price: NaN, pct: NaN },
    ] }], width);
    expect(lines.every(line => strWidth(line.text) <= width)).toBe(true);
    for (const scheme of ["red-up", "green-up"] as const) {
      const buffer = paintLines(lines, scheme, width);
      expect(colorAt(buffer, "+1.25%")).toBe(marketForegrounds(scheme)["market-up"]);
      expect(colorAt(buffer, "-2.50%")).toBe(marketForegrounds(scheme)["market-down"]);
      expect(colorAt(buffer, "0.00%")).toBe(WHYJ_THEME.muted);
      expect(colorAt(buffer, "--")).toBe(WHYJ_THEME.muted);
      expect(buffer.toPlain().join("\n")).not.toContain("-0.00%");
    }
  }
});

function screen(width = 120, height = 30): Buffer {
  const buffer = new Buffer(width, height); panel!.render(buffer); return buffer;
}
function selectColors(): void {
  for (let i = 0; i < 20; i++) {
    if (screen().toPlain().some(line => line.includes("> Market Colors "))) return;
    panel!.handleKey("", { name: "down" });
  }
  throw new Error("Market Colors setting not discoverable");
}

it("persists the Settings choice, projects it at startup, and closes without a market refresh", () => {
  panel = new PanelController(); panel.open("config"); selectColors();
  for (const [width, height] of [[60, 20], [80, 24], [120, 40]]) {
    expect(screen(width, height).toPlain().join("\n")).toContain("Market Colors");
  }
  expect(panel.handleKey("", { name: "return" })).toEqual({});
  expect(panel.marketColorScheme()).toBe("green-up");
  expect(screen().toPlain().join("\n")).toContain("Green ↑ Red ↓");
  expect(panel.handleKey("", { name: "escape" })).toEqual({ close: true, refreshPanel: false });
  panel.close(); panel.open("config");
  const settings = loadSettings();
  expect(settings.preferences.marketColorScheme).toBe("green-up");
  expect(buildLocalStorageState(settings, { symbols: [], groups: [] }).marketColorScheme).toBe("green-up");
  expect(panel.marketColorScheme()).toBe("green-up");
});

it("does not apply a color change after a settings conflict", () => {
  panel = new PanelController(); panel.open("config"); selectColors();
  const other = loadSettings(); other.preferences.defaultBenchmark = "SPY"; saveSettings(other);
  const saved = readFileSync(join(root, "settings.json"), "utf8");
  panel.handleKey("", { name: "return" });
  expect(panel.marketColorScheme()).toBe("red-up");
  expect(screen().toPlain().join("\n")).toContain("Settings changed.");
  expect(readFileSync(join(root, "settings.json"), "utf8")).toBe(saved);
  expect(panel.handleKey("", { name: "escape" })).toEqual({ close: true, refreshPanel: false });
});

it("applies a saved selection through the actual TUI key handler and paint lifecycle", () => {
  const tui = new QuantTui(createInitialAppState("fixture"));
  tui.screen.out = { columns: 200, rows: 36, write: () => true } as unknown as NodeJS.WriteStream;
  tui.screen.resize();
  tui.state.activity = "ready"; tui.state.panelLoading = false;
  tui.state.panel = [{ kind: "quotes", title: "Market", rows: [{ code: "AAPL", name: "Apple", price: 100, pct: 2.75 }] }];
  // Exercise the internal keyboard event boundary without acquiring the user's stdin or starting background jobs.
  const dispatch = Reflect.get(tui, "handleKeyAction").bind(tui) as (action: Extract<InputAction, { type: "key" }>) => void;
  const press = (name: string) => dispatch({ type: "key", name, ctrl: false, meta: false, shift: false });
  tui.openConfig();
  panel = Reflect.get(tui, "panel") as PanelController;
  selectColors(); press("return"); press("escape");
  expect(tui.state.marketColorScheme).toBe("green-up");
  expect(tui.state.composerStatus).toBeNull();
  tui.openHelp();
  expect(colorAt(tui.screen.buf, "+2.75%")).toBe(WHYJ_THEME.marketDown);
  press("escape");
});

it("migrates absent or invalid conventions to red-up without losing other preferences", () => {
  for (const value of [undefined, "invalid", null, 42]) {
    writeFileSync(join(root, "settings.json"), JSON.stringify({ preferences: { marketColorScheme: value, defaultBenchmark: "QQQ" } }));
    const settings = loadSettings();
    expect(settings.preferences.marketColorScheme).toBe("red-up");
    expect(settings.preferences.defaultBenchmark).toBe("QQQ");
  }
});
