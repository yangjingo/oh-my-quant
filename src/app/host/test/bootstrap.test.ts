import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { attachWorkspaceHost, connectWorkspaceHost, stopWorkspaceHost, type HostConnection } from "../../bootstrap.ts";
import { createHostRuntimeStore, hostProcessState } from "../../../storage/index.ts";
import { DEFAULT_SETTINGS } from "../../../types/config.ts";
import type { SessionSnapshot, WorkspaceIdentity } from "../../../types/workbench.ts";

let root: string, previousHang: string | undefined, previousLeaseRoot: string | undefined;
const connections: HostConnection[] = [];
let model: ReturnType<typeof Bun.serve> | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "whyj-host-bootstrap-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "assets/index.html"), "<html><head></head><body>Built fixture</body></html>");
  previousHang = process.env.WHYJ_HOST_TEST_HANG;
  previousLeaseRoot = process.env.WHYJ_RESOURCE_LEASE_ROOT; process.env.WHYJ_RESOURCE_LEASE_ROOT = join(root, "lease-registry");
});
async function eventually(check: () => boolean, budget = 5000) {
  const end = Date.now() + budget;
  while (!check()) { if (Date.now() > end) throw new Error("Host did not reach expected process state"); await delay(15); }
}
afterEach(async () => {
  if (previousHang === undefined) delete process.env.WHYJ_HOST_TEST_HANG; else process.env.WHYJ_HOST_TEST_HANG = previousHang;
  for (const connection of connections.splice(0)) {
    const store = createHostRuntimeStore(root), entry = store.read();
    if (entry?.instanceId === connection.instanceId) {
      await stopWorkspaceHost(connection).catch(() => {});
      await eventually(() => hostProcessState(entry.pid) === "dead");
    }
  }
  await model?.stop(true); model = undefined;
  if (previousLeaseRoot === undefined) delete process.env.WHYJ_RESOURCE_LEASE_ROOT; else process.env.WHYJ_RESOURCE_LEASE_ROOT = previousLeaseRoot;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep + "whyj-host-bootstrap-")) throw new Error("Unexpected fixture cleanup path");
  rmSync(root, { recursive: true, force: true });
});
const options = () => ({ workspaceRoot: root, entrypoint: join(import.meta.dir, "fixtures/host.ts"), timeoutMs: 10_000 });
async function connect() { const connection = await connectWorkspaceHost(options()); connections.push(connection); return connection; }
async function rpc<T>(connection: HostConnection, method: string, ...args: unknown[]): Promise<T> {
  const response = await fetch(connection.url + "/api/workbench/rpc", { method: "POST",
    headers: { "content-type": "application/json", "x-workbench-token": connection.token }, body: JSON.stringify({ method, args }),
  });
  if (!response.ok) throw new Error("Fixture RPC failed: " + response.status);
  return (await response.json() as { result: T }).result;
}

test("concurrent launchers reuse one authenticated Host and detach leaves it available", async () => {
  const clients = await Promise.all([connect(), connect(), connect(), connect()]);
  expect(clients.filter(item => item.started)).toHaveLength(1);
  expect(new Set(clients.map(item => item.instanceId)).size).toBe(1);
  const first = clients.find(item => item.started)!, store = createHostRuntimeStore(root), entry = store.read()!;
  expect(entry.pid).not.toBe(process.pid); expect(store.readOwner("startup")).toBeUndefined();
  const response = await fetch(first.url + "/api/workbench/events", { headers: { "x-workbench-token": first.token } });
  const reader = response.body!.getReader(); const chunk = await reader.read();
  expect(new TextDecoder().decode(chunk.value)).toContain(first.instanceId);
  await expect(stopWorkspaceHost(first, "if-idle")).rejects.toThrow("did not accept shutdown");
  await reader.cancel(); reader.releaseLock();
  const again = await connect();
  expect(again.started).toBe(false); expect(again.instanceId).toBe(first.instanceId);
  expect(hostProcessState(entry.pid)).toBe("alive");
  const page = await fetch(first.url); expect(await page.text()).toContain("Built fixture");
}, 15_000);

test("independent launcher processes exit while exactly one shared Host survives", async () => {
  const launchers = Array.from({ length: 4 }, () => Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/launcher.ts")], {
    env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe",
  }));
  const results = await Promise.all(launchers.map(async child => ({ code: await child.exited, out: await new Response(child.stdout).text(), err: await new Response(child.stderr).text() })));
  const connection = await connect();
  expect(connection.started).toBe(false);
  expect(results.every(item => item.code === 0 && !item.err)).toBe(true);
  const replies = results.map(item => JSON.parse(item.out) as { instanceId: string; started: boolean });
  expect(replies.filter(item => item.started)).toHaveLength(1);
  expect(replies.every(item => item.instanceId === connection.instanceId)).toBe(true);
  expect(hostProcessState(createHostRuntimeStore(root).read()!.pid)).toBe("alive");
}, 15_000);

test("a package-script launcher closes its output pipes while its detached Host survives", async () => {
  const executable = process.execPath.replace(/\\/g, "/"), entry = join(import.meta.dir, "fixtures/launcher.ts").replace(/\\/g, "/");
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { launch: `"${executable}" "${entry}"` } }));
  const launcher = Bun.spawn([process.execPath, "run", "launch"], { cwd: root, env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe" });
  expect(await launcher.exited).toBe(0);
  const connection = await connect(); // Register cleanup before waiting for EOF.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const [out] = await Promise.race([Promise.all([new Response(launcher.stdout).text(), new Response(launcher.stderr).text()]),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Package script kept output pipes open")), 3000); }),
  ]).finally(() => clearTimeout(timer));
  expect(JSON.parse(out).instanceId).toBe(connection.instanceId);
  expect(connection.started).toBe(false);
  expect(hostProcessState(createHostRuntimeStore(root).read()!.pid)).toBe("alive");
}, 15_000);

test("registered entries prevent idle shutdown and detach never stops a shared Host", async () => {
  const started = await connect(), reused = await connect();
  const desktop = await attachWorkspaceHost(reused, "desktop");
  await desktop.renew();
  await expect(stopWorkspaceHost(started, "if-idle")).rejects.toThrow("did not accept shutdown");
  await expect(stopWorkspaceHost(reused, "if-idle")).rejects.toThrow("does not authorize stopping");
  await desktop.detach();
  expect((await connect()).instanceId).toBe(started.instanceId);
  const entry = createHostRuntimeStore(root).read()!;
  await stopWorkspaceHost(started, "if-idle");
  await eventually(() => hostProcessState(entry.pid) === "dead");
}, 15_000);

test("a detached client leaves a real Quant run alive; explicit shutdown stops the next run without replay", async () => {
  let requests = 0, finish: (() => void) | undefined;
  const encoder = new TextEncoder();
  model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const payload = await request.json() as { model: string }; requests++;
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      const chunk = (content: string, done: boolean) => "data: " + JSON.stringify({ id: "host-fixture", object: "chat.completion.chunk", created: 0, model: payload.model,
        choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: done ? "stop" : null }] }) + "\n\n";
      controller.enqueue(encoder.encode(chunk("Shared run ", false)));
      finish = () => { controller.enqueue(encoder.encode(chunk("completed.", true) + "data: [DONE]\n\n")); controller.close(); };
    } }), { headers: { "content-type": "text/event-stream" } });
  } });
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.provider = "custom"; settings.model = "host-fixture"; settings.thinkingLevel = "off";
  settings.providers = { custom: { baseUrl: model.url.origin + "/v1", api: "openai-completions", apiKey: "isolated-host-test" } };
  writeFileSync(join(root, "settings.json"), JSON.stringify(settings));
  const first = await connect(), viewer = await attachWorkspaceHost(first, "web");
  const identity = await rpc<WorkspaceIdentity>(first, "identity"), initial = await rpc<SessionSnapshot>(first, "session", identity.sessionId);
  const accepted = await rpc<{ runId: string }>(first, "submit", { ...identity, runId: undefined, requestId: randomUUID(), expectedRevision: initial.revision, text: "Explain this synthetic example without tools." });
  await eventually(() => requests === 1);
  await viewer.detach();
  await expect(stopWorkspaceHost(first, "if-idle")).rejects.toThrow("did not accept shutdown");
  const second = await connect();
  const running = await rpc<SessionSnapshot>(second, "session", identity.sessionId);
  expect(running.state).toBe("running"); expect(running.identity.runId).toBe(accepted.runId);
  finish!();
  let settled = running;
  for (let attempt = 0; attempt < 100 && settled.state === "running"; attempt++) { await delay(20); settled = await rpc<SessionSnapshot>(second, "session", identity.sessionId); }
  expect(settled.state).toBe("settled"); expect(settled.turns.at(-1)?.text).toContain("Shared run completed.");
  expect(requests).toBe(1);
  await rpc(second, "submit", { workspaceId: identity.workspaceId, sessionId: identity.sessionId, requestId: randomUUID(), expectedRevision: settled.revision, text: "A second held run." });
  await eventually(() => requests === 2);
  const entry = createHostRuntimeStore(root).read()!; await stopWorkspaceHost(first);
  await eventually(() => hostProcessState(entry.pid) === "dead");
  const reopened = await connect(), restored = await rpc<SessionSnapshot>(reopened, "session", identity.sessionId);
  expect(restored.state).toBe("cancelled"); expect(requests).toBe(2);
}, 20_000);

test("authentication, origin, public capability and instance-scoped shutdown", async () => {
  const connection = await connect();
  expect((await fetch(connection.url + "/api/host/ready")).status).toBe(401);
  expect((await fetch(connection.url + "/api/host/ready", { headers: { "x-workbench-token": "wrong" } })).status).toBe(401);
  expect((await fetch(connection.url + "/api/workbench/bootstrap", { headers: { origin: "https://evil.example" } })).status).toBe(403);
  const bootstrap = await (await fetch(connection.url + "/api/workbench/bootstrap")).json() as Record<string, unknown>;
  expect(bootstrap.instanceId).toBe(connection.instanceId);
  expect(JSON.stringify(bootstrap)).not.toContain(connection.controlToken);
  expect(JSON.stringify(bootstrap)).not.toContain(root.replace(/\\/g, "\\\\"));
  const headers = { "content-type": "application/json", "x-workbench-token": connection.token };
  expect((await fetch(connection.url + "/api/host/shutdown", { method: "POST", headers, body: JSON.stringify({ instanceId: connection.instanceId, mode: "explicit" }) })).status).toBe(403);
  expect((await fetch(connection.url + "/api/host/shutdown", { method: "POST", headers: { ...headers, "x-host-control-token": connection.controlToken }, body: JSON.stringify({ instanceId: "old-instance", mode: "explicit" }) })).status).toBe(400);
  expect((await fetch(connection.url + "/api/host/ready", { headers })).status).toBe(200);
  const entry = createHostRuntimeStore(root).read()!;
  await stopWorkspaceHost(connection);
  await eventually(() => hostProcessState(entry.pid) === "dead");
  expect(createHostRuntimeStore(root).read()).toBeUndefined();
  expect(createHostRuntimeStore(root).readOwner("owner")).toBeUndefined();
}, 15_000);

test("incompatible live registration is diagnosed without starting or killing another process", async () => {
  const connection = await connect(), store = createHostRuntimeStore(root), original = store.read()!;
  const path = join(root, ".host/registry.json");
  try {
    for (const incompatible of [{ protocolVersion: 999 }, { serviceContractVersion: 1 }]) {
      writeFileSync(path, JSON.stringify({ ...original, ...incompatible }));
      await expect(connectWorkspaceHost(options())).rejects.toThrow("different workspace or protocol");
      expect(store.read()?.instanceId).toBe(connection.instanceId);
      expect(hostProcessState(original.pid)).toBe("alive");
      expect(store.readOwner("startup")).toBeUndefined();
    }
  } finally { writeFileSync(path, JSON.stringify(original)); }
}, 15_000);

test("an unreachable live owner is preserved instead of being mistaken for a stale registration", async () => {
  const connection = await connect(), store = createHostRuntimeStore(root), original = store.read()!;
  const path = join(root, ".host/registry.json");
  const stopped = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const unused = stopped.url.origin; await stopped.stop(true);
  writeFileSync(path, JSON.stringify({ ...original, url: unused }));
  try {
    await expect(connectWorkspaceHost(options())).rejects.toThrow("No replacement was started");
    expect(store.read()?.instanceId).toBe(connection.instanceId);
    expect(hostProcessState(original.pid)).toBe("alive");
  } finally { writeFileSync(path, JSON.stringify(original)); }
}, 15_000);

test("a dead registered Host is replaced, preserving workspace identity and rotating capabilities", async () => {
  const first = await connect(), store = createHostRuntimeStore(root), record = store.read()!;
  // Test-only child discovered from this isolated workspace and authenticated above.
  process.kill(record.pid, "SIGKILL"); await eventually(() => hostProcessState(record.pid) === "dead");
  const second = await connect();
  expect(second.started).toBe(true); expect(second.workspaceId).toBe(first.workspaceId);
  expect(second.instanceId).not.toBe(first.instanceId); expect(second.token).not.toBe(first.token);
}, 15_000);

test("readiness timeout terminates only the child started by this launch", async () => {
  process.env.WHYJ_HOST_TEST_HANG = "1";
  await expect(connectWorkspaceHost({ ...options(), timeoutMs: 3000 })).rejects.toThrow("startup budget");
  expect(existsSync(join(root, "hung-pid"))).toBe(true);
  expect(hostProcessState(Number(readFileSync(join(root, "hung-pid"), "utf8")))).toBe("dead");
  expect(createHostRuntimeStore(root).readOwner("startup")).toBeUndefined();
  expect(createHostRuntimeStore(root).read()).toBeUndefined();
}, 7000);

test("corrupt registration fails closed and preserves the original bytes", async () => {
  createHostRuntimeStore(root); const path = join(root, ".host/registry.json"); writeFileSync(path, "unknown-format");
  await expect(connectWorkspaceHost(options())).rejects.toThrow("unreadable");
  expect(readFileSync(path, "utf8")).toBe("unknown-format");
  expect(createHostRuntimeStore(root).readOwner("owner")).toBeUndefined();
});

test("an older resource-coordination contract is refused without replacing its live owner", async () => {
  const connection = await connect(), store = createHostRuntimeStore(root), original = store.read()!;
  const path = join(root, ".host/registry.json"); writeFileSync(path, JSON.stringify({ ...original, serviceContractVersion: 3 }));
  try {
    await expect(connectWorkspaceHost(options())).rejects.toThrow("different workspace or protocol");
    expect(store.read()?.instanceId).toBe(connection.instanceId); expect(hostProcessState(original.pid)).toBe("alive");
  } finally { writeFileSync(path, JSON.stringify(original)); }
}, 15000);

test("missing built assets fail startup and release both launch and execution ownership", async () => {
  unlinkSync(join(root, "assets/index.html"));
  await expect(connectWorkspaceHost(options())).rejects.toThrow("exited before authenticated readiness");
  const store = createHostRuntimeStore(root);
  expect(store.read()).toBeUndefined(); expect(store.readOwner("startup")).toBeUndefined(); expect(store.readOwner("owner")).toBeUndefined();
}, 10_000);

test("an unavailable runtime fails without a registered or owned Host", async () => {
  await expect(connectWorkspaceHost({ ...options(), bunExecutable: join(root, "missing-bun-executable") })).rejects.toBeDefined();
  const store = createHostRuntimeStore(root);
  expect(store.read()).toBeUndefined(); expect(store.readOwner("startup")).toBeUndefined(); expect(store.readOwner("owner")).toBeUndefined();
}, 10_000);
