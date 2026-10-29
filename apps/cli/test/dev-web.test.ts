import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { connectWorkspaceHost, stopWorkspaceHost } from "../../../src/app/bootstrap.ts";
import { createHostRuntimeStore, hostProcessState } from "../../../src/storage/index.ts";
import { ensureDevelopmentAssets, runWebDevelopment } from "../dev/web.ts";

test("fresh development builds Host assets once and fails clearly when dependencies or build output are missing", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-dev-assets-")), vite = join(root, "vite.js");
  try {
    await expect(ensureDevelopmentAssets(root, vite)).rejects.toThrow("Web dependencies are missing");
    writeFileSync(vite, 'import { mkdirSync, writeFileSync } from "node:fs"; if (process.argv[2] !== "build") process.exit(3); mkdirSync("dist", { recursive: true }); writeFileSync("dist/index.html", "built once");');
    expect(await ensureDevelopmentAssets(root, vite)).toBe(0);
    expect(readFileSync(join(root, "dist/index.html"), "utf8")).toBe("built once");
    writeFileSync(vite, "process.exit(7)");
    expect(await ensureDevelopmentAssets(root, vite)).toBe(0);
    expect(readFileSync(join(root, "dist/index.html"), "utf8")).toBe("built once");
    const other = join(root, "missing-output"); mkdirSync(other);
    expect(await ensureDevelopmentAssets(other, vite)).toBe(7);
    writeFileSync(vite, "process.exit(0)");
    await expect(ensureDevelopmentAssets(other, vite)).rejects.toThrow("did not produce dist/index.html");
    expect(existsSync(join(other, "dist/index.html"))).toBe(false);
  } finally {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep + "whyj-dev-assets-")) throw new Error("Unexpected fixture path");
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);

test("connected Web development proxies only same-origin browser operations and releases Vite without stopping the Host", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-dev-web-"));
  const priorRoot = process.env.OHQUANT_DIR, priorPort = process.env.WHYJ_DEV_WEB_PORT, priorNoProxy = process.env.NO_PROXY;
  mkdirSync(join(root, "assets")); writeFileSync(join(root, "assets/index.html"), "<html><head></head><body>Host fixture</body></html>");
  const reserve = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("reserved") });
  const port = reserve.port; await reserve.stop(true);
  process.env.OHQUANT_DIR = root; process.env.WHYJ_DEV_WEB_PORT = String(port); process.env.NO_PROXY = "127.0.0.1,localhost";
  const connection = await connectWorkspaceHost({ workspaceRoot: root, entrypoint: join(import.meta.dir, "../../../src/app/host/test/fixtures/host.ts"), timeoutMs: 10000 });
  const entry = createHostRuntimeStore(root).read()!, controller = new AbortController();
  const run = runWebDevelopment(controller.signal), base = `http://127.0.0.1:${port}`;
  try {
    let page: Response | undefined;
    for (let i = 0; i < 200; i++) {
      try { page = await fetch(base, { signal: AbortSignal.timeout(500) }); break; } catch { await delay(50); }
    }
    expect(page?.status).toBe(200);
    const html = await page!.text(); expect(html).toContain('name="whyj-workbench-host"'); expect(html).toContain("/@vite/client");
    const bootstrap = await fetch(base + "/api/workbench/bootstrap", { headers: { origin: base, "sec-fetch-site": "same-origin" } });
    expect(bootstrap.status).toBe(200);
    const value = await bootstrap.json() as { token: string; instanceId: string }; expect(value.instanceId).toBe(connection.instanceId);
    const rpc = await fetch(base + "/api/workbench/rpc", { method: "POST", headers: { origin: base, "content-type": "application/json", "x-workbench-token": value.token },
      body: JSON.stringify({ method: "identity", args: [] }) });
    expect(rpc.status).toBe(200); expect((await rpc.json() as { result: { workspaceId: string } }).result.workspaceId).toBe(connection.workspaceId);
    const events = await fetch(base + "/api/workbench/events", { headers: { origin: base, "x-workbench-token": value.token } });
    expect(events.status).toBe(200); const reader = events.body!.getReader(); expect(new TextDecoder().decode((await reader.read()).value)).toContain('"type":"ready"');
    await reader.cancel(); reader.releaseLock();
    for (const [path, init] of [
      ["/api/workbench/bootstrap", { headers: { origin: "https://foreign.invalid" } }],
      ["/api/workbench/bootstrap", { headers: { origin: "null" } }],
      ["/api/workbench/bootstrap", { headers: { "sec-fetch-site": "cross-site" } }],
      ["/api/workbench/bootstrap", { headers: { host: "foreign.invalid" } }],
      ["/api/workbench/bootstrap?unexpected=1", {}],
      ["/api/workbench/rpc", { method: "DELETE" }],
      ["/api/host/terminal", { method: "POST", headers: { "x-workbench-token": value.token, "x-host-control-token": connection.controlToken } }],
      ["/api/host/shutdown", { method: "POST" }],
    ] as const) expect((await fetch(base + path, init)).status).toBe(403);
    expect((await fetch(connection.url + "/api/workbench/bootstrap", { headers: { origin: base } })).status).toBe(403);
    expect(hostProcessState(entry.pid)).toBe("alive");
  } finally {
    try {
      controller.abort(); expect(await run).toBe(0);
      expect(hostProcessState(entry.pid)).toBe("alive");
      await expect(fetch(base, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
      const occupied = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("occupied") });
      try { expect(await runWebDevelopment()).not.toBe(0); expect(hostProcessState(entry.pid)).toBe("alive"); }
      finally { await occupied.stop(true); }
    } finally {
      await stopWorkspaceHost(connection);
      for (let i = 0; i < 200 && hostProcessState(entry.pid) !== "dead"; i++) await delay(25);
      const state = hostProcessState(entry.pid);
      if (priorRoot === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = priorRoot;
      if (priorPort === undefined) delete process.env.WHYJ_DEV_WEB_PORT; else process.env.WHYJ_DEV_WEB_PORT = priorPort;
      if (priorNoProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = priorNoProxy;
      if (!resolve(root).startsWith(resolve(tmpdir()) + sep + "whyj-dev-web-")) throw new Error("Unexpected fixture path");
      if (state === "dead") rmSync(root, { recursive: true, force: true });
      expect(state).toBe("dead");
    }
  }
}, 30000);
