import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function runCli(args: string[]) {
  const ohq = join(tmpdir(), `whyj-doctor-cli-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try {
    return Bun.spawnSync({
      cmd: [process.execPath, "src/index.ts", ...args],
      cwd: process.cwd(),
      env: {
        ...process.env,
        OHQUANT_DIR: ohq,
        WHYJ_QUANT_API_KEY: "test-provider-key",
        WHYJ_QUANT_BASE_URL: "https://api.deepseek.com/anthropic",
        WHYJ_QUANT_LLMQUANT_API_KEY: "test-data-key",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
  } finally {
    rmSync(ohq, { recursive: true, force: true });
  }
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe("CLI doctor command", () => {
  it("emits stable JSON for whyj --json doctor", () => {
    const result = runCli(["--json", "doctor"]);
    expect(result.exitCode).toBe(0);
    expect(decode(result.stderr)).toBe("");

    const body = JSON.parse(decode(result.stdout));
    expect(body).toEqual(expect.objectContaining({
      ok: true,
      command: "doctor",
      data: expect.objectContaining({
        name: "whyj",
        ready: true,
        hints: [],
      }),
    }));
    expect(body.data.auth.WHYJ_QUANT_API_KEY).toEqual(expect.objectContaining({
      available: true,
      source: "env",
      value: expect.stringMatching(/^test\.\.\.-key · fp:[0-9a-f]{8}$/),
    }));
    expect(body.data.auth.WHYJ_QUANT_LLMQUANT_API_KEY).toEqual(expect.objectContaining({
      available: true,
      source: "env",
      value: expect.stringMatching(/^test\.\.\.-key · fp:[0-9a-f]{8}$/),
    }));
  });

  it("runs /doctor through one-shot slash execution", () => {
    const result = runCli(["--json", "-c", "/doctor"]);
    expect(result.exitCode).toBe(0);
    expect(decode(result.stderr)).toBe("");

    const body = JSON.parse(decode(result.stdout));
    expect(body.ok).toBe(true);
    expect(body.command).toBe("doctor");
    expect(body.message).toContain("whyj doctor");
    expect(body.message).toContain("Credentials");
    expect(body.message).toContain("value");
    expect(body.data).toEqual(expect.objectContaining({ ready: true }));
  });
});
