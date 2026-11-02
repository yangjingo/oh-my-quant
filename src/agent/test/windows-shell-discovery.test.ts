import { expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { NodeExecutionEnv } from "../src/session-runtime/node.ts";

const powershell = process.platform === "win32" ? Bun.which("pwsh.exe") ?? Bun.which("powershell.exe") : null;
const git = process.platform === "win32" ? Bun.which("git.exe") : null;
const gitBash = git ? resolve(dirname(git), "../bin/bash.exe") : "";
const fixture = join(import.meta.dir, "fixtures", "windows-shell-discovery.ts");

async function run(mode: string, shellPath: string | undefined, path: string) {
  const root = mkdtempSync(join(tmpdir(), "whyj-shell-discovery-"));
  try {
    const cmd = process.env.ComSpec;
    if (!cmd) throw new Error("Windows command processor is unavailable");
    // A real executable that cannot locate pwsh: the former implementation
    // invokes it from this process's cwd instead of using the available PATH.
    copyFileSync(cmd, join(root, "where.exe"));
    if (mode !== "bash-missing") {
      const fakeGitBin = join(root, "Git", "bin");
      mkdirSync(fakeGitBin, { recursive: true });
      copyFileSync(cmd, join(fakeGitBin, "bash.exe"));
    }
    const child = Bun.spawn([process.execPath, fixture, mode, root, shellPath ?? ""], {
      cwd: root, env: { ...process.env, PATH: path }, stdout: "pipe", stderr: "pipe",
    });
    const watchdog = setTimeout(() => child.kill(), 20_000);
    try {
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
      return JSON.parse(stdout);
    } finally { clearTimeout(watchdog); child.kill(); await child.exited; }
  } finally {
    const target = resolve(root);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("whyj-shell-discovery-")) throw new Error("Unexpected fixture root");
    rmSync(target, { recursive: true, force: true });
  }
}

test.skipIf(process.platform !== "win32" || !powershell)("Windows discovers PowerShell without trusting a failed where process", async () => {
  // Quoted directory entries and spaces are valid Windows PATH inputs.
  const path = `"${dirname(powershell!)}";${process.env.PATH ?? ""}`;
  expect(await run("default", undefined, path)).toEqual({ ok: true, exitCode: 0, stdout: "WHYJ_SYNTHETIC" });
}, 30_000);

test.skipIf(process.platform !== "win32")("Windows never silently executes default PowerShell syntax in Bash", async () => {
  expect(await run("default", undefined, "")).toEqual({ ok: false, code: "shell_unavailable" });
}, 30_000);

test.skipIf(process.platform !== "win32" || !powershell)("an explicit PowerShell path works without PATH discovery", async () => {
  expect(await run("custom", powershell!, "")).toEqual({ ok: true, exitCode: 0, stdout: "WHYJ_SYNTHETIC" });
}, 30_000);

test.skipIf(process.platform !== "win32" || !existsSync(gitBash))("explicit Bash remains available on Windows", async () => {
  expect(await run("bash", undefined, dirname(gitBash))).toEqual({ ok: true, exitCode: 0, stdout: "WHYJ_SYNTHETIC" });
  expect(await run("git-bash", undefined, dirname(gitBash))).toEqual({ ok: true, exitCode: 0, stdout: "WHYJ_SYNTHETIC" });
}, 30_000);

test.skipIf(process.platform !== "win32")("an unavailable explicitly requested Bash does not silently select PowerShell", async () => {
  expect(await run("bash-missing", undefined, "")).toEqual({ ok: false, code: "shell_unavailable" });
}, 30_000);

test.skipIf(process.platform === "win32")("Unix shell execution remains available", async () => {
  const result = await new NodeExecutionEnv({ cwd: process.cwd() }).exec("printf 'WHYJ_SYNTHETIC'", { timeout: 10 });
  expect(result.ok && { exitCode: result.value.exitCode, stdout: result.value.stdout }).toEqual({ exitCode: 0, stdout: "WHYJ_SYNTHETIC" });
});
