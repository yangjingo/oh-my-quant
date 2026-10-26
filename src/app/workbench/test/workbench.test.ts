import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DEFAULT_SETTINGS } from "../../../types/config.ts";
import { readSettings, saveSettings } from "../../../storage/index.ts";
import { createWorkbenchService } from "../service.ts";
import { startWorkbenchServer, WORKBENCH_ASSETS_ROOT } from "../server.ts";
import type { SessionSnapshot, WorkbenchClient } from "../../../types/workbench.ts";

const KEY = "fixture-workbench-secret-101";
let root: string, previous: string | undefined, proxy: string | undefined;
let model: ReturnType<typeof Bun.serve>, host: ReturnType<typeof startWorkbenchServer> | undefined;
let service: ReturnType<typeof createWorkbenchService> | undefined;
let mode: "answer" | "tool" | "hold" | "empty" | "thinking" | "preparing" | "bad-tool", requests: Record<string, unknown>[], toolSent: boolean;
let reached: (() => void) | undefined;
let releasePreparation: (() => void) | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "whyj-workbench-")); previous = process.env.OHQUANT_DIR; proxy = process.env.NO_PROXY;
  process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
  mode = "answer"; requests = []; toolSent = false; reached = undefined; releasePreparation = undefined;
  model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const payload = await request.json() as Record<string, unknown>; requests.push(payload); reached?.();
    if (mode === "hold") return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(": waiting\n\n")); } }), { headers: { "Content-Type": "text/event-stream" } });
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
  const reader = response.body!.getReader(); const initial = await reader.read(); expect(new TextDecoder().decode(initial.value)).toContain('"type":"snapshot"');
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
