import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { bashTool, setBashExecutorForTest } from "./bash-tool.ts";

const tempDirs: string[] = [];
const executorCalls: Array<{ command: string; options: Record<string, unknown> }> = [];

function okShell(output: string, exitCode = 0) {
  return {
    ok: true as const,
    value: {
      output,
      exitCode,
      cancelled: false,
      truncated: false,
    },
  };
}

function installFakeExecutor(): void {
  executorCalls.length = 0;
  setBashExecutorForTest((async (_env: unknown, command: string, options: Record<string, unknown>) => {
    executorCalls.push({ command, options });
    if (command === "exit 42") return okShell("", 42);
    if (command === "true") return okShell("", 0);
    if (command === "pwd") return okShell(String(options.cwd ?? process.cwd()), 0);
    if (command.includes("whyj-stream-ok")) {
      (options.onChunk as ((chunk: string) => void) | undefined)?.("whyj-stream-ok\n");
      return okShell("whyj-stream-ok\n", 0);
    }
    if (command.includes("whyj-bash-ok")) return okShell("whyj-bash-ok\n", 0);
    return okShell("", 0);
  }) as never);
}

beforeEach(() => installFakeExecutor());

afterEach(() => {
  setBashExecutorForTest();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

describe("bashTool", () => {
  it("normalizes codex-style command arrays", () => {
    const args = bashTool.prepareArguments?.({ command: ["echo", "hello"] });
    expect(args).toEqual({ command: "echo hello" });
  });

  it("runs a simple echo command", async () => {
    const result = await bashTool.execute("test", { command: "echo whyj-bash-ok" });
    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("Exit code: 0");
      expect(result.content[0].text).toMatch(/whyj-bash-ok/);
    }
  }, 15_000);

  it("uses the provided workdir and returns it in details", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ohq-bash-tool-"));
    tempDirs.push(dir);

    const result = await bashTool.execute("test", { command: "pwd", workdir: dir });
    expect((result.details as { workdir?: string }).workdir).toBe(dir);
    expect(executorCalls[0]?.options.cwd).toBe(dir);
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text.toLowerCase()).toContain(basename(dir).toLowerCase());
    }
  }, 15_000);

  it("reports successful commands with no output", async () => {
    const result = await bashTool.execute("test", { command: "true" });
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("Exit code: 0");
      expect(result.content[0].text).toContain("(no output)");
    }
  }, 15_000);

  it("streams output updates while command is running", async () => {
    const onUpdate = mock(() => {});
    const result = await bashTool.execute("test", { command: "echo whyj-stream-ok" }, undefined, onUpdate);
    expect(onUpdate).toHaveBeenCalled();
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("whyj-stream-ok");
    }
  }, 15_000);

  it("throws on non-zero exit", async () => {
    await expect(bashTool.execute("test", { command: "exit 42" })).rejects.toThrow("Exit code: 42");
  }, 15_000);

  it("throws on empty command", async () => {
    await expect(bashTool.execute("test", { command: "   " })).rejects.toThrow("command is required");
  });

  it("rejects temp scripts in the repository workdir", async () => {
    await expect(
      bashTool.execute("test", { command: "python temp_562500.py" }),
    ).rejects.toThrow("Do not create or use temporary scripts in the repository workdir");
    expect(executorCalls.length).toBe(0);
  });

  it("allows temp scripts under the system temp directory", async () => {
    const tempPath = `$env:TEMP\\temp_562500.py`;
    const result = await bashTool.execute("test", { command: `python ${tempPath}` });
    expect(executorCalls[0]?.command).toContain(tempPath);
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("Exit code: 0");
    }
  });
});
