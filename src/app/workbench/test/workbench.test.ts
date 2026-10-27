import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DEFAULT_SETTINGS } from "../../../types/config.ts";
import { createWorkbenchSessionStore, readSettings, saveSettings } from "../../../storage/index.ts";
import { createDefaultSessionDependencies } from "../../../runtime/session-dependencies.ts";
import { createWorkbenchService } from "../service.ts";
import { startWorkbenchServer, WORKBENCH_ASSETS_ROOT } from "../server.ts";
import type { SessionSnapshot, WorkbenchClient } from "../../../types/workbench.ts";

const KEY = "fixture-workbench-secret-101";
let root: string, previous: string | undefined, proxy: string | undefined;
let model: ReturnType<typeof Bun.serve>, host: ReturnType<typeof startWorkbenchServer> | undefined;
let service: ReturnType<typeof createWorkbenchService> | undefined;
let mode: "answer" | "tool" | "hold" | "empty" | "thinking" | "preparing" | "bad-tool" | "hold-thinking", requests: Record<string, unknown>[], toolSent: boolean;
let reached: (() => void) | undefined;
let releasePreparation: (() => void) | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "whyj-workbench-")); previous = process.env.OHQUANT_DIR; proxy = process.env.NO_PROXY;
  process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
  mode = "answer"; requests = []; toolSent = false; reached = undefined; releasePreparation = undefined;
  model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const payload = await request.json() as Record<string, unknown>; requests.push(payload); reached?.();
    if (mode === "hold" || mode === "hold-thinking") return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(mode === "hold" ? ": waiting\n\n" : "data: " + JSON.stringify({id:"hold-thinking",object:"chat.completion.chunk",created:0,model:payload.model,choices:[{index:0,delta:{role:"assistant",reasoning_content:"PRIVATE_REASONING_NOT_FOR_UI"},finish_reason:null}]}) + "\n\n")); } }), { headers: { "Content-Type": "text/event-stream" } });
    const call = ["tool", "preparing", "bad-tool"].includes(mode) && !toolSent;
    if (call) toolSent = true;
    const args = JSON.stringify({ shares: mode === "bad-tool" ? KEY : 100, costPerShare: 10, observedClose: 12, observationDate: "2026-10-23", currency: "CNY", changes: [-0.1, 0, 0.1] });
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: "core-tool-101", type: "function", function: { name: "calculate_position_scenarios", arguments: args } }] }
      : mode === "empty" ? { role: "assistant", content: "" } : { role: "assistant", content: `这是同一核心会话的回答，仅作假设计算。${KEY}` };
    const chunk = { id: "fixture", object: "chat.completion.chunk", created: 0, model: String(payload.model) };
    const encode = (delta: unknown, finish_reason: string | null = null) => new TextEncoder().encode("data: " + JSON.stringify({ ...chunk, choices: [{ index: 0, delta, finish_reason }] }) + "\n\n");
    if (mode === "preparing" && call) return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(encode({ role: "assistant", tool_calls: [{ index: 0, id: "core-tool-101", type: "function", function: { name: "calculate_position_scenarios", arguments: "{" } }] }));
      releasePreparation = () => {
        controller.enqueue(encode({ tool_calls: [{ index: 0, function: { arguments: args.slice(1) } }] }));
        controller.enqueue(encode({}, "tool_calls")); controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); controller.close();
      };
    } }), { headers: { "Content-Type": "text/event-stream" } });
    const reasoning = mode === "thinking" ? Array.from({ length: 10 }, () => ({ ...chunk, choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "PRIVATE_REASONING_NOT_FOR_UI" }, finish_reason: null }] })) : [];
    return new Response([...reasoning, { ...chunk, choices: [{ index: 0, delta, finish_reason: null }] }, { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] }]
      .map(value => "data: " + JSON.stringify(value) + "\n\n").join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
  } });
  const settings = structuredClone(DEFAULT_SETTINGS); settings.provider = "custom"; settings.model = "workbench-fixture"; settings.thinkingLevel = "off";
  settings.providers = { custom: { baseUrl: model.url.origin + "/v1", api: "openai-completions", apiKey: KEY } };
  saveSettings(settings);
  mkdirSync(join(root, "assets")); writeFileSync(join(root, "assets", "index.html"), "<html><head></head><body>Workbench fixture</body></html>");
});
afterEach(async () => {
  await host?.close(); await service?.close(); model.stop(true); host = undefined; service = undefined;
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (proxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = proxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected fixture root");
  rmSync(root, { recursive: true, force: true });
});
async function terminal(client: WorkbenchClient, id: string): Promise<SessionSnapshot> {
  for (let attempts = 0; attempts < 250; attempts++) { const value = await client.session(id); if (value.state !== "running") return value; await Bun.sleep(10); }
  throw new Error("Expected a terminal run");
}
async function setup() {
  service = createWorkbenchService({ cwd: root }); const identity = await service.client.identity();
  return { client: service.client, identity, submit: (text: string) => service!.client.submit({ ...identity, text }) };
}
async function preparing(client: WorkbenchClient, id: string) {
  for (let attempt = 0; attempt < 250; attempt++) {
    const snapshot = await client.session(id);
    if (snapshot.turns[1]?.activity?.some(item => item.state === "preparing")) return snapshot;
    await Bun.sleep(10);
  }
  throw new Error("Expected a preparing tool before dispatch");
}
test("the default entry resolves built assets under the repository apps directory", () => {
  expect(WORKBENCH_ASSETS_ROOT).toBe(resolve(import.meta.dir, "../../../..", "apps/web/dist"));
});
test("uses the real core and registered calculator, then preserves context on a follow-up", async () => {
  mode = "tool"; const { client, identity, submit } = await setup();
  const result = await submit("请调用 calculate_position_scenarios 计算给定假设值。");
  const finished = await terminal(client, identity.sessionId);
  expect(finished.state).toBe("settled"); expect(finished.identity.runId).toBe(result.runId);
  expect(finished.turns[1]?.activity).toContainEqual(expect.objectContaining({ name: "calculate_position_scenarios", state: "completed" }));
  expect(JSON.stringify(finished)).not.toContain(KEY); expect(finished.turns[1]?.text).toContain("[REDACTED]");
  expect((requests[0]?.tools as { function: { name: string } }[]).some(item => item.function.name === "bash")).toBe(false);
  const previousCount = requests.length; await submit("继续解释刚才的成本收益率。");
  const followup = await terminal(client, identity.sessionId);
  expect(followup.turns).toHaveLength(4); expect(requests.length).toBeGreaterThan(previousCount);
  const last = JSON.stringify(requests.at(-1)?.messages); expect(last).toContain("calculate_position_scenarios"); expect(last).toContain("继续解释");
  expect(followup.output.artifacts).toHaveLength(0); // A normal reply is not an immutable verified report.
});
test("detaching does not cancel; duplicate submit and stale exact-run cancellation cannot target new work", async () => {
  mode = "hold"; const { client, identity, submit } = await setup();
  const started = new Promise<void>(resolve => { reached = resolve; });
  const first = await submit("保留运行"); await started;
  const release = client.subscribe(() => {}); release();
  expect((await client.session(identity.sessionId)).state).toBe("running");
  await expect(submit("不允许并发")).rejects.toThrow("当前会话仍在运行");
  await client.cancel(first.runId); expect((await client.session(identity.sessionId)).state).toBe("cancelled");
  const second = await submit("下一轮"); await expect(client.cancel(first.runId)).rejects.toThrow("未取消其他研究");
  expect((await client.session(identity.sessionId)).identity.runId).toBe(second.runId);
  await client.cancel(second.runId); expect((await client.session(identity.sessionId)).state).toBe("cancelled");
});

test("an empty provider reply cannot appear as a successfully completed answer", async () => {
  mode = "empty"; const { client, identity, submit } = await setup();
  await submit("不能把空响应当成研究完成");
  const finished = await terminal(client, identity.sessionId);
  expect(finished.state).toBe("failed");
  expect(finished.turns[1]?.text).toContain("模型未返回可显示的回答");
  expect(finished.output.artifacts).toHaveLength(0);
});

test("thinking events project only a phase, avoid per-token snapshots, and freeze the terminal clock", async () => {
  mode = "thinking"; const { client, identity, submit } = await setup();
  const snapshots: SessionSnapshot[] = [];
  const detach = client.subscribe(event => { if (event.type === "snapshot") snapshots.push(event.snapshot); });
  await submit("验证真实 thinking 事件的安全状态投影");
  const finished = await terminal(client, identity.sessionId); detach();
  expect(finished.state).toBe("settled");
  expect(snapshots.filter(value => value.turns[1]?.phase === "thinking")).toHaveLength(1);
  expect(snapshots.some(value => value.turns[1]?.phase === "answering")).toBe(true);
  expect(JSON.stringify(snapshots)).not.toContain("PRIVATE_REASONING_NOT_FOR_UI");
  expect(Number.isFinite(Date.parse(finished.turns[1]!.endedAt!))).toBe(true);
  expect((await client.session(identity.sessionId)).turns[1]?.endedAt).toBe(finished.turns[1]?.endedAt);
});

test("one actual tool call moves from preparation through execution to a readable completed record", async () => {
  mode = "preparing"; const { client, identity, submit } = await setup();
  const states: string[] = [];
  const detach = client.subscribe(event => { if (event.type === "snapshot") states.push(...event.snapshot.turns.flatMap(turn => turn.activity?.map(item => item.state) ?? [])); });
  await submit("准备完成前不要显示执行成功");
  const pending = await preparing(client, identity.sessionId);
  expect(pending.turns[1]?.activity).toHaveLength(1);
  expect(pending.turns[1]?.activity?.[0]).toMatchObject({ id: "core-tool-101", title: "计算持仓情景", state: "preparing" });
  expect(pending.turns[1]?.activity?.[0]?.elapsedMs).toBeUndefined();
  releasePreparation!(); const done = await terminal(client, identity.sessionId); detach();
  expect(states).toContain("running"); expect(done.turns[1]?.activity).toHaveLength(1);
  expect(done.turns[1]?.activity?.[0]).toMatchObject({ id: "core-tool-101", title: "计算持仓情景", context: "100 股 · 3 个情景", state: "completed" });
});

test("cancelled preparation never becomes executed history, and tool failure never becomes completed evidence", async () => {
  mode = "preparing"; const { client, identity, submit } = await setup();
  const run = await submit("停止尚未执行的调用"); await preparing(client, identity.sessionId); await client.cancel(run.runId);
  expect((await client.session(identity.sessionId)).turns[1]?.activity?.[0]?.state).toBe("not-run");
  mode = "bad-tool"; toolSent = false;
  await submit("无效参数仍保留失败记录"); const result = await terminal(client, identity.sessionId);
  expect(result.turns[3]?.activity?.[0]).toMatchObject({ title: "计算持仓情景", state: "failed" });
  expect(JSON.stringify(result)).not.toContain(KEY);
});
test("model settings have storage revisions, reject stale saves and never project credentials", async () => {
  const { client, submit } = await setup();
  const old = await client.preferences(); expect(old.modelProvider).toBe("custom"); expect(JSON.stringify(old)).not.toContain(KEY);
  await client.updatePreferences({ ...old, model: "next-model" });
  expect(readSettings().model).toBe("next-model");
  await expect(client.updatePreferences({ ...old, model: "stale-model" })).rejects.toMatchObject({ code: "ESTORAGECONFLICT" });
  expect(readSettings().model).toBe("next-model");
  mode = "hold"; const started = new Promise<void>(resolve => { reached = resolve; }); const run = await submit("运行中不能修改模型"); await started;
  await expect(client.updatePreferences({ ...await client.preferences(), model: "wrong-boundary" })).rejects.toThrow("请先等待或停止研究");
  await client.cancel(run.runId);
});
test("loopback API rejects tokens, foreign origins, arbitrary operations and credential writes", async () => {
  host = startWorkbenchServer({ port: 0, assetsRoot: join(root, "assets") });
  const url = host.server.url.origin;
  const bootstrap = await (await fetch(url + "/api/workbench/bootstrap")).json() as { token: string };
  const headers = { "Content-Type": "application/json", "x-workbench-token": bootstrap.token };
  const payload = JSON.stringify({ method: "identity", args: [] });
  expect((await fetch(url + "/api/workbench/rpc", { method: "POST", body: payload, headers: { "Content-Type": "application/json" } })).status).toBe(401);
  expect((await fetch(url + "/api/workbench/rpc", { method: "POST", body: payload, headers: { ...headers, Origin: "https://untrusted.invalid" } })).status).toBe(403);
  expect((await fetch(url + "/api/workbench/bootstrap", { headers: { Host: "untrusted.invalid" } })).status).toBe(403);
  expect((await fetch(url + "/api/workbench/rpc", { method: "POST", body: JSON.stringify({ method: "constructor", args: [] }), headers })).status).toBe(404);
  const preferences = await host.service.client.preferences();
  const result = await fetch(url + "/api/workbench/rpc", { method: "POST", headers, body: JSON.stringify({ method: "updatePreferences", args: [{ ...preferences, apiKey: "injected" }] }) });
  expect(result.status).toBe(400); expect(readSettings().providers?.custom?.apiKey).toBe(KEY);
  const html = await (await fetch(url)).text(); expect(html).toContain('name="whyj-workbench-host"'); expect(html).not.toContain(bootstrap.token); expect(html).not.toContain(KEY);
  expect((await fetch(url + "/assets/..%2fsettings.json")).status).toBe(404);
  expect((await fetch(url + "/api/workbench/file?path=settings.json", { headers })).status).toBe(404);
});
test("SSE clients observe one shared run; cancelling the reader only releases its observation", async () => {
  mode = "hold"; host = startWorkbenchServer({ port: 0, assetsRoot: join(root, "assets") });
  const url = host.server.url.origin, client = host.service.client;
  const bootstrap = await (await fetch(url + "/api/workbench/bootstrap")).json() as { token: string };
  const response = await fetch(url + "/api/workbench/events", { headers: { "x-workbench-token": bootstrap.token } });
  expect(response.headers.get("Content-Type")).toContain("text/event-stream");
  const reader = response.body!.getReader(); const initial = await reader.read(); expect(new TextDecoder().decode(initial.value)).toContain('"type":"ready"');
  const identity = await client.identity(), started = new Promise<void>(resolve => { reached = resolve; });
  const run = await client.submit({ ...identity, text: "共享运行" }); await started;
  await reader.cancel(); expect((await client.session(identity.sessionId)).state).toBe("running");
  const viaHttp = await fetch(url + "/api/workbench/rpc", { method: "POST", headers: { "Content-Type": "application/json", "x-workbench-token": bootstrap.token }, body: JSON.stringify({ method: "session", args: [identity.sessionId] }) });
  expect((await viaHttp.json() as { result: SessionSnapshot }).result.identity.runId).toBe(run.runId);
  await client.cancel(run.runId); expect((await client.session(identity.sessionId)).state).toBe("cancelled");
});
test("a second Host cannot own the workspace, and normal close releases the lock", async () => {
  host = startWorkbenchServer({ port: 0, assetsRoot: join(root, "assets") });
  expect(() => startWorkbenchServer({ port: 0, assetsRoot: join(root, "assets") })).toThrow("此工作区已有本地研究服务");
  await host.close(); host = startWorkbenchServer({ port: 0, assetsRoot: join(root, "assets") });
  expect((await host.service.client.identity()).workspaceId).toHaveLength(24);
});


test("restart restores names and tool history without requests, then opens the original core context", async () => {
  mode = "tool"; const { client, identity, submit } = await setup();
  await submit("计算假设情景，保存后继续"); const before = await terminal(client, identity.sessionId);
  await client.renameSession(identity.sessionId, "持仓情景研究"); await service!.close(); service = undefined;
  const count = requests.length;
  service = createWorkbenchService({ cwd: join(root, "different-checkout") });
  expect((await service.client.identity()).sessionId).toBe(identity.sessionId);
  expect((await service.client.workspaces())[0]?.name).toBe("持仓情景研究");
  expect((await service.client.session(identity.sessionId)).turns).toEqual(before.turns);
  expect(requests.length).toBe(count);
  await service.client.submit({ ...identity, text: "继续解释旧计算" });
  const after = await terminal(service.client, identity.sessionId);
  expect(after.turns).toHaveLength(4);
  expect(JSON.stringify(requests.at(-1)?.messages)).toContain("calculate_position_scenarios");
  expect(JSON.stringify(requests.at(-1)?.messages)).toContain("计算假设情景，保存后继续");
});


for (const phase of ["waiting", "thinking", "tool"] as const) test(`actual Host kill/restart preserves ${phase} without replay`, async () => {
  const spawn = async (hold: boolean) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/host-process.ts")], {
      env: { ...process.env, WHYJ_TEST_HOLD_TOOL: hold ? "1" : "" }, stdout: "pipe", stderr: "pipe",
    });
    const reader = child.stdout.getReader(); let text = "";
    const timeout = setTimeout(() => child.kill(), 30000);
    try {
      while (!text.includes("\n")) { const chunk = await reader.read(); if (chunk.done) throw new Error("Host exited: " + await new Response(child.stderr).text()); text += new TextDecoder().decode(chunk.value); }
      const { url } = JSON.parse(text.split("\n").find(line => line.startsWith("{"))!);
      return { child, url: url as string };
    } catch (error) { child.kill("SIGKILL"); await child.exited; throw error; }
    finally { clearTimeout(timeout); reader.releaseLock(); }
  };
  const rpcClient = async (url: string) => {
    const { token } = await (await fetch(url + "/api/workbench/bootstrap", { signal: AbortSignal.timeout(10000) })).json() as { token: string };
    return async <T>(method: string, args: unknown[] = []): Promise<T> => {
      const reply = await (await fetch(url + "/api/workbench/rpc", { method: "POST", headers: { "Content-Type": "application/json", "x-workbench-token": token }, signal: AbortSignal.timeout(10000), body: JSON.stringify({ method, args }) })).json() as { ok: boolean; result: T; error?: unknown };
      if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.result;
    };
  };
  console.log(`Crash fixture ${phase}: starting isolated Host`);
  mode = phase === "waiting" ? "hold" : phase === "thinking" ? "hold-thinking" : "tool"; toolSent = false;
  let processHost = await spawn(phase === "tool");
  try {
    let rpc = await rpcClient(processHost.url);
    const identity = await rpc<SessionSnapshot["identity"]>("identity");
    const target = phase === "tool" ? await rpc<{ sessionId: string }>("createSession") : identity;
    const submitted = await rpc<{ runId: string }>("submit", [{ workspaceId: identity.workspaceId, sessionId: target.sessionId, text: "受控中断测试 " + phase }]);
    for (let i = 0; i < 400; i++) {
      const current = await rpc<SessionSnapshot>("session", [target.sessionId]);
      if (phase === "tool" ? existsSync(join(root, "tool-receipt")) : phase === "thinking" ? current.turns.at(-1)?.phase === "thinking" : requests.length > 0) break;
      await Bun.sleep(10);
    }
    expect(requests.length).toBeGreaterThan(0);
    if (phase === "thinking") expect((await rpc<SessionSnapshot>("session", [target.sessionId])).turns.at(-1)?.phase).toBe("thinking");
    if (phase === "tool") expect(readFileSync(join(root, "tool-receipt"), "utf8")).toBe("started\n");
    processHost.child.kill("SIGKILL"); await processHost.child.exited;
    console.log(`Crash fixture ${phase}: killed; waiting for ownership lease`);
    const originals = readdirSync(root, { recursive: true }).filter((name): name is string => typeof name === "string" && (/settings|sessions/.test(name)) && name.endsWith(".json") || typeof name === "string" && name.endsWith(".jsonl"))
      .map(name => ({ name, bytes: readFileSync(join(root, name)) }));
    const count = requests.length;
    // A killed production Host retains its ownership lease until natural stale expiry.
    await Bun.sleep(31000);
    processHost = await spawn(false); rpc = await rpcClient(processHost.url);
    console.log(`Crash fixture ${phase}: restarted`);
    const recovered = await rpc<SessionSnapshot>("session", [target.sessionId]);
    expect(recovered.state).toBe("interrupted"); expect(recovered.identity.runId).toBe(submitted.runId);
    expect(requests.length).toBe(count);
    for (const file of originals) expect(readFileSync(join(root, file.name))).toEqual(file.bytes);
    if (phase === "tool") {
      expect(recovered.turns[1]?.activity?.[0]?.state).toBe("unconfirmed");
      await expect(rpc("submit", [{ workspaceId: identity.workspaceId, sessionId: target.sessionId, text: "不应发送" }])).rejects.toThrow("RECONCILE_REQUIRED");
      expect(requests.length).toBe(count);
      await rpc("acknowledgeInterruption", [submitted.runId]); expect(requests.length).toBe(count);
      expect((await rpc<SessionSnapshot>("session", [target.sessionId])).turns[1]?.activity?.[0]?.state).toBe("unconfirmed");
    }
    mode = "answer";
    await rpc("submit", [{ workspaceId: identity.workspaceId, sessionId: target.sessionId, text: "用户明确的新问题" }]);
    for (let i = 0; i < 300; i++) { if ((await rpc<SessionSnapshot>("session", [target.sessionId])).state !== "running") break; await Bun.sleep(10); }
    expect(JSON.stringify(requests.at(-1)?.messages)).toContain("受控中断测试 " + phase);
    expect((await rpc<SessionSnapshot>("session", [target.sessionId])).state).toBe("settled");
    if (phase === "tool") expect(readFileSync(join(root, "tool-receipt"), "utf8")).toBe("started\n");
  } finally { processHost.child.kill("SIGKILL"); await processHost.child.exited; }
  console.log(`Crash fixture ${phase}: verified recovery and explicit follow-up`);
}, 120000);


test("a failed acceptance checkpoint sends no request and leaves other new sessions usable", async () => {
  const store = createWorkbenchSessionStore();
  service = createWorkbenchService({ cwd: root, store: { ...store, save: (record, revision) => record.runCount > 0 ? Promise.reject(new Error("disk failure")) : store.save(record, revision) } });
  const identity = await service.client.identity();
  await expect(service.client.submit({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, text: "必须先保存" })).rejects.toThrow("无法安全保存");
  expect(requests).toHaveLength(0);
  expect(store.load(identity.workspaceId, identity.sessionId).record.snapshot.state).toBe("idle");
  const other = await service.client.createSession(); expect((await service.client.session(other.sessionId)).state).toBe("idle");
});

test("an unsaved tool intent never dispatches the tool", async () => {
  mode = "tool"; const store = createWorkbenchSessionStore(); let executions = 0;
  let blocked!: () => void; const intentFailure = new Promise<void>(resolve => { blocked = resolve; });
  service = createWorkbenchService({ cwd: root, store: { ...store, save: (record, revision) => record.snapshot.turns.some(turn => turn.activity?.some(item => item.state === "running")) ? (blocked(), Promise.reject(new Error("disk failure"))) : store.save(record, revision) },
    dependencies: () => { const deps = createDefaultSessionDependencies({ cwd: root }); return { ...deps, tools: deps.tools.map(tool => tool.name !== "calculate_position_scenarios" ? tool : { ...tool, async execute(...args) { executions++; return tool.execute(...args); } }) }; } });
  const failures: string[] = []; const detach = service.client.subscribe(event => { if (event.type === "session-error") failures.push(event.message); });
  const identity = await service.client.identity(); await service.client.submit({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, text: "先保存工具意图" });
  await Promise.race([intentFailure, Bun.sleep(2500).then(() => { throw new Error("tool intent was not reached"); })]);
  await service.close(); detach(); expect(executions).toBe(0); expect(requests.length).toBe(1); expect(failures[0]).toContain("无法安全保存");
});


test("large stored histories stay lazy in lists and startup SSE, then release their Agent after each turn", async () => {
  const store = createWorkbenchSessionStore();
  service = createWorkbenchService({ cwd: root }); const identity = await service.client.identity(); await service.close();
  const template = store.load(identity.workspaceId, identity.sessionId).record;
  for (let i = 0; i < 30; i++) {
    const id = randomUUID(); await store.save({ ...template, sessionId: id, name: "历史 " + i,
      snapshot: { ...template.snapshot, identity: { ...template.snapshot.identity, sessionId: id }, turns: [{ id: "history", role: "assistant", state: "settled", text: "payload".repeat(10000), at: template.updatedAt }] } }, null);
  }
  let loads = 0, agents = 0, cleanups = 0;
  service = createWorkbenchService({ cwd: root, store: { ...store, load: (workspace, id) => { loads++; return store.load(workspace, id); } }, dependencies: () => {
    agents++; const deps = createDefaultSessionDependencies({ cwd: root }), cleanup = deps.env.cleanup.bind(deps.env);
    deps.env.cleanup = async () => { cleanups++; await cleanup(); }; return deps;
  } });
  const start = performance.now(); const rows = await service.client.workspaces(); const listMs = performance.now() - start;
  expect(rows).toHaveLength(31); expect(loads).toBe(0); expect(agents).toBe(0);
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const url = host.server.url.origin, { token } = await (await fetch(url + "/api/workbench/bootstrap")).json() as { token: string };
  const response = await fetch(url + "/api/workbench/events", { headers: { "x-workbench-token": token } });
  const reader = response.body!.getReader(), chunk = await reader.read(); await reader.cancel();
  const frame = new TextDecoder().decode(chunk.value); expect(frame).toContain('"type":"ready"'); expect(frame).not.toContain("payload");
  expect(loads).toBe(0); expect(agents).toBe(0);
  const before = performance.now(); const snapshot = await service.client.session(rows.find(row => row.name === "历史 0")!.sessionId);
  expect(snapshot.turns[0]?.text).toHaveLength(70000); expect(loads).toBe(1); expect(agents).toBe(0);
  console.log(JSON.stringify({ fixture: "30 histories x 70000 characters", listMs, selectedReadMs: performance.now() - before, listBytes: Buffer.byteLength(JSON.stringify(rows)), selectedBytes: Buffer.byteLength(JSON.stringify(snapshot)), startupSseBytes: chunk.value!.byteLength }));
  for (let i = 0; i < 2; i++) { await service.client.submit({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, text: "资源释放检查 " + i }); await terminal(service.client, identity.sessionId); }
  expect(agents).toBe(2); expect(cleanups).toBe(2);
  expect(readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"))).toHaveLength(1);
});


test("missing original context fails explicitly without a provider call or a replacement journal", async () => {
  const { client, identity, submit } = await setup(); await submit("保存原始上下文"); await terminal(client, identity.sessionId);
  await service!.close(); service = undefined;
  const files = readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"));
  expect(files).toHaveLength(1); rmSync(join(root, "sessions", String(files[0])));
  const count = requests.length; service = createWorkbenchService({ cwd: root });
  await service.client.submit({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, text: "无法恢复时不能假装记得" });
  const stopped = await terminal(service.client, identity.sessionId);
  expect(stopped.state).toBe("failed"); expect(stopped.turns.at(-1)?.text).toContain("原研究上下文无法读取");
  expect(requests.length).toBe(count);
  expect(readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"))).toHaveLength(0);
});
