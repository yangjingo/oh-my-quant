import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DEFAULT_SETTINGS } from "../../../types/config.ts";
import { createWorkbenchSessionStore, loadArtifactSnapshot, readSettings, saveSettings } from "../../../storage/index.ts";
import { createDefaultSessionDependencies } from "../../../runtime/session-dependencies.ts";
import { createResearchService as createWorkbenchService } from "../research.ts";
import { startWorkbenchServer, WORKBENCH_ASSETS_ROOT } from "../../workbench/server.ts";
import type { ArtifactSummary, SavedResearch, SessionSnapshot, WorkbenchClient } from "../../../types/workbench.ts";

const KEY = "fixture-workbench-secret-101";
let root: string, previous: string | undefined, proxy: string | undefined;
let model: ReturnType<typeof Bun.serve>, host: ReturnType<typeof startWorkbenchServer> | undefined;
let service: ReturnType<typeof createWorkbenchService> | undefined;
let mode: "answer" | "tool" | "hold" | "empty" | "thinking" | "preparing" | "bad-tool" | "hold-thinking" | "pure-failure", requests: Record<string, unknown>[], toolSent: boolean;
let reached: (() => void) | undefined;
let releasePreparation: (() => void) | undefined;
let historySeed: Promise<void> | undefined;
let reply: string | undefined;
let scriptedCalls: Array<(payload: Record<string, unknown>) => Array<{ name: string; args: unknown }>>;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "whyj-workbench-")); previous = process.env.OHQUANT_DIR; proxy = process.env.NO_PROXY;
  process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
  mode = "answer"; requests = []; toolSent = false; reached = undefined; releasePreparation = undefined; scriptedCalls = []; reply = undefined;
  model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const payload = await request.json() as Record<string, unknown>; requests.push(payload); reached?.();
    if (mode === "pure-failure" && toolSent) return Response.json({ error: { message: "Controlled model refusal after a pure calculation error", type: "invalid_request_error" } }, { status: 400 });
    if (mode === "hold" || mode === "hold-thinking") return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(mode === "hold" ? ": waiting\n\n" : "data: " + JSON.stringify({id:"hold-thinking",object:"chat.completion.chunk",created:0,model:payload.model,choices:[{index:0,delta:{role:"assistant",reasoning_content:"PRIVATE_REASONING_NOT_FOR_UI"},finish_reason:null}]}) + "\n\n")); } }), { headers: { "Content-Type": "text/event-stream" } });
    const scripted = scriptedCalls.shift()?.(payload);
    const call = !!scripted || ["tool", "preparing", "bad-tool", "pure-failure"].includes(mode) && !toolSent;
    if (call) toolSent = true;
    const args = JSON.stringify({ shares: mode === "bad-tool" || mode === "pure-failure" ? KEY : 100, costPerShare: 10, observedClose: 12, observationDate: "2026-10-23", currency: "CNY", changes: [-0.1, 0, 0.1] });
    const delta = scripted ? { role: "assistant", tool_calls: scripted.map((item, index) => ({ index, id: `service-step-${requests.length}-${index}`, type: "function", function: { name: item.name, arguments: JSON.stringify(item.args) } })) }
      : call ? { role: "assistant", tool_calls: [{ index: 0, id: "core-tool-101", type: "function", function: { name: "calculate_position_scenarios", arguments: args } }] }
      : mode === "empty" ? { role: "assistant", content: "" } : { role: "assistant", content: reply ?? `这是同一核心会话的回答，仅作假设计算。${KEY}` };
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
  await historySeed?.catch(() => {}); historySeed = undefined;
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
async function requestFor(client: WorkbenchClient, identity: { workspaceId: string; sessionId: string }, text: string) {
  return { workspaceId: identity.workspaceId, sessionId: identity.sessionId, text,
    requestId: randomUUID(), expectedRevision: (await client.session(identity.sessionId)).revision! };
}
async function setup() {
  service = createWorkbenchService({ cwd: root }); const identity = await service.client.identity();
  return { client: service.client, identity, submit: async (text: string) => service!.client.submit(await requestFor(service!.client, identity, text)) };
}
async function preparing(client: WorkbenchClient, id: string) {
  for (let attempt = 0; attempt < 250; attempt++) {
    const snapshot = await client.session(id);
    if (snapshot.turns[1]?.activity?.some(item => item.state === "preparing")) return snapshot;
    await Bun.sleep(10);
  }
  throw new Error("Expected a preparing tool before dispatch");
}
test("public automatic and explicit titles redact configured credentials before truncation", async () => {
  const long = KEY + "-long-credential-suffix-123456";
  const settings = readSettings(); settings.providers!.custom!.apiKey = long; saveSettings(settings);
  const { client, identity, submit } = await setup(); await submit(long + " title"); await terminal(client, identity.sessionId);
  expect(JSON.stringify(await client.workspaces())).not.toContain(long.slice(0, 32));
  expect((await client.workspaces())[0]!.name).toContain("[REDACTED]");
  await client.renameSession({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, title: long + " renamed", expectedRevision: (await client.session(identity.sessionId)).revision! });
  expect(JSON.stringify(await client.workspaces())).not.toContain(long);
  expect(JSON.stringify(createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record)).not.toContain(long);
});
test("supported data-source credentials are redacted in actual-core public answers", async () => {
  const settings = readSettings(); const tokens = ["dummy-tushare-review-value", "dummy-financial-review-value"];
  settings.env = { ...settings.env, WHYJ_QUANT_TUSHARE_TOKEN: tokens[0]!, WHYJ_QUANT_FINANCIAL_DATASETS_KEY: tokens[1]! }; saveSettings(settings);
  reply = "Visible " + tokens.join(" / "); const { client, identity, submit } = await setup();
  await submit("Report synthetic fixture text"); const snapshot = await terminal(client, identity.sessionId);
  for (const token of tokens) expect(JSON.stringify(snapshot)).not.toContain(token);
  expect(snapshot.turns[1]?.text).toContain("Visible");
});
test("unavailable explicit references are rejected before a provider call but literal text is allowed", async () => {
  const { client, identity, submit } = await setup();
  await expect(submit("Summarize @file:evidence.md")).rejects.toThrow("引用"); expect(requests).toHaveLength(0);
  expect((await client.session(identity.sessionId)).turns).toHaveLength(0);
  await submit("Email user@example.com; literal `@file:example.md` and \\@file:escaped.md");
  await terminal(client, identity.sessionId); expect(requests.length).toBeGreaterThan(0);
});
test("the default entry resolves built assets under the repository apps directory", () => {
  expect(WORKBENCH_ASSETS_ROOT).toBe(resolve(import.meta.dir, "../../../..", "apps/web/dist"));
});

test("explicit clarification survives restart without replay and an HTTP answer creates a new run", async () => {
  scriptedCalls = [() => [{ name: "ask_user", args: { question: `请补充研究范围？${KEY}` } }]];
  const { client, identity, submit } = await setup();
  const asked = await submit("请先澄清范围");
  const waiting = await terminal(client, identity.sessionId);
  expect(waiting.state).toBe("needs_input");
  expect(waiting.turns[1]).toMatchObject({ state: "needs_input", text: "请补充研究范围？[REDACTED]" });
  expect(waiting.turns[1]?.endedAt).toBeTruthy();
  expect(waiting.turns[1]?.activity?.[0]).toMatchObject({ name: "ask_user", state: "completed", title: "澄清研究问题" });
  expect(requests).toHaveLength(1);
  const next = { workspaceId: identity.workspaceId, sessionId: identity.sessionId, requestId: randomUUID(), expectedRevision: waiting.revision!, previousRunId: asked.runId };
  await expect(client.continue!(next)).rejects.toMatchObject({ code: "CONTINUE_UNAVAILABLE" });
  await expect(client.save!({ workspaceId: identity.workspaceId, ...asked, expectedRevision: waiting.revision!, expectedArtifactRevision: null })).rejects.toMatchObject({ code: "SAVE_UNAVAILABLE" });
  await service!.close(); service = createWorkbenchService({ cwd: root });
  expect(await service.client.session(identity.sessionId)).toEqual(waiting); expect(requests).toHaveLength(1);
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const { token } = await (await fetch(host.server.url + "api/workbench/bootstrap")).json() as { token: string };
  const remote = (method: string, input: unknown) => fetch(host!.server.url + "api/workbench/rpc", { method: "POST",
    headers: { "Content-Type": "application/json", "x-workbench-token": token }, body: JSON.stringify({ method, args: [input] }) });
  expect((await (await remote("session", identity.sessionId)).json() as { result: SessionSnapshot }).result).toEqual(waiting);
  expect((await remote("followup", { ...next, expectedRevision: 0, text: "过期回答" })).status).toBe(409);
  const input = { ...next, text: "只讨论固定样本，不获取新数据。" };
  const response = await remote("followup", input); expect(response.status).toBe(200);
  const result = (await response.json() as { result: { sessionId: string; runId: string } }).result;
  expect(await service.client.followup!(input)).toEqual(result);
  expect(result.sessionId).toBe(identity.sessionId); expect(result.runId).not.toBe(asked.runId);
  const answered = await terminal(service.client, identity.sessionId);
  expect(answered.state).toBe("settled"); expect(answered.turns[1]).toEqual(waiting.turns[1]);
  expect(answered.turns[2]).toMatchObject({ operation: "followup", previousRunId: asked.runId, text: input.text });
  expect(JSON.stringify(requests.at(-1)?.messages)).toContain("请补充研究范围");
  expect(JSON.stringify(requests.at(-1)?.messages)).toContain(input.text);
  expect(requests).toHaveLength(2);
});

test("clarification stops later tools in the same batch without bypassing the existing host policy", async () => {
  let calculations = 0; const policyCalls: string[] = [];
  service = createWorkbenchService({ cwd: root, dependencies: () => {
    const dependencies = createDefaultSessionDependencies({ cwd: root });
    return { ...dependencies, beforeToolCall: call => { policyCalls.push(call.toolName); return undefined; }, tools: dependencies.tools.map(tool => tool.name !== "calculate_position_scenarios" ? tool : {
      ...tool, async execute(...args: Parameters<typeof tool.execute>) { calculations++; return tool.execute(...args); },
    }) };
  } });
  scriptedCalls = [() => [{ name: "ask_user", args: { question: "先确认范围。" } }, { name: "calculate_position_scenarios",
    args: { shares: 100, costPerShare: 10, observedClose: 12, observationDate: "2026-10-23", currency: "CNY", changes: [0.1] } }]];
  const client = service.client, identity = await client.identity();
  await client.submit(await requestFor(client, identity, "先询问再计算"));
  const waiting = await terminal(client, identity.sessionId);
  expect(waiting.state).toBe("needs_input"); expect(waiting.turns[1]?.text).toBe("先确认范围。");
  expect(policyCalls).toEqual(["ask_user"]); expect(calculations).toBe(0); expect(requests).toHaveLength(1);
  expect(waiting.turns[1]?.activity?.find(item => item.name === "calculate_position_scenarios")?.state).not.toBe("completed");
});

test("blank clarification fails validation without inventing a waiting user question", async () => {
  scriptedCalls = [() => [{ name: "ask_user", args: { question: "   " } }]];
  const { client, identity, submit } = await setup(); await submit("需要一个真实问题");
  const finished = await terminal(client, identity.sessionId);
  expect(finished.state).toBe("settled");
  expect(finished.turns[1]?.activity?.[0]).toMatchObject({ name: "ask_user", state: "failed" });
  expect(finished.turns[1]?.text).toContain("同一核心会话的回答");
});

test("cancelling a delayed clarification prevents a late needs_input state", async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  service = createWorkbenchService({ cwd: root, dependencies: () => ({ ...createDefaultSessionDependencies({ cwd: root }),
    async beforeToolCall() { entered(); await gate; return undefined; },
  }) });
  scriptedCalls = [() => [{ name: "ask_user", args: { question: "迟到的问题不应出现" } }]];
  const client = service.client, identity = await client.identity();
  const run = await client.submit(await requestFor(client, identity, "停止等待中的澄清"));
  const states: string[] = []; let sawCancel!: () => void;
  const cancelled = new Promise<void>(resolve => { sawCancel = resolve; });
  const detach = client.subscribe(event => { if (event.type === "snapshot") { states.push(event.snapshot.state); if (event.snapshot.state === "cancelled") sawCancel(); } });
  try {
    await started;
    const cancelling = client.cancel({ workspaceId: identity.workspaceId, ...run });
    await cancelled; release(); await cancelling;
    const stopped = await client.session(identity.sessionId);
    expect(stopped.state).toBe("cancelled"); expect(states).not.toContain("needs_input");
    expect(stopped.turns[1]?.text).not.toContain("迟到的问题");
  } finally { release(); detach(); }
});

for (const allowed of [false, true]) test(`clarification respects declared task capabilities (allowed=${allowed})`, async () => {
  scriptedCalls = [() => [{ name: "research_task", args: { action: "read" } }], payload => {
    const messages = payload.messages as Array<{ role: string; content: string }>;
    const result = messages.findLast(message => message.role === "tool" && typeof message.content === "string" && message.content.includes("\nTask details: "))!;
    const state = JSON.parse(result.content.split("\nTask details: ")[1]!) as { expectedRevision: string; latestRequest: { entryId: string } };
    return [{ name: "research_task", args: { action: "declare", expectedRevision: state.expectedRevision, requestEntryId: state.latestRequest.entryId,
      task: { goal: "核对固定范围后再回测", scope: { symbols: ["AAPL"], market: "US", start: "2026-01-01", end: "2026-02-09" },
        constraints: { allowedTools: ["run_backtest", ...(allowed ? ["ask_user"] : [])], notes: ["仅固定样本"] }, dataRefs: [], reportRequired: false,
        criteria: [{ id: "return", description: "原参数收益", tool: "run_backtest", parameters: { symbol: "AAPL", fast: 1, slow: 2, cash: 1000, commission: 0, start: "2026-01-01", end: "2026-02-09" }, metrics: ["Total return"] }] },
    } }];
  }, () => [{ name: "ask_user", args: { question: "请确认研究范围。" } }]];
  const { client, identity, submit } = await setup(); await submit("研究 AAPL，范围固定在 2026-01-01 到 2026-02-09。");
  const state = await terminal(client, identity.sessionId);
  const activeTools = (requests[2]?.tools as Array<{ function: { name: string } }>).map(tool => tool.function.name);
  expect(activeTools.includes("ask_user")).toBe(allowed);
  expect(state.state).toBe(allowed ? "needs_input" : "settled");
  expect(state.turns[1]?.activity?.find(item => item.name === "ask_user")?.state).toBe(allowed ? "completed" : "failed");
  if (allowed) expect(requests).toHaveLength(3);
});

test("workspace identity resolves filesystem aliases independently of the entry cwd", async () => {
  const data = join(root, "private-root"), alias = join(root, "alias");
  mkdirSync(data); symlinkSync(data, alias, process.platform === "win32" ? "junction" : "dir");
  process.env.OHQUANT_DIR = data;
  service = createWorkbenchService({ cwd: root });
  const original = await service.client.identity(); await service.close();
  process.env.OHQUANT_DIR = join(alias, ".");
  service = createWorkbenchService({ cwd: join(root, "other-entry") });
  expect(await service.client.identity()).toEqual(original); await service.close();
  if (process.platform === "win32") {
    process.env.OHQUANT_DIR = data.toUpperCase();
    service = createWorkbenchService({ cwd: root });
    expect(await service.client.identity()).toEqual(original); await service.close();
  }
  process.env.OHQUANT_DIR = join(root, "different-root");
  service = createWorkbenchService({ cwd: root });
  expect((await service.client.identity()).workspaceId).not.toBe(original.workspaceId);
});

test("explicit follow-up binds the prior run and revision, deduplicates across HTTP and retains lineage", async () => {
  const { client, identity, submit } = await setup();
  const first = await submit("第一轮固定问题");
  const before = await terminal(client, identity.sessionId);
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const { token } = await (await fetch(host.server.url + "api/workbench/bootstrap")).json() as { token: string };
  const remote = (input: unknown, method = "followup") => fetch(host!.server.url + "api/workbench/rpc", { method: "POST",
    headers: { "Content-Type": "application/json", "x-workbench-token": token }, body: JSON.stringify({ method, args: [input] }) });
  const input = { ...await requestFor(client, identity, "沿用第一轮解释边界"), previousRunId: first.runId };
  await expect(client.followup!({ ...input, expectedRevision: 0 })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  expect((await remote({ ...input, expectedRevision: 0 })).status).toBe(409);
  const response = await remote(input);
  expect(response.status).toBe(200);
  const { result } = await response.json() as { result: { sessionId: string; runId: string } };
  expect(await client.followup!(input)).toEqual(result);
  expect(result.runId).not.toBe(first.runId); expect(result.sessionId).toBe(identity.sessionId);
  const after = await terminal(client, identity.sessionId);
  expect(after.turns.slice(0, 2)).toEqual([...before.turns]);
  expect(after.turns[2]).toMatchObject({ operation: "followup", previousRunId: first.runId });
  expect(JSON.stringify(requests.at(-1)?.messages)).toContain("第一轮固定问题");
  const count = requests.length;
  const staleRun = { ...input, requestId: randomUUID(), expectedRevision: after.revision! };
  await expect(client.followup!(staleRun)).rejects.toMatchObject({ code: "RUN_CONFLICT" });
  expect((await (await remote(staleRun)).json() as { error: { code: string } }).error.code).toBe("RUN_CONFLICT");
  const { previousRunId: _, ...plain } = input;
  await expect(client.submit(plain)).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
  await service!.close(); service = createWorkbenchService({ cwd: root });
  expect((await service.client.session(identity.sessionId)).turns).toEqual(after.turns);
  expect(requests).toHaveLength(count);
});

test("continue creates a new run after cancellation without reviving its predecessor", async () => {
  mode = "hold";
  const { client, identity, submit } = await setup();
  const started = new Promise<void>(resolve => { reached = resolve; });
  const first = await submit("未完成的研究"); await started;
  await client.cancel({ workspaceId: identity.workspaceId, ...first });
  const before = await client.session(identity.sessionId);
  const input = { workspaceId: identity.workspaceId, sessionId: identity.sessionId, previousRunId: first.runId,
    requestId: randomUUID(), expectedRevision: before.revision! };
  await expect(client.followup!({ ...input, text: "尚未完成的追问" })).rejects.toMatchObject({ code: "FOLLOWUP_UNAVAILABLE" });
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const { token } = await (await fetch(host.server.url + "api/workbench/bootstrap")).json() as { token: string };
  const remote = (value: unknown) => fetch(host!.server.url + "api/workbench/rpc", { method: "POST",
    headers: { "Content-Type": "application/json", "x-workbench-token": token }, body: JSON.stringify({ method: "continue", args: [value] }) });
  for (const bad of [{ ...input, text: "hidden question" }, { ...input, previousRunId: "" }, { ...input, path: root }]) {
    await expect(client.continue!(bad)).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect((await remote(bad)).status).toBe(400);
  }
  mode = "answer";
  const next = await client.continue!(input);
  expect(next.runId).not.toBe(first.runId); expect(next.sessionId).toBe(first.sessionId);
  expect((await (await remote(input)).json() as { result: unknown }).result).toEqual(next);
  const after = await terminal(client, identity.sessionId);
  expect(after.state).toBe("settled"); expect(after.turns.slice(0, 2)).toEqual([...before.turns]);
  expect(after.turns[1]?.state).toBe("cancelled");
  expect(after.turns[2]).toMatchObject({ operation: "continue", previousRunId: first.runId });
  const finished = { ...input, requestId: randomUUID(), previousRunId: next.runId, expectedRevision: after.revision! };
  await expect(client.continue!(finished)).rejects.toMatchObject({ code: "CONTINUE_UNAVAILABLE" });
});

test("acknowledging an uncertain tool never grants permission to replay it via continue", async () => {
  mode = "tool";
  const { client, identity, submit } = await setup();
  const first = await submit("工具结果待核对的研究"); await terminal(client, identity.sessionId); await service!.close();
  const store = createWorkbenchSessionStore(), loaded = store.load(identity.workspaceId, identity.sessionId);
  const snapshot: SessionSnapshot = { ...loaded.record.snapshot, state: "running", turns: loaded.record.snapshot.turns.map(turn => turn.role === "user" ? turn :
    { ...turn, state: "running", activity: turn.activity?.map(item => ({ ...item, state: "running" })) }) };
  await store.save({ ...loaded.record, snapshot }, loaded.revision);
  service = createWorkbenchService({ cwd: root });
  const restored = service.client;
  const recovered = await restored.session(identity.sessionId), count = requests.length;
  const input = { workspaceId: identity.workspaceId, sessionId: identity.sessionId, previousRunId: first.runId,
    requestId: randomUUID(), expectedRevision: recovered.revision! };
  await expect(restored.continue!(input)).rejects.toMatchObject({ code: "RECONCILE_REQUIRED" });
  await restored.acknowledgeInterruption!({ ...recovered.identity, runId: first.runId, expectedRevision: recovered.revision! });
  input.expectedRevision = (await restored.session(identity.sessionId)).revision!;
  await expect(restored.continue!(input)).rejects.toMatchObject({ code: "CONTINUE_UNSAFE" });
  expect(requests).toHaveLength(count);
  expect((await restored.session(identity.sessionId)).turns[1]?.activity?.[0]?.state).toBe("unconfirmed");
});

test("a known pure tool failure can be explicitly continued without treating unknown effects as safe", async () => {
  mode = "pure-failure";
  const { client, identity, submit } = await setup();
  const first = await submit("纯计算失败后等待用户继续");
  const stopped = await terminal(client, identity.sessionId);
  expect(stopped.state).toBe("failed");
  expect(stopped.turns[1]?.activity?.[0]).toMatchObject({ name: "calculate_position_scenarios", state: "failed" });
  mode = "answer";
  const next = await client.continue!({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, previousRunId: first.runId,
    requestId: randomUUID(), expectedRevision: stopped.revision! });
  expect(next.runId).not.toBe(first.runId);
  const finished = await terminal(client, identity.sessionId);
  expect(finished.state).toBe("settled"); expect(finished.turns[1]?.state).toBe("failed");
});

test("save and reload retain fixed versions across later runs, stale clients and damaged report files", async () => {
  const { client, identity, submit } = await setup();
  const firstRun = await submit("第一份可保存成果");
  const firstState = await terminal(client, identity.sessionId);
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const { token } = await (await fetch(host.server.url + "api/workbench/bootstrap")).json() as { token: string };
  const remote = (method: string, value: unknown) => fetch(host!.server.url + "api/workbench/rpc", { method: "POST",
    headers: { "Content-Type": "application/json", "x-workbench-token": token }, body: JSON.stringify({ method, args: [value] }) });
  const input = { workspaceId: identity.workspaceId, ...firstRun, expectedRevision: firstState.revision!, expectedArtifactRevision: null };
  const saved = await remote("save", input); expect(saved.status).toBe(200);
  const first = (await saved.json() as { result: ArtifactSummary }).result;
  expect(first).toMatchObject({ version: 1, runId: firstRun.runId });
  await expect(client.save!(input)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  expect((await remote("save", input)).status).toBe(409);
  const reference = { workspaceId: identity.workspaceId, sessionId: identity.sessionId, artifactId: first.id, sha256: first.sha256 };
  const original = await client.reload!(reference), count = requests.length;
  expect(original.turns).toEqual(firstState.turns); expect(original.identity.runId).toBe(firstRun.runId);
  expect((await (await remote("reload", reference)).json() as { result: SavedResearch }).result).toEqual(original);
  expect(requests).toHaveLength(count); expect(JSON.stringify(original)).not.toContain(KEY); expect(JSON.stringify(original)).not.toContain(root);
  const oldReport = loadArtifactSnapshot(`${first.id}@${first.sha256}`);
  expect(oldReport?.meta.provenance?.scope).toBe("branch");
  const next = await client.followup!({ ...await requestFor(client, identity, "第二轮新增结论"), previousRunId: firstRun.runId });
  const nextState = await terminal(client, identity.sessionId);
  const second = await client.save!({ workspaceId: identity.workspaceId, ...next,
    expectedRevision: nextState.revision!, expectedArtifactRevision: first.sha256 });
  expect(second.id).toBe(first.id); expect(second.version).toBe(2); expect(second.sha256).not.toBe(first.sha256);
  expect(loadArtifactSnapshot(`${first.id}@${first.sha256}`)).toEqual(oldReport);
  expect(await client.reload!(reference)).toEqual(original);
  const staleHead = { workspaceId: identity.workspaceId, ...next, expectedRevision: (await client.session(identity.sessionId)).revision!, expectedArtifactRevision: first.sha256 };
  await expect(client.save!(staleHead)).rejects.toMatchObject({ code: "ARTIFACT_CONFLICT" });
  expect((await remote("save", staleHead)).status).toBe(409);
  for (const bad of [{ ...reference, path: root }, { ...reference, artifactId: "../settings" }, { ...reference, sha256: "latest" }]) {
    await expect(client.reload!(bad)).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect((await remote("reload", bad)).status).toBe(400);
  }
  const head = join(root, "artifacts", `${first.id}.report.json`);
  writeFileSync(head, "damaged head");
  await expect(client.save!({ ...staleHead, expectedArtifactRevision: second.sha256 })).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
  expect(readFileSync(head, "utf8")).toBe("damaged head");
  expect(await client.reload!(reference)).toEqual(original);
  const archive = join(root, "artifacts", ".revisions", first.id, first.sha256, "report.json");
  writeFileSync(archive, "damaged version");
  const beforeReload = requests.length;
  await expect(client.reload!(reference)).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
  expect((await remote("reload", reference)).status).toBe(409);
  expect(readFileSync(archive, "utf8")).toBe("damaged version"); expect(requests).toHaveLength(beforeReload);
});

test("save owns the terminal session until its checkpoint commits, and close drains the accepted operation", async () => {
  let count = 0, entered!: () => void, release!: () => void;
  const blocked = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  service = createWorkbenchService({ cwd: root, dependencies: () => {
    const dependency = createDefaultSessionDependencies({ cwd: root });
    if (++count !== 2) return dependency;
    return { ...dependency, sessions: { ...dependency.sessions, create: dependency.sessions.create.bind(dependency.sessions), open: dependency.sessions.open.bind(dependency.sessions),
      async list(options) { entered(); await gate; return dependency.sessions.list(options); } } };
  } });
  const client = service.client, identity = await client.identity();
  const run = await client.submit(await requestFor(client, identity, "并发保存"));
  const finished = await terminal(client, identity.sessionId);
  const saving = client.save!({ workspaceId: identity.workspaceId, ...run, expectedRevision: finished.revision!, expectedArtifactRevision: null });
  try {
    await blocked;
    await expect(client.submit(await requestFor(client, identity, "不能越过保存"))).rejects.toMatchObject({ code: "SESSION_BUSY" });
    await expect(client.renameSession({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, expectedRevision: finished.revision!, title: "并发重命名" })).rejects.toMatchObject({ code: "SESSION_BUSY" });
    let closed = false;
    const closing = service.close().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    release(); const artifact = await saving; await closing;
    service = createWorkbenchService({ cwd: root });
    expect((await service.client.session(identity.sessionId)).output.artifacts).toEqual([artifact]);
    expect(requests).toHaveLength(1);
  } finally { release(); await saving.catch(() => {}); }
});

test("a committed report survives a failed checkpoint without publishing a successful save", async () => {
  const store = createWorkbenchSessionStore(); let failCheckpoint = false;
  service = createWorkbenchService({ cwd: root, store: { ...store, async save(record, revision) {
    if (failCheckpoint && record.snapshot.output.artifacts.length) throw new Error("Controlled checkpoint failure after report commit");
    return store.save(record, revision);
  } } });
  const client = service.client, identity = await client.identity();
  const run = await client.submit(await requestFor(client, identity, "报告与会话提交失败边界"));
  const finished = await terminal(client, identity.sessionId), before = store.load(identity.workspaceId, identity.sessionId);
  const projected: SessionSnapshot[] = [];
  const detach = client.subscribe(event => { if (event.type === "snapshot") projected.push(event.snapshot); });
  failCheckpoint = true;
  await expect(client.save!({ workspaceId: identity.workspaceId, ...run, expectedRevision: finished.revision!, expectedArtifactRevision: null }))
    .rejects.toMatchObject({ code: "SESSION_STORAGE" });
  detach();
  expect(projected.every(snapshot => snapshot.output.artifacts.length === 0)).toBe(true);
  expect(store.load(identity.workspaceId, identity.sessionId)).toEqual(before);
  const report = loadArtifactSnapshot(`workbench-${identity.sessionId}`);
  expect(report?.meta.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(loadArtifactSnapshot(`workbench-${identity.sessionId}@${report!.meta.revision}`)).toEqual(report);
  await service.close(); service = createWorkbenchService({ cwd: root });
  const reopened = await service.client.session(identity.sessionId);
  expect(reopened.output.artifacts).toHaveLength(0);
  await expect(service.client.save!({ workspaceId: identity.workspaceId, ...run, expectedRevision: reopened.revision!, expectedArtifactRevision: null }))
    .rejects.toMatchObject({ code: "ARTIFACT_CONFLICT" });
  expect(requests).toHaveLength(1);
  expect(loadArtifactSnapshot(`workbench-${identity.sessionId}`)).toEqual(report);
});

test("readers see saved artifacts only after the checkpoint commit", async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const store = createWorkbenchSessionStore();
  service = createWorkbenchService({ cwd: root, store: { ...store, async save(record, revision) {
    if (record.snapshot.output.artifacts.length) { entered(); await gate; }
    return store.save(record, revision);
  } } });
  const client = service.client, identity = await client.identity();
  const run = await client.submit(await requestFor(client, identity, "提交前不显示保存成功"));
  const finished = await terminal(client, identity.sessionId);
  const saving = client.save!({ workspaceId: identity.workspaceId, ...run, expectedRevision: finished.revision!, expectedArtifactRevision: null });
  try {
    await started;
    expect(await client.session(identity.sessionId)).toEqual(finished);
    release(); const artifact = await saving;
    const current = await client.session(identity.sessionId);
    expect(current.output.artifacts).toEqual([artifact]);
    expect(store.load(identity.workspaceId, identity.sessionId).record.snapshot).toEqual(current);
  } finally { release(); await saving.catch(() => {}); }
});

test("review forks exactly the saved branch into a new session and leaves later source work unchanged", async () => {
  const { client, identity, submit } = await setup();
  const first = await submit("固定版本原始问题");
  const firstState = await terminal(client, identity.sessionId);
  const artifact = await client.save!({ workspaceId: identity.workspaceId, ...first, expectedRevision: firstState.revision!, expectedArtifactRevision: null });
  const later = await client.followup!({ ...await requestFor(client, identity, "不应进入旧报告复核的后续问题"), previousRunId: first.runId });
  const sourceState = await terminal(client, identity.sessionId);
  const storage = createWorkbenchSessionStore(), sourceRecord = storage.load(identity.workspaceId, identity.sessionId);
  const dependencies = createDefaultSessionDependencies({ cwd: root });
  const sourceMetadata = (await dependencies.sessions.list({ cwd: root })).find(item => item.id === sourceRecord.record.coreSessionId)!;
  const sourceBytes = readFileSync(sourceMetadata.path);
  await dependencies.env.cleanup();
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const { token } = await (await fetch(host.server.url + "api/workbench/bootstrap")).json() as { token: string };
  const remote = (input: unknown) => fetch(host!.server.url + "api/workbench/rpc", { method: "POST",
    headers: { "Content-Type": "application/json", "x-workbench-token": token }, body: JSON.stringify({ method: "review", args: [input] }) });
  const input = { workspaceId: identity.workspaceId, sessionId: identity.sessionId, artifactId: artifact.id, sha256: artifact.sha256,
    requestId: randomUUID(), expectedRevision: sourceState.revision!, text: "独立复核固定版本的结论边界" };
  const response = await remote(input); expect(response.status).toBe(200);
  const { result } = await response.json() as { result: { sessionId: string; runId: string } };
  expect(await client.review!(input)).toEqual(result);
  expect(result.sessionId).not.toBe(identity.sessionId); expect(result.runId).not.toBe(later.runId);
  const reviewed = await terminal(client, result.sessionId);
  expect(reviewed.state).toBe("settled"); expect(reviewed.turns[0]).toMatchObject({ operation: "review", previousRunId: first.runId });
  expect(reviewed.source).toEqual({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, artifactId: artifact.id, sha256: artifact.sha256, runId: first.runId });
  const messages = JSON.stringify(requests.at(-1)?.messages);
  expect(messages).toContain("固定版本原始问题"); expect(messages).toContain(input.text);
  expect(messages).not.toContain("不应进入旧报告复核的后续问题");
  expect(storage.load(identity.workspaceId, result.sessionId).record.coreSessionId).not.toBe(sourceRecord.record.coreSessionId);
  expect(readFileSync(sourceMetadata.path)).toEqual(sourceBytes);
  expect(await client.session(identity.sessionId)).toEqual(sourceState);
  const count = requests.length;
  await expect(client.review!({ ...input, text: "改变相同请求" })).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
  await expect(client.review!({ ...input, requestId: randomUUID(), expectedRevision: 0 })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  await service!.close(); service = createWorkbenchService({ cwd: root });
  expect((await service.client.session(result.sessionId)).source).toEqual(reviewed.source);
  expect(requests).toHaveLength(count);
  // A source branch whose bytes no longer match the fixed report is preserved,
  // and must not be replaced with a newer or empty context for another review.
  writeFileSync(sourceMetadata.path, "damaged source journal");
  await expect(service.client.review!({ ...input, requestId: randomUUID() })).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
  expect(readFileSync(sourceMetadata.path, "utf8")).toBe("damaged source journal"); expect(requests).toHaveLength(count);
});

test("a different client changing the checkpoint during fork prevents stale review acceptance", async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  service = createWorkbenchService({ cwd: root, dependencies: () => {
    const dependency = createDefaultSessionDependencies({ cwd: root });
    const repository = dependency.sessions as typeof dependency.sessions & { fork: (...args: unknown[]) => Promise<unknown> };
    return { ...dependency, sessions: { create: repository.create.bind(repository), open: repository.open.bind(repository), list: repository.list.bind(repository),
      async fork(...args: unknown[]) { entered(); await gate; return repository.fork(...args); } } };
  } });
  const client = service.client, identity = await client.identity();
  const run = await client.submit(await requestFor(client, identity, "固定来源研究"));
  const finished = await terminal(client, identity.sessionId);
  const report = await client.save!({ workspaceId: identity.workspaceId, ...run, expectedRevision: finished.revision!, expectedArtifactRevision: null });
  const snapshot = await client.session(identity.sessionId), before = requests.length;
  const review = client.review!({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, artifactId: report.id, sha256: report.sha256,
    requestId: randomUUID(), expectedRevision: snapshot.revision!, text: "不能忽略另一客户端更新" });
  try {
    await started;
    const store = createWorkbenchSessionStore(), current = store.load(identity.workspaceId, identity.sessionId);
    const revision = current.record.snapshot.revision! + 1;
    await store.save({ ...current.record, name: "并发客户端的新名称", snapshot: { ...current.record.snapshot, revision } }, current.revision);
    release(); await expect(review).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect((await client.session(identity.sessionId)).revision).toBe(revision);
    expect((await client.workspaces())[0]?.name).toBe("并发客户端的新名称");
    expect(await client.workspaces()).toHaveLength(1); expect(requests).toHaveLength(before);
  } finally { release(); await review.catch(() => {}); }
});

test("interruption acknowledgement validates run and revision and cannot race checkpoint deletion", async () => {
  mode = "tool";
  const { client, identity, submit } = await setup();
  const run = await submit("待核对运行"); await terminal(client, identity.sessionId); await service!.close();
  const store = createWorkbenchSessionStore(), current = store.load(identity.workspaceId, identity.sessionId);
  await store.save({ ...current.record, snapshot: { ...current.record.snapshot, state: "running" } }, current.revision);
  let entered!: () => void, release!: () => void;
  const enteredDelete = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  service = createWorkbenchService({ cwd: root, store: { ...store, async delete(...args) { entered(); await gate; return store.delete(...args); } } });
  const restored = service.client, recovered = await restored.session(identity.sessionId);
  const input = { workspaceId: identity.workspaceId, ...run, expectedRevision: recovered.revision! };
  await expect(restored.acknowledgeInterruption!({ ...input, workspaceId: "another-workspace" })).rejects.toMatchObject({ code: "WORKSPACE_MISMATCH" });
  await expect(restored.acknowledgeInterruption!({ ...input, runId: "previous-run" })).rejects.toMatchObject({ code: "RUN_NOT_FOUND" });
  await expect(restored.acknowledgeInterruption!({ ...input, expectedRevision: 0 })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  const deleting = restored.deleteSession!({ workspaceId: input.workspaceId, sessionId: input.sessionId, expectedRevision: input.expectedRevision });
  try {
    await enteredDelete;
    await expect(restored.acknowledgeInterruption!(input)).rejects.toMatchObject({ code: "SESSION_BUSY" });
    release(); await deleting;
    expect(await restored.workspaces()).toHaveLength(0);
    expect(existsSync(join(root, "workbench", "sessions", identity.sessionId + ".json"))).toBe(false);
  } finally { release(); await deleting.catch(() => {}); }
});

test("session deletion rejects active and stale clients and retains journals and immutable report versions", async () => {
  mode = "hold";
  const { client, identity, submit } = await setup();
  const started = new Promise<void>(resolve => { reached = resolve; });
  const run = await submit("先等待明确停止"); await started;
  await expect(client.deleteSession!({ workspaceId: identity.workspaceId, sessionId: identity.sessionId,
    expectedRevision: (await client.session(identity.sessionId)).revision! })).rejects.toMatchObject({ code: "SESSION_BUSY" });
  await client.cancel({ workspaceId: identity.workspaceId, ...run }); mode = "answer";
  const completed = await client.continue!({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, previousRunId: run.runId,
    requestId: randomUUID(), expectedRevision: (await client.session(identity.sessionId)).revision! });
  const terminalState = await terminal(client, identity.sessionId);
  const artifact = await client.save!({ workspaceId: identity.workspaceId, ...completed, expectedRevision: terminalState.revision!, expectedArtifactRevision: null });
  const input = { workspaceId: identity.workspaceId, sessionId: identity.sessionId, expectedRevision: (await client.session(identity.sessionId)).revision! };
  await client.renameSession({ ...input, title: "另一客户端更新" });
  await expect(client.deleteSession!(input)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const { token } = await (await fetch(host.server.url + "api/workbench/bootstrap")).json() as { token: string };
  const remote = (value: unknown) => fetch(host!.server.url + "api/workbench/rpc", { method: "POST",
    headers: { "Content-Type": "application/json", "x-workbench-token": token }, body: JSON.stringify({ method: "deleteSession", args: [value] }) });
  expect((await remote(input)).status).toBe(409);
  const store = createWorkbenchSessionStore(), record = store.load(identity.workspaceId, identity.sessionId);
  const dependencies = createDefaultSessionDependencies({ cwd: root });
  const journal = (await dependencies.sessions.list({ cwd: root })).find(item => item.id === record.record.coreSessionId)!;
  await dependencies.env.cleanup(); const journalBytes = readFileSync(journal.path);
  input.expectedRevision = (await client.session(identity.sessionId)).revision!;
  expect((await remote(input)).status).toBe(200);
  expect(await client.workspaces()).toHaveLength(0);
  await expect(client.session(identity.sessionId)).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
  await expect(client.identity()).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
  expect(readFileSync(journal.path)).toEqual(journalBytes);
  expect(loadArtifactSnapshot(`${artifact.id}@${artifact.sha256}`)?.meta.revision).toBe(artifact.sha256);
  const created = await client.createSession(); expect((await client.identity()).sessionId).toBe(created.sessionId);
  const file = join(root, "workbench", "sessions", created.sessionId + ".json");
  writeFileSync(file, "corrupt checkpoint must be retained");
  expect((await remote({ ...input, sessionId: created.sessionId, expectedRevision: 0 })).status).toBe(409);
  expect(readFileSync(file, "utf8")).toBe("corrupt checkpoint must be retained");
});

test("saving a terminal run uses its committed leaf instead of newer journal content", async () => {
  const { client, identity, submit } = await setup();
  const run = await submit("属于终态运行的内容"), finished = await terminal(client, identity.sessionId);
  const record = createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record;
  const dependencies = createDefaultSessionDependencies({ cwd: root });
  const metadata = (await dependencies.sessions.list({ cwd: root })).find(item => item.id === record.coreSessionId)!;
  await dependencies.env.cleanup();
  const addedId = randomUUID();
  appendFileSync(metadata.path, JSON.stringify({ type: "message", id: addedId, parentId: record.coreLeafId, timestamp: new Date().toISOString(),
    message: { role: "user", content: "OUTSIDE_COMMITTED_RUN", timestamp: Date.now() } }) + "\n");
  const artifact = await client.save!({ workspaceId: identity.workspaceId, ...run, expectedRevision: finished.revision!, expectedArtifactRevision: null });
  const saved = loadArtifactSnapshot(`${artifact.id}@${artifact.sha256}`)!;
  expect(saved.meta.provenance?.leafId).toBe(record.coreLeafId!);
  expect(saved.meta.provenance?.entryIds).not.toContain(addedId);
  expect(saved.html).not.toContain("OUTSIDE_COMMITTED_RUN");
  expect(readFileSync(metadata.path, "utf8")).toContain("OUTSIDE_COMMITTED_RUN");
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
  await client.cancel({ workspaceId: identity.workspaceId, ...first }); expect((await client.session(identity.sessionId)).state).toBe("cancelled");
  const second = await submit("下一轮"); await expect(client.cancel({ workspaceId: identity.workspaceId, ...first })).rejects.toThrow("未取消其他研究");
  expect((await client.session(identity.sessionId)).identity.runId).toBe(second.runId);
  await client.cancel({ workspaceId: identity.workspaceId, ...second }); expect((await client.session(identity.sessionId)).state).toBe("cancelled");
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
  const run = await submit("停止尚未执行的调用"); await preparing(client, identity.sessionId); await client.cancel({ workspaceId: identity.workspaceId, ...run });
  expect((await client.session(identity.sessionId)).turns[1]?.activity?.[0]?.state).toBe("not-run");
  mode = "bad-tool"; toolSent = false;
  await submit("无效参数仍保留失败记录"); const result = await terminal(client, identity.sessionId);
  expect(result.turns[3]?.activity?.[0]).toMatchObject({ title: "计算持仓情景", state: "failed" });
  expect(JSON.stringify(result)).not.toContain(KEY);
});
test("model settings have storage revisions, reject stale saves and never project credentials", async () => {
  const { client, identity, submit } = await setup();
  const old = await client.preferences(); expect(old.modelProvider).toBe("custom"); expect(JSON.stringify(old)).not.toContain(KEY);
  await client.updatePreferences({ revision: old.revision, source: old.source, portfolio: old.portfolio, model: "next-model" });
  expect(readSettings().model).toBe("next-model");
  await expect(client.updatePreferences({ revision: old.revision, source: old.source, portfolio: old.portfolio, model: "stale-model" })).rejects.toMatchObject({ code: "ESTORAGECONFLICT" });
  expect(readSettings().model).toBe("next-model");
  mode = "hold"; const started = new Promise<void>(resolve => { reached = resolve; }); const run = await submit("运行中不能修改模型"); await started;
  await expect(client.updatePreferences({ revision: (await client.preferences()).revision, source: "none", portfolio: "", model: "wrong-boundary" })).rejects.toThrow("请先等待或停止研究");
  await client.cancel({ workspaceId: identity.workspaceId, ...run });
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
  const run = await client.submit(await requestFor(client, identity, "共享运行")); await started;
  await reader.cancel(); expect((await client.session(identity.sessionId)).state).toBe("running");
  const viaHttp = await fetch(url + "/api/workbench/rpc", { method: "POST", headers: { "Content-Type": "application/json", "x-workbench-token": bootstrap.token }, body: JSON.stringify({ method: "session", args: [identity.sessionId] }) });
  expect((await viaHttp.json() as { result: SessionSnapshot }).result.identity.runId).toBe(run.runId);
  await client.cancel({ workspaceId: identity.workspaceId, ...run }); expect((await client.session(identity.sessionId)).state).toBe("cancelled");
});
test("a second Host cannot own the workspace, and normal close releases the lock", async () => {
  host = startWorkbenchServer({ port: 0, assetsRoot: join(root, "assets") });
  expect(() => startWorkbenchServer({ port: 0, assetsRoot: join(root, "assets") })).toThrow("此工作区已有本地研究服务");
  await host.close(); host = startWorkbenchServer({ port: 0, assetsRoot: join(root, "assets") });
  expect((await host.service.client.identity()).workspaceId).toHaveLength(24);
});

test("direct and HTTP submissions deduplicate one request and reject changed input or stale revisions", async () => {
  mode = "hold";
  host = startWorkbenchServer({ port: 0, assetsRoot: join(root, "assets") });
  const client = host.service.client, identity = await client.identity();
  const bootstrap = await (await fetch(host.server.url + "api/workbench/bootstrap")).json() as { token: string };
  const remote = (value: unknown, method = "submit") => fetch(host!.server.url + "api/workbench/rpc", {
    method: "POST", headers: { "Content-Type": "application/json", "x-workbench-token": bootstrap.token },
    body: JSON.stringify({ method, args: [value] }),
  });
  const input = await requestFor(client, identity, "Only one run");
  const started = new Promise<void>(resolve => { reached = resolve; });
  const [local, response] = await Promise.all([client.submit(input), remote(input)]);
  await started;
  expect(response.status).toBe(200);
  expect((await response.json() as { result: unknown }).result).toEqual(local);
  expect(requests).toHaveLength(1);
  expect((await client.session(identity.sessionId)).turns).toHaveLength(2);
  expect((await remote({ ...input, text: "Different input" })).status).toBe(409);
  await expect(client.submit({ ...input, text: "Different input" })).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
  const target = { workspaceId: identity.workspaceId, ...local };
  for (const wrong of [{ ...target, workspaceId: "another-workspace" }, { ...target, sessionId: "another-session" },
    { ...target, runId: "another-run" }]) {
    await expect(client.cancel(wrong)).rejects.toThrow("未取消其他研究");
    expect((await remote(wrong, "cancel")).status).toBe(wrong.workspaceId !== target.workspaceId ? 409 : 404);
  }
  expect((await remote(local.runId, "cancel")).status).toBe(400);
  expect((await client.session(identity.sessionId)).state).toBe("running");
  expect((await remote(target, "cancel")).status).toBe(200);
  await client.cancel(target); // Repeated cancellation of this exact run is idempotent.
  const cancelled = await client.session(identity.sessionId);
  expect(await client.submit(input)).toEqual(local);
  const duplicate = await remote(input);
  expect((await duplicate.json() as { result: unknown }).result).toEqual(local);
  expect(await client.session(identity.sessionId)).toEqual(cancelled);
  const stale = { ...input, requestId: randomUUID() };
  expect((await remote(stale)).status).toBe(409);
  await expect(client.submit(stale)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  expect(requests).toHaveLength(1);
  // A caller cannot mutate the cached receipt and change the identity of a retry.
  (local as { runId: string }).runId = "caller-modified";
  expect((await client.submit(input)).runId).toBe(cancelled.identity.runId!);
});

test("direct and HTTP submissions use the same runtime argument boundary without starting a model", async () => {
  host = startWorkbenchServer({ port: 0, assetsRoot: join(root, "assets") });
  const client = host.service.client, identity = await client.identity();
  const valid = await requestFor(client, identity, "Valid input");
  const bootstrap = await (await fetch(host.server.url + "api/workbench/bootstrap")).json() as { token: string };
  for (const input of [null, [], { ...valid, requestId: "" }, { ...valid, expectedRevision: -1 },
    { ...valid, expectedRevision: "0" }, { ...valid, text: "" }, { ...valid, path: "arbitrary-file" }]) {
    const local = await client.submit(input as never).then(() => null, error => error as { code: string });
    const response = await fetch(host.server.url + "api/workbench/rpc", { method: "POST",
      headers: { "Content-Type": "application/json", "x-workbench-token": bootstrap.token }, body: JSON.stringify({ method: "submit", args: [input] }) });
    expect(response.status).toBe(400);
    expect(local).not.toBeNull();
    expect((await response.json() as { error: { code: string } }).error.code).toBe(local!.code);
  }
  expect(requests).toHaveLength(0);
  expect((await client.session(identity.sessionId)).turns).toHaveLength(0);
});

test("reads and existing mutators share direct and HTTP validation, including scoped revision-checked rename", async () => {
  const { client, identity } = await setup();
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const { token } = await (await fetch(host.server.url + "api/workbench/bootstrap")).json() as { token: string };
  const remote = (method: string, args: unknown[]) => fetch(host!.server.url + "api/workbench/rpc", { method: "POST",
    headers: { "Content-Type": "application/json", "x-workbench-token": token }, body: JSON.stringify({ method, args }) });
  const rename = { workspaceId: identity.workspaceId, sessionId: identity.sessionId, expectedRevision: 0, title: "共享名称" };
  const preference = { revision: (await client.preferences()).revision, model: "workbench-fixture", source: "none", portfolio: "" };
  const bad: Array<[keyof WorkbenchClient, unknown[]]> = [
    ["session", [null]], ["transcript", [" "]], ["output", [3]], ["references", [identity.sessionId, []]],
    ["renameSession", [{ ...rename, title: "" }]], ["renameSession", [{ ...rename, expectedRevision: "0" }]],
    ["renameSession", [{ ...rename, path: root }]], ["acknowledgeInterruption", ["old-run-only"]],
    ["updatePreferences", [{ ...preference, apiKey: "injected" }]], ["updatePreferences", [null]],
    ["updatePreferences", [{ ...preference, source: "demo" }]], ["updatePreferences", [{ ...preference, thinkingLevel: [] }]],
  ];
  for (const [method, args] of bad) {
    const failure = await (client[method] as (...values: unknown[]) => Promise<unknown>)(...args).then(() => null, error => error as { code: string });
    const response = await remote(method, args);
    expect(response.status).toBe(400); expect(failure).not.toBeNull();
    expect((await response.json() as { error: { code: string } }).error.code).toBe(failure!.code);
  }
  await client.renameSession(rename);
  expect((await remote("renameSession", [rename])).status).toBe(409);
  await expect(client.renameSession(rename)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  const wrong = { ...rename, workspaceId: "another-workspace", expectedRevision: 1 };
  await expect(client.renameSession(wrong)).rejects.toMatchObject({ code: "WORKSPACE_MISMATCH" });
  expect((await remote("renameSession", [wrong])).status).toBe(409);
  expect((await client.workspaces())[0]?.name).toBe(rename.title); expect(requests).toHaveLength(0);
});

test("close wins over submissions and session creation still waiting at the readiness boundary", async () => {
  for (const operation of ["submit", "create"] as const) {
    let agents = 0;
    service = createWorkbenchService({ cwd: root, dependencies: () => { agents++; return createDefaultSessionDependencies({ cwd: root }); } });
    const client = service.client, identity = await client.identity();
    const input = await requestFor(client, identity, "Must not run after close");
    const before = await client.workspaces();
    const pending = operation === "submit" ? client.submit(input) : client.createSession();
    const closed = service.close();
    await expect(pending).rejects.toMatchObject({ code: "CLOSED" });
    await closed;
    expect(await client.workspaces()).toEqual(before);
    expect(agents).toBe(0);
    expect(requests).toHaveLength(0);
  }
});


test("restart restores names and tool history without requests, then opens the original core context", async () => {
  mode = "tool"; const { client, identity, submit } = await setup();
  await submit("计算假设情景，保存后继续"); const before = await terminal(client, identity.sessionId);
  await client.renameSession({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, expectedRevision: before.revision!, title: "持仓情景研究" }); await service!.close(); service = undefined;
  const count = requests.length;
  service = createWorkbenchService({ cwd: join(root, "different-checkout") });
  expect((await service.client.identity()).sessionId).toBe(identity.sessionId);
  expect((await service.client.workspaces())[0]?.name).toBe("持仓情景研究");
  expect((await service.client.session(identity.sessionId)).turns).toEqual(before.turns);
  expect(requests.length).toBe(count);
  await service.client.submit(await requestFor(service.client, identity, "继续解释旧计算"));
  const after = await terminal(service.client, identity.sessionId);
  expect(after.turns).toHaveLength(4);
  expect(JSON.stringify(requests.at(-1)?.messages)).toContain("calculate_position_scenarios");
  expect(JSON.stringify(requests.at(-1)?.messages)).toContain("计算假设情景，保存后继续");
});


for (const phase of ["waiting", "thinking", "tool"] as const) test(`actual Host kill/restart preserves ${phase} without replay`, async () => {
  const spawn = async (hold: boolean) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../../workbench/test/fixtures/host-process.ts")], {
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
    const submitted = await rpc<{ runId: string }>("submit", [{ workspaceId: identity.workspaceId, sessionId: target.sessionId, requestId: randomUUID(), expectedRevision: (await rpc<SessionSnapshot>("session", [target.sessionId])).revision!, text: "受控中断测试 " + phase }]);
    for (let i = 0; i < 400; i++) {
      const current = await rpc<SessionSnapshot>("session", [target.sessionId]);
      if (phase === "tool" ? existsSync(join(root, "tool-receipt")) : phase === "thinking" ? current.turns.at(-1)?.phase === "thinking" : requests.length > 0) break;
      await Bun.sleep(10);
    }
    expect(requests.length).toBeGreaterThan(0);
    if (phase === "thinking") expect((await rpc<SessionSnapshot>("session", [target.sessionId])).turns.at(-1)?.phase).toBe("thinking");
    if (phase === "tool") expect(readFileSync(join(root, "tool-receipt"), "utf8")).toBe("started\n");
    processHost.child.kill("SIGKILL"); await processHost.child.exited;
    console.log(`Crash fixture ${phase}: process exit observed; reclaiming ownership`);
    const originals = readdirSync(root, { recursive: true }).filter((name): name is string => typeof name === "string" && (/settings|sessions/.test(name)) && name.endsWith(".json") || typeof name === "string" && name.endsWith(".jsonl"))
      .map(name => ({ name, bytes: readFileSync(join(root, name)) }));
    const count = requests.length;
    // Process exit was observed above. Recovery must not wait for an mtime lease.
    processHost = await spawn(false); rpc = await rpcClient(processHost.url);
    console.log(`Crash fixture ${phase}: restarted`);
    const recovered = await rpc<SessionSnapshot>("session", [target.sessionId]);
    expect(recovered.state).toBe("interrupted"); expect(recovered.identity.runId).toBe(submitted.runId);
    expect(requests.length).toBe(count);
    for (const file of originals) expect(readFileSync(join(root, file.name))).toEqual(file.bytes);
    if (phase === "tool") {
      expect(recovered.turns[1]?.activity?.[0]?.state).toBe("unconfirmed");
      await expect(rpc("submit", [{ workspaceId: identity.workspaceId, sessionId: target.sessionId, requestId: randomUUID(), expectedRevision: (await rpc<SessionSnapshot>("session", [target.sessionId])).revision!, text: "不应发送" }])).rejects.toThrow("RECONCILE_REQUIRED");
      expect(requests.length).toBe(count);
      await rpc("acknowledgeInterruption", [{ workspaceId: identity.workspaceId, sessionId: target.sessionId, runId: submitted.runId, expectedRevision: (await rpc<SessionSnapshot>("session", [target.sessionId])).revision! }]); expect(requests.length).toBe(count);
      expect((await rpc<SessionSnapshot>("session", [target.sessionId])).turns[1]?.activity?.[0]?.state).toBe("unconfirmed");
    }
    mode = "answer";
    await rpc("submit", [{ workspaceId: identity.workspaceId, sessionId: target.sessionId, requestId: randomUUID(), expectedRevision: (await rpc<SessionSnapshot>("session", [target.sessionId])).revision!, text: "用户明确的新问题" }]);
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
  await expect(service.client.submit(await requestFor(service.client, identity, "必须先保存"))).rejects.toThrow("无法安全保存");
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
  const identity = await service.client.identity(); await service.client.submit(await requestFor(service.client, identity, "先保存工具意图"));
  await Promise.race([intentFailure, Bun.sleep(2500).then(() => { throw new Error("tool intent was not reached"); })]);
  await service.close(); detach(); expect(executions).toBe(0); expect(requests.length).toBe(1); expect(failures[0]).toContain("无法安全保存");
});


describe("large-history fixture lifecycle", () => {
  let store: ReturnType<typeof createWorkbenchSessionStore>;
  let identity: Awaited<ReturnType<WorkbenchClient["identity"]>>;
  beforeEach(async () => {
    historySeed = (async () => {
  store = createWorkbenchSessionStore();
  service = createWorkbenchService({ cwd: root }); identity = await service.client.identity(); await service.close();
  const template = store.load(identity.workspaceId, identity.sessionId).record;
  for (let i = 0; i < 30; i++) {
    const id = randomUUID(); await store.save({ ...template, sessionId: id, name: "历史 " + i,
      snapshot: { ...template.snapshot, identity: { ...template.snapshot.identity, sessionId: id }, turns: [{ id: "history", role: "assistant", state: "settled", text: "payload".repeat(10000), at: template.updatedAt }] } }, null);
  }
    })();
    await historySeed;
  }, 120_000);
  test("large stored histories stay lazy in lists and startup SSE, then release their Agent after each turn", async () => {
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
  for (let i = 0; i < 2; i++) { await service.client.submit(await requestFor(service.client, identity, "资源释放检查 " + i)); await terminal(service.client, identity.sessionId); }
  expect(agents).toBe(2); expect(cleanups).toBe(2);
  expect(readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"))).toHaveLength(1);
});
});


test("missing original context fails explicitly without a provider call or a replacement journal", async () => {
  const { client, identity, submit } = await setup(); await submit("保存原始上下文"); await terminal(client, identity.sessionId);
  await service!.close(); service = undefined;
  const files = readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"));
  expect(files).toHaveLength(1); rmSync(join(root, "sessions", String(files[0])));
  const count = requests.length; service = createWorkbenchService({ cwd: root });
  await service.client.submit(await requestFor(service.client, identity, "无法恢复时不能假装记得"));
  const stopped = await terminal(service.client, identity.sessionId);
  expect(stopped.state).toBe("failed"); expect(stopped.turns.at(-1)?.text).toContain("原研究上下文无法读取");
  expect(requests.length).toBe(count);
  expect(readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"))).toHaveLength(0);
});
