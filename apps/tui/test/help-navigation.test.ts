import { expect, it } from "bun:test";
import { PanelController, type PanelResult } from "../src/panel.ts";
import { Buffer } from "../src/buffer.ts";
import { nextInputAction } from "../src/input.ts";
import { buildHelpPanelData } from "../src/panel-models.ts";
import { COMMAND_CATALOG } from "../../../src/runtime/workspace/command-catalog.ts";
import { executeCommand, parseCommand } from "../../../src/cli/registry.ts";
import type { PanelDataService } from "../../../src/runtime/workspace/panel-data.ts";
import { DEFAULT_SETTINGS } from "../../../src/types/config.ts";
import { HelpPanel } from "../src/help-panel.ts";
import { QuantTui } from "../src/tui.ts";
import { AppRuntime, createInitialAppState } from "../../../src/app-runtime.ts";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { saveSettings } from "../../../src/storage/index.ts";

function controller(): PanelController {
  const unexpected = (): never => { throw new Error("Help must not access unrelated data or save settings"); };
  const data: PanelDataService = { loadSettings: () => structuredClone(DEFAULT_SETTINGS), cwd: unexpected,
    saveSettings: unexpected, listStoredSessions: unexpected, listArtifacts: unexpected, loadPanelPortfolio: unexpected,
    editPortfolio: unexpected, hasWhyjEnvValue: unexpected, stripTerminalControlCodes: value => value };
  const panel = new PanelController(data); panel.open("help"); return panel;
}

function raw(panel: PanelController, bytes: string): PanelResult | null {
  let result: PanelResult | null = null;
  while (bytes) {
    const { action, rest } = nextInputAction(bytes); bytes = rest;
    if (!action || action.type !== "key") throw new Error("Expected a complete keyboard input");
    result = panel.handleKey(action.char ?? "", { ...action, name: action.name || undefined });
  }
  return result;
}

function visible(panel: PanelController, width: number, height: number): string {
  const buffer = new Buffer(width, height); panel.render(buffer); return buffer.toPlain().join("\n");
}

it.each([[60, 20], [80, 24], [120, 32]])("makes every Help command readable and queries usage without running it at %s x %s", async (width, height) => {
  const panel = controller();
  try {
    for (const entry of COMMAND_CATALOG) {
      const screen = visible(panel, width, height);
      expect(screen).toContain(entry.desc);
      expect(screen).toContain(`Usage: /help ${entry.name.slice(1)}`);
      const usage = raw(panel, "?");
      expect(usage).toEqual({ command: `/help ${entry.name.slice(1)}`, close: true });
      const result = await executeCommand(parseCommand(usage!.command!)!);
      expect(result.success).toBe(true); expect(result.effects).toBeUndefined();
      expect(result.message).toContain(entry.desc);
      expect(raw(panel, "\r")).toEqual({ command: entry.name, close: true });
      raw(panel, "\x1b[B");
    }
    expect(visible(panel, width, height)).toContain("Usage: /help compact");
    raw(panel, "\x1b[A"); expect(visible(panel, width, height)).toContain("Usage: /help exit");
    expect(raw(panel, "\x1b")).toEqual({ close: true });
  } finally { panel.close(); }
});

it.each([[60, 20], [80, 24], [120, 32]])("keeps all Hotkeys readable, read-only and reachable across section changes at %s x %s", (width, height) => {
  const panel = controller();
  try {
    raw(panel, "\x1b[A"); // Keep /exit selected while reading shortcuts.
    raw(panel, "\t");
    for (const item of buildHelpPanelData(0).hotkeys) {
      const screen = visible(panel, width, height);
      expect(screen).toContain(item.key); expect(screen).toContain(item.desc);
      expect(raw(panel, "\r")).toEqual({}); expect(raw(panel, "?")).toEqual({});
      raw(panel, "\x1b[B");
    }
    raw(panel, "\x1b[A");
    expect(visible(panel, 120, 32)).toContain("Slash command mode");
    expect(visible(panel, 60, 20)).toContain("Slash command mode");
    raw(panel, "\x1b[Z"); // Shift+Tab returns to commands without losing selection.
    expect(visible(panel, width, height)).toContain("Usage: /help exit");
    raw(panel, "\t"); expect(raw(panel, "\x1b")).toEqual({ close: true });
    panel.close(); panel.open("help");
    expect(visible(panel, width, height)).toContain("Usage: /help compact");
  } finally { panel.close(); }
});

it("uses remapped Help controls for both handling and visible hints", () => {
  const panel = new HelpPanel({ helpSection: ["ctrl+t"], helpUsage: ["u"], confirm: ["ctrl+r"], cancel: ["ctrl+q"], previous: ["k"], next: ["j"] });
  const screen = () => { const buffer = new Buffer(80, 24); panel.render(buffer); return buffer.toPlain().join("\n"); };
  expect(screen()).toContain("ctrl+t switch"); expect(screen()).toContain("ctrl+r run · u usage");
  expect(panel.handleKey("", { name: "tab" })).toEqual({});
  expect(panel.handleKey("?", {})).toEqual({});
  expect(panel.handleKey("", { name: "return" })).toEqual({});
  expect(panel.handleKey("", { name: "escape" })).toEqual({});
  panel.handleKey("j", {}); expect(screen()).toContain("Usage: /help resume");
  panel.handleKey("k", {}); expect(screen()).toContain("Usage: /help compact");
  expect(panel.handleKey("u", {})).toEqual({ command: "/help compact", close: true });
  panel.handleKey("", { ctrl: true, name: "t" }); expect(screen()).toContain("[Hotkeys]");
  expect(panel.handleKey("", { ctrl: true, name: "r" })).toEqual({});
  panel.handleKey("", { ctrl: true, name: "t" });
  expect(panel.handleKey("", { ctrl: true, name: "r" })).toEqual({ command: "/compact", close: true });
  expect(panel.handleKey("", { ctrl: true, name: "q" })).toEqual({ close: true });
});

it.each([[60, 20], [80, 24], [120, 32]])("opens Help from Composer, reads exit usage and keeps the session usable at %s x %s", async (width, height) => {
  const previous = process.env.OHQUANT_DIR, root = mkdtempSync(join(tmpdir(), "whyj-help-keyboard-"));
  process.env.OHQUANT_DIR = root;
  let tui: QuantTui | undefined, runtime: AppRuntime | undefined;
  try {
    saveSettings(structuredClone(DEFAULT_SETTINGS));
    const original = readFileSync(join(root, "settings.json"), "utf8");
    tui = new QuantTui(createInitialAppState("help-fixture"));
    tui.screen.out = { columns: width, rows: height, write: () => true } as unknown as NodeJS.WriteStream;
    tui.screen.resize();
    const effects: string[] = [], submitted: string[] = [], pending: Promise<string>[] = [];
    runtime = new AppRuntime({ onHelpRequest: () => tui!.openHelp(), onMessages: messages => tui!.update({ messages }),
      onActivity: activity => tui!.update({ activity }),
      onPanel: () => effects.push("market"), onConfigRequest: () => effects.push("config"), onDoctorRequest: () => effects.push("doctor") },
      async () => { throw new Error("No market request"); }, async () => { throw new Error("No market request"); },
      () => { throw new Error("No model initialization"); });
    tui.onSubmit(text => { submitted.push(text); pending.push(runtime!.submit(text)); });
    tui.onPanelRefresh(() => effects.push("refresh"));
    const key = Reflect.get(tui, "handleKeyAction").bind(tui) as (action: Exclude<ReturnType<typeof nextInputAction>["action"], null>) => void;
    const type = (bytes: string) => {
      while (bytes) {
        const { action, rest } = nextInputAction(bytes); bytes = rest;
        if (!action || action.type !== "key") throw new Error("Expected complete input");
        key(action);
      }
    };
    const settle = async () => { while (pending.length) expect(await Promise.all(pending.splice(0))).not.toContain("exit"); };
    type("/hel\t\r"); await settle();
    type("\x1b[A"); type("\t\r"); // Hotkeys Enter must not execute the selected /exit.
    expect(submitted).toEqual(["/help"]);
    type("\x1b[Z?"); await settle();
    expect(submitted).toEqual(["/help", "/help exit"]);
    expect(tui.state.messages.some(message => message.text?.includes("Exit WhyJ Quant"))).toBe(true);
    expect((Reflect.get(tui, "panel") as PanelController).isOpen()).toBe(false);
    type("/help portfolio\r"); await settle();
    expect(tui.state.messages.some(message => message.text?.includes("Manage observation groups"))).toBe(true);
    type("/help\r"); await settle(); type("\x1b");
    expect((Reflect.get(tui, "panel") as PanelController).isOpen()).toBe(false);
    expect(effects).toEqual([]);
    expect(readFileSync(join(root, "settings.json"), "utf8")).toBe(original);
  } finally {
    await runtime?.shutdown();
    if (tui) (Reflect.get(tui, "panel") as PanelController).close();
    if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected Help fixture directory");
    rmSync(root, { recursive: true, force: true });
  }
});
