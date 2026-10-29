import { expect, it } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DEFAULT_SETTINGS } from "../../../src/types/config.ts";

it("retains structured endpoint failures in the real one-shot JSON protocol without writing research data", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-tool-probe-cli-")); let mode = "403", calls = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    calls++;
    if (mode === "403") return new Response("fixture-secret", { status: 403 });
    return Response.json({ code: 0, data: { fields: ["ts_code", "name"], items: mode === "ready" ? [["000001.SZ", "平安银行"]] : [] } });
  } });
  const cfg = structuredClone(DEFAULT_SETTINGS); cfg.env = { TUSHARE_BASE_URL: server.url.href, WHYJ_QUANT_TUSHARE_TOKEN: "fixture-secret" };
  writeFileSync(join(root, "settings.json"), JSON.stringify(cfg));
  try {
    const env = { ...process.env, OHQUANT_DIR: root, NO_PROXY: "127.0.0.1,localhost" };
    // /help is now offline. Seed normal settings migration before asserting that endpoint probes add no writes.
    const baseline = Bun.spawn([process.execPath, "run", "src/index.ts", "-c", "/config"], { cwd: process.cwd(), env, stdout: "ignore", stderr: "ignore" });
    expect(await baseline.exited).toBe(0);
    const snapshot = () => Object.fromEntries(readdirSync(root, { recursive: true }).map(String)
      .filter(path => statSync(join(root, path)).isFile()).map(path => [path, readFileSync(join(root, path), "utf8")]));
    const before = snapshot();
    for (const [response, status, exit] of [["403", "permission-denied", 1], ["empty", "empty", 1], ["ready", "ready", 0]] as const) {
      mode = response;
      const child = Bun.spawn([process.execPath, "run", "src/index.ts", "--json", "-c", "/doctor --tool search_symbols --market A --keyword 平安银行"], {
        cwd: process.cwd(), env, stdout: "pipe", stderr: "pipe" });
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(code).toBe(exit); expect(stderr).toBe(""); expect(stdout).not.toContain("fixture-secret");
      const report = JSON.parse(stdout);
      expect(report.ok).toBe(exit === 0); expect(report.data.status).toBe(status); expect(report.data.endpoint).toBe("stock_basic");
      if (exit) expect(report.error.code).toBe("command_failed");
    }
    expect(calls).toBe(3); expect(snapshot()).toEqual(before);
  } finally {
    await server.stop(true);
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected tool-probe fixture path");
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
