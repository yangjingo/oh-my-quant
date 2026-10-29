import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { commandPreflight } from "../workspace/command-preflight.ts";
import { parseDoctorPhases } from "../workspace/doctor-phases.ts";
import { executeCommand, parseCommand } from "../../cli/registry.ts";
import { AppRuntime } from "../../app-runtime.ts";
import { piConfigHandler } from "../../cli/handlers/pi-config.ts";
import { extensionsHandler } from "../../cli/handlers/extensions.ts";

let root: string, previous: string | undefined;
const invalid = [
  "/skill info Alpha --check-imports false", "/skill run Alpha --check-imports", "/skill list --check-imports",
  "/clear --dry-run", "/clear extra", "/exit --force", "/help --verbose", "/artifact --generate", "/config --unknown", "/config extra",
  "/compact --symbol AAPL", "/resume one two", "/resume --task false", "/resume session --task", "/resume --unknown",
  "/portfolio delete Core --dry-run", "/portfolio list Core", "/portfolio add Core", "/portfolio use Core", "/portfolio select", "/portfolio select Core extra",
  "/doctor --phase", '/doctor --phase ""', "/doctor --phase data,typo", "/doctor --phsae data", "/doctor extra",
  "/doctor --phase model --phase data", "/doctor --tool fetch_bars --phase data", "/doctor --tool",
  "/skill info Alpha --check false", "/skill list --scope", "/skill list extra", "/skill install owner/repo extra",
  "/skill info Alpha --check-network false", "/skill run Alpha --check-network", "/skill list --check-network",
  "/skill audit position-sizer --record private.json", "/skill audit position-sizer --json only.json",
  "/skill run Alpha --name Beta", "/skill info --name Alpha --skill Beta", "/skill Alpha --unknown", "/constructor", "/toString",
  "/config --pi", "/config --pi list --extensions list", "/config --pi list --provider custom", "/config --pi preview --review token",
  "/config --pi apply", '/config --pi apply --review ""', '/config --pi list --from " "', '/config --pi preview --model ""',
  "/config --extensions disable", '/config --extensions disable ""', "/config --extensions list extra", "/config --extensions unknown",
];
beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "whyj-command-preflight-")); process.env.OHQUANT_DIR = root;
  writeFileSync(join(root, "settings.json"), "INVALID_CONFIGURATION_MUST_NOT_BE_READ");
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected command fixture directory");
  rmSync(root, { recursive: true, force: true });
});

it("rejects invalid command arguments before settings, panels, mutation and diagnostics", async () => {
  const forbidden = () => { throw new Error("Unexpected command side effect"); };
  for (const input of invalid) {
    const result = await executeCommand(parseCommand(input)!, {
      openConfig: forbidden, openDoctor: forbidden, openHelp: forbidden, openPortfolio: forbidden, openResume: forbidden,
      openArtifact: forbidden, openResearch: forbidden, manageExtensions: forbidden,
    });
    expect(result.success).toBe(false); expect(result.effects).toBeUndefined();
    expect(result.message).toMatch(/help/);
  }
  expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("INVALID_CONFIGURATION_MUST_NOT_BE_READ");
});

it("preserves documented research commands, skill selectors, quoted labels and endpoint parameters", () => {
  for (const input of ["/clear", "/exit", "/compact retain original parameters", "/resume old-session", "/resume --task", "/portfolio",
    "/skill info technical-analyst", "/skill info technical-analyst",
    '/portfolio create "Growth --US"', '/portfolio select "Growth US"', "/portfolio select group-1", '/portfolio add "Growth US" AAPL "Apple Inc"', "/portfolio remove Core AAPL", "/portfolio import old group",
    "/doctor --phase DATA,tools", "/doctor --tool fetch_bars --market US --symbol AAPL --start 2025-01-06 --end 2025-01-17",
    "/skill list --scope user", "/skill info technical-analyst", "/skill info technical-analyst", "/skill install --repo owner/repo",
    "/skill info technical-analyst", "/skill info technical-analyst",
    "/skill info technical-analyst",
    "/skill install",
    "/skill run Alpha retain dates", "/skill trigger --skill Alpha", "/skill:Alpha retain dates", "/config --pi list", "/config --extensions list",
    '/config --pi preview --provider custom --model "model with spaces"', '/config --pi apply --from "C:\\Pi Lab" --review observed-token',
    "/config --extensions", "/config --extensions disable whyj.core", "/config --extensions reload whyj.core"]) {
    expect(commandPreflight(parseCommand(input)!)).toBeUndefined();
  }
  expect(parseCommand('/config --pi list --from "C:\\Users\\Research Lab\\.pi"')!.flags.from).toBe("C:\\Users\\Research Lab\\.pi");
  expect(commandPreflight(parseCommand("/portfolio delete Core --help")!)?.success).toBe(true);
});

it("applies the same config contract to direct handlers without reading settings or managing extensions", async () => {
  const ctx = { manageExtensions: () => { throw new Error("Must not manage extensions"); } };
  for (const input of invalid.filter(input => input.startsWith("/config --pi") || input.startsWith("/config --extensions"))) {
    const parsed = parseCommand(input)!;
    const result = await (parsed.flags.pi !== undefined ? piConfigHandler : extensionsHandler)(parsed.flags, parsed.positional, ctx);
    expect(result.success).toBe(false); expect(result.effects).toBeUndefined();
    expect(result.message).not.toContain("INVALID_CONFIGURATION_MUST_NOT_BE_READ");
  }
  expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("INVALID_CONFIGURATION_MUST_NOT_BE_READ");
});

it("rejects duplicate flags without choosing either value and keeps special object keys as data", async () => {
  const repeated = parseCommand("/doctor --phase data --phase model")!;
  expect(repeated.argumentError).toContain("Duplicate");
  expect((await executeCommand(repeated)).success).toBe(false);
  const special = parseCommand("/clear --__proto__ value")!;
  expect(Object.hasOwn(special.flags, "__proto__")).toBe(true);
  expect((await executeCommand(special)).success).toBe(false);
});

it("requires every explicitly requested Doctor phase to be valid", () => {
  expect(parseDoctorPhases(undefined)).toBeUndefined();
  expect(parseDoctorPhases(" DATA,tools data ")).toEqual(["data", "tools"]);
  for (const value of [true, false, 0, null, "", " , ", "unknown", "data,unknown"]) expect(() => parseDoctorPhases(value)).toThrow("No diagnostics were started");
});

it("returns invalid-input errors through AppRuntime without activity, market refresh or model initialization", async () => {
  const messages: string[] = [], effects: string[] = [], statuses: string[] = [];
  const runtime = new AppRuntime({
    onMessages: items => { messages.splice(0, messages.length, ...items.map(item => item.text ?? "")); },
    onActivity: value => effects.push(value), onDoctorRequest: () => effects.push("doctor"),
    onComposerStatus: status => { if (status) { expect(status.kind).toBe("error"); statuses.push(status.text); } },
    onSkillsChanged: () => effects.push("skills"), onPanel: () => effects.push("market"),
  }, async () => { throw new Error("No quotes"); }, async () => { throw new Error("No quotes"); }, () => { throw new Error("No model"); });
  try {
    for (const input of invalid) expect(await runtime.submit(input)).toBe("continue");
    expect(effects).toEqual([]);
    expect(statuses).toHaveLength(invalid.length);
    expect(statuses.join("\n")).toContain("No diagnostics were started");
    expect(messages).toEqual([]);
  } finally { await runtime.shutdown(); }
});

it.each([
  { args: ["--json", "doctor", "--phase", "data,typo"], code: "invalid_arguments" },
  { args: ["--json", "doctor", "--phase"], code: "invalid_arguments" },
  { args: ["--json", "doctor", "--phsae", "data"], code: "invalid_arguments" },
  { args: ["--json", "doctor", "--phase", "data", "--phase", "model"], code: "invalid_arguments" },
  { args: ["--json", "-c", "/doctor --phase data,typo"], code: "command_failed" },
  { args: ["--json", "-c", "/portfolio delete Core --dry-run"], code: "command_failed" },
  { args: ["--json", "-c", "/config --pi apply"], code: "command_failed" },
  { args: ["--json", "-c", "/config --extensions disable"], code: "command_failed" },
])("rejects invalid CLI arguments before configuration ($args)", async ({ args, code }) => {
  const child = Bun.spawn([process.execPath, "src/index.ts", ...args], { env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe" });
  const deadline = setTimeout(() => child.kill(), 10000);
  try {
    const [out, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(exit).toBe(1); expect(error).toBe("");
    expect(JSON.parse(out)).toMatchObject({ ok: false, error: { code } });
    expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("INVALID_CONFIGURATION_MUST_NOT_BE_READ");
  } finally { clearTimeout(deadline); child.kill(); await child.exited; }
}, 15000);
