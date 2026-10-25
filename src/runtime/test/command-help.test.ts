import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { COMMAND_CATALOG } from "../workspace/command-catalog.ts";
import { commandHelpResult } from "../workspace/command-help.ts";
import { executeCommand, parseCommand } from "../../cli/registry.ts";
import { AppRuntime } from "../../app-runtime.ts";
import { buildSuggestions } from "../../../apps/tui/src/input.ts";
import { buildHelpPanelData } from "../../../apps/tui/src/panel-models.ts";
import { Buffer as TerminalBuffer } from "../../../apps/tui/src/buffer.ts";
import { drawPanelFrame } from "../../../apps/tui/src/panel-chrome.ts";
import { renderHelpPanelView } from "../../../apps/tui/src/panel-views.ts";

let root: string, previous: string | undefined;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "whyj-command-help-")); process.env.OHQUANT_DIR = root;
  writeFileSync(join(root, "settings.json"), "INVALID_SETTINGS_MUST_NOT_BE_READ");
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected help fixture directory");
  rmSync(root, { recursive: true, force: true });
});

it("resolves usage for all public commands before settings, panels or agent actions", async () => {
  const forbidden = () => { throw new Error("Help must not open or run the command"); };
  for (const entry of COMMAND_CATALOG) {
    const direct = await executeCommand(parseCommand(`${entry.name} --help`)!, {
      openConfig: forbidden, openDoctor: forbidden, openHelp: forbidden, openPortfolio: forbidden,
      openResume: forbidden, openArtifact: forbidden, manageExtensions: forbidden,
    });
    const named = await executeCommand(parseCommand(`/help ${entry.name}`)!);
    expect(direct).toEqual(named); expect(direct.success).toBe(true);
    expect(direct.effects).toBeUndefined(); expect(direct.message).toContain(entry.desc);
    expect(direct.data).toHaveProperty("usage");
  }
  expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("INVALID_SETTINGS_MUST_NOT_BE_READ");
});

it("does not execute malformed help, unknown commands, or help appended to a mutation", async () => {
  for (const input of ["/clear --help false", "/exit --help extra", "/help portfolio extra", "/help unknown", "/unknown --help"]) {
    const result = await executeCommand(parseCommand(input)!);
    expect(result.success).toBe(false); expect(result.effects).toBeUndefined();
  }
  for (const input of ["/portfolio delete Core --help", "/config --extensions disable whyj.core --help", "/skill install owner/repo --help", "/compact -h", "/session --help"]) {
    const result = await executeCommand(parseCommand(input)!);
    expect(result.success).toBe(true); expect(result.effects).toBeUndefined();
  }
  expect(commandHelpResult(parseCommand("/clear")!)).toBeUndefined();
});

it("keeps every public command discoverable with no installed skills and preserves exact-command behavior", () => {
  const all = buildSuggestions("/", [], []);
  for (const entry of COMMAND_CATALOG) {
    expect(all).toContainEqual({ label: `${entry.name}  ${entry.desc}`, fill: entry.name });
    expect(buildSuggestions(entry.name, [], [])).toEqual([]);
  }
  expect(buildSuggestions("/ski", [], [])).toEqual([{ label: "/skill  Download, load, and run skills", fill: "/skill" }]);
  expect(buildSuggestions("/artifact ", [], [])).toEqual([]);
  for (const [width, height] of [[60, 20], [80, 24], [120, 32]] as const) {
    const buffer = new TerminalBuffer(width, height);
    const data = buildHelpPanelData(2);
    expect(data.commands.map(({ selected: _selected, ...entry }) => entry)).toEqual([...COMMAND_CATALOG]);
    renderHelpPanelView(buffer, drawPanelFrame(buffer, "Help", "Esc close"), data);
    expect(buffer.toPlain().join("\n")).toContain("Usage: /help portfolio");
  }
});

it("handles usage in AppRuntime without bootstrapping, changing activity, running diagnostics or refreshing quotes", async () => {
  const messages: string[] = [], effects: string[] = [];
  const runtime = new AppRuntime({
    onMessages: items => { messages.splice(0, messages.length, ...items.map(item => item.text ?? "")); },
    onActivity: value => effects.push(value), onDoctorRequest: () => effects.push("doctor"),
    onSkillsChanged: () => effects.push("skills"), onPanel: () => effects.push("market"),
    onPortfolioRequest: () => effects.push("portfolio"), onConfigRequest: () => effects.push("config"),
  }, async () => { throw new Error("No quotes"); }, async () => { throw new Error("No quotes"); },
  () => { throw new Error("No model startup"); });
  try {
    for (const input of ["/clear --help", "/compact --help", "/doctor --help", "/skill install owner/repo --help", "/exit --help", "/help portfolio"]) {
      expect(await runtime.submit(input)).toBe("continue");
    }
    expect(effects).toEqual([]);
    expect(messages.join("\n")).toContain("Summarize the active research session");
    expect(messages.join("\n")).toContain("Manage observation groups");
    expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("INVALID_SETTINGS_MUST_NOT_BE_READ");
  } finally { await runtime.shutdown(); }
});

it("prints a stable one-shot help envelope even with corrupt settings", async () => {
  const child = Bun.spawn([process.execPath, "src/index.ts", "--json", "-c", "/clear --help"], {
    env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe",
  });
  const deadline = setTimeout(() => child.kill(), 10000);
  try {
    const [text, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(exit).toBe(0); expect(error).toBe("");
    const result = JSON.parse(text);
    expect(result).toMatchObject({ ok: true, command: "clear", data: { name: "/clear", usage: expect.any(Array) } });
    expect(result.message).toContain("Saved research sessions and reports remain");
    expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("INVALID_SETTINGS_MUST_NOT_BE_READ");
  } finally { clearTimeout(deadline); child.kill(); await child.exited; }
}, 15000);
