import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import manifest from "../../../package.json";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "whyj-version-cli-"));
  writeFileSync(join(root, "settings.json"), "INVALID_SETTINGS_MUST_NOT_BE_READ");
});
afterEach(() => {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected version fixture directory.");
  rmSync(root, { recursive: true, force: true });
});

async function run(args: string[]) {
  const child = Bun.spawn([process.execPath, "src/index.ts", ...args], {
    env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe", timeout: 5_000,
  });
  return { code: await child.exited, out: await new Response(child.stdout).text(), err: await new Response(child.stderr).text() };
}

test("source CLI version exits before malformed settings or interactive startup, in text and JSON modes", async () => {
  for (const args of [["--version"], ["-V"]]) {
    const result = await run(args);
    expect(result.code).toBe(0); expect(result.err).toBe("");
    expect(result.out).toContain(`WhyJ Quant v${manifest.version}`);
    expect(result.out).toContain(`bundled Pi agent core v${manifest.dependencies["@earendil-works/pi-agent-core"]}`);
    expect(result.out).not.toContain("\x1b");
  }
  const json = await run(["--json", "--version"]);
  expect(json.code).toBe(0); expect(json.err).toBe("");
  expect(JSON.parse(json.out)).toMatchObject({ ok: true, command: "version", data: {
    version: manifest.version, piAgentCore: manifest.dependencies["@earendil-works/pi-agent-core"],
    piAi: manifest.dependencies["@earendil-works/pi-ai"],
  } });
  expect(json.out).not.toContain("\x1b");
  expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("INVALID_SETTINGS_MUST_NOT_BE_READ");
}, 20_000);

test("version rejects mixed or repeated actions without entering the TUI", async () => {
  for (const args of [["--json", "--version", "doctor"], ["--json", "--version", "--help"],
    ["--json", "--version", "--version"]]) {
    const result = await run(args), envelope = JSON.parse(result.out);
    expect(result.code).toBe(1); expect(result.err).toBe("");
    expect(envelope).toMatchObject({ ok: false, command: "version", error: { code: "invalid_arguments" } });
    expect(result.out).not.toContain("\x1b");
  }
}, 20_000);

test("global help discovers version without loading malformed settings", async () => {
  const result = await run(["--help"]);
  expect(result.code).toBe(0); expect(result.err).toBe("");
  expect(result.out).toContain("whyj --version");
  expect(result.out).not.toContain("\x1b");
});

test("help rejects an unknown option, repeated help or a mixed action before loading settings", async () => {
  for (const args of [["--json", "--help", "--bogus"], ["--json", "--help", "--help"],
    ["--json", "--help", "doctor"]]) {
    const result = await run(args), envelope = JSON.parse(result.out);
    expect(result.code).toBe(1); expect(result.err).toBe("");
    expect(envelope).toMatchObject({ ok: false, command: "help", error: { code: "invalid_arguments" } });
    expect(result.out).not.toContain("\x1b");
  }
  expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("INVALID_SETTINGS_MUST_NOT_BE_READ");
}, 20_000);

test("unknown, valueless and duplicate root actions fail before TUI startup", async () => {
  for (const args of [["--json"], ["--json", "--versoin"], ["--json", "-c"],
    ["--json", "-c", "/help", "--bogus"], ["--json", "doctor", "--phase"]]) {
    const result = await run(args), envelope = JSON.parse(result.out);
    expect(result.code).toBe(1); expect(result.err).toBe("");
    expect(envelope.error.code).toBe("invalid_arguments");
    expect(result.out).not.toContain("\x1b");
  }
  const valid = await run(["--json", "-c", "/help"]);
  expect(valid.code).toBe(0); expect(valid.err).toBe("");
  expect(JSON.parse(valid.out)).toMatchObject({ ok: true, command: "help" });
}, 30_000);
