import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, spyOn, test as bunTest } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DEFAULT_SETTINGS } from "../../../types/config.ts";
import { acquireResourceLeases, createWorkbenchSessionStore, listArtifacts, loadArtifactSnapshot, readSettings, saveSettings, resolveWorkbenchSessionsDir } from "../../../storage/index.ts";
import { createDefaultSessionDependencies } from "../../../runtime/session-dependencies.ts";
import { createResearchService as createWorkbenchService } from "../research.ts";
import { startWorkbenchServer, WORKBENCH_ASSETS_ROOT } from "../../workbench/server.ts";
import type { ArtifactSummary, SavedResearch, SessionSnapshot, WorkbenchClient } from "../../../types/workbench.ts";
import { openTerminalSession } from "../../host/terminal-session.ts";
import { createTerminalClient } from "../../host/terminal-client.ts";
import { createQuantResearchAgent } from "../../../runtime/quant-harness.ts";
import { AppRuntime } from "../../../app-runtime.ts";
import type { CurrentSessionMeta, UIMessage } from "../../../types/ui.ts";
import { TerminalEnvironment } from "../terminal-environment.ts";
import { ComposerReferences } from "../../../runtime/workspace/composer-references.ts";
import { listRestorableArtifactReports } from "../../../runtime/research/artifact-reports.ts";
import type { ResearchTaskSnapshot } from "../../../types/research-task.ts";
import type { ResearchTaskSpec } from "../../../types/research-task.ts";
import type { HudMetrics } from "../../../types/hud.ts";
import { countConversationTurns } from "../../../runtime/workspace/hud.ts";
import { QuantResearchHarness } from "../../../runtime/quant-harness.ts";
import { editPortfolio } from "../../../runtime/research/portfolio.ts";
import { activeResearchSelection, singlePortfolioToolDenial, withSinglePortfolioResearch } from "../../../runtime/research/active-portfolio.ts";
import { annualComparisonFixture } from "../../../research/test/annual-fixture.ts";
import { accountHistoryFixture } from "../../../performance/test/fixture.ts";
import { createFixtureLifetime } from "./fixture-lifetime.ts";

function structuredTask(): ResearchTaskSpec {
  return { id: "service-task", request: "按固定窗口研究 AAPL，禁止交易", goal: "核验固定研究任务",
    scope: { symbols: ["AAPL"], market: "US", start: "2026-01-01", end: "2026-02-09" },
    constraints: { allowedTools: ["run_backtest"], notes: ["禁止交易"] }, dataRefs: [], reportRequired: false,
    criteria: [{ id: "return", description: "原参数收益", tool: "run_backtest", parameters: { symbol: "AAPL", fast: 1, slow: 2,
      cash: 1000, commission: 0, start: "2026-01-01", end: "2026-02-09" }, metrics: ["Total return"] }] };
}

const KEY = "fixture-workbench-secret-101";
const fixtureLifetime = createFixtureLifetime();
let fixtureName = "", fixturePhase = "body";
const phase = (value: string) => { fixturePhase = value; };
const test = (name: string, body: () => unknown, timeout?: number) =>
  bunTest(name, fixtureLifetime.track(async () => { fixtureName = name; fixturePhase = "body"; await body(); }), timeout);
let root: string, previous: string | undefined, proxy: string | undefined, previousSkills: string | undefined, previousLeaseRoot: string | undefined;
let model: ReturnType<typeof Bun.serve>, host: ReturnType<typeof startWorkbenchServer> | undefined;
let service: ReturnType<typeof createWorkbenchService> | undefined;
let mode: "answer" | "tool" | "hold" | "gated-answer" | "empty" | "thinking" | "preparing" | "bad-tool" | "hold-thinking" | "pure-failure" | "stream-thinking" | "tool-thinking" | "stream-report", requests: Record<string, unknown>[], toolSent: boolean;
let gatedAnswer: Promise<void> | undefined;
let reached: (() => void) | undefined;
let releasePreparation: (() => void) | undefined;
let releaseThinking: (() => void) | undefined;
let streamCredential = KEY;
let syntheticReportPath = "";
let historySeed: Promise<void> | undefined;
let reply: string | undefined;
let scriptedCalls: Array<(payload: Record<string, unknown>) => Array<{ name: string; args: unknown }>>;
let answerText: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "whyj-workbench-")); previous = process.env.OHQUANT_DIR; proxy = process.env.NO_PROXY;
  process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
  previousSkills = process.env.OHQUANT_SKILLS_DIR; process.env.OHQUANT_SKILLS_DIR = join(root, "skills");
  previousLeaseRoot = process.env.WHYJ_RESOURCE_LEASE_ROOT; process.env.WHYJ_RESOURCE_LEASE_ROOT = join(root, "lease-registry");
  mode = "answer"; requests = []; toolSent = false; reached = undefined; releasePreparation = undefined; releaseThinking = undefined; streamCredential = KEY; gatedAnswer = undefined; scriptedCalls = []; reply = undefined;
  answerText = `这是同一核心会话的回答，仅作假设计算。${KEY}`;
  model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const payload = await request.json() as Record<string, unknown>; requests.push(payload); reached?.();
    if (mode === "gated-answer") await gatedAnswer;
    if (mode === "pure-failure" && toolSent) return Response.json({ error: { message: "Controlled model refusal after a pure calculation error", type: "invalid_request_error" } }, { status: 400 });
    if (mode === "hold" || mode === "hold-thinking") return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(mode === "hold" ? ": waiting\n\n" : "data: " + JSON.stringify({id:"hold-thinking",object:"chat.completion.chunk",created:0,model:payload.model,choices:[{index:0,delta:{role:"assistant",reasoning_content:"PRIVATE_REASONING_NOT_FOR_UI"},finish_reason:null}]}) + "\n\n")); } }), { headers: { "Content-Type": "text/event-stream" } });
    if (mode === "stream-report" && toolSent) return new Response(new ReadableStream({ start(controller) {
      const frame = (delta: unknown, finish_reason: string | null = null) => new TextEncoder().encode("data: " + JSON.stringify({ id: "stream-report", object: "chat.completion.chunk", created: 0, model: payload.model, choices: [{ index: 0, delta, finish_reason }] }) + "\n\n");
      controller.enqueue(frame({ role: "assistant", content: "Report: " + syntheticReportPath.slice(0, 12) }));
      releaseThinking = () => {
        controller.enqueue(frame({ content: syntheticReportPath.slice(12) + " · 12.00 CNY · 2026-10-29 · https://example.com/a" }));
        controller.enqueue(frame({}, "stop")); controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); controller.close();
      };
    } }), { headers: { "Content-Type": "text/event-stream" } });
    if (mode === "stream-thinking") return new Response(new ReadableStream({ start(controller) {
      const frame = (delta: unknown, finish_reason: string | null = null) => new TextEncoder().encode("data: " + JSON.stringify({ id: "stream-thinking", object: "chat.completion.chunk", created: 0, model: payload.model, choices: [{ index: 0, delta, finish_reason }] }) + "\n\n");
      controller.enqueue(frame({ role: "assistant", reasoning_content: "第一段：核对数据日期。" }));
      let stage = 0;
      releaseThinking = () => {
        if (stage++ === 0) controller.enqueue(frame({ reasoning_content: "第二段：对照风险。" + streamCredential.slice(0, 10) }));
        else {
          controller.enqueue(frame({ reasoning_content: streamCredential.slice(10) + " 已完成核对。" }));
          controller.enqueue(frame({ content: "这是最终回答，假设结果。" })); controller.enqueue(frame({}, "stop"));
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); controller.close();
        }
      };
    } }), { headers: { "Content-Type": "text/event-stream" } });
    const scripted = scriptedCalls.shift()?.(payload);
    const call = !!scripted || ["tool", "preparing", "bad-tool", "pure-failure", "tool-thinking"].includes(mode) && !toolSent;
    if (call) toolSent = true;
    const args = JSON.stringify({ shares: mode === "bad-tool" || mode === "pure-failure" ? KEY : 100, costPerShare: 10, observedClose: 12, observationDate: "2026-10-23", currency: "CNY", changes: [-0.1, 0, 0.1] });
    const delta = scripted ? { role: "assistant", tool_calls: scripted.map((item, index) => ({ index, id: `service-step-${requests.length}-${index}`, type: "function", function: { name: item.name, arguments: JSON.stringify(item.args) } })) }
      : call ? { role: "assistant", tool_calls: [{ index: 0, id: "core-tool-101", type: "function", function: { name: "calculate_position_scenarios", arguments: args } }] }
      : mode === "empty" ? { role: "assistant", content: "" } : { role: "assistant", content: reply ?? answerText };
    const chunk = { id: "fixture", object: "chat.completion.chunk", created: 0, model: String(payload.model) };
    const encode = (delta: unknown, finish_reason: string | null = null) => new TextEncoder().encode("data: " + JSON.stringify({ ...chunk, choices: [{ index: 0, delta, finish_reason }] }) + "\n\n");
    if (mode === "preparing" && call) return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(encode({ role: "assistant", tool_calls: [{ index: 0, id: "core-tool-101", type: "function", function: { name: "calculate_position_scenarios", arguments: "{" } }] }));
      releasePreparation = () => {
        controller.enqueue(encode({ tool_calls: [{ index: 0, function: { arguments: args.slice(1) } }] }));
        controller.enqueue(encode({}, "tool_calls")); controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); controller.close();
      };
    } }), { headers: { "Content-Type": "text/event-stream" } });
    const reasoning = mode === "thinking" ? Array.from({ length: 10 }, () => ({ ...chunk, choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "PROVIDER_THINKING_FIXTURE" }, finish_reason: null }] })) : [];
    if (mode === "tool-thinking") reasoning.push({ ...chunk, choices: [{ index: 0, delta: { role: "assistant", reasoning_content: call ? "先规划计算。" : "再核对结果。" }, finish_reason: null }] });
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
  await fixtureLifetime.drain(() => console.error("WHYJ_RESEARCH_PENDING " + JSON.stringify({
    test: fixtureName, phase: fixturePhase, modelRequests: requests.length,
  })));
  await host?.close(); await service?.close(); model.stop(true);
  host = undefined; service = undefined;
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (proxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = proxy;
  if (previousSkills === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previousSkills;
  if (previousLeaseRoot === undefined) delete process.env.WHYJ_RESOURCE_LEASE_ROOT; else process.env.WHYJ_RESOURCE_LEASE_ROOT = previousLeaseRoot;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected fixture root");
  rmSync(root, { recursive: true, force: true });
}, 30000);
async function terminal(client: WorkbenchClient, id: string): Promise<SessionSnapshot> {
  let lastState: SessionSnapshot["state"] | "unobserved" = "unobserved";
  for (let attempts = 0; attempts < 250; attempts++) { const value = await client.session(id); lastState = value.state; if (value.state !== "running") return value; await Bun.sleep(10); }
  throw new Error(`Expected a terminal run (phase=${fixturePhase}, lastState=${lastState}, modelRequests=${requests.length})`);
}
async function requestFor(client: WorkbenchClient, identity: { workspaceId: string; sessionId: string }, text: string) {
  return { workspaceId: identity.workspaceId, sessionId: identity.sessionId, text,
    requestId: randomUUID(), expectedRevision: (await client.session(identity.sessionId)).revision! };
}
async function legacyConversation(text: string) {
  const dependencies = createDefaultSessionDependencies({ cwd: root });
  const agent = createQuantResearchAgent({ cwd: root, dependencies });
  try {
    await agent.prompt(text); await agent.waitForIdle();
    const metadata = (await agent.getSessionMetadata())!;
    const assistant = structuredClone(agent.state.messages.find(message => message.role === "assistant")!);
    if (assistant.role !== "assistant") throw new Error("Missing legacy assistant fixture");
    return { metadata, assistant, bytes: readFileSync(metadata.path) };
  } finally { await dependencies.env.cleanup(); }
}
async function setup() {
  service = createWorkbenchService({ cwd: root }); const identity = await service.client.identity();
  return { client: service.client, identity, submit: async (text: string) => service!.client.submit(await requestFor(service!.client, identity, text)) };
}
function skillDependencies() {
  const dependencies = createDefaultSessionDependencies({ cwd: root });
  return { ...dependencies,
    readConnection: () => {
      const connection = dependencies.readConnection();
      return { ...connection, model: { ...connection.model, input: ["text", "image"] as ("text" | "image")[] } };
    },
    loadSkills: async () => [{ name: "host-fixture", description: "Host skill fixture", content: "Explain the supplied fixture without executing tools.",
      filePath: join(root, "SKILL.md"), sourcePath: root, source: "pi" as const, scope: "project" as const }],
  };
}
async function preparing(client: WorkbenchClient, id: string) {
  for (let attempt = 0; attempt < 250; attempt++) {
    const snapshot = await client.session(id);
    if (snapshot.turns[1]?.activity?.some(item => item.state === "preparing")) return snapshot;
    await Bun.sleep(10);
  }
  throw new Error("Expected a preparing tool before dispatch");
}

test("terminal queue binds the original run, deduplicates input and preserves private reference display", async () => {
  mode = "preparing";
  writeFileSync(join(root, "queue.txt"), "QUEUED_SOURCE_ONLY_FOR_MODEL");
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity();
  const run = await service.terminal.submit(await requestFor(client, identity, "Initial queue fixture"));
  try {
    await preparing(client, identity.sessionId);
    const input = { ...identity, runId: run.runId, requestId: "queue-once", text: "Queued original @file:queue.txt" };
    const receipts = await Promise.all([service.terminal.enqueue(input), service.terminal.enqueue(input)]);
    expect(receipts[0]).toEqual(receipts[1]); expect(receipts[0]?.mode).toBe("followUp");
    expect(receipts[0]?.runId).toBe(run.runId);
    await expect(service.terminal.enqueue({ ...input, text: "Changed" })).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
    await expect(service.terminal.enqueue({ ...input, requestId: "wrong-run", runId: "another-run" })).rejects.toMatchObject({ code: "QUEUE_CLOSED" });
    await expect(service.terminal.enqueue({ ...input, requestId: "bad", expectedRevision: 0 })).rejects.toMatchObject({ code: "INPUT_INVALID" });
    await expect(service.terminal.submit({ ...await requestFor(client, identity, "reuse queued ID"), requestId: input.requestId })).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
    const context = await service.terminal.context({ workspaceId: identity.workspaceId, sessionId: identity.sessionId });
    expect(context.composerQueue).toEqual([input.text]);
    expect(JSON.stringify(await client.session(identity.sessionId))).not.toContain(input.text);
    releasePreparation!(); releasePreparation = undefined;
    expect((await terminal(client, identity.sessionId)).identity.runId).toBe(run.runId);
    expect(requests).toHaveLength(3);
    expect(JSON.stringify(requests[2])).toContain("QUEUED_SOURCE_ONLY_FOR_MODEL");
    const done = await service.terminal.context({ workspaceId: identity.workspaceId, sessionId: identity.sessionId });
    expect(done.composerQueue).toEqual([]);
    expect(done.messages.filter(message => message.role === "user" && message.text === input.text)).toHaveLength(1);
    expect(JSON.stringify(done.messages)).not.toContain("QUEUED_SOURCE_ONLY_FOR_MODEL");
    expect(await service.terminal.enqueue(input)).toEqual(receipts[0]); // Receipt is stable after completion.
    await expect(service.terminal.enqueue({ ...input, requestId: "late" })).rejects.toMatchObject({ code: "QUEUE_CLOSED" });
  } finally { releasePreparation?.(); }
});

for (const cancel of [false, true]) test(`terminal queue steers the same Agent during a tool and ${cancel ? "clears on cancellation" : "is consumed in that run"}`, async () => {
  mode = "tool"; let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  service = createWorkbenchService({ cwd: root, dependencies: () => {
    const deps = createDefaultSessionDependencies({ cwd: root });
    return { ...deps, tools: deps.tools.map(tool => tool.name !== "calculate_position_scenarios" ? tool : { ...tool, async execute(...args: Parameters<typeof tool.execute>) {
      entered(); await gate; return tool.execute(...args);
    } }) };
  } });
  const client = service.client, identity = await client.identity();
  const run = await service.terminal.submit(await requestFor(client, identity, "Initial tool fixture"));
  try {
    await started;
    const receipt = await service.terminal.enqueue({ ...identity, runId: run.runId, requestId: "steer", text: "Steering fixture" });
    expect(receipt.mode).toBe("steer");
    expect((await service.terminal.context({ workspaceId: identity.workspaceId, sessionId: identity.sessionId })).composerQueue).toEqual(["Steering fixture"]);
    if (cancel) {
      const cancelling = client.cancel({ ...identity, runId: run.runId });
      await expect(service.terminal.enqueue({ ...identity, runId: run.runId, requestId: "after-stop", text: "Must reject" })).rejects.toMatchObject({ code: "QUEUE_CLOSED" });
      release(); await cancelling;
    } else {
      release(); expect((await terminal(client, identity.sessionId)).identity.runId).toBe(run.runId);
      expect(JSON.stringify(requests[1])).toContain("Steering fixture");
    }
    expect((await service.terminal.context({ workspaceId: identity.workspaceId, sessionId: identity.sessionId })).composerQueue).toEqual([]);
    expect(requests).toHaveLength(cancel ? 1 : 2);
  } finally { release(); }
});

test("terminal queue rejects ending core while failure persistence still holds the Host run", async () => {
  mode = "pure-failure"; toolSent = true;
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  service = createWorkbenchService({ cwd: root, dependencies: () => {
    const deps = createDefaultSessionDependencies({ cwd: root }), repository = deps.sessions;
    return { ...deps, sessions: { ...repository, open: repository.open.bind(repository), list: repository.list.bind(repository), async create(options) {
      const session = await repository.create(options), append = session.appendMessage.bind(session);
      session.appendMessage = async message => {
        if (message.role === "assistant" && message.stopReason === "error") { entered(); await gate; }
        return append(message);
      };
      return session;
    } } };
  } });
  const client = service.client, identity = await client.identity();
  const run = await service.terminal.submit(await requestFor(client, identity, "Failing core owner"));
  try {
    await started;
    expect((await client.session(identity.sessionId)).state).toBe("running");
    await expect(service.terminal.enqueue({ ...identity, runId: run.runId, requestId: "late-core", text: "Never acknowledge this" })).rejects.toMatchObject({ code: "QUEUE_CLOSED" });
    release(); expect((await terminal(client, identity.sessionId)).state).toBe("failed");
  } finally { release(); }
});

test("terminal queue reference work cannot retarget a later run after its original owner finishes", async () => {
  mode = "preparing"; let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const original = ComposerReferences.prototype.expand;
  const spy = spyOn(ComposerReferences.prototype, "expand").mockImplementation(async function(this: ComposerReferences, input: string, signal?: AbortSignal) {
    if (input === "Delayed queue") { entered(); await gate; }
    return original.call(this, input, signal);
  });
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity();
  const first = await service.terminal.submit(await requestFor(client, identity, "First owner"));
  let queued: Promise<unknown> | undefined;
  try {
    await preparing(client, identity.sessionId);
    queued = service.terminal.enqueue({ ...identity, runId: first.runId, requestId: "delayed", text: "Delayed queue" });
    void queued.catch(() => {}); await started;
    releasePreparation!(); releasePreparation = undefined; await terminal(client, identity.sessionId);
    mode = "hold";
    const second = await service.terminal.submit(await requestFor(client, identity, "Second owner"));
    expect(second.runId).not.toBe(first.runId);
    release(); await expect(queued).rejects.toMatchObject({ code: "QUEUE_CLOSED" });
    expect(JSON.stringify(requests)).not.toContain("Delayed queue");
    await client.cancel({ ...identity, runId: second.runId });
  } finally { release(); releasePreparation?.(); await queued?.catch(() => {}); spy.mockRestore(); }
});
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

test("terminal queue uses Host state in the real AppRuntime and drains without a second core session", async () => {
  mode = "preparing";
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity();
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, queues: string[][] = [], seen: UIMessage[][] = [];
  const runtime = new AppRuntime({ onMessages: messages => seen.push(messages), onActivity() {}, onComposerQueue: queue => queues.push(queue) },
    async () => [], async () => [], { host: connection }, undefined, undefined, 1000, 0);
  try {
    await runtime.bootstrap(); await runtime.submit("Initial AppRuntime queue fixture");
    const active = await preparing(client, identity.sessionId);
    await runtime.submit("Queued through original composer");
    expect(queues.at(-1)).toEqual(["Queued through original composer"]);
    expect((await client.session(identity.sessionId)).identity.runId).toBe(active.identity.runId);
    releasePreparation!(); releasePreparation = undefined;
    await terminal(client, identity.sessionId);
    for (let n = 0; n < 200 && (!seen.at(-1)?.some(message => message.role === "user" && message.text === "Queued through original composer") || queues.at(-1)?.length); n++) await Bun.sleep(10);
    expect(queues.at(-1)).toEqual([]);
    expect(seen.at(-1)?.filter(message => message.role === "user" && message.text === "Queued through original composer")).toHaveLength(1);
    expect(requests).toHaveLength(3);
    expect(readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"))).toHaveLength(1);
  } finally { releasePreparation?.(); await runtime.shutdown(); }
});

test("terminal queue cannot add local capability input to a browser-owned run", async () => {
  mode = "hold"; const { client, identity, submit } = await setup();
  const run = await submit("Browser-owned fixture");
  try {
    for (let n = 0; n < 100 && !requests.length; n++) await Bun.sleep(10);
    await expect(service!.terminal.enqueue({ ...identity, runId: run.runId, requestId: "must-not-escalate", text: "Local input" })).rejects.toMatchObject({ code: "QUEUE_CLOSED" });
    expect(requests).toHaveLength(1);
  } finally { await client.cancel({ ...identity, runId: run.runId }); }
});

test("terminal reference suggestions follow the selected journal and Host cwd without creating or rewriting research", async () => {
  mode = "tool";
  const { client, identity, submit } = await setup();
  await submit("First evidence owner"); await terminal(client, identity.sessionId);
  const store = createWorkbenchSessionStore(), firstCore = store.load(identity.workspaceId, identity.sessionId).record.coreSessionId!;
  const second = await client.createSession(); toolSent = false;
  await client.submit(await requestFor(client, second, "Second evidence owner")); await terminal(client, second.sessionId);
  const secondCore = store.load(identity.workspaceId, second.sessionId).record.coreSessionId!;
  const dependencies = createDefaultSessionDependencies({ cwd: root }), metadata = await dependencies.sessions.list();
  const originals = metadata.map(item => ({ path: item.path, bytes: readFileSync(item.path) })); await dependencies.env.cleanup();
  writeFileSync(join(root, "selected-reference.txt"), "Host-owned path fixture");
  const calls = requests.length;
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, remote = createTerminalClient(connection);
  const runtime = new AppRuntime({ onMessages() {}, onActivity() {} }, async () => [], async () => [], { host: connection }, undefined, undefined, 1000, 0);
  try {
    await runtime.bootstrap();
    const first = await runtime.getReferenceSuggestions("@evidence:calculate_position_scenarios");
    expect(first).toHaveLength(1); expect(first[0]?.fill).toContain(firstCore + "/");
    await runtime.submit(`/resume ${secondCore}`);
    const selected = await runtime.getReferenceSuggestions("@evidence:calculate_position_scenarios");
    expect(selected).toHaveLength(1); expect(selected[0]?.fill).toContain(secondCore + "/");
    expect(selected[0]?.fill).not.toContain(firstCore);
    expect(await runtime.getReferenceSuggestions("@file:selected-reference")).toContainEqual(expect.objectContaining({ kind: "file", fill: "@file:selected-reference.txt " }));
    const headers = { "content-type": "application/json", "x-workbench-token": connection.token };
    const input = { workspaceId: identity.workspaceId, sessionId: second.sessionId, input: "@evidence:" };
    expect((await fetch(connection.url + "/api/host/terminal", { method: "POST", headers, body: JSON.stringify({ instanceId: connection.instanceId, method: "suggestReferences", input }) })).status).toBe(403);
    expect((await fetch(connection.url + "/api/workbench/rpc", { method: "POST", headers, body: JSON.stringify({ method: "suggestReferences", args: [input] }) })).status).toBe(404);
    await expect(remote.references(second.sessionId, "@file:")).rejects.toThrow("暂未开放文件引用");
    await expect(remote.suggestReferences({ ...input, extra: "unsupported" } as typeof input)).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(requests).toHaveLength(calls);
    for (const original of originals) expect(readFileSync(original.path)).toEqual(original.bytes);
    expect(readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"))).toHaveLength(2);
  } finally { await runtime.shutdown(); }
});

test("terminal reference suggestions read the live owner and reject a run change while a query is pending", async () => {
  mode = "tool";
  service = createWorkbenchService({ cwd: root, dependencies: () => {
    const deps = createDefaultSessionDependencies({ cwd: root });
    return { ...deps, tools: deps.tools.map(tool => tool.name !== "calculate_position_scenarios" ? tool : { ...tool, async execute(...args: Parameters<typeof tool.execute>) {
      const result = await tool.execute(...args); mode = "hold"; return result;
    } }) };
  } });
  const client = service.client, identity = await client.identity();
  const run = await service.terminal.submit(await requestFor(client, identity, "Live evidence owner"));
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const original = ComposerReferences.prototype.suggest; let spy: ReturnType<typeof spyOn> | undefined;
  let reading: Promise<unknown> | undefined;
  try {
    for (let n = 0; n < 200 && requests.length < 2; n++) await Bun.sleep(10);
    const input = { workspaceId: identity.workspaceId, sessionId: identity.sessionId, input: "@evidence:calculate_position_scenarios" };
    const result = await service.terminal.suggestReferences(input);
    expect(result.runId).toBe(run.runId); expect(result.items).toHaveLength(1); expect(requests).toHaveLength(2);
    spy = spyOn(ComposerReferences.prototype, "suggest").mockImplementation(async function(this: ComposerReferences, input: string) {
      entered(); await gate; return original.call(this, input);
    });
    reading = service.terminal.suggestReferences(input); void reading.catch(() => {}); await started;
    await client.cancel({ ...identity, runId: run.runId });
    release(); await expect(reading).rejects.toMatchObject({ code: "CONTEXT_CHANGED" });
    expect(requests).toHaveLength(2);
  } finally { release(); await reading?.catch(() => {}); spy?.mockRestore(); await client.cancel({ ...identity, runId: run.runId }).catch(() => {}); }
});

test("shared AppRuntime renders the Host conversation and shutdown detaches without stopping its research", async () => {
  mode = "preparing";
  const { client, identity } = await setup();
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, seen: UIMessage[][] = [];
  let helpOpened = 0;
  const runtime = new AppRuntime({ onMessages: messages => seen.push(messages), onActivity: () => {}, onHelpRequest: () => { helpOpened++; } },
    async () => [], async () => [], { host: connection }, undefined, undefined, 1000, 0);
  try {
    await runtime.bootstrap(); expect(requests).toHaveLength(0);
    expect(createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record.coreSessionId).toBeNull();
    await runtime.submit("/help"); expect(helpOpened).toBe(1); expect(requests).toHaveLength(0);
    await runtime.submit("Run the shared fixture without starting another owner");
    await preparing(client, identity.sessionId);
    await Promise.race([runtime.shutdown(), Bun.sleep(2000).then(() => { throw new Error("View shutdown waited for Host research"); })]);
    const frames = seen.length;
    expect((await client.session(identity.sessionId)).state).toBe("running");
    releasePreparation!();
    expect((await terminal(client, identity.sessionId)).state).toBe("settled");
    await Bun.sleep(150); expect(seen).toHaveLength(frames);
    expect(readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"))).toHaveLength(1);
    const calls = requests.length;
    const resumed = new AppRuntime({ onMessages: messages => seen.push(messages), onActivity: () => {} },
      async () => [], async () => [], { host: connection }, undefined, undefined, 1000, 0);
    try {
      await resumed.bootstrap();
      expect(JSON.stringify(seen.at(-1))).toContain("Run the shared fixture");
      expect(JSON.stringify(seen.at(-1))).toContain("同一核心会话");
      expect(requests).toHaveLength(calls);
    } finally { await resumed.shutdown(); }
  } finally { await runtime.shutdown(); }
});

test("a local help panel does not mark an active shared research run ready", async () => {
  mode = "preparing";
  const { client, identity } = await setup();
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, activities: string[] = [];
  let helpOpened = 0;
  const runtime = new AppRuntime({ onMessages() {}, onActivity: value => activities.push(value), onHelpRequest: () => { helpOpened++; } },
    async () => [], async () => [], { host: connection }, undefined, undefined, 1000, 0);
  try {
    await runtime.bootstrap(); await runtime.submit("Keep this shared research running"); await preparing(client, identity.sessionId);
    for (let n = 0; n < 200 && !["thinking", "running tool"].includes(activities.at(-1) ?? ""); n++) await Bun.sleep(10);
    expect(["thinking", "running tool"]).toContain(activities.at(-1) ?? "");
    const calls = requests.length, activityCount = activities.length;
    await runtime.submit("/help");
    expect(helpOpened).toBe(1); expect((await client.session(identity.sessionId)).state).toBe("running");
    expect(activities.slice(activityCount)).not.toContain("ready");
    expect(["thinking", "running tool"]).toContain(activities.at(-1) ?? ""); expect(requests).toHaveLength(calls);
  } finally { releasePreparation?.(); await runtime.shutdown(); }
});

test("private annual export waits while the selected shared research is active", async () => {
  mode = "preparing";
  const { client, identity } = await setup();
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, statuses: string[] = [];
  const runtime = new AppRuntime({ onMessages() {}, onActivity() {}, onComposerStatus: value => { if (value?.text) statuses.push(value.text); } },
    async () => [], async () => [], { host: connection }, undefined, undefined, 1000, 0);
  const output = join(root, "private-export-must-not-exist.html");
  try {
    await runtime.bootstrap(); await runtime.submit("Keep this shared research running"); await preparing(client, identity.sessionId);
    for (let n = 0; n < 200 && (await client.session(identity.sessionId)).state !== "running"; n++) await Bun.sleep(10);
    await runtime.exportPrivateAnnual({ comparisonId: "missing", year: 2025, valuationCutoff: "2025-12-31",
      historyFile: join(root, "missing-private-history.json"), output, decisionIds: [] });
    expect(statuses.at(-1)).toContain("Wait for the current operation");
    expect(existsSync(output)).toBe(false); expect((await client.session(identity.sessionId)).state).toBe("running");
  } finally { releasePreparation?.(); await runtime.shutdown(); }
});

test("idle shared private annual export stays local and prevents a concurrent submission from its own view", async () => {
  const { client, identity } = await setup();
  const comparison = (await annualComparisonFixture()).save(), history = accountHistoryFixture();
  const endAt = Date.parse("2025-12-31T23:59:59.999Z");
  history.request.endAt = endAt; history.request.accountRef = "PRIVATE_SHARED_EXPORT_SENTINEL_982";
  history.valuations.at(-1)!.at = endAt; history.source.observedAt = endAt + 1000;
  const exportRoot = mkdtempSync(join(tmpdir(), "whyj-private-shared-"));
  const input = join(exportRoot, "private-history.json"), output = join(exportRoot, "private-annual.html");
  writeFileSync(input, JSON.stringify(history));
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, statuses: string[] = [], messages: string[] = [];
  const runtime = new AppRuntime({ onMessages: value => messages.push(JSON.stringify(value)), onActivity() {},
    onComposerStatus: value => { if (value?.text) statuses.push(value.text); } }, async () => [], async () => [], { host: connection }, undefined, undefined, 1000, 0);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  let spy: ReturnType<typeof spyOn> | undefined, operation: Promise<void> | undefined;
  try {
    await runtime.bootstrap(); await Bun.sleep(150);
    const before = await client.session(identity.sessionId);
    const original = service!.client.session.bind(service!.client);
    spy = spyOn(service!.client, "session").mockImplementation(async value => { entered(); await gate; return original(value); });
    const request = { comparisonId: comparison.id, year: 2025, valuationCutoff: "2025-12-31", historyFile: input, output, decisionIds: [] };
    operation = runtime.exportPrivateAnnual(request);
    await started;
    request.output = join(exportRoot, "changed-after-review.html");
    await runtime.submit("Do not start research during private export");
    expect(statuses.at(-1)).toContain("Wait for the current operation");
    await expect(runtime.submitResearch(structuredTask())).rejects.toThrow("ready, idle session");
    expect(requests).toHaveLength(0);
    release(); await operation;
    expect(await client.session(identity.sessionId)).toEqual(before);
    expect(statuses.at(-1)).toContain("Private annual HTML written");
    expect(readFileSync(output, "utf8")).toContain("PRIVATE_SHARED_EXPORT_SENTINEL_982");
    expect(existsSync(request.output)).toBe(false);
    expect(messages.join("\n")).not.toContain("PRIVATE_SHARED_EXPORT_SENTINEL_982");
    expect(statuses.join("\n")).not.toContain("PRIVATE_SHARED_EXPORT_SENTINEL_982");
    expect(JSON.stringify(await client.session(identity.sessionId))).not.toContain("PRIVATE_SHARED_EXPORT_SENTINEL_982");
    expect(requests).toHaveLength(0);
  } finally {
    release(); await operation?.catch(() => {}); spy?.mockRestore(); await runtime.shutdown();
    if (!resolve(exportRoot).startsWith(resolve(tmpdir()) + sep + "whyj-private-shared-")) throw new Error("Unexpected private export fixture path");
    rmSync(exportRoot, { recursive: true, force: true });
  }
});

test("private annual export refuses a late session confirmation after the view changes", async () => {
  const { client, identity } = await setup();
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, statuses: string[] = [];
  const runtime = new AppRuntime({ onMessages() {}, onActivity() {}, onComposerStatus: value => { if (value?.text) statuses.push(value.text); } },
    async () => [], async () => [], { host: connection }, undefined, undefined, 1000, 0);
  let release!: () => void, entered!: () => void, first = true;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const output = join(root, "must-not-write-private.html");
  let spy: ReturnType<typeof spyOn> | undefined, operation: Promise<void> | undefined;
  try {
    await runtime.bootstrap(); await Bun.sleep(150);
    const original = service!.client.session.bind(service!.client);
    spy = spyOn(service!.client, "session").mockImplementation(async value => { if (first) { first = false; entered(); await gate; } return original(value); });
    operation = runtime.exportPrivateAnnual({ comparisonId: "missing", year: 2025, valuationCutoff: "2025-12-31",
      historyFile: join(root, "not-read.json"), output, decisionIds: [] });
    await started; await runtime.submit("/clear"); release(); await operation;
    expect(statuses.at(-1)).toContain("Selected session changed"); expect(existsSync(output)).toBe(false);
    expect((await client.workspaces()).some(item => item.sessionId !== identity.sessionId)).toBe(true);
    expect(requests).toHaveLength(0);
  } finally { release(); await operation?.catch(() => {}); spy?.mockRestore(); await runtime.shutdown(); }
});

test("shared AppRuntime opens the original resume panel and selects history without another model call", async () => {
  const legacy = await legacyConversation("History selected from the terminal panel");
  const { client, identity } = await setup();
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, panels: Array<CurrentSessionMeta | undefined> = [], seen: UIMessage[][] = [];
  const runtime = new AppRuntime({ onMessages: messages => seen.push(messages), onActivity: () => {},
    onResumeRequest: meta => panels.push(meta) }, async () => [], async () => [], { host: connection }, undefined, undefined, 1000, 0);
  const calls = requests.length;
  try {
    await runtime.bootstrap();
    await runtime.submit("/resume"); await Bun.sleep(20);
    expect(panels).toHaveLength(1); expect(panels[0]).toBeUndefined();
    await runtime.submit(`/resume ${legacy.metadata.id}`);
    await runtime.submit("/session"); await Bun.sleep(150);
    expect(panels.at(-1)).toMatchObject({ id: legacy.metadata.id, createdAt: legacy.metadata.createdAt,
      // The journal retains displayUser, provider user and assistant entries.
      entryCount: { messages: 3, compactions: 0, branches: 0 } });
    expect(JSON.stringify(seen.at(-1))).toContain("History selected from the terminal panel");
    await runtime.submit("/resume missing-session"); await runtime.submit("/resume");
    await Bun.sleep(20); expect(panels.at(-1)?.id).toBe(legacy.metadata.id);
    await runtime.submit("/clear"); await runtime.submit("/resume"); await Bun.sleep(150);
    expect(panels).toHaveLength(4);
    expect(panels.at(-1)).toBeUndefined();
    expect((await client.session(identity.sessionId)).state).toBe("idle");
    expect(readFileSync(legacy.metadata.path)).toEqual(legacy.bytes);
    expect(requests).toHaveLength(calls);
  } finally { await runtime.shutdown(); }
});

test("terminal skill management lists, selects and reloads cached skills without creating research", async () => {
  const cache = join(root, "skills", "LLMQuant-skills", "skills", "llmquant-data"), path = join(cache, "SKILL.md");
  mkdirSync(cache, { recursive: true }); writeFileSync(path, "---\nname: llmquant-data\ndescription: First managed fixture\n---\nPRIVATE_FIXTURE_SKILL");
  const { client, identity } = await setup(), command = async (text: string) => service!.terminal.command(await requestFor(client, identity, text));
  expect((await command("/skill catalog")).result.success).toBe(true);
  expect((await command("/skill install llmquant-data")).result.success).toBe(true);
  const info = await command("/skill info llmquant-data"); expect(info.result.message).toContain("First managed fixture");
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const runtime = new AppRuntime({ onMessages: () => {}, onActivity: () => {} }, async () => [], async () => [],
    { host: { ...await host.ready, started: false } }, undefined, undefined, 1000, 0);
  try {
    expect(await runtime.getSkillSuggestions()).toContainEqual({ name: "llmquant-data", description: "First managed fixture", scope: "project" });
    writeFileSync(path, "---\nname: llmquant-data\ndescription: Updated managed fixture\n---\nPRIVATE_FIXTURE_SKILL");
    expect((await command("/skill reload")).result.success).toBe(true);
    expect((await command("/skill info llmquant-data")).result.message).toContain("Updated managed fixture");
    expect((await command("/skill remove llmquant-data")).result.success).toBe(true);
    expect((await command("/skill info llmquant-data")).result.success).toBe(false);
    expect((await runtime.getSkillSuggestions()).some(skill => skill.name === "llmquant-data")).toBe(false);
    expect(readFileSync(path, "utf8")).toContain("PRIVATE_FIXTURE_SKILL");
    expect((await command("/skill install llmquant-data")).result.success).toBe(true);
    expect(createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record.coreSessionId).toBeNull();
    expect(requests).toHaveLength(0);
  } finally { await runtime.shutdown(); }
});

test("a skill listing in one workspace excludes mutation of the shared catalog in another", async () => {
  const cache = join(root, "skills", "LLMQuant-skills", "skills", "llmquant-data");
  mkdirSync(cache, { recursive: true }); writeFileSync(join(cache, "SKILL.md"), "---\nname: llmquant-data\ndescription: Shared fixture\n---\nfixture");
  const { client, identity } = await setup();
  const other = createWorkbenchService({ cwd: root, workspaceId: "2".repeat(24) });
  const otherIdentity = await other.client.identity(), original = TerminalEnvironment.prototype.catalog;
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  TerminalEnvironment.prototype.catalog = async function(...args) { entered(); await gate; return original.apply(this, args); };
  const reading = service!.terminal.command(await requestFor(client, identity, "/skill list"));
  try {
    await reached;
    await expect(other.terminal.command(await requestFor(other.client, otherIdentity, "/skill remove llmquant-data")))
      .rejects.toMatchObject({ code: "RESOURCES_IN_USE" });
    expect(existsSync(join(root, "skills", ".selection.json"))).toBe(false);
    release(); expect((await reading).result.success).toBe(true);
    expect((await other.terminal.command(await requestFor(other.client, otherIdentity, "/skill remove llmquant-data"))).result.success).toBe(true);
    expect(JSON.parse(readFileSync(join(root, "skills", ".selection.json"), "utf8"))["LLMQuant-skills"]).toEqual([]);
  } finally { release(); await reading.catch(() => {}); TerminalEnvironment.prototype.catalog = original; await other.close(); }
});

test("a separate resource writer excludes a skill listing until released", async () => {
  const { client, identity } = await setup(), release = await acquireResourceLeases([join(root, "skills")], "write");
  try {
    await expect(service!.terminal.command(await requestFor(client, identity, "/skill list")))
      .rejects.toMatchObject({ code: "RESOURCES_IN_USE" });
  } finally { await release(); }
  expect((await service!.terminal.command(await requestFor(client, identity, "/skill list"))).result.success).toBe(true);
  expect(requests).toHaveLength(0);
});

test("a terminal compact in one workspace excludes shared skill mutation in another", async () => {
  phase("compact-fixture-setup");
  const cache = join(root, "skills", "LLMQuant-skills", "skills", "llmquant-data");
  mkdirSync(cache, { recursive: true }); writeFileSync(join(cache, "SKILL.md"), "---\nname: llmquant-data\ndescription: Shared fixture\n---\nfixture");
  const { client, identity } = await setup();
  phase("compact-submit-initial"); await service!.terminal.submit(await requestFor(client, identity, "Create a synthetic session before compact"));
  phase("compact-wait-initial");
  expect((await terminal(client, identity.sessionId)).state).toBe("settled");
  const other = createWorkbenchService({ cwd: root, workspaceId: "3".repeat(24) });
  const otherIdentity = await other.client.identity(), original = TerminalEnvironment.prototype.dependencies;
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  TerminalEnvironment.prototype.dependencies = async function(...args) { entered(); await gate; return original.apply(this, args); };
  phase("compact-start-command"); const compact = service!.terminal.command(await requestFor(client, identity, "/compact"));
  try {
    phase("compact-wait-dependencies"); await reached;
    phase("compact-check-resource-exclusion");
    await expect(other.terminal.command(await requestFor(other.client, otherIdentity, "/skill remove llmquant-data")))
      .rejects.toMatchObject({ code: "RESOURCES_IN_USE" });
    expect(existsSync(join(root, "skills", ".selection.json"))).toBe(false);
    phase("compact-release-and-complete"); release(); await compact;
    phase("compact-check-mutation-after-release");
    expect((await other.terminal.command(await requestFor(other.client, otherIdentity, "/skill remove llmquant-data"))).result.success).toBe(true);
  } finally { release(); await compact.catch(() => {}); TerminalEnvironment.prototype.dependencies = original; await other.close(); }
});

test("terminal extension management reuses the Host registry and protects research in other views", async () => {
  const { client, identity } = await setup();
  const command = async (text: string) => service!.terminal.command(await requestFor(client, identity, text));
  expect((await command("/config --extensions list")).result.message).toContain("whyj.core 1.0.0 · enabled");
  expect((await command("/config --extensions disable whyj.core")).result.success).toBe(true);
  expect(readSettings().disabledExtensions).toContain("whyj.core");
  expect(createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record.coreSessionId).toBeNull();
  expect(requests).toHaveLength(0);
  mode = "hold";
  const run = await service!.terminal.submit(await requestFor(client, identity, "The disabled extension must not supply tools"));
  for (let n = 0; n < 200 && !requests.length; n++) await Bun.sleep(10);
  expect(JSON.stringify(requests[0]?.tools)).not.toContain("calculate_position_scenarios");
  const other = await client.createSession();
  await expect(service!.terminal.command(await requestFor(client, other, "/config --extensions enable whyj.core")))
    .rejects.toMatchObject({ code: "RESOURCES_IN_USE" });
  await expect(service!.terminal.command(await requestFor(client, other, "/skill reload"))).rejects.toMatchObject({ code: "RESOURCES_IN_USE" });
  expect((await service!.terminal.command(await requestFor(client, other, "/skill list"))).result.success).toBe(true);
  expect((await service!.terminal.command(await requestFor(client, other, "/config --extensions list"))).result.success).toBe(true);
  expect((await client.session(identity.sessionId)).state).toBe("running");
  await client.cancel({ workspaceId: identity.workspaceId, ...run });
  expect((await command("/config --extensions enable whyj.core")).result.success).toBe(true);
  expect((await command("/config --extensions reload whyj.core")).result.success).toBe(true);
  mode = "answer";
  await service!.terminal.submit(await requestFor(client, identity, "Enabled tools are available in the same journal"));
  await terminal(client, identity.sessionId);
  expect(JSON.stringify(requests.at(-1)?.tools)).toContain("calculate_position_scenarios");
  expect(readSettings().disabledExtensions).not.toContain("whyj.core");
});

test("a pending terminal resource change excludes new owners and cancellation cannot apply it later", async () => {
  const { client, identity } = await setup(), other = await client.createSession();
  const original = TerminalEnvironment.prototype.manage;
  let entered!: () => void, release!: () => void, calls = 0;
  const reached = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  TerminalEnvironment.prototype.manage = async function(...args) { calls++; entered(); await gate; return original.apply(this, args); };
  const input = await requestFor(client, identity, "/config --extensions disable whyj.core");
  const pending = service!.terminal.command(input), result = pending.catch(error => error);
  try {
    await reached;
    const duplicate = service!.terminal.command(input).catch(error => error);
    await expect(service!.terminal.submit(await requestFor(client, other, "Must wait for resource change"))).rejects.toMatchObject({ code: "RESOURCES_BUSY" });
    await expect(client.submit(await requestFor(client, other, "Browser must not race resource change"))).rejects.toMatchObject({ code: "RESOURCES_BUSY" });
    await expect(service!.terminal.command(await requestFor(client, other, "/compact"))).rejects.toMatchObject({ code: "RESOURCES_BUSY" });
    const cancelling = service!.terminal.cancelCommand({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, requestId: input.requestId });
    release(); await cancelling;
    expect(await result).toMatchObject({ code: "COMMAND_CANCELLED" });
    expect(await duplicate).toMatchObject({ code: "COMMAND_CANCELLED" }); expect(calls).toBe(1);
    expect(readSettings().disabledExtensions ?? []).not.toContain("whyj.core");
    expect(requests).toHaveLength(0);
    expect((await service!.terminal.command(await requestFor(client, other, "/config --extensions list"))).result.success).toBe(true);
  } finally { release(); await result; TerminalEnvironment.prototype.manage = original; }
});

test("terminal MCP configuration uses the selected workspace and retains its existing config", async () => {
  const prior = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = join(root, "isolated-pi");
  try {
    const { client, identity } = await setup(), command = async (text: string) => service!.terminal.command(await requestFor(client, identity, text));
    expect((await command("/mcp install tushare --local")).result.success).toBe(true);
    const path = join(root, ".pi", "mcp.json"), first = readFileSync(path);
    expect(first.toString()).toContain("YOUR_TUSHARE_TOKEN");
    expect((await command("/mcp install tushare --local")).result.message).toContain("Kept existing tushare");
    expect(readFileSync(path)).toEqual(first);
    expect((await command("/mcp list --local")).result.message).toContain("tushare [configured]");
    expect((await command("/mcp remove tushare --local")).result.success).toBe(true);
    expect((await command("/mcp list --local")).result.message).toContain("tushare [available]");
    expect(createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record.coreSessionId).toBeNull();
    expect(requests).toHaveLength(0);
  } finally { if (prior === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = prior; }
});

test("project MCP Host commands do not read user configuration during another writer", async () => {
  const previousPi = process.env.PI_CODING_AGENT_DIR, pi = join(root, "isolated-pi"); process.env.PI_CODING_AGENT_DIR = pi;
  try {
    const { client, identity } = await setup(), writer = await acquireResourceLeases([pi], "write");
    try {
      for (const text of ["/mcp list --local", "/mcp install tushare --local"]) {
        await expect(service!.terminal.command(await requestFor(client, identity, text))).rejects.toMatchObject({ code: "RESOURCES_IN_USE" });
        expect(existsSync(join(root, ".pi", "mcp.json"))).toBe(false);
      }
    } finally { await writer(); }
    expect((await service!.terminal.command(await requestFor(client, identity, "/mcp list --local"))).result.success).toBe(true);
    expect((await service!.terminal.command(await requestFor(client, identity, "/mcp install tushare --local"))).result.success).toBe(true);
  } finally { if (previousPi === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousPi; }
});

test("shared AppRuntime retains management output across context refresh and clears it with the selected view", async () => {
  const { identity } = await setup();
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const seen: UIMessage[][] = [], runtime = new AppRuntime({ onMessages: messages => seen.push(messages), onActivity: () => {} },
    async () => [], async () => [], { host: { ...await host.ready, started: false } }, undefined, undefined, 1000, 0);
  try {
    await runtime.bootstrap(); await runtime.submit("/config --extensions list"); await Bun.sleep(150);
    expect(JSON.stringify(seen.at(-1))).toContain("whyj.core 1.0.0");
    await runtime.submit("/mcp export tushare"); await Bun.sleep(150);
    expect(JSON.stringify(seen.at(-1))).toContain("mcpServers");
    expect(JSON.stringify(seen.at(-1))).toContain("whyj.core 1.0.0");
    await runtime.submit("/clear"); await Bun.sleep(150);
    expect(seen.at(-1)).toEqual([]);
    expect(createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record.coreSessionId).toBeNull();
    expect(requests).toHaveLength(0);
  } finally { await runtime.shutdown(); }
});

test("shared AppRuntime skill shutdown leaves the command owned by Host and an explicit interrupt cancels only the selected run", async () => {
  mode = "hold-thinking";
  service = createWorkbenchService({ cwd: root, dependencies: skillDependencies });
  const client = service.client, identity = await client.identity();
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, seen: UIMessage[][] = [];
  const runtime = new AppRuntime({ onMessages: messages => seen.push(messages), onActivity: () => {} },
    async () => [], async () => [], { host: connection }, undefined, undefined, 1000, 0);
  let pending: Promise<unknown> | undefined;
  try {
    await runtime.bootstrap(); pending = runtime.submit("/skill run host-fixture Keep the Host alive");
    for (let n = 0; n < 200 && !JSON.stringify(seen.at(-1)).includes("PRIVATE_REASONING_NOT_FOR_UI"); n++) await Bun.sleep(10);
    expect(JSON.stringify(seen.at(-1))).toContain("PRIVATE_REASONING_NOT_FOR_UI");
    const run = (await client.session(identity.sessionId)).identity;
    await Promise.race([runtime.shutdown(), Bun.sleep(2000).then(() => { throw new Error("View shutdown cancelled or waited for a skill"); })]);
    expect((await client.session(identity.sessionId)).state).toBe("running");
    const other = await client.createSession(), independent = await client.submit(await requestFor(client, other, "A different active run"));
    const observer = new AppRuntime({ onMessages: () => {}, onActivity: () => {} }, async () => [], async () => [], { host: connection }, undefined, undefined, 1000, 0);
    try {
      await observer.bootstrap(); expect(await observer.interruptResearch()).toBe(true); await pending;
      expect((await client.session(identity.sessionId)).state).toBe("cancelled");
      expect((await client.session(other.sessionId)).state).toBe("running");
      expect((await client.session(identity.sessionId)).identity.runId).toBe(run.runId);
      await client.cancel({ workspaceId: connection.workspaceId, ...independent });
    } finally { await observer.shutdown(); }
  } finally { await runtime.shutdown(); await service.close(); await pending; }
});

test("terminal clear stops only its source run, selects a fresh view and preserves the old journal", async () => {
  mode = "hold";
  const { client, identity } = await setup();
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const remote = createTerminalClient({ ...await host.ready, started: false });
  const run = await remote.submit(await requestFor(remote, identity, "Original research retained after clear"));
  for (let n = 0; n < 200 && requests.length === 0; n++) await Bun.sleep(10);
  const other = await remote.createSession(), independent = await remote.submit(await requestFor(remote, other, "Another view keeps its run"));
  const oldCore = createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record.coreSessionId;
  const input = await requestFor(remote, identity, '/"clear"');
  const receipt = await remote.command(input);
  expect(receipt.result.success).toBe(true); expect(receipt.selectedSessionId).not.toBe(identity.sessionId);
  expect(await remote.command(input)).toEqual(receipt); expect(await remote.workspaces()).toHaveLength(3);
  expect((await remote.session(identity.sessionId)).state).toBe("cancelled");
  expect((await remote.session(identity.sessionId)).identity.runId).toBe(run.runId);
  expect((await remote.session(other.sessionId)).state).toBe("running");
  const next = await remote.session(receipt.selectedSessionId!);
  expect(next.turns).toEqual([]); expect(next.identity.runId).toBeNull();
  expect(createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record.coreSessionId).toBe(oldCore);
  expect(JSON.stringify((await remote.context(identity)).messages)).toContain("Original research retained");
  mode = "answer";
  await remote.submit(await requestFor(remote, next.identity, "A genuinely new conversation"));
  expect((await terminal(client, next.identity.sessionId)).state).toBe("settled");
  expect(JSON.stringify(requests.at(-1)?.messages)).not.toContain("Original research retained");
  await remote.cancel({ workspaceId: identity.workspaceId, ...independent });
});

test("terminal references expand in the Host while browser references are rejected before model dispatch", async () => {
  const content = "PRIVATE_REFERENCE_CONTENT\n" + "Reference data. ".repeat(2000);
  const file = join(root, "research-notes.txt"); writeFileSync(file, content);
  const { client, identity } = await setup();
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const remote = createTerminalClient({ ...await host.ready, started: false });
  const text = "Explain @file:research-notes.txt without calling tools.";
  await remote.submit(await requestFor(client, identity, text));
  const completed = await terminal(client, identity.sessionId);
  expect(completed.state).toBe("settled"); expect(requests).toHaveLength(1);
  expect(JSON.stringify(requests[0]?.messages)).toContain("PRIVATE_REFERENCE_CONTENT");
  expect(JSON.stringify(requests[0]?.messages).length).toBeGreaterThan(16000);
  expect(completed.turns[0]?.text).toBe(text); expect(JSON.stringify(completed)).not.toContain("PRIVATE_REFERENCE_CONTENT");
  const context = await remote.context(identity);
  expect(context.messages).toContainEqual({ role: "user", text });
  expect(JSON.stringify(context.messages)).not.toContain("PRIVATE_REFERENCE_CONTENT");
  const dependencies = createDefaultSessionDependencies({ cwd: root });
  try {
    const metadata = (await dependencies.sessions.list()).find(item => item.id === context.coreSessionId)!;
    expect(readFileSync(metadata.path, "utf8")).toContain("PRIVATE_REFERENCE_CONTENT");
  } finally { await dependencies.env.cleanup(); }
  const browser = await client.createSession();
  await expect(client.submit(await requestFor(client, browser, text))).rejects.toMatchObject({ code: "REFERENCE_UNAVAILABLE" });
  expect(requests).toHaveLength(1); expect((await client.session(browser.sessionId)).turns).toHaveLength(0);
  expect(readFileSync(file, "utf8")).toBe(content);
});

test("missing terminal references fail before model dispatch and do not poison a later request", async () => {
  const { client, identity } = await setup();
  await service!.terminal.submit(await requestFor(client, identity, "Explain @file:missing-reference.txt"));
  expect((await terminal(client, identity.sessionId)).state).toBe("failed"); expect(requests).toHaveLength(0);
  await service!.terminal.submit(await requestFor(client, identity, "An explicit independent prompt"));
  expect((await terminal(client, identity.sessionId)).state).toBe("settled"); expect(requests).toHaveLength(1);
  expect(JSON.stringify(requests[0]?.messages)).not.toContain("missing-reference.txt");
});

test("terminal skill images use the original handler and journal without replaying pixels or duplicate requests", async () => {
  service = createWorkbenchService({ cwd: root, dependencies: skillDependencies });
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, remote = createTerminalClient(connection), identity = await remote.identity();
  const pixels = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=";
  const chart = join(root, "fixture chart.png"); writeFileSync(chart, Buffer.from(pixels, "base64"));
  const input = await requestFor(remote, identity, `/skill run host-fixture --image "${chart}" Explain the fixture`);
  const receipt = await remote.command(input);
  expect(receipt.result.success).toBe(true); expect(receipt.result.message).toContain("Running host-fixture");
  expect(await remote.command(input)).toEqual(receipt); expect(requests).toHaveLength(1);
  expect(JSON.stringify(requests[0])).toContain(`data:image/png;base64,${pixels}`);
  expect(JSON.stringify(requests[0])).toContain("Explain the fixture");
  const snapshot = await remote.session(identity.sessionId), context = await remote.context(identity);
  expect(snapshot.state).toBe("settled"); expect(snapshot.turns[0]?.text).toBe("SKILL.host-fixture");
  expect(JSON.stringify(snapshot)).not.toContain(pixels); expect(JSON.stringify(context)).not.toContain(pixels);
  const files = readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"));
  expect(files).toHaveLength(1);
  const journal = readFileSync(join(root, "sessions", String(files[0])), "utf8");
  expect(journal).toContain("sha256"); expect(journal).not.toContain(pixels);
  await expect(remote.submit(input)).rejects.toThrow("请求标识已用于终端命令");
  await remote.submit(await requestFor(remote, identity, "An independent text-only turn"));
  expect((await terminal(remote, identity.sessionId)).state).toBe("settled");
  expect((await remote.context(identity)).coreSessionId).toBe(context.coreSessionId);
  expect(JSON.stringify(requests.at(-1))).not.toContain(pixels);
});

test("terminal skill validation and missing images never dispatch a model or poison the next command", async () => {
  service = createWorkbenchService({ cwd: root, dependencies: skillDependencies });
  const client = service.client, identity = await client.identity();
  const malformed = await service.terminal.command(await requestFor(client, identity, "/skill run host-fixture --unsupported yes"));
  expect(malformed.result.success).toBe(false);
  expect(createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record.coreSessionId).toBeNull();
  const unknown = await service.terminal.command(await requestFor(client, identity, "/skill run nonexistent-fixture"));
  expect(unknown.result).toMatchObject({ success: false, message: expect.stringContaining("Unknown skill") });
  const missing = await service.terminal.command(await requestFor(client, identity, `/skill:host-fixture --image "${join(root, "missing.png")}"`));
  expect(missing.result.success).toBe(false); expect((await client.session(identity.sessionId)).state).toBe("failed");
  expect(requests).toHaveLength(0);
  const recovered = await service.terminal.command(await requestFor(client, identity, "/skill trigger host-fixture Recover normally"));
  expect(recovered.result.success).toBe(true); expect(requests).toHaveLength(1);
  expect(JSON.stringify(requests[0])).not.toContain("missing.png");
});

test("detaching a terminal skill view preserves execution and exact run cancellation leaves other sessions running", async () => {
  mode = "hold-thinking";
  service = createWorkbenchService({ cwd: root, dependencies: skillDependencies });
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, remote = createTerminalClient(connection);
  const view = await openTerminalSession(connection, { onSnapshot: () => {} });
  const identity = view.snapshot!.identity;
  const pending = view.command("/skill:host-fixture Keep running").then(result => ({ result }), error => ({ error }));
  try {
    for (let n = 0; n < 200 && !(await remote.session(identity.sessionId)).turns.some(turn => turn.phase === "thinking"); n++) await Bun.sleep(10);
    const context = await remote.context(identity);
    expect(context.thinkingText).toContain("PRIVATE_REASONING_NOT_FOR_UI");
    const run = (await remote.session(identity.sessionId)).identity;
    await view.detach(); expect((await remote.session(identity.sessionId)).state).toBe("running");
    const other = await remote.createSession(), independent = await remote.submit(await requestFor(remote, other, "Independent active research"));
    await expect(remote.cancel({ ...identity, runId: independent.runId })).rejects.toThrow("未找到");
    await remote.cancel({ ...run, runId: run.runId! });
    const result = await pending;
    expect(result).toMatchObject({ result: { result: { success: false } } });
    expect((await remote.session(identity.sessionId)).state).toBe("cancelled");
    expect((await remote.session(other.sessionId)).state).toBe("running");
    await remote.cancel({ workspaceId: connection.workspaceId, ...independent });
  } finally { await view.detach(); await service.close(); await pending; }
});

test("terminal skill final checkpoint failure cannot return success or replay a duplicate command", async () => {
  const store = createWorkbenchSessionStore();
  service = createWorkbenchService({ cwd: root, dependencies: skillDependencies, store: { ...store, async save(record, revision) {
    if (record.snapshot.state === "settled") throw new Error("Controlled final skill checkpoint failure");
    return store.save(record, revision);
  } } });
  const client = service.client, identity = await client.identity();
  const input = await requestFor(client, identity, "/skill run host-fixture Persist the fixture answer");
  await expect(service.terminal.command(input)).rejects.toMatchObject({ code: "SESSION_STORAGE" });
  await expect(service.terminal.command(input)).rejects.toMatchObject({ code: "SESSION_STORAGE" });
  expect(requests).toHaveLength(1);
  expect(store.load(identity.workspaceId, identity.sessionId).record.snapshot.state).toBe("running");
  const files = readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"));
  expect(files).toHaveLength(1);
  expect(readFileSync(join(root, "sessions", String(files[0])), "utf8")).toContain("Persist the fixture answer");
});

for (const shutdown of [false, true]) test(`terminal skill ${shutdown ? "shutdown" : "command cancellation"} drains its owned run`, async () => {
  mode = "hold";
  service = createWorkbenchService({ cwd: root, dependencies: skillDependencies });
  const client = service.client, identity = await client.identity();
  const input = await requestFor(client, identity, "/skill run host-fixture Wait for cancellation");
  const pending = service.terminal.command(input).catch(error => error);
  for (let n = 0; n < 200 && requests.length === 0; n++) await Bun.sleep(10);
  expect(requests).toHaveLength(1);
  await expect(service.terminal.command(await requestFor(client, identity, "/skill run host-fixture Concurrent invocation"))).rejects.toMatchObject({ code: "SESSION_BUSY" });
  const target = { workspaceId: identity.workspaceId, sessionId: identity.sessionId, requestId: input.requestId };
  if (shutdown) await Promise.race([service.close(), Bun.sleep(2000).then(() => { throw new Error("Skill shutdown did not drain"); })]);
  else {
    await expect(service.terminal.cancelCommand({ ...target, sessionId: randomUUID() })).rejects.toMatchObject({ code: "COMMAND_NOT_FOUND" });
    expect((await client.session(identity.sessionId)).state).toBe("running");
    await service.terminal.cancelCommand(target);
  }
  expect(await pending).toMatchObject({ code: "COMMAND_CANCELLED" });
  expect((await client.session(identity.sessionId)).state).toBe("cancelled");
  if (!shutdown) {
    const next = await client.submit(await requestFor(client, identity, "A later independent run"));
    await service.terminal.cancelCommand(target);
    expect((await client.session(identity.sessionId)).state).toBe("running");
    await client.cancel({ workspaceId: identity.workspaceId, ...next });
  }
});

test("an echoed private control capability never reaches ordinary browser snapshots or events", async () => {
  service = createWorkbenchService({ cwd: root });
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const registration = await host.ready, client = service.client, identity = await client.identity();
  answerText = "A local tool result echoed " + registration.controlToken;
  const headers = { "x-workbench-token": registration.token };
  const events = await fetch(host.server.url + "api/workbench/events", { headers });
  const reader = events.body!.getReader(), decoder = new TextDecoder();
  try {
    await reader.read(); // ready
    const input = await requestFor(client, identity, "Only a synthetic capability echo.");
    await service.terminal.submit(input);
    await terminal(client, identity.sessionId);
    const snapshot = await fetch(host.server.url + "api/workbench/rpc", { method: "POST", headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ method: "session", args: [identity.sessionId] }) });
    const body = await snapshot.text();
    expect(body).toContain("[REDACTED]"); expect(body).not.toContain(registration.controlToken);
    let stream = "";
    for (let n = 0; n < 10 && !stream.includes("[REDACTED]"); n++) stream += decoder.decode((await reader.read()).value);
    expect(stream).toContain("[REDACTED]"); expect(stream).not.toContain(registration.controlToken);
  } finally { await reader.cancel(); reader.releaseLock(); }
});

test("terminal resume imports the original legacy journal once, excludes private reasoning and never calls a model while selecting", async () => {
  mode = "thinking";
  const legacy = await legacyConversation("旧终端中的 SPY 研究");
  expect(legacy.bytes.toString()).toContain("PROVIDER_THINKING_FIXTURE");
  const count = requests.length;
  service = createWorkbenchService({ cwd: root });
  const client = service.client, identity = await client.identity(), other = await client.createSession();
  const [first, second] = await Promise.all([
    service.terminal.command(await requestFor(client, identity, `/resume ${legacy.metadata.id}`)),
    service.terminal.command(await requestFor(client, other, `/session ${legacy.metadata.id}`)),
  ]);
  expect(first.result.message).toContain("Resumed"); expect(first.selectedSessionId).toBe(second.selectedSessionId);
  expect(await client.workspaces()).toHaveLength(3);
  const imported = await client.session(first.selectedSessionId!);
  expect(imported.state).toBe("idle"); expect(imported.identity.runId).toBeNull();
  expect(imported.turns.map(turn => turn.role)).toEqual(["user", "assistant"]);
  expect(JSON.stringify(imported)).toContain("旧终端中的 SPY 研究");
  expect(JSON.stringify(imported)).not.toContain(KEY); expect(JSON.stringify(imported)).not.toContain("PROVIDER_THINKING_FIXTURE");
  expect(JSON.stringify(imported)).not.toContain(legacy.metadata.path);
  expect(requests).toHaveLength(count); expect(readFileSync(legacy.metadata.path)).toEqual(legacy.bytes);
  expect(createWorkbenchSessionStore().load(identity.workspaceId, imported.identity.sessionId).record).toMatchObject({ coreSessionId: legacy.metadata.id, runCount: 0 });
  await service.close(); service = createWorkbenchService({ cwd: root });
  const repeated = await service.terminal.command(await requestFor(service.client, identity, `/resume ${legacy.metadata.id}`));
  expect(repeated.selectedSessionId).toBe(first.selectedSessionId); expect(await service.client.workspaces()).toHaveLength(3);
  expect(await service.client.session(imported.identity.sessionId)).toEqual(imported); expect(requests).toHaveLength(count);
  mode = "answer";
  await service.client.submit(await requestFor(service.client, imported.identity, "明确继续旧上下文"));
  expect((await terminal(service.client, imported.identity.sessionId)).state).toBe("settled");
  expect(JSON.stringify(requests.at(-1)?.messages)).toContain("旧终端中的 SPY 研究");
  expect(readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"))).toHaveLength(1);
  const last = await service.client.session(imported.identity.sessionId), calls = requests.length;
  await service.client.deleteSession!({ workspaceId: identity.workspaceId, sessionId: last.identity.sessionId, expectedRevision: last.revision! });
  const reopened = await service.terminal.command(await requestFor(service.client, identity, `/resume ${legacy.metadata.id}`));
  expect(reopened.selectedSessionId).not.toBe(last.identity.sessionId);
  expect((await service.client.session(reopened.selectedSessionId!)).turns.map(turn => turn.text).join("\n")).toContain("明确继续旧上下文");
  expect(requests).toHaveLength(calls);
});

test("private terminal context shows live model thinking without exposing it to browser RPC or changing the journal", async () => {
  const { client, identity } = await setup();
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, remote = createTerminalClient(connection);
  expect(await remote.context(identity)).toMatchObject({ coreSessionId: null, messages: [], thinkingText: "", turnCount: 0, contextUsage: null });
  mode = "hold-thinking";
  const run = await service!.terminal.submit(await requestFor(client, identity, "仅用于终端上下文读取"));
  try {
    for (let n = 0; n < 200 && !(await client.session(identity.sessionId)).turns.some(turn => turn.phase === "thinking"); n++) await Bun.sleep(10);
    const context = await remote.context(identity), calls = requests.length;
    expect(context.thinkingText).toContain("PRIVATE_REASONING_NOT_FOR_UI");
    expect(context.turnCount).toBe(1);
    expect(context.messages).toContainEqual(expect.objectContaining({ role: "user", text: "仅用于终端上下文读取" }));
    expect(context.session.identity.runId).toBe(run.runId);
    expect(JSON.stringify(await client.session(identity.sessionId))).not.toContain("PRIVATE_REASONING_NOT_FOR_UI");
    const dependencies = createDefaultSessionDependencies({ cwd: root });
    const metadata = (await dependencies.sessions.list()).find(item => item.id === context.coreSessionId)!;
    const bytes = readFileSync(metadata.path);
    await remote.context(identity); expect(readFileSync(metadata.path)).toEqual(bytes); expect(requests).toHaveLength(calls);
    await dependencies.env.cleanup();
    const headers = { "content-type": "application/json", "x-workbench-token": connection.token };
    const post = (path: string, body: unknown, extra = {}) => fetch(connection.url + path, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    expect((await post("/api/host/terminal", { instanceId: connection.instanceId, method: "context", input: identity })).status).toBe(403);
    expect((await post("/api/workbench/rpc", { method: "context", args: [identity] })).status).toBe(404);
    await expect(remote.context({ workspaceId: "other", sessionId: identity.sessionId })).rejects.toThrow("工作区不匹配");
    const withControl = { "x-host-control-token": connection.controlToken };
    expect((await post("/api/host/terminal", { instanceId: "old", method: "context", input: identity }, withControl)).status).toBe(400);
    expect((await post("/api/host/terminal", { instanceId: connection.instanceId, method: "context", input: { workspaceId: identity.workspaceId, sessionId: identity.sessionId, unsafe: true } }, withControl)).status).toBe(400);
    expect(requests).toHaveLength(calls);
    const queued = { workspaceId: identity.workspaceId, ...run, requestId: "private-queue", text: "Private queued text" };
    expect((await post("/api/host/terminal", { instanceId: connection.instanceId, method: "enqueue", input: queued })).status).toBe(403);
    expect((await post("/api/workbench/rpc", { method: "enqueue", args: [queued] })).status).toBe(404);
    expect(await remote.enqueue(queued)).toMatchObject({ runId: run.runId, mode: "followUp" });
    expect((await remote.context(identity)).composerQueue).toEqual([queued.text]);
    expect(JSON.stringify(await client.session(identity.sessionId))).not.toContain(queued.text);
    expect(requests).toHaveLength(calls);
  } finally { await client.cancel({ workspaceId: identity.workspaceId, ...run }); }
});

test("private terminal context restores full tool presentation from the original journal without executing or rewriting it", async () => {
  const legacy = await legacyConversation("旧终端历史"), dependencies = createDefaultSessionDependencies({ cwd: root });
  try {
    const source = await dependencies.sessions.open(legacy.metadata);
    await source.appendMessage({ ...legacy.assistant, stopReason: "toolUse", content: [{ type: "toolCall", id: "private-tool",
      name: "bash", arguments: { command: `PRIVATE_TOOL_ARGUMENT ${KEY}` } }] });
    await source.appendMessage({ role: "toolResult", toolCallId: "private-tool", toolName: "bash", timestamp: Date.now(), isError: false,
      content: [{ type: "text", text: `PRIVATE_TOOL_RESULT ${KEY}` }] });
  } finally { await dependencies.env.cleanup(); }
  const { client, identity } = await setup();
  const selected = await service!.terminal.command(await requestFor(client, identity, `/resume ${legacy.metadata.id}`));
  const input = { workspaceId: identity.workspaceId, sessionId: selected.selectedSessionId! }, bytes = readFileSync(legacy.metadata.path), calls = requests.length;
  const first = await service!.terminal.context(input);
  expect(first.messages).toContainEqual(expect.objectContaining({ role: "tool", tool: expect.objectContaining({ status: "done", args: expect.stringContaining("PRIVATE_TOOL_ARGUMENT"), result: expect.stringContaining("PRIVATE_TOOL_RESULT") }) }));
  expect(JSON.stringify(first)).not.toContain(KEY); expect(JSON.stringify(first)).toContain("[REDACTED]");
  expect(JSON.stringify(await client.session(input.sessionId))).not.toContain("PRIVATE_TOOL_ARGUMENT");
  expect(JSON.stringify(await client.session(input.sessionId))).not.toContain("PRIVATE_TOOL_RESULT");
  await service!.close(); service = createWorkbenchService({ cwd: root });
  expect(await service.terminal.context(input)).toEqual(first);
  expect(readFileSync(legacy.metadata.path)).toEqual(bytes); expect(requests).toHaveLength(calls);
  rmSync(legacy.metadata.path);
  await expect(service.terminal.context(input)).rejects.toMatchObject({ code: "CONTEXT_MISSING" });
  expect(requests).toHaveLength(calls);
});

test("a private context read cannot resurrect a view deleted while its journal metadata was loading", async () => {
  const legacy = await legacyConversation("可删除的视图"), calls = requests.length;
  let holding = false, reached!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  service = createWorkbenchService({ cwd: root, dependencies: () => {
    const dependencies = createDefaultSessionDependencies({ cwd: root }), repository = dependencies.sessions;
    return { ...dependencies, sessions: { ...repository, create: repository.create.bind(repository), open: repository.open.bind(repository), async list(options) {
      if (holding) { reached(); await gate; }
      return repository.list(options);
    } } };
  } });
  const client = service.client, identity = await client.identity();
  const selected = await service.terminal.command(await requestFor(client, identity, `/resume ${legacy.metadata.id}`));
  const target = { workspaceId: identity.workspaceId, sessionId: selected.selectedSessionId! };
  holding = true;
  const reading = service.terminal.context(target), outcome = reading.then(() => null, error => error);
  try {
    await entered;
    await client.deleteSession!({ ...target, expectedRevision: (await client.session(target.sessionId)).revision! });
    release(); expect(await outcome).toMatchObject({ code: "CONTEXT_CHANGED" });
    expect((await client.workspaces()).some(item => item.sessionId === target.sessionId)).toBe(false);
    expect(existsSync(legacy.metadata.path)).toBe(true); expect(requests).toHaveLength(calls);
  } finally { release(); await reading.catch(() => {}); }
});

test("terminal resume switches only its own view while the detached source research remains active", async () => {
  const { client, identity, submit } = await setup();
  await submit("已完成的旧研究"); await terminal(client, identity.sessionId);
  const core = createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record.coreSessionId;
  const other = await client.createSession(); mode = "hold";
  const previousRequests = requests.length;
  const run = await client.submit(await requestFor(client, other, "仍在执行的研究"));
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false };
  const view = await openTerminalSession(connection, { sessionId: other.sessionId, onSnapshot() {} });
  const observer = await openTerminalSession(connection, { sessionId: other.sessionId, onSnapshot() {} });
  try {
    const receipt = await view.command(`/resume ${core}`);
    expect(receipt.selectedSessionId).toBe(identity.sessionId);
    expect(view.snapshot?.identity.sessionId).toBe(identity.sessionId);
    expect(observer.snapshot?.identity.sessionId).toBe(other.sessionId);
    const sourceState = await client.session(other.sessionId);
    expect(sourceState).toMatchObject({ state: "running" });
    expect(await client.workspaces()).toHaveLength(2);
    // Selection may finish before initialization. Require the detached source to
    // reach its model as well, so a later startup failure cannot pass this test.
    for (let n = 0; n < 200 && requests.length === previousRequests; n++) await Bun.sleep(10);
    expect(requests).toHaveLength(previousRequests + 1);
    expect((await client.session(other.sessionId)).state).toBe("running");
    const count = requests.length;
    expect((await view.command("/resume")).result.message).toContain(String(core));
    expect((await view.command("/resume --task")).result.success).toBe(true);
    expect((await observer.command("/resume --task")).result.success).toBe(true);
    expect(requests).toHaveLength(count);
    await expect(view.command("/resume does-not-exist")).rejects.toThrow("Session not found");
    expect(view.snapshot?.identity.sessionId).toBe(identity.sessionId);
  } finally { await view.detach(); await observer.detach(); await client.cancel({ workspaceId: identity.workspaceId, ...run }); }
}, 20000);

test("shared task inspection opens the existing panel without model calls or journal writes, including during research", async () => {
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity();
  await service.terminal.submit(await requestFor(client, identity, "A task-free research conversation"));
  await terminal(client, identity.sessionId);
  const dependencies = createDefaultSessionDependencies({ cwd: root });
  const core = createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record.coreSessionId;
  const journal = (await dependencies.sessions.list({ cwd: root })).find(item => item.id === core)!.path;
  await dependencies.env.cleanup();
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, panels: ResearchTaskSnapshot[] = [], messages: UIMessage[][] = [];
  const runtime = new AppRuntime({ onMessages: value => messages.push(structuredClone(value)), onActivity() {},
    onResearchRequest: value => panels.push(structuredClone(value)) }, async () => [], async () => [], { host: connection }, undefined, undefined, 1000, 0);
  try {
    await runtime.bootstrap(); const before = readFileSync(journal), calls = requests.length, visible = structuredClone(messages.at(-1));
    await runtime.submit("/resume --task"); await runtime.submit("/resume --task");
    expect(panels).toHaveLength(2); expect(panels[0]?.task).toBeNull(); expect(panels[0]).toEqual(panels[1]);
    expect(readFileSync(journal)).toEqual(before); expect(requests).toHaveLength(calls); expect(messages.at(-1)).toEqual(visible);
    mode = "hold"; const started = new Promise<void>(resolve => { reached = resolve; });
    await runtime.submit("Held while inspecting the task");
    await started; const during = readFileSync(journal), activeCalls = requests.length;
    await runtime.submit("/resume --task");
    expect(panels).toHaveLength(3); expect(panels[2]?.task).toBeNull();
    expect(readFileSync(journal)).toEqual(during); expect(requests).toHaveLength(activeCalls);
    const active = await client.session(identity.sessionId);
    expect(active.state).toBe("running");
    await client.cancel({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, runId: active.identity.runId! });
  } finally { await runtime.shutdown(); }
});

test("structured terminal research declares its task and prompts once in the original owner with identity deduplication", async () => {
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity(), task = structuredTask();
  const input = { workspaceId: identity.workspaceId, sessionId: identity.sessionId, requestId: "structured-once",
    expectedRevision: (await client.session(identity.sessionId)).revision!, expectedTaskRevision: null, task };
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, remote = createTerminalClient(connection);
  const headers = { "content-type": "application/json", "x-workbench-token": connection.token };
  const body = JSON.stringify({ instanceId: connection.instanceId, method: "submitResearch", input });
  expect((await fetch(connection.url + "/api/host/terminal", { method: "POST", headers, body })).status).toBe(403);
  expect((await fetch(connection.url + "/api/workbench/rpc", { method: "POST", headers,
    body: JSON.stringify({ method: "submitResearch", args: [input] }) })).status).toBe(404);
  await expect(service.terminal.submitResearch({ ...input, requestId: "invalid", task: { ...task, criteria: [] } })).rejects.toMatchObject({ code: "TASK_INVALID" });
  expect(requests).toHaveLength(0);
  const receipt = await remote.submitResearch(input), completed = await terminal(client, identity.sessionId);
  expect(completed.state).toBe("settled"); expect(completed.identity.runId).toBe(receipt.runId);
  expect(requests).toHaveLength(1); expect(JSON.stringify(requests[0])).toContain(task.goal);
  expect(await remote.submitResearch(input)).toEqual(receipt); expect(requests).toHaveLength(1);
  await expect(remote.submitResearch({ ...input, task: { ...task, goal: "different" } })).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
  const inspected = await service.terminal.command(await requestFor(client, identity, "/resume --task"));
  expect(inspected.result.success).toBe(true);
  expect(inspected.result.data).toMatchObject({ task: { spec: task, status: "active" } });
  const old = inspected.result.data as ResearchTaskSnapshot;
  const next = await remote.submitResearch({ ...input, requestId: "structured-stale", expectedRevision: completed.revision!, expectedTaskRevision: "obsolete" });
  const failed = await terminal(client, next.sessionId);
  expect(failed.state).toBe("failed"); expect(failed.turns.at(-1)?.text).toContain("Stale or invalid task revision");
  expect(requests).toHaveLength(1);
  expect((await service.terminal.command(await requestFor(client, identity, "/resume --task"))).result.data).toMatchObject({ task: { revision: old.task!.revision } });
  expect(readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"))).toHaveLength(1);
});

test("shared AppRuntime waits for a structured task and exposes its task panel without a second Agent", async () => {
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, panels: ResearchTaskSnapshot[] = [], messages: UIMessage[][] = [];
  const runtime = new AppRuntime({ onMessages: value => messages.push(structuredClone(value)), onActivity() {},
    onResearchRequest: value => panels.push(structuredClone(value)) }, async () => [], async () => [], { host: connection }, undefined, undefined, 1000, 0);
  try {
    await runtime.bootstrap(); await runtime.submitResearch(structuredTask());
    const identity = await service.client.identity(), completed = await service.client.session(identity.sessionId);
    expect(completed.state).toBe("settled"); expect(requests).toHaveLength(1);
    await runtime.submit("/resume --task");
    expect(panels).toHaveLength(1); expect(panels[0]?.task?.spec).toEqual(structuredTask());
    expect(JSON.stringify(messages.at(-1))).toContain(structuredTask().request);
    await expect(runtime.submitResearch(structuredTask(), "stale-task-revision")).rejects.toThrow("Stale or invalid task revision");
    expect(requests).toHaveLength(1);
    expect(readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"))).toHaveLength(1);
  } finally { await runtime.shutdown(); }
});

test("aborting structured research cancels its exact Host run while retaining its declared task", async () => {
  mode = "hold"; const started = new Promise<void>(resolve => { reached = resolve; });
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, panels: ResearchTaskSnapshot[] = [], controller = new AbortController();
  const runtime = new AppRuntime({ onMessages() {}, onActivity() {}, onResearchRequest: value => panels.push(structuredClone(value)) },
    async () => [], async () => [], { host: connection }, undefined, undefined, 1000, 0);
  try {
    await runtime.bootstrap(); let settled = false;
    const running = runtime.submitResearch(structuredTask(), null, controller.signal).finally(() => { settled = true; });
    void running.catch(() => {}); await started;
    expect(settled).toBe(false);
    await runtime.submit("/resume --task"); expect(panels[0]?.task?.spec).toEqual(structuredTask());
    const identity = await service.client.identity(), run = (await service.client.session(identity.sessionId)).identity.runId;
    controller.abort(); await expect(running).rejects.toThrow("cancelled");
    const cancelled = await service.client.session(identity.sessionId);
    expect(cancelled.state).toBe("cancelled"); expect(cancelled.identity.runId).toBe(run); expect(requests).toHaveLength(1);
    await runtime.submit("/resume --task"); expect(panels.at(-1)?.task?.spec).toEqual(structuredTask());
    expect(readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"))).toHaveLength(1);
  } finally { controller.abort(); await runtime.shutdown(); }
});

test("structured declaration remains inspectable when reference expansion fails before model dispatch", async () => {
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity(), task = { ...structuredTask(), request: "研究 @file:missing-task-source.txt" };
  const input = { workspaceId: identity.workspaceId, sessionId: identity.sessionId, requestId: "task-reference-failure",
    expectedRevision: (await client.session(identity.sessionId)).revision!, expectedTaskRevision: null, task };
  const run = await service.terminal.submitResearch(input), failed = await terminal(client, identity.sessionId);
  expect(failed.state).toBe("failed"); expect(failed.turns.at(-1)?.text).toContain("引用无法读取"); expect(requests).toHaveLength(0);
  const current = await service.terminal.command(await requestFor(client, identity, "/resume --task"));
  expect(current.result.data).toMatchObject({ task: { spec: task } });
  const deps = createDefaultSessionDependencies({ cwd: root });
  const core = createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record.coreSessionId;
  const path = (await deps.sessions.list({ cwd: root })).find(item => item.id === core)!.path; await deps.env.cleanup();
  const bytes = readFileSync(path);
  expect(await service.terminal.submitResearch(input)).toEqual(run);
  expect(readFileSync(path)).toEqual(bytes); expect(requests).toHaveLength(0);
});

test("structured research rejects a portfolio outside the active selection before creating a run", async () => {
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity(), before = await client.session(identity.sessionId), task = structuredTask();
  task.scope.groupIds = ["not-the-active-portfolio"];
  await expect(service.terminal.submitResearch({ workspaceId: identity.workspaceId, sessionId: identity.sessionId,
    requestId: "task-outside-portfolio", expectedRevision: before.revision!, expectedTaskRevision: null, task })).rejects.toMatchObject({ code: "TASK_SCOPE" });
  expect(await client.session(identity.sessionId)).toEqual(before); expect(requests).toHaveLength(0);
  expect(!existsSync(join(root, "sessions")) || readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl")).length === 0).toBe(true);
});

test("terminal research is cancelled when its active portfolio changes, without adopting the replacement scope", async () => {
  const first = editPortfolio({ type: "create", name: "First group" }).groups.at(-1)!;
  editPortfolio({ type: "add", group: first.id, code: "AAPL" });
  const second = editPortfolio({ type: "create", name: "Second group" }).groups.at(-1)!;
  editPortfolio({ type: "add", group: second.id, code: "MSFT" });
  editPortfolio({ type: "select", group: first.id });
  mode = "hold"; const started = new Promise<void>(resolve => { reached = resolve; });
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity();
  const run = await service.terminal.submit(await requestFor(client, identity, "Review the selected portfolio"));
  try {
    await started; expect(JSON.stringify(requests[0])).toContain("First group");
    expect(JSON.stringify(requests[0])).not.toContain("Second group");
    editPortfolio({ type: "select", group: second.id });
    const stopped = await Promise.race([terminal(client, identity.sessionId), Bun.sleep(2000).then(() => null)]);
    expect(stopped?.state).toBe("cancelled"); expect(stopped?.identity.runId).toBe(run.runId);
    expect(requests).toHaveLength(1);
  } finally { await client.cancel({ workspaceId: identity.workspaceId, ...run }).catch(() => {}); }
});

test("one-shot portfolio selection cancels the old terminal run without cancelling a browser-owned run", async () => {
  const first = editPortfolio({ type: "create", name: "CLI First" }).groups.at(-1)!;
  editPortfolio({ type: "add", group: first.id, code: "AAPL" });
  const second = editPortfolio({ type: "create", name: "CLI Second" }).groups.at(-1)!;
  editPortfolio({ type: "add", group: second.id, code: "MSFT" }); editPortfolio({ type: "select", group: first.id });
  mode = "hold";
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity(), browser = await client.createSession!();
  const terminalRun = await service.terminal.submit(await requestFor(client, identity, "Terminal research before CLI selection"));
  const browserRun = await client.submit(await requestFor(client, browser, "Browser research continues independently"));
  try {
    for (let n = 0; n < 200 && requests.length < 2; n++) await Bun.sleep(10);
    expect(requests).toHaveLength(2);
    const cli = Bun.spawn([process.execPath, "src/index.ts", "--json", "-c", `/portfolio select ${second.id}`], {
      cwd: process.env.WHYJ_TEST_PORTFOLIO_CLI_ROOT ?? resolve(import.meta.dir, "../../../.."),
      env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe", timeout: 10000 });
    const [code, stdout, stderr] = await Promise.all([cli.exited, new Response(cli.stdout).text(), new Response(cli.stderr).text()]);
    expect(stderr).toBe("");
    if (code !== 0) throw new Error(`One-shot portfolio selection exited ${code}: ${stdout}`);
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, command: "portfolio", data: { activeGroupId: second.id } });
    const stopped = await terminal(client, identity.sessionId);
    expect(stopped.state).toBe("cancelled"); expect(stopped.identity.runId).toBe(terminalRun.runId);
    expect((await client.session(browser.sessionId)).state).toBe("running"); expect(requests).toHaveLength(2);
  } finally {
    await Promise.all([terminalRun, browserRun].map(run => client.cancel({ workspaceId: identity.workspaceId, ...run }).catch(() => {})));
  }
}, 20000);

test("queued terminal input cannot enter the old run after a portfolio switch", async () => {
  const first = editPortfolio({ type: "create", name: "First group" }).groups.at(-1)!;
  editPortfolio({ type: "add", group: first.id, code: "AAPL" });
  const second = editPortfolio({ type: "create", name: "Second group" }).groups.at(-1)!;
  editPortfolio({ type: "add", group: second.id, code: "MSFT" }); editPortfolio({ type: "select", group: first.id });
  mode = "hold"; const started = new Promise<void>(resolve => { reached = resolve; });
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity();
  const run = await service.terminal.submit(await requestFor(client, identity, "Original portfolio run"));
  try {
    await started; editPortfolio({ type: "select", group: second.id });
    await expect(service.terminal.enqueue({ workspaceId: identity.workspaceId, ...run, requestId: "wrong-portfolio-queue", text: "Do not enqueue" }))
      .rejects.toMatchObject({ code: "QUEUE_CLOSED" });
    expect((await terminal(client, identity.sessionId)).state).toBe("cancelled");
    expect(requests).toHaveLength(1); expect(JSON.stringify(requests)).not.toContain("Do not enqueue");
  } finally { await client.cancel({ workspaceId: identity.workspaceId, ...run }).catch(() => {}); }
});

test("switching portfolios stops all old terminal owners but not a new run on the replacement group", async () => {
  const first = editPortfolio({ type: "create", name: "First group" }).groups.at(-1)!;
  editPortfolio({ type: "add", group: first.id, code: "AAPL" });
  const second = editPortfolio({ type: "create", name: "Second group" }).groups.at(-1)!;
  editPortfolio({ type: "add", group: second.id, code: "MSFT" }); editPortfolio({ type: "select", group: first.id });
  mode = "hold";
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, firstView = await client.identity(), secondView = await client.createSession!(), newView = await client.createSession!();
  const run1 = await service.terminal.submit(await requestFor(client, firstView, "First old owner"));
  const run2 = await service.terminal.submit(await requestFor(client, secondView, "Second old owner"));
  let run3: { sessionId: string; runId: string } | undefined;
  try {
    for (let n = 0; n < 200 && requests.length < 2; n++) await Bun.sleep(10);
    expect(requests).toHaveLength(2); editPortfolio({ type: "select", group: second.id });
    run3 = await service.terminal.submit(await requestFor(client, newView, "New portfolio owner"));
    for (let n = 0; n < 200 && requests.length < 3; n++) await Bun.sleep(10);
    expect(requests).toHaveLength(3); expect(JSON.stringify(requests[2])).toContain("Second group");
    expect((await terminal(client, run1.sessionId)).state).toBe("cancelled");
    expect((await terminal(client, run2.sessionId)).state).toBe("cancelled");
    expect((await client.session(run3.sessionId)).state).toBe("running");
  } finally {
    await Promise.all([run1, run2, ...(run3 ? [run3] : [])].map(run => client.cancel({ workspaceId: firstView.workspaceId, ...run }).catch(() => {})));
  }
}, 20000);

test("a captured terminal portfolio remains fixed for prompts and task policy", async () => {
  const first = editPortfolio({ type: "create", name: "First group" }).groups.at(-1)!;
  editPortfolio({ type: "add", group: first.id, code: "AAPL" });
  const second = editPortfolio({ type: "create", name: "Second group" }).groups.at(-1)!;
  editPortfolio({ type: "add", group: second.id, code: "MSFT" }); editPortfolio({ type: "select", group: first.id });
  const selection = activeResearchSelection(), dependencies = createDefaultSessionDependencies({ cwd: root });
  try {
    const fixed = withSinglePortfolioResearch(dependencies, selection);
    editPortfolio({ type: "select", group: second.id });
    expect(fixed.prompts.skill("fixture", "test")).toContain("First group");
    expect(fixed.prompts.skill("fixture", "test")).not.toContain("Second group");
    const task = { ...structuredTask(), scope: { ...structuredTask().scope, groupIds: [second.id], symbols: ["MSFT"] } };
    expect(singlePortfolioToolDenial("research_task", { action: "declare", task }, selection)).toContain("currently selected portfolio");
    expect(singlePortfolioToolDenial("research_task", { action: "declare", task })).toBeNull();
  } finally { await dependencies.env.cleanup(); }
});

test("a portfolio switch during Agent initialization stops before the first model request", async () => {
  const first = editPortfolio({ type: "create", name: "First group" }).groups.at(-1)!;
  editPortfolio({ type: "add", group: first.id, code: "AAPL" });
  const second = editPortfolio({ type: "create", name: "Second group" }).groups.at(-1)!;
  editPortfolio({ type: "add", group: second.id, code: "MSFT" }); editPortfolio({ type: "select", group: first.id });
  let entered!: () => void, release!: () => void, hold = true;
  const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  service = createWorkbenchService({ cwd: root, dependencies: () => {
    const base = createDefaultSessionDependencies({ cwd: root });
    return { ...base, async loadSkills() { if (hold) { hold = false; entered(); await gate; } return base.loadSkills(); } };
  } });
  const client = service.client, identity = await client.identity();
  const run = await service.terminal.submit(await requestFor(client, identity, "Do not use a changed portfolio"));
  try {
    await started; editPortfolio({ type: "select", group: second.id }); release();
    const stopped = await terminal(client, identity.sessionId);
    expect(stopped.state).toBe("cancelled"); expect(stopped.identity.runId).toBe(run.runId); expect(requests).toHaveLength(0);
  } finally { release(); await client.cancel({ workspaceId: identity.workspaceId, ...run }).catch(() => {}); }
});

test("portfolio changes do not cancel a browser-owned run", async () => {
  const first = editPortfolio({ type: "create", name: "First group" }).groups.at(-1)!;
  editPortfolio({ type: "add", group: first.id, code: "AAPL" });
  const second = editPortfolio({ type: "create", name: "Second group" }).groups.at(-1)!;
  editPortfolio({ type: "add", group: second.id, code: "MSFT" }); editPortfolio({ type: "select", group: first.id });
  mode = "hold";
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, terminalView = await client.identity(), browserView = await client.createSession!();
  const terminalRun = await service.terminal.submit(await requestFor(client, terminalView, "Terminal research"));
  const browserRun = await client.submit(await requestFor(client, browserView, "Browser research"));
  try {
    for (let n = 0; n < 200 && requests.length < 2; n++) await Bun.sleep(10);
    expect(requests).toHaveLength(2); editPortfolio({ type: "select", group: second.id });
    expect((await terminal(client, terminalRun.sessionId)).state).toBe("cancelled");
    expect((await client.session(browserRun.sessionId)).state).toBe("running");
  } finally {
    await Promise.all([terminalRun, browserRun].map(run => client.cancel({ workspaceId: terminalView.workspaceId, ...run }).catch(() => {})));
  }
}, 20000);

test("a portfolio switch before a fast final answer cannot settle the old run", async () => {
  const first = editPortfolio({ type: "create", name: "First group" }).groups.at(-1)!;
  editPortfolio({ type: "add", group: first.id, code: "AAPL" });
  const second = editPortfolio({ type: "create", name: "Second group" }).groups.at(-1)!;
  editPortfolio({ type: "add", group: second.id, code: "MSFT" }); editPortfolio({ type: "select", group: first.id });
  let release!: () => void; gatedAnswer = new Promise<void>(resolve => { release = resolve; });
  mode = "gated-answer"; const started = new Promise<void>(resolve => { reached = resolve; });
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity();
  const run = await service.terminal.submit(await requestFor(client, identity, "A fast answer for the first portfolio"));
  try {
    await started; editPortfolio({ type: "select", group: second.id }); release();
    const result = await terminal(client, identity.sessionId);
    expect(result.state).toBe("cancelled"); expect(result.identity.runId).toBe(run.runId); expect(requests).toHaveLength(1);
  } finally { release(); await client.cancel({ workspaceId: identity.workspaceId, ...run }).catch(() => {}); }
});

test("shared views retain the active Host model when settings change, then show the new model after the run", async () => {
  mode = "hold"; const started = new Promise<void>(resolve => { reached = resolve; });
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, firstModels: string[] = [], secondModels: string[] = [];
  const first = new AppRuntime({ onMessages() {}, onActivity() {}, onModel: value => firstModels.push(value.model) },
    async () => [], async () => [], { host: connection }, undefined, undefined, 1000, 0);
  let second: AppRuntime | undefined;
  try {
    const initial = await first.bootstrap(); await first.submit("Hold a run while model settings change"); await started;
    for (let n = 0; n < 200 && firstModels.at(-1) !== initial.model; n++) await Bun.sleep(10);
    expect(firstModels.at(-1)).toBe(initial.model);
    const identity = await service.client.identity(), active = await service.client.session(identity.sessionId);
    const privateContext = await createTerminalClient(connection).context({ workspaceId: identity.workspaceId, sessionId: identity.sessionId });
    expect(privateContext.activeModel?.id).toBe(initial.model);
    expect(JSON.stringify(privateContext.activeModel)).not.toContain(KEY);
    expect(JSON.stringify(privateContext.activeModel)).not.toContain(String(model.url.origin));
    const settings = readSettings(); settings.model = "next-fixture-model"; saveSettings(settings);
    first.refreshConfiguration(); expect(firstModels.at(-1)).toBe(initial.model);
    second = new AppRuntime({ onMessages() {}, onActivity() {}, onModel: value => secondModels.push(value.model) },
      async () => [], async () => [], { host: connection }, undefined, undefined, 1000, 0);
    const attached = await second.bootstrap(); expect(attached.model).toBe(initial.model); expect(secondModels.at(-1)).toBe(initial.model);
    await service.client.cancel({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, runId: active.identity.runId! });
    for (let n = 0; n < 200 && (firstModels.at(-1) !== "next-fixture-model" || secondModels.at(-1) !== "next-fixture-model"); n++) await Bun.sleep(10);
    expect(firstModels.at(-1)).toBe("next-fixture-model"); expect(secondModels.at(-1)).toBe("next-fixture-model");
    expect((await createTerminalClient(connection).context({ workspaceId: identity.workspaceId, sessionId: identity.sessionId })).activeModel).toBeNull();
    mode = "answer"; await first.submit("Use the newly saved model");
    expect((await terminal(service.client, identity.sessionId)).state).toBe("settled");
    expect(requests.at(-1)?.model).toBe("next-fixture-model");
  } finally { await first.shutdown(); await second?.shutdown(); }
});

test("shared views receive the same Host-owned latency after a completed terminal run", async () => {
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, one: HudMetrics[] = [], two: HudMetrics[] = [];
  const make = (items: HudMetrics[]) => new AppRuntime({ onMessages() {}, onActivity() {}, onHud: value => { if (value) items.push(structuredClone(value)); } },
    async () => [], async () => [], { host: connection }, undefined, undefined, 1000, 0);
  const first = make(one), second = make(two);
  try {
    await first.bootstrap(); await second.bootstrap(); await first.submit("A measured local response");
    const identity = await service.client.identity(); expect((await terminal(service.client, identity.sessionId)).state).toBe("settled");
    for (let n = 0; n < 200 && (one.at(-1)?.ttftMs == null || two.at(-1)?.ttftMs == null); n++) await Bun.sleep(10);
    expect(one.at(-1)?.ttftMs).toBeNumber(); expect(two.at(-1)?.ttftMs).toBe(one.at(-1)?.ttftMs);
    expect(requests).toHaveLength(1);
  } finally { await first.shutdown(); await second.shutdown(); }
});

test("shared HUD counts the effective compacted context like the original agent in both views", async () => {
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity();
  for (const text of ["First research question", "Second research question"]) {
    await service.terminal.submit(await requestFor(client, identity, text));
    await terminal(client, identity.sessionId);
  }
  const dependencies = createDefaultSessionDependencies({ cwd: root });
  let expected: number;
  try {
    const coreId = createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record.coreSessionId;
    const metadata = (await dependencies.sessions.list({ cwd: root })).find(item => item.id === coreId);
    expect(metadata).toBeDefined();
    const original = await dependencies.sessions.open(metadata!);
    const retained = await original.appendMessage({ role: "user", content: "Retained after compaction", timestamp: Date.now() });
    await original.appendCompaction("Earlier turns were summarized.", retained, 50000);
    expected = countConversationTurns((await original.buildContext()).messages);
  } finally { await dependencies.env.cleanup(); }
  const context = await service.terminal.context({ workspaceId: identity.workspaceId, sessionId: identity.sessionId });
  expect(context.messages.filter(message => message.role === "user").length).toBeGreaterThan(expected);
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, one: HudMetrics[] = [], two: HudMetrics[] = [];
  const make = (items: HudMetrics[]) => new AppRuntime({ onMessages() {}, onActivity() {}, onHud: value => { if (value) items.push(structuredClone(value)); } },
    async () => [], async () => [], { host: connection }, undefined, undefined, 1000, 0);
  const first = make(one), second = make(two);
  try {
    await first.bootstrap(); await second.bootstrap();
    expect(one.at(-1)?.turnCount).toBe(expected); expect(two.at(-1)?.turnCount).toBe(expected);
  } finally { await first.shutdown(); await second.shutdown(); }
});

test("terminal latency is private, session-scoped and cleared on configuration change and Host restart", async () => {
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity();
  await service.terminal.submit(await requestFor(client, identity, "A measured local response"));
  await terminal(client, identity.sessionId);
  const measured = await service.terminal.context({ workspaceId: identity.workspaceId, sessionId: identity.sessionId });
  expect(measured.latency.ttftMs).toBeNumber();
  expect(measured.contextUsage?.tokens).toBeNumber();
  expect(JSON.stringify(await client.session(identity.sessionId))).not.toContain("ttftMs");
  const other = await client.createSession!();
  expect((await service.terminal.context({ workspaceId: identity.workspaceId, sessionId: other.sessionId })).latency).toEqual({ ttftMs: null, tpotMs: null });
  const settings = readSettings(); settings.model = "new-hud-model"; saveSettings(settings);
  const changed = await service.terminal.context({ workspaceId: identity.workspaceId, sessionId: identity.sessionId });
  expect(changed.latency).toEqual({ ttftMs: null, tpotMs: null }); expect(changed.contextUsage).toBeNull();
  await service.terminal.submit(await requestFor(client, identity, "A response from the new model"));
  await terminal(client, identity.sessionId);
  const next = await service.terminal.context({ workspaceId: identity.workspaceId, sessionId: identity.sessionId });
  expect(next.latency.ttftMs).toBeNumber(); expect(next.contextUsage?.tokens).toBeNumber();
  const calls = requests.length; await service.close();
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const restarted = await service.terminal.context({ workspaceId: identity.workspaceId, sessionId: identity.sessionId });
  expect(restarted.latency).toEqual({ ttftMs: null, tpotMs: null }); expect(restarted.contextUsage).toBeNull();
  expect(requests).toHaveLength(calls);
});

test("idle terminal context does not reuse usage after its original journal advances", async () => {
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity();
  await service.terminal.submit(await requestFor(client, identity, "A measured local response"));
  await terminal(client, identity.sessionId);
  const input = { workspaceId: identity.workspaceId, sessionId: identity.sessionId };
  expect((await service.terminal.context(input)).contextUsage?.tokens).toBeNumber();
  const dependencies = createDefaultSessionDependencies({ cwd: root });
  try {
    const coreId = createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record.coreSessionId;
    const metadata = (await dependencies.sessions.list({ cwd: root })).find(item => item.id === coreId);
    expect(metadata).toBeDefined();
    const original = await dependencies.sessions.open(metadata!);
    await original.appendMessage({ role: "user", content: "Journal advanced outside the cached estimate", timestamp: Date.now() });
    const changed = await service.terminal.context(input);
    expect(changed.contextUsage).toBeNull();
    expect(JSON.stringify(changed.messages)).toContain("Journal advanced outside the cached estimate");
  } finally { await dependencies.env.cleanup(); }
});

test("cancelled terminal research does not add a partial latency sample", async () => {
  mode = "hold-thinking"; const started = new Promise<void>(resolve => { reached = resolve; });
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity();
  const run = await service.terminal.submit(await requestFor(client, identity, "Cancel while reasoning"));
  await started;
  for (let n = 0; n < 100; n++) {
    const context = await service.terminal.context({ workspaceId: identity.workspaceId, sessionId: identity.sessionId }).catch(() => undefined);
    if (context?.thinkingText) break;
    await Bun.sleep(10);
  }
  await client.cancel({ workspaceId: identity.workspaceId, ...run });
  expect((await service.terminal.context({ workspaceId: identity.workspaceId, sessionId: identity.sessionId })).latency).toEqual({ ttftMs: null, tpotMs: null });
});

test("cancelling structured research before declaration records no task and sends no model request", async () => {
  let reachedUpdate!: () => void, releaseUpdate!: () => void;
  const entered = new Promise<void>(resolve => { reachedUpdate = resolve; }), gate = new Promise<void>(resolve => { releaseUpdate = resolve; });
  const original = QuantResearchHarness.prototype.update;
  const spy = spyOn(QuantResearchHarness.prototype, "update").mockImplementation(async function(this: QuantResearchHarness, event, signal) {
    reachedUpdate(); await gate; return original.call(this, event, signal);
  });
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity(), input = { workspaceId: identity.workspaceId, sessionId: identity.sessionId,
    requestId: "cancel-task-before-declaration", expectedRevision: (await client.session(identity.sessionId)).revision!, expectedTaskRevision: null, task: structuredTask() };
  try {
    const run = await service.terminal.submitResearch(input); await entered;
    const cancelling = client.cancel({ workspaceId: identity.workspaceId, ...run });
    releaseUpdate(); await cancelling;
    expect((await client.session(identity.sessionId)).state).toBe("cancelled"); expect(requests).toHaveLength(0);
    const inspected = await service.terminal.command(await requestFor(client, identity, "/resume --task"));
    expect((inspected.result.data as ResearchTaskSnapshot).task).toBeNull();
    expect(await service.terminal.submitResearch(input)).toEqual(run); expect(requests).toHaveLength(0);
  } finally { releaseUpdate(); spy.mockRestore(); }
});

test("terminal resume during source journal initialization does not replace or abort the new source Agent", async () => {
  let holdCreation = false, reached!: () => void, release!: () => void;
  const opened = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  service = createWorkbenchService({ cwd: root, dependencies: () => {
    const dependencies = createDefaultSessionDependencies({ cwd: root }), repository = dependencies.sessions;
    return { ...dependencies, sessions: { open: repository.open.bind(repository), list: repository.list.bind(repository), async create(input) {
      const source = await repository.create(input);
      if (holdCreation) { holdCreation = false; reached(); await gate; }
      return source;
    } } };
  } });
  const client = service.client, identity = await client.identity();
  await client.submit(await requestFor(client, identity, "已有的研究")); await terminal(client, identity.sessionId);
  const coreId = createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record.coreSessionId;
  const source = await client.createSession(); holdCreation = true; mode = "hold";
  const run = await client.submit(await requestFor(client, source, "正在初始化的研究"));
  try {
    await opened;
    const count = requests.length;
    const selected = await service.terminal.command(await requestFor(client, source, `/resume ${coreId}`));
    expect(selected.selectedSessionId).toBe(identity.sessionId); expect(requests).toHaveLength(count);
    expect((await client.session(source.sessionId)).state).toBe("running");
    release();
    for (let n = 0; n < 200 && requests.length === count; n++) await Bun.sleep(10);
    expect(requests).toHaveLength(count + 1);
    expect((await client.session(source.sessionId)).identity.runId).toBe(run.runId);
    expect((await client.session(source.sessionId)).state).toBe("running");
    expect(readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"))).toHaveLength(2);
  } finally { release(); await client.cancel({ workspaceId: identity.workspaceId, ...run }); }
});

test("terminal resume retains an unfinished legacy tool for explicit reconciliation without dispatch or replay", async () => {
  const legacy = await legacyConversation("保留旧历史");
  const dependencies = createDefaultSessionDependencies({ cwd: root });
  try {
    const original = await dependencies.sessions.open(legacy.metadata);
    await original.appendMessage({ role: "user", content: "旧工具运行尚无结果", timestamp: Date.now() });
    await original.appendMessage({ ...legacy.assistant, stopReason: "toolUse", content: [{ type: "toolCall", id: "legacy-unconfirmed",
      name: "bash", arguments: { command: "echo NEVER_REPLAY_LEGACY_TOOL" } }] });
  } finally { await dependencies.env.cleanup(); }
  const before = readFileSync(legacy.metadata.path), count = requests.length;
  const { client, identity } = await setup();
  const receipt = await service!.terminal.command(await requestFor(client, identity, `/resume ${legacy.metadata.id}`));
  const imported = await client.session(receipt.selectedSessionId!);
  expect(imported.state).toBe("interrupted"); expect(imported.recovery).toMatchObject({ acknowledgementRequired: true, unconfirmedTools: 1 });
  expect(imported.turns.at(-1)?.activity).toContainEqual(expect.objectContaining({ id: "legacy-unconfirmed", state: "unconfirmed" }));
  await expect(client.submit(await requestFor(client, imported.identity, "不能自动继续"))).rejects.toMatchObject({ code: "RECONCILE_REQUIRED" });
  await client.acknowledgeInterruption!({ ...imported.identity, runId: imported.identity.runId!, expectedRevision: imported.revision! });
  const acknowledged = await client.session(imported.identity.sessionId);
  await expect(client.continue!({ workspaceId: identity.workspaceId, sessionId: imported.identity.sessionId, previousRunId: imported.identity.runId!,
    requestId: randomUUID(), expectedRevision: acknowledged.revision! })).rejects.toMatchObject({ code: "CONTINUE_UNSAFE" });
  expect(requests).toHaveLength(count); expect(readFileSync(legacy.metadata.path)).toEqual(before);
});

test("failed legacy import preserves the source and original selection without creating another checkpoint on retry", async () => {
  const legacy = await legacyConversation("原始会话保持不变"), count = requests.length;
  const store = createWorkbenchSessionStore();
  service = createWorkbenchService({ cwd: root, store: { ...store, async save(record, revision) {
    if (record.coreSessionId === legacy.metadata.id) throw new Error("Controlled import checkpoint failure");
    return store.save(record, revision);
  } } });
  const client = service.client, identity = await client.identity();
  const original = await client.session(identity.sessionId);
  for (let n = 0; n < 2; n++) await expect(service.terminal.command(await requestFor(client, identity, `/resume ${legacy.metadata.id}`))).rejects.toMatchObject({ code: "SESSION_STORAGE" });
  expect(await client.session(identity.sessionId)).toEqual(original); expect(await client.workspaces()).toHaveLength(1);
  expect(store.list(identity.workspaceId)).toHaveLength(1);
  expect(readFileSync(legacy.metadata.path)).toEqual(legacy.bytes); expect(requests).toHaveLength(count);
});

test("private terminal compact reopens the same journal, reuses the command receipt and stays absent from browser RPC", async () => {
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, remote = createTerminalClient(connection);
  const identity = await remote.identity();
  await remote.submit(await requestFor(remote, identity, "保留 SPY 的研究目标"));
  const before = await terminal(remote, identity.sessionId);
  const store = createWorkbenchSessionStore(), coreId = store.load(identity.workspaceId, identity.sessionId).record.coreSessionId;
  const input = await requestFor(remote, identity, "/compact 保留研究目标");
  const ordinary = { "content-type": "application/json", "x-workbench-token": connection.token };
  const denied = await fetch(host.server.url + "api/host/terminal", { method: "POST", headers: ordinary,
    body: JSON.stringify({ instanceId: connection.instanceId, method: "command", input }) });
  expect(denied.status).toBe(403);
  const unavailable = await fetch(host.server.url + "api/workbench/rpc", { method: "POST", headers: ordinary,
    body: JSON.stringify({ method: "command", args: [input] }) });
  expect(unavailable.status).toBe(404);
  const count = requests.length;
  const result = await remote.command(input);
  expect(result.result.success).toBe(true); expect(result.result.message).toContain("Compacted");
  expect(result.result.effects).toContainEqual({ type: "compactSession" });
  const compactContext = await remote.context({ workspaceId: identity.workspaceId, sessionId: identity.sessionId });
  expect(compactContext.contextUsage?.tokens).toEqual(expect.any(Number));
  expect(compactContext.latency).toEqual({ ttftMs: null, tpotMs: null });
  const compactDependencies = createDefaultSessionDependencies({ cwd: root });
  try {
    const metadata = (await compactDependencies.sessions.list({ cwd: root })).find(item => item.id === coreId)!;
    expect(compactContext.turnCount).toBe(countConversationTurns((await (await compactDependencies.sessions.open(metadata)).buildContext()).messages));
  } finally { await compactDependencies.env.cleanup(); }
  expect(requests).toHaveLength(count + 1);
  expect(await remote.command(input)).toEqual(result); expect(requests).toHaveLength(count + 1);
  const after = await remote.session(identity.sessionId);
  expect(after.turns).toEqual(before.turns); expect(after.revision).toBeGreaterThan(before.revision!);
  expect(store.load(identity.workspaceId, identity.sessionId).record.coreSessionId).toBe(coreId);
  const files = readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"));
  expect(files).toHaveLength(1);
  expect(readFileSync(join(root, "sessions", String(files[0])), "utf8")).toContain('"type":"compaction"');
  await expect(remote.command({ ...input, requestId: randomUUID() })).rejects.toThrow("会话已变化");
  await expect(remote.submit({ ...input, expectedRevision: after.revision! })).rejects.toThrow("请求标识");
  await host.close(); host = undefined;
  service = createWorkbenchService({ cwd: root });
  expect(await service.client.session(identity.sessionId)).toEqual(after);
  await service.client.submit(await requestFor(service.client, identity, "从浏览器继续压缩后的上下文"));
  expect((await terminal(service.client, identity.sessionId)).state).toBe("settled");
  expect(JSON.stringify(requests.at(-1)?.messages)).toContain("同一核心会话的回答");
});

test("terminal compact on an empty session does not create a journal or start a model", async () => {
  const { client, identity } = await setup();
  const receipt = await service!.terminal.command(await requestFor(client, identity, "/compact"));
  expect(receipt.result.success).toBe(false); expect(receipt.result.message).toContain("active agent session");
  expect(requests).toHaveLength(0);
  expect(createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record.coreSessionId).toBeNull();
  const missing = await service!.terminal.command(await requestFor(client, identity, "/skill install anything"));
  expect(missing.result).toMatchObject({ success: false, message: 'Unknown skill "anything". Use /skill catalog to choose names.' });
  await expect(service!.terminal.command(await requestFor(client, identity, "/portfolio list"))).rejects.toMatchObject({ code: "COMMAND_UNAVAILABLE" });
  expect(requests).toHaveLength(0);
  expect(createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record.coreSessionId).toBeNull();
});

test("queued terminal compact waits for the accepted research and blocks a second mutation of that session", async () => {
  phase("queued-setup");
  mode = "preparing";
  const { client, identity, submit } = await setup();
  phase("queued-submit-initial"); const run = await submit("保留当前工具研究");
  phase("queued-wait-preparation"); await preparing(client, identity.sessionId);
  phase("queued-start-compact");
  const pending = service!.terminal.command(await requestFor(client, identity, "/compact 保留工具结果"));
  await Bun.sleep(0);
  phase("queued-check-exclusion"); await expect(client.submit(await requestFor(client, identity, "不能插入另一轮"))).rejects.toMatchObject({ code: "SESSION_BUSY" });
  releasePreparation!();
  phase("queued-wait-compact"); const compacted = await pending;
  expect(compacted.result.success).toBe(true); expect(compacted.result.message).toContain("Compacted");
  const after = await client.session(identity.sessionId);
  expect(after.identity.runId).toBe(run.runId); expect(after.state).toBe("settled"); expect(after.turns).toHaveLength(2);
  expect(requests).toHaveLength(3); // Tool preparation, final answer, then compaction.
});

test("terminal compact checkpoint failure preserves the changed journal without publishing success or retrying", async () => {
  let fail = false;
  const store = createWorkbenchSessionStore(), seen: SessionSnapshot[] = [];
  service = createWorkbenchService({ cwd: root, store: { ...store, async save(record, revision) {
    if (fail) throw new Error("Controlled command checkpoint failure");
    return store.save(record, revision);
  } } });
  const client = service.client, identity = await client.identity();
  await client.submit(await requestFor(client, identity, "保留压缩前的研究")); await terminal(client, identity.sessionId);
  const before = store.load(identity.workspaceId, identity.sessionId), count = requests.length;
  const input = await requestFor(client, identity, "/compact");
  client.subscribe(event => { if (event.type === "snapshot") seen.push(event.snapshot); });
  fail = true;
  await expect(service.terminal.command(input)).rejects.toMatchObject({ code: "SESSION_STORAGE" });
  await expect(service.terminal.command(input)).rejects.toMatchObject({ code: "SESSION_STORAGE" });
  expect(requests).toHaveLength(count + 1); expect(seen).toHaveLength(0);
  expect(store.load(identity.workspaceId, identity.sessionId)).toEqual(before);
  const files = readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"));
  expect(files).toHaveLength(1);
  expect(readFileSync(join(root, "sessions", String(files[0])), "utf8")).toContain('"type":"compaction"');
  await service.close(); service = createWorkbenchService({ cwd: root });
  expect((await service.client.session(identity.sessionId)).revision).toBe(before.record.snapshot.revision);
  expect(requests).toHaveLength(count + 1);
});

test("cancelling a queued terminal command leaves the active research alive and duplicate requests do not execute", async () => {
  mode = "hold";
  const { client, identity, submit } = await setup();
  const run = await submit("等待模型的研究");
  const input = await requestFor(client, identity, "/compact");
  const pending = service!.terminal.command(input).catch(error => error);
  const duplicate = service!.terminal.command(input).catch(error => error);
  await Bun.sleep(0);
  await expect(service!.terminal.cancelCommand({ ...identity, requestId: input.requestId })).rejects.toMatchObject({ code: "INPUT_INVALID" });
  await service!.terminal.cancelCommand({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, requestId: input.requestId });
  expect(await pending).toMatchObject({ code: "COMMAND_CANCELLED" }); expect(await duplicate).toMatchObject({ code: "COMMAND_CANCELLED" });
  expect((await client.session(identity.sessionId)).state).toBe("running");
  await client.cancel({ ...identity, runId: run.runId });
});

for (const queued of [true, false]) test(`Host shutdown drains ${queued ? "queued" : "executing"} terminal compact without waiting for the model timeout`, async () => {
  const { client, identity, submit } = await setup();
  if (!queued) { await submit("先完成一轮以便压缩"); await terminal(client, identity.sessionId); }
  mode = "hold";
  if (queued) await submit("研究尚在等待");
  const count = requests.length;
  const input = await requestFor(client, identity, "/compact");
  const pending = service!.terminal.command(input).catch(error => error);
  if (!queued) {
    for (let n = 0; n < 200 && requests.length === count; n++) await Bun.sleep(10);
    expect(requests.length).toBeGreaterThan(count);
  } else await Bun.sleep(0);
  await Promise.race([service!.close(), Bun.sleep(2000).then(() => { throw new Error("Host shutdown stuck on terminal command"); })]);
  expect(await pending).toMatchObject({ code: "COMMAND_CANCELLED" });
});

test("private command cancellation cannot cancel another session or a concurrent research run", async () => {
  const { client, identity, submit } = await setup();
  await submit("待压缩的上下文"); await terminal(client, identity.sessionId);
  mode = "hold";
  const input = await requestFor(client, identity, "/compact");
  const pending = service!.terminal.command(input).catch(error => error);
  const other = await client.createSession(), run = await client.submit(await requestFor(client, other, "独立研究"));
  await expect(service!.terminal.cancelCommand({ workspaceId: identity.workspaceId, sessionId: other.sessionId, requestId: input.requestId })).rejects.toMatchObject({ code: "COMMAND_NOT_FOUND" });
  await service!.terminal.cancelCommand({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, requestId: input.requestId });
  expect(await pending).toMatchObject({ code: "COMMAND_CANCELLED" });
  expect((await client.session(other.sessionId)).state).toBe("running");
  expect((await client.session(identity.sessionId)).state).toBe("settled");
  await client.cancel({ workspaceId: identity.workspaceId, ...run });
});

test("terminal automatic reports survive detach and restart, preserving fixed versions without another model call", async () => {
  phase("auto-report-setup");
  const settings = readSettings(); settings.artifactGeneration.auto = true; saveSettings(settings);
  mode = "preparing";
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false };
  const view = await openTerminalSession(connection, { onSnapshot() {} });
  phase("auto-report-submit"); const firstRun = await view.submit("分析 SPY 的风险，仅作假设计算");
  phase("auto-report-wait-preparation"); await preparing(service.client, firstRun.sessionId);
  await view.detach(); releasePreparation!();
  phase("auto-report-wait-first"); const first = await terminal(service.client, firstRun.sessionId);
  expect(first.state).toBe("settled"); expect(first.output.artifacts).toHaveLength(1);
  expect(first.turns.at(-1)?.text).toContain("自动报告已保存");
  const report = first.output.artifacts[0]!;
  expect(report).toMatchObject({ runId: firstRun.runId, version: 1 });
  const saved = loadArtifactSnapshot(`${report.id}@${report.sha256}`);
  expect(saved?.meta.provenance?.scope).toBe("branch");
  expect(saved?.html).toContain("假设计算");
  expect(requests).toHaveLength(2); // One tool turn and its answer, no report-generation model request.
  expect(JSON.stringify(first)).not.toContain(root); expect(JSON.stringify(first)).not.toContain(KEY);
  phase("auto-report-restart"); await host.close(); host = undefined;
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  expect(await service.client.session(firstRun.sessionId)).toEqual(first);
  const identity = first.identity;
  phase("auto-report-submit-second"); await service.terminal.submit(await requestFor(service.client, identity, "继续分析 SPY 风险，仍仅作假设计算"));
  phase("auto-report-wait-second");
  const second = await terminal(service.client, identity.sessionId);
  expect(second.output.artifacts).toHaveLength(2);
  expect(second.output.artifacts[1]).toMatchObject({ id: report.id, version: 2 });
  expect(second.output.artifacts[1]?.sha256).not.toBe(report.sha256);
  expect(loadArtifactSnapshot(`${report.id}@${report.sha256}`)).toEqual(saved);
  expect((await service.client.reload!({ workspaceId: identity.workspaceId, sessionId: identity.sessionId,
    artifactId: report.id, sha256: report.sha256 })).identity.runId).toBe(firstRun.runId);
});

test("terminal report restoration owns the original journal, restores its fixed branch and leaves the requesting session untouched", async () => {
  phase("restore-report-setup");
  const settings = readSettings(); settings.artifactGeneration.auto = true; saveSettings(settings);
  mode = "tool";
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity();
  phase("restore-report-submit-first"); await service.terminal.submit(await requestFor(client, identity, "分析 SPY 风险，仅作假设计算"));
  phase("restore-report-wait-first");
  const first = await terminal(client, identity.sessionId), report = first.output.artifacts[0]!;
  expect(report).toBeDefined();
  const reportId = `${report.id}@${report.sha256}`, fixed = loadArtifactSnapshot(reportId);
  expect(fixed?.meta.provenance?.scope).toBe("branch");
  expect(listRestorableArtifactReports(root).some(item => item.revision === report.sha256)).toBe(true);
  expect(listRestorableArtifactReports(join(root, "other-project"))).toEqual([]);
  phase("restore-report-submit-later"); await service.terminal.submit(await requestFor(client, identity, "这是报告保存后的新问题"));
  phase("restore-report-wait-later");
  const later = await terminal(client, identity.sessionId);
  expect(JSON.stringify(later.turns)).toContain("这是报告保存后的新问题");
  const source = await client.createSession!(), sourceBefore = await client.session(source.sessionId), calls = requests.length;
  const request = { workspaceId: identity.workspaceId, sessionId: source.sessionId, requestId: "restore-report-once", expectedRevision: sourceBefore.revision!, reportId };
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, remote = createTerminalClient(connection);
  const body = JSON.stringify({ instanceId: connection.instanceId, method: "restoreReport", input: request });
  const headers = { "content-type": "application/json", "x-workbench-token": connection.token };
  expect((await fetch(connection.url + "/api/host/terminal", { method: "POST", headers, body })).status).toBe(403);
  expect((await fetch(connection.url + "/api/workbench/rpc", { method: "POST", headers,
    body: JSON.stringify({ method: "restoreReport", args: [request] }) })).status).toBe(404);
  const cache = join(root, "skills", "LLMQuant-skills", "skills", "llmquant-data");
  mkdirSync(cache, { recursive: true }); writeFileSync(join(cache, "SKILL.md"), "---\nname: llmquant-data\ndescription: Shared fixture\n---\nfixture");
  const other = createWorkbenchService({ cwd: root, workspaceId: "4".repeat(24) }), otherIdentity = await other.client.identity();
  const original = TerminalEnvironment.prototype.dependencies;
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  TerminalEnvironment.prototype.dependencies = async function(...args) { entered(); await gate; return original.apply(this, args); };
  phase("restore-report-start-restore"); const pendingRestore = remote.restoreReport(request);
  let restored: Awaited<ReturnType<typeof remote.restoreReport>>;
  try {
    phase("restore-report-wait-dependencies"); await reached;
    phase("restore-report-check-exclusion");
    await expect(other.terminal.command(await requestFor(other.client, otherIdentity, "/skill remove llmquant-data")))
      .rejects.toMatchObject({ code: "RESOURCES_IN_USE" });
    expect(existsSync(join(root, "skills", ".selection.json"))).toBe(false);
    phase("restore-report-release-and-complete"); release(); restored = await pendingRestore;
    expect((await other.terminal.command(await requestFor(other.client, otherIdentity, "/skill remove llmquant-data"))).result.success).toBe(true);
  } finally { release(); await pendingRestore.catch(() => {}); TerminalEnvironment.prototype.dependencies = original; await other.close(); }
  expect(restored.result.success).toBe(true);
  expect(restored.selectedSessionId).toBe(identity.sessionId);
  const restoredContext = await remote.context({ workspaceId: identity.workspaceId, sessionId: identity.sessionId });
  expect(restoredContext.contextUsage?.tokens).toEqual(expect.any(Number));
  expect(restoredContext.latency).toEqual({ ttftMs: null, tpotMs: null });
  const restoredDependencies = createDefaultSessionDependencies({ cwd: root });
  try {
    const metadata = (await restoredDependencies.sessions.list({ cwd: root })).find(item => item.id === restoredContext.coreSessionId)!;
    expect(restoredContext.turnCount).toBe(countConversationTurns((await (await restoredDependencies.sessions.open(metadata)).buildContext()).messages));
  } finally { await restoredDependencies.env.cleanup(); }
  expect(restored.filePath && existsSync(restored.filePath)).toBe(true);
  expect(readFileSync(restored.filePath!, "utf8")).toBe(fixed!.html);
  const target = await client.session(identity.sessionId);
  expect(target.revision).toBe(later.revision! + 2);
  expect(JSON.stringify(target.turns)).not.toContain("这是报告保存后的新问题");
  expect(target.output.artifacts).toEqual([]);
  expect(await client.session(source.sessionId)).toEqual(sourceBefore);
  expect(loadArtifactSnapshot(reportId)).toEqual(fixed);
  expect(requests).toHaveLength(calls);
  expect(await remote.restoreReport(request)).toEqual(restored);
  expect((await client.session(identity.sessionId)).revision).toBe(target.revision);
  await expect(remote.restoreReport({ ...request, reportId: "different" })).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
  await expect(service.terminal.restoreReport({ ...request, requestId: "extra", text: "extra" })).rejects.toMatchObject({ code: "INPUT_INVALID" });
});

test("shared AppRuntime opens the restored report from its Host cwd and refreshes the selected conversation", async () => {
  phase("app-restore-setup");
  const settings = readSettings(); settings.artifactGeneration.auto = true; saveSettings(settings);
  mode = "tool";
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false }, messages: UIMessage[][] = [], directories: Array<string | null> = [], opened: string[] = [];
  const runtime = new AppRuntime({ onMessages: value => messages.push(value), onActivity() {}, onArtifactCwd: value => directories.push(value) },
    async () => [], async () => [], { host: connection }, undefined, undefined, 1000, 0, {}, undefined, path => opened.push(path));
  try {
    phase("app-restore-bootstrap"); await runtime.bootstrap();
    expect(directories.at(-1)).toBe(root);
    phase("app-restore-submit-first"); await runtime.submit("分析 SPY 风险，恢复之前的研究");
    phase("app-restore-wait-first");
    const id = (await service.client.identity()).sessionId, first = await terminal(service.client, id), report = first.output.artifacts[0]!;
    phase("app-restore-submit-later"); await runtime.submit("这次后续讨论不属于报告");
    phase("app-restore-wait-later"); await terminal(service.client, id);
    const calls = requests.length;
    phase("app-restore-open-report"); await runtime.restoreArtifact(`${report.id}@${report.sha256}`);
    expect(opened).toHaveLength(1); expect(readFileSync(opened[0]!, "utf8")).toBe(loadArtifactSnapshot(`${report.id}@${report.sha256}`)!.html);
    expect(JSON.stringify(messages.at(-1))).toContain("恢复之前的研究");
    expect(JSON.stringify(messages.at(-1))).not.toContain("这次后续讨论不属于报告");
    expect(requests).toHaveLength(calls); expect(directories.at(-1)).toBe(root);
  } finally { await runtime.shutdown(); }
});

test("terminal report restoration rejects a running owner and altered provenance without opening or changing the report", async () => {
  phase("reject-restore-setup");
  const settings = readSettings(); settings.artifactGeneration.auto = true; saveSettings(settings);
  mode = "tool";
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity();
  phase("reject-restore-submit-first"); await service.terminal.submit(await requestFor(client, identity, "分析 SPY 风险，固定报告的原始问题"));
  phase("reject-restore-wait-first");
  const original = await terminal(client, identity.sessionId), report = original.output.artifacts[0]!;
  const reportId = `${report.id}@${report.sha256}`, fixed = loadArtifactSnapshot(reportId);
  const source = await client.createSession!(), beforeSource = await client.session(source.sessionId);
  const request = { workspaceId: identity.workspaceId, sessionId: source.sessionId, requestId: "busy-report", expectedRevision: beforeSource.revision!, reportId };
  mode = "hold"; const started = new Promise<void>(resolve => { reached = resolve; });
  phase("reject-restore-start-active"); const active = await service.terminal.submit(await requestFor(client, identity, "仍在研究的后续问题"));
  phase("reject-restore-wait-active");
  await started; const calls = requests.length;
  phase("reject-restore-check-busy"); await expect(service.terminal.restoreReport(request)).rejects.toMatchObject({ code: "SESSION_BUSY" });
  expect((await client.session(identity.sessionId)).state).toBe("running");
  expect(requests).toHaveLength(calls); expect(await client.session(source.sessionId)).toEqual(beforeSource);
  phase("reject-restore-cancel-active"); await client.cancel({ workspaceId: identity.workspaceId, ...active });
  const targetBefore = await client.session(identity.sessionId);
  const dependencies = createDefaultSessionDependencies({ cwd: root });
  const coreId = createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record.coreSessionId;
  const metadata = (await dependencies.sessions.list({ cwd: root })).find(item => item.id === coreId)!;
  await dependencies.env.cleanup();
  const bytes = readFileSync(metadata.path, "utf8");
  expect(bytes).toContain("固定报告的原始问题");
  writeFileSync(metadata.path, bytes.replace("固定报告的原始问题", "原始问题已被修改"));
  try {
    phase("reject-restore-check-provenance"); const rejected = await service.terminal.restoreReport({ ...request, requestId: "altered-report" });
    expect(rejected.result.success).toBe(false); expect(rejected.filePath).toBeUndefined();
    expect(await client.session(identity.sessionId)).toEqual({ ...targetBefore, revision: targetBefore.revision! + 2 });
    expect(await client.session(source.sessionId)).toEqual(beforeSource);
    expect(loadArtifactSnapshot(reportId)).toEqual(fixed);
    expect(requests).toHaveLength(calls);
  } finally { writeFileSync(metadata.path, bytes); }
});

test("terminal report restoration imports an unmapped legacy journal once and selects it", async () => {
  const settings = readSettings(); settings.artifactGeneration.auto = true; saveSettings(settings);
  mode = "tool";
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity();
  await service.terminal.submit(await requestFor(client, identity, "分析 SPY 风险，需要恢复的旧报告"));
  const first = await terminal(client, identity.sessionId), report = first.output.artifacts[0]!;
  const coreId = createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record.coreSessionId;
  await client.deleteSession!({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, expectedRevision: first.revision! });
  const source = await client.createSession!(), sourceBefore = await client.session(source.sessionId), calls = requests.length;
  const request = { workspaceId: identity.workspaceId, sessionId: source.sessionId, requestId: "legacy-report", expectedRevision: sourceBefore.revision!, reportId: `${report.id}@${report.sha256}` };
  const restored = await service.terminal.restoreReport(request);
  expect(restored.result.success).toBe(true); expect(restored.selectedSessionId).not.toBe(identity.sessionId);
  expect(createWorkbenchSessionStore().load(identity.workspaceId, restored.selectedSessionId!).record.coreSessionId).toBe(coreId);
  expect((await client.workspaces()).filter(item => item.sessionId === restored.selectedSessionId)).toHaveLength(1);
  expect(await service.terminal.restoreReport(request)).toEqual(restored);
  expect(requests).toHaveLength(calls);
  expect(readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"))).toHaveLength(1);
});

test("terminal report checkpoint failure keeps an uncertain changed journal unavailable in the current Host", async () => {
  const settings = readSettings(); settings.artifactGeneration.auto = true; saveSettings(settings);
  mode = "tool"; let failWrite = false;
  const store = createWorkbenchSessionStore();
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }),
    store: { ...store, async save(record, revision) { if (failWrite && !record.snapshot.recovery?.acknowledgementRequired) throw new Error("controlled report checkpoint failure"); return store.save(record, revision); } } });
  const client = service.client, identity = await client.identity();
  await service.terminal.submit(await requestFor(client, identity, "分析 SPY 风险，保存固定报告"));
  const first = await terminal(client, identity.sessionId), report = first.output.artifacts[0]!;
  await service.terminal.submit(await requestFor(client, identity, "后来追加的研究"));
  const later = await terminal(client, identity.sessionId), before = store.load(identity.workspaceId, identity.sessionId);
  const reportId = `${report.id}@${report.sha256}`, fixed = loadArtifactSnapshot(reportId), calls = requests.length;
  failWrite = true;
  try {
    await expect(service.terminal.restoreReport({ workspaceId: identity.workspaceId, sessionId: identity.sessionId,
      requestId: "report-checkpoint-failure", expectedRevision: later.revision!, reportId })).rejects.toMatchObject({ code: "SESSION_STORAGE" });
    const barrier = store.load(identity.workspaceId, identity.sessionId);
    expect(barrier.revision).not.toBe(before.revision);
    expect(barrier.record.snapshot).toMatchObject({ state: "interrupted", recovery: { acknowledgementRequired: true } });
    await expect(client.session(identity.sessionId)).rejects.toMatchObject({ code: "CONTEXT_UNCONFIRMED" });
    expect(loadArtifactSnapshot(reportId)).toEqual(fixed); expect(requests).toHaveLength(calls);
    failWrite = false; await service.close();
    service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
    const recovered = await service.client.session(identity.sessionId);
    expect(recovered.state).toBe("interrupted"); expect(recovered.recovery?.acknowledgementRequired).toBe(true);
    await expect(service.terminal.submit(await requestFor(service.client, identity, "不可自动继续"))).rejects.toMatchObject({ code: "RECONCILE_REQUIRED" });
    expect(requests).toHaveLength(calls);
  } finally { failWrite = false; }
});

test("automatic reports are skipped for disabled settings, ordinary chat, browser calls and cancelled runs", async () => {
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity();
  await service.terminal.submit(await requestFor(client, identity, "分析 SPY 风险"));
  expect((await terminal(client, identity.sessionId)).output.artifacts).toHaveLength(0);
  const settings = readSettings(); settings.artifactGeneration.auto = true; saveSettings(settings);
  await service.terminal.submit(await requestFor(client, identity, "你好"));
  expect((await terminal(client, identity.sessionId)).output.artifacts).toHaveLength(0);
  await client.submit(await requestFor(client, identity, "分析 SPY 风险"));
  expect((await terminal(client, identity.sessionId)).output.artifacts).toHaveLength(0);
  mode = "hold";
  const run = await service.terminal.submit(await requestFor(client, identity, "分析 SPY 风险"));
  await client.cancel({ ...identity, runId: run.runId });
  expect((await client.session(identity.sessionId)).state).toBe("cancelled");
  expect(listArtifacts()).toHaveLength(0);
});

test("automatic report failure preserves the answer and damaged report without claiming a saved result", async () => {
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity();
  await service.terminal.submit(await requestFor(client, identity, "建立原始会话"));
  await terminal(client, identity.sessionId);
  const coreId = createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record.coreSessionId!;
  const damaged = join(root, "artifacts", coreId + ".report.json");
  mkdirSync(join(root, "artifacts"), { recursive: true });
  writeFileSync(damaged, "preserve damaged report");
  const settings = readSettings(); settings.artifactGeneration.auto = true; saveSettings(settings);
  await service.terminal.submit(await requestFor(client, identity, "分析 SPY 风险"));
  const finished = await terminal(client, identity.sessionId);
  expect(finished.state).toBe("settled");
  expect(finished.turns.at(-1)?.text).toContain("同一核心会话的回答");
  expect(finished.turns.at(-1)?.text).toContain("自动报告生成失败");
  expect(finished.turns.at(-1)?.text).not.toContain("自动报告已保存");
  expect(finished.output.artifacts).toHaveLength(0);
  expect(readFileSync(damaged, "utf8")).toBe("preserve damaged report");
});

test("automatic reports wait for an explicit terminal clarification answer", async () => {
  const settings = readSettings(); settings.artifactGeneration.auto = true; saveSettings(settings);
  scriptedCalls = [() => [{ name: "ask_user", args: { question: "需要使用哪个风险假设？" } }]];
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity();
  const run = await service.terminal.submit(await requestFor(client, identity, "分析 SPY 风险"));
  const waiting = await terminal(client, identity.sessionId);
  expect(waiting.state).toBe("needs_input"); expect(waiting.output.artifacts).toHaveLength(0);
  expect(listArtifacts()).toHaveLength(0);
  await service.terminal.followup({ ...await requestFor(client, identity, "仅按假设计算分析 SPY 风险"), previousRunId: run.runId });
  const answered = await terminal(client, identity.sessionId);
  expect(answered.state).toBe("settled"); expect(answered.output.artifacts).toHaveLength(1);
  expect(answered.output.artifacts[0]?.runId).not.toBe(run.runId);
});

test("an automatic report is not published when its checkpoint cannot commit, and the immutable file is retained", async () => {
  const settings = readSettings(); settings.artifactGeneration.auto = true; saveSettings(settings);
  const store = createWorkbenchSessionStore(), seen: SessionSnapshot[] = [];
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }), store: {
    ...store, async save(record, revision) {
      if (record.snapshot.output.artifacts.length) throw new Error("Controlled checkpoint write failure");
      return store.save(record, revision);
    },
  } });
  const identity = await service.client.identity();
  service.client.subscribe(event => { if (event.type === "snapshot") seen.push(event.snapshot); });
  await service.terminal.submit(await requestFor(service.client, identity, "分析 SPY 风险"));
  for (let n = 0; n < 250 && !listArtifacts().length; n++) await Bun.sleep(10);
  await service.close();
  expect(listArtifacts()).toHaveLength(1);
  expect(seen.every(snapshot => snapshot.output.artifacts.length === 0)).toBe(true);
  const saved = listArtifacts()[0]!;
  expect(loadArtifactSnapshot(`${saved.sessionId}@${saved.revision}`)).not.toBeNull();
  service = createWorkbenchService({ cwd: root });
  const restored = await service.client.session(identity.sessionId);
  expect(restored.state).toBe("interrupted"); expect(restored.output.artifacts).toHaveLength(0);
  expect(listArtifacts()).toHaveLength(1); expect(requests).toHaveLength(1);
});

test("cancellation after automatic report storage retains the report and cannot turn the run back into settled", async () => {
  const settings = readSettings(); settings.artifactGeneration.auto = true; saveSettings(settings);
  let reachedNote!: () => void, releaseNote!: () => void;
  const started = new Promise<void>(resolve => { reachedNote = resolve; });
  const gate = new Promise<void>(resolve => { releaseNote = resolve; });
  service = createWorkbenchService({ cwd: root, dependencies: () => {
    const dependency = createDefaultSessionDependencies({ cwd: root }), repository = dependency.sessions;
    return { ...dependency, sessions: {
      open: repository.open.bind(repository), list: repository.list.bind(repository),
      async create(input) {
        const session = await repository.create(input), append = session.appendMessage.bind(session);
        session.appendMessage = async message => {
          if ("customType" in message && message.customType === "artifact_export") { reachedNote(); await gate; }
          return append(message);
        };
        return session;
      },
    } };
  } });
  const client = service.client, identity = await client.identity();
  const run = await service.terminal.submit(await requestFor(client, identity, "分析 SPY 风险"));
  try {
    await started;
    expect(listArtifacts()).toHaveLength(1);
    const cancelling = client.cancel({ ...identity, runId: run.runId });
    await Bun.sleep(0); releaseNote(); await cancelling;
    const cancelled = await client.session(identity.sessionId);
    expect(cancelled.state).toBe("cancelled");
    expect(cancelled.output.artifacts).toHaveLength(1);
    expect(cancelled.output.artifacts[0]?.runId).toBe(run.runId);
    expect(cancelled.turns.at(-1)?.text).not.toContain("自动报告已保存");
    await service.close(); service = createWorkbenchService({ cwd: root });
    expect(await service.client.session(identity.sessionId)).toEqual(cancelled);
    expect(requests).toHaveLength(1);
  } finally { releaseNote(); }
});

test("terminal answer review is committed by the Host with no view attached", async () => {
  const settings = readSettings(); settings.artifactGeneration.auto = true; saveSettings(settings);
  answerText = "SPY 的 Sharpe 36.44 源于样本内回撤为零。";
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  const client = service.client, identity = await client.identity();
  await service.terminal.submit(await requestFor(client, identity, "分析 SPY 风险并解释绩效口径"));
  const finished = await terminal(client, identity.sessionId);
  expect(finished.state).toBe("settled");
  expect(finished.turns.at(-1)?.text).toContain(answerText);
  expect(finished.turns.at(-1)?.text).toContain("绩效口径回答需要复核");
  expect(finished.output.artifacts).toHaveLength(0); expect(listArtifacts()).toHaveLength(0);
  await service.close(); service = createWorkbenchService({ cwd: root });
  expect(await service.client.session(identity.sessionId)).toEqual(finished);
  expect(requests).toHaveLength(1);
});

test("default terminal environment retains built-in system tools while a later browser run remains restricted", async () => {
  service = createWorkbenchService({ cwd: root });
  const client = service.client, identity = await client.identity();
  await service.terminal.submit(await requestFor(client, identity, "只回答文字，不执行系统工具"));
  expect((await terminal(client, identity.sessionId)).state).toBe("settled");
  const terminalTools = (requests[0]!.tools as Array<{ function: { name: string } }>).map(tool => tool.function.name);
  expect(terminalTools).toContain("bash");
  expect(terminalTools).not.toContain("compare_portfolios");
  const count = requests.length;
  await client.submit(await requestFor(client, identity, "浏览器回答仍然受限"));
  expect((await terminal(client, identity.sessionId)).state).toBe("settled");
  const browserTools = (requests[count]!.tools as Array<{ function: { name: string } }>).map(tool => tool.function.name);
  expect(browserTools).not.toContain("bash");
});

test("terminal view detaches during execution, reconnects to the completed run and cancels only its selected run", async () => {
  mode = "preparing";
  service = createWorkbenchService({ cwd: root, dependencies: () => createDefaultSessionDependencies({ cwd: root }) });
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false };
  const seen: SessionSnapshot[] = [];
  const first = await openTerminalSession(connection, { onSnapshot: snapshot => seen.push(snapshot) });
  const second = await openTerminalSession(connection, { onSnapshot: snapshot => seen.push(snapshot) });
  try {
    const accepted = await first.submit("断开后仍应完成的真实核心调用");
    await preparing(service.client, accepted.sessionId);
    await first.detach();
    await expect(first.submit("不能从已断开的视图提交")).rejects.toThrow("detached");
    expect((await service.client.session(accepted.sessionId)).state).toBe("running");
    releasePreparation!();
    expect((await terminal(service.client, accepted.sessionId)).state).toBe("settled");
    for (let n = 0; n < 100 && second.snapshot?.state !== "settled"; n++) await Bun.sleep(10);
    expect(second.snapshot?.identity.runId).toBe(accepted.runId);
    expect(second.snapshot?.state).toBe("settled");
    expect(second.snapshot?.turns[1]?.text).toContain("同一核心会话");
    mode = "hold";
    const target = await second.submit("只取消这一轮");
    const remote = createTerminalClient(connection), other = await remote.createSession();
    const independent = await remote.submit(await requestFor(remote, other, "另一个视图的运行"));
    await expect(remote.cancel({ workspaceId: connection.workspaceId, sessionId: target.sessionId, runId: independent.runId })).rejects.toThrow("未找到");
    expect((await remote.session(target.sessionId)).state).toBe("running");
    expect(await second.cancel()).toBe(true);
    expect((await remote.session(target.sessionId)).state).toBe("cancelled");
    expect((await remote.session(independent.sessionId)).state).toBe("running");
    await remote.cancel({ workspaceId: connection.workspaceId, ...independent });
  } finally { await first.detach(); await second.detach(); }
});

test("terminal capability shares run identity but cannot be selected or replayed by browser RPC", async () => {
  let skillReads = 0, dynamicReads = 0, executions = 0;
  service = createWorkbenchService({ cwd: root, dependencies: () => {
    const dependencies = createDefaultSessionDependencies({ cwd: root });
    const original = dependencies.tools.find(tool => tool.name === "calculate_position_scenarios")!;
    const probe = { ...original, name: "terminal_fixture", async execute(...args: Parameters<typeof original.execute>) {
      executions++; return original.execute(...args);
    } };
    return { ...dependencies, tools: [...dependencies.tools, probe],
      loadSkills: async () => { skillReads++; return []; },
      readTools: () => { dynamicReads++; return { revision: "terminal-fixture", tools: [...dependencies.tools, probe] }; },
    };
  } });
  const client = service.client, identity = await client.identity();
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const registration = await host.ready;
  const bootstrap = await (await fetch(host.server.url + "api/workbench/bootstrap")).json() as Record<string, unknown>;
  expect(bootstrap.controlToken).toBeUndefined();
  const input = await requestFor(client, identity, "终端明确授权的运行");
  const remote = (control?: string, instanceId = registration.instanceId) => fetch(host!.server.url + "api/host/terminal", {
    method: "POST", headers: { "content-type": "application/json", "x-workbench-token": registration.token,
      ...(control ? { "x-host-control-token": control } : {}) },
    body: JSON.stringify({ instanceId, method: "submit", input }),
  });
  expect((await remote()).status).toBe(403);
  expect((await remote("wrong")).status).toBe(403);
  expect((await remote(registration.controlToken, "old-instance")).status).toBe(400);
  await expect(client.submit({ ...input, terminal: true } as never)).rejects.toMatchObject({ code: "INPUT_INVALID" });
  expect(requests).toHaveLength(0);
  scriptedCalls = [() => [{ name: "terminal_fixture", args: { shares: 100, costPerShare: 10, observedClose: 12,
    observationDate: "2026-10-23", currency: "CNY", changes: [-0.1, 0, 0.1] } }]];
  const response = await remote(registration.controlToken); expect(response.status).toBe(200);
  const receipt = (await response.json() as { result: { runId: string; sessionId: string } }).result;
  expect(await service.terminal.submit(input)).toEqual(receipt);
  await expect(client.submit(input)).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
  const finished = await terminal(client, identity.sessionId);
  expect(finished.state).toBe("settled");
  expect(finished.identity).toEqual({ ...identity, runId: receipt.runId });
  expect(executions).toBe(1); expect(skillReads).toBeGreaterThan(0); expect(dynamicReads).toBeGreaterThan(0);
  const counts = { skillReads, dynamicReads, executions }, before = requests.length;
  await client.submit(await requestFor(client, identity, "随后从浏览器继续同一会话"));
  expect((await terminal(client, identity.sessionId)).state).toBe("settled");
  expect({ skillReads, dynamicReads, executions }).toEqual(counts);
  const toolNames = (requests[before]!.tools as Array<{ function: { name: string } }>).map(tool => tool.function.name);
  expect(toolNames).not.toContain("terminal_fixture");
  expect(JSON.stringify(requests[before]!.messages)).toContain(input.text);
});

test("explicit clarification survives restart without replay and an HTTP answer creates a new run", async () => {
  scriptedCalls = [() => [{ name: "ask_user", args: { question: `请补充研究范围？${KEY}` } }]];
  const { client, identity } = await setup();
  const original = await requestFor(client, identity, "请先澄清范围");
  const asked = await client.submit(original);
  const waiting = await terminal(client, identity.sessionId);
  expect(waiting.state).toBe("needs_input");
  expect(waiting.turns[1]).toMatchObject({ state: "needs_input", text: "请补充研究范围？[REDACTED]" });
  expect(waiting.turns[1]?.endedAt).toBeTruthy();
  expect(waiting.turns[1]?.activity?.[0]).toMatchObject({ name: "ask_user", state: "completed", title: "澄清研究问题" });
  expect(requests).toHaveLength(1);
  expect(await client.submit(original)).toEqual(asked);
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
  const unscoped = { workspaceId: identity.workspaceId, sessionId: identity.sessionId, requestId: randomUUID(), expectedRevision: waiting.revision!, text: "未经关联的提交" };
  await expect(service.client.submit(unscoped)).rejects.toMatchObject({ code: "CLARIFICATION_PENDING" });
  const rejectedSubmit = await remote("submit", unscoped);
  expect(rejectedSubmit.status).toBe(409);
  expect((await rejectedSubmit.json() as { error: { code: string } }).error.code).toBe("CLARIFICATION_PENDING");
  expect(await service.client.session(identity.sessionId)).toEqual(waiting);
  expect(requests).toHaveLength(1);
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
  expect(finished.recovery).toBeUndefined();
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

test("continue refuses a prior completed effect without replaying it or changing its checkpoint", async () => {
  mode = "tool";
  const { client, identity, submit } = await setup();
  const first = await submit("受控工具完成后中断"); await terminal(client, identity.sessionId); await service!.close();
  const store = createWorkbenchSessionStore(), loaded = store.load(identity.workspaceId, identity.sessionId);
  const snapshot: SessionSnapshot = { ...loaded.record.snapshot, state: "running", turns: loaded.record.snapshot.turns.map(turn => turn.role === "user" ? turn :
    { ...turn, state: "running", activity: turn.activity?.map(item => ({ ...item, name: "fetch_bars", state: "completed" })) }) };
  await store.save({ ...loaded.record, snapshot }, loaded.revision);
  service = createWorkbenchService({ cwd: root });
  const recovered = await service.client.session(identity.sessionId), count = requests.length;
  const before = store.load(identity.workspaceId, identity.sessionId);
  mode = "answer";
  await expect(service.client.continue!({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, previousRunId: first.runId,
    requestId: randomUUID(), expectedRevision: recovered.revision! })).rejects.toMatchObject({ code: "CONTINUE_UNSAFE" });
  expect(requests).toHaveLength(count); expect(store.load(identity.workspaceId, identity.sessionId)).toEqual(before);
});

test("continue rejects incomplete or ambiguous prior activity without changing the stored checkpoint", async () => {
  mode = "tool";
  const { client, identity, submit } = await setup();
  const first = await submit("检查历史工具记录"); await terminal(client, identity.sessionId); await service!.close();
  const store = createWorkbenchSessionStore(), template = store.load(identity.workspaceId, identity.sessionId).record;
  const assistant = template.snapshot.turns.find(turn => turn.role === "assistant")!;
  const variants: Array<{ label: string; turns: SessionSnapshot["turns"] }> = [
    { label: "missing assistant", turns: template.snapshot.turns.filter(turn => turn.role !== "assistant") },
    { label: "missing activity", turns: template.snapshot.turns.map(turn => turn.role === "assistant" ? { ...turn, activity: undefined, state: "running" } : turn) },
    { label: "wrong role", turns: template.snapshot.turns.map(turn => turn.role === "assistant" ? { ...turn, role: "user", state: "running" } : turn) },
    { label: "duplicate assistant", turns: [...template.snapshot.turns, assistant].map(turn => turn.role === "assistant" ? { ...turn, state: "running" } : turn) },
    { label: "duplicate tool identity", turns: template.snapshot.turns.map(turn => turn.role === "assistant" ? { ...turn, state: "running", activity: [...turn.activity!, ...turn.activity!] } : turn) },
  ];
  for (const variant of variants) {
    const current = store.load(identity.workspaceId, identity.sessionId);
    await store.save({ ...template, snapshot: { ...template.snapshot, state: "running", turns: variant.turns } }, current.revision);
    service = createWorkbenchService({ cwd: root });
    const recovered = await service.client.session(identity.sessionId), before = store.load(identity.workspaceId, identity.sessionId), count = requests.length;
    expect(recovered.recovery?.acknowledgementRequired, variant.label).toBe(true);
    await expect(service.client.submit({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, requestId: randomUUID(),
      expectedRevision: recovered.revision!, text: "尚未核对的新问题" })).rejects.toMatchObject({ code: "RECONCILE_REQUIRED" });
    expect(store.load(identity.workspaceId, identity.sessionId)).toEqual(before); expect(requests).toHaveLength(count);
    await service.client.acknowledgeInterruption!({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, runId: first.runId, expectedRevision: recovered.revision! });
    const acknowledged = await service.client.session(identity.sessionId), afterAck = store.load(identity.workspaceId, identity.sessionId);
    await expect(service.client.continue!({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, previousRunId: first.runId,
      requestId: randomUUID(), expectedRevision: acknowledged.revision! }), variant.label).rejects.toMatchObject({ code: "CONTINUE_UNSAFE" });
    expect(requests).toHaveLength(count); expect(store.load(identity.workspaceId, identity.sessionId)).toEqual(afterAck);
    await service.close(); service = undefined;
  }
});

test("cancelling a started effect requires persisted acknowledgement before a new question", async () => {
  let effects = 0, started!: () => void;
  const reachedEffect = new Promise<void>(resolve => { started = resolve; });
  scriptedCalls = [() => [{ name: "fetch_bars", args: { symbol: "000300.SH", market: "A" } }]];
  service = createWorkbenchService({ cwd: root, dependencies: () => {
    const deps = createDefaultSessionDependencies({ cwd: root });
    return { ...deps, tools: deps.tools.map(tool => tool.name !== "fetch_bars" ? tool : { ...tool, async execute(_id, _args, signal) {
      effects++; started();
      return new Promise<never>((_resolve, reject) => { signal?.addEventListener("abort", () => reject(new Error("controlled cancellation")), { once: true }); });
    } }) };
  } });
  const client = service.client, identity = await client.identity();
  const first = await client.submit(await requestFor(client, identity, "执行后取消"));
  await Promise.race([reachedEffect, Bun.sleep(10000).then(() => { throw new Error("Tool did not start"); })]);
  await client.cancel({ workspaceId: identity.workspaceId, ...first });
  const cancelled = await client.session(identity.sessionId), count = requests.length;
  expect(cancelled.state).toBe("cancelled"); expect(cancelled.turns.at(-1)?.activity?.[0]?.state).toBe("cancelled");
  expect(cancelled.recovery).toMatchObject({ runId: first.runId, unconfirmedTools: 1, acknowledgementRequired: true });
  const store = createWorkbenchSessionStore(); expect(store.load(identity.workspaceId, identity.sessionId).record.version).toBe(2);
  await expect(client.submit(await requestFor(client, identity, "未经核对"))).rejects.toMatchObject({ code: "RECONCILE_REQUIRED" });
  expect(requests).toHaveLength(count); expect(effects).toBe(1);
  await service.close(); service = createWorkbenchService({ cwd: root });
  const recovered = await service.client.session(identity.sessionId);
  expect(recovered.state).toBe("cancelled"); expect(recovered.recovery?.acknowledgementRequired).toBe(true); expect(requests).toHaveLength(count);
  await service.client.acknowledgeInterruption!({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, runId: first.runId, expectedRevision: recovered.revision! });
  const acknowledged = await service.client.session(identity.sessionId);
  expect(acknowledged.recovery?.acknowledgementRequired).toBe(false);
  const afterAcknowledgement = store.load(identity.workspaceId, identity.sessionId);
  await service.client.acknowledgeInterruption!({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, runId: first.runId, expectedRevision: acknowledged.revision! });
  expect(store.load(identity.workspaceId, identity.sessionId)).toEqual(afterAcknowledgement); expect(requests).toHaveLength(count);
  await expect(service.client.continue!({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, previousRunId: first.runId,
    requestId: randomUUID(), expectedRevision: acknowledged.revision! })).rejects.toMatchObject({ code: "CONTINUE_UNSAFE" });
  await service.close(); service = createWorkbenchService({ cwd: root });
  expect((await service.client.session(identity.sessionId)).recovery?.acknowledgementRequired).toBe(false);
  const next = await service.client.submit(await requestFor(service.client, identity, "核对后提出新问题"));
  expect(next.runId).not.toBe(first.runId); expect((await terminal(service.client, identity.sessionId)).state).toBe("settled");
  expect(effects).toBe(1); expect(store.load(identity.workspaceId, identity.sessionId).record.version).toBe(2);
}, 30000);

test("legacy cancelled effect is gated without rewriting v1 until acknowledgement; pure cancellation stays usable", async () => {
  mode = "tool";
  const { client, identity, submit } = await setup();
  const first = await submit("旧版取消记录"); await terminal(client, identity.sessionId); await service!.close();
  const store = createWorkbenchSessionStore(), template = store.load(identity.workspaceId, identity.sessionId).record;
  for (const [name, expectedGate] of [["calculate_position_scenarios", false], ["fetch_bars", true]] as const) {
    const current = store.load(identity.workspaceId, identity.sessionId);
    await store.save({ ...template, snapshot: { ...template.snapshot, state: "cancelled", turns: template.snapshot.turns.map(turn => turn.role === "assistant"
      ? { ...turn, state: "cancelled", activity: turn.activity?.map(item => ({ ...item, name, state: "cancelled" })) } : turn) } }, current.revision);
    const old = store.load(identity.workspaceId, identity.sessionId);
    service = createWorkbenchService({ cwd: root });
    const projected = await service.client.session(identity.sessionId);
    expect(!!projected.recovery?.acknowledgementRequired).toBe(expectedGate);
    expect(store.load(identity.workspaceId, identity.sessionId)).toEqual(old);
    if (expectedGate) {
      await expect(service.client.submit(await requestFor(service.client, identity, "未核对"))).rejects.toMatchObject({ code: "RECONCILE_REQUIRED" });
      await service.client.acknowledgeInterruption!({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, runId: first.runId, expectedRevision: projected.revision! });
      expect(store.load(identity.workspaceId, identity.sessionId).record.version).toBe(2);
    }
    await service.close(); service = undefined;
  }
});

test("a cancellation acknowledgement becomes visible only after its checkpoint commits", async () => {
  mode = "tool";
  const { client, identity, submit } = await setup();
  const first = await submit("等待确认持久化"); await terminal(client, identity.sessionId); await service!.close();
  const store = createWorkbenchSessionStore(), current = store.load(identity.workspaceId, identity.sessionId);
  await store.save({ ...current.record, snapshot: { ...current.record.snapshot, state: "cancelled", turns: current.record.snapshot.turns.map(turn => turn.role === "assistant"
    ? { ...turn, state: "cancelled", activity: turn.activity?.map(item => ({ ...item, name: "fetch_bars", state: "cancelled" })) } : turn) } }, current.revision);
  let entered!: () => void, release!: () => void;
  const blocked = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  service = createWorkbenchService({ cwd: root, store: { ...store, async save(record, revision) {
    if (record.snapshot.recovery?.acknowledgementRequired === false) { entered(); await gate; }
    return store.save(record, revision);
  } } });
  const restored = service.client, prior = await restored.session(identity.sessionId), events: SessionSnapshot[] = [];
  const detach = restored.subscribe(event => { if (event.type === "snapshot") events.push(event.snapshot); });
  const ack = restored.acknowledgeInterruption!({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, runId: first.runId, expectedRevision: prior.revision! });
  try {
    await blocked;
    expect((await restored.session(identity.sessionId)).recovery?.acknowledgementRequired).toBe(true);
    expect(events.every(event => event.recovery?.acknowledgementRequired !== false)).toBe(true);
    await expect(restored.submit({ ...await requestFor(restored, identity, "不能越过未提交的确认") })).rejects.toMatchObject({ code: "SESSION_BUSY" });
    release(); await ack;
    expect((await restored.session(identity.sessionId)).recovery?.acknowledgementRequired).toBe(false);
    expect(store.load(identity.workspaceId, identity.sessionId).record.version).toBe(2);
  } finally { release(); await ack.catch(() => {}); detach(); }
});

test("an effect still settling after cancellation cannot be acknowledged early", async () => {
  let started!: () => void, release!: () => void;
  const reachedEffect = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  scriptedCalls = [() => [{ name: "fetch_bars", args: { symbol: "000300.SH", market: "A" } }]];
  service = createWorkbenchService({ cwd: root, dependencies: () => {
    const deps = createDefaultSessionDependencies({ cwd: root });
    return { ...deps, tools: deps.tools.map(tool => tool.name !== "fetch_bars" ? tool : { ...tool, async execute() {
      started(); await gate; return { content: [{ type: "text" as const, text: "late result" }], details: {} };
    } }) };
  } });
  const client = service.client, identity = await client.identity(); let cancelled: SessionSnapshot | undefined;
  const detach = client.subscribe(event => { if (event.type === "snapshot" && event.snapshot.state === "cancelled") cancelled = event.snapshot; });
  const first = await client.submit(await requestFor(client, identity, "停止仍在收尾的工具"));
  await Promise.race([reachedEffect, Bun.sleep(10000).then(() => { throw new Error("Tool did not start"); })]);
  const stopping = client.cancel({ workspaceId: identity.workspaceId, ...first });
  try {
    for (let i = 0; i < 100 && !cancelled; i++) await Bun.sleep(10);
    expect(cancelled?.recovery?.acknowledgementRequired).toBe(true);
    await expect(client.acknowledgeInterruption!({ workspaceId: identity.workspaceId, sessionId: identity.sessionId,
      runId: first.runId, expectedRevision: cancelled!.revision! })).rejects.toMatchObject({ code: "SESSION_BUSY" });
    release(); await stopping;
    const stopped = await client.session(identity.sessionId);
    expect(stopped.recovery?.acknowledgementRequired).toBe(true);
    expect(stopped.turns.at(-1)?.activity?.[0]?.state).toBe("cancelled");
    expect(JSON.stringify(stopped)).not.toContain("late result");
  } finally { release(); await stopping.catch(() => {}); detach(); }
}, 30000);

for (const failure of ["throw", "error-result"] as const) test(`an effectful ${failure} blocks a subsequent same-run effect and requires acknowledgement`, async () => {
  let effects = 0;
  const call = () => [{ name: "fetch_bars", args: { symbol: "000300.SH", market: "A" } }];
  scriptedCalls = [call, call];
  service = createWorkbenchService({ cwd: root, dependencies: () => {
    const deps = createDefaultSessionDependencies({ cwd: root });
    return { ...deps, tools: deps.tools.map(tool => tool.name !== "fetch_bars" ? tool : { ...tool, async execute() {
      effects++;
      if (failure === "throw") throw new Error("controlled uncertain effect");
      return { content: [{ type: "text" as const, text: "controlled uncertain error" }], details: { error: { code: "FIXTURE" } } };
    } }) };
  } });
  const client = service.client, identity = await client.identity();
  const first = await client.submit(await requestFor(client, identity, "失败后不要重复副作用"));
  const finished = await terminal(client, identity.sessionId), count = requests.length;
  expect(effects).toBe(1);
  expect(finished.turns.at(-1)?.activity?.[0]?.state).toBe("failed");
  expect(finished.recovery).toMatchObject({ runId: first.runId, unconfirmedTools: 1, acknowledgementRequired: true });
  await expect(client.submit(await requestFor(client, identity, "未经核对的新问题"))).rejects.toMatchObject({ code: "RECONCILE_REQUIRED" });
  expect(requests).toHaveLength(count);
  await client.acknowledgeInterruption!({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, runId: first.runId, expectedRevision: finished.revision! });
  expect(requests).toHaveLength(count);
}, 30000);

test("parallel effectful calls cannot dispatch after an earlier same-batch failure", async () => {
  let effects = 0;
  scriptedCalls = [() => ["000300.SH", "000905.SH"].map(symbol => ({ name: "fetch_bars", args: { symbol, market: "A" } }))];
  service = createWorkbenchService({ cwd: root, dependencies: () => {
    const deps = createDefaultSessionDependencies({ cwd: root });
    return { ...deps, tools: deps.tools.map(tool => tool.name !== "fetch_bars" ? tool : { ...tool, executionMode: "parallel" as const, async execute() {
      effects++; await Bun.sleep(60); throw new Error("controlled first effect failed");
    } }) };
  } });
  const client = service.client, identity = await client.identity();
  await client.submit(await requestFor(client, identity, "同批工具失败后等待核对"));
  const stopped = await terminal(client, identity.sessionId);
  expect(effects).toBe(1);
  expect(stopped.turns.at(-1)?.activity?.map(item => item.state)).toEqual(["failed", "not-run"]);
  expect(stopped.recovery).toMatchObject({ unconfirmedTools: 1, acknowledgementRequired: true });
}, 30000);

test("successful parallel effectful calls run serially and remain available", async () => {
  let effects = 0, active = 0, maximum = 0;
  scriptedCalls = [() => ["000300.SH", "000905.SH"].map(symbol => ({ name: "fetch_bars", args: { symbol, market: "A" } }))];
  service = createWorkbenchService({ cwd: root, dependencies: () => {
    const deps = createDefaultSessionDependencies({ cwd: root });
    return { ...deps, tools: deps.tools.map(tool => tool.name !== "fetch_bars" ? tool : { ...tool, executionMode: "parallel" as const, async execute() {
      effects++; active++; maximum = Math.max(maximum, active); await Bun.sleep(30); active--;
      return { content: [{ type: "text" as const, text: "controlled success" }], details: {} };
    } }) };
  } });
  const client = service.client, identity = await client.identity();
  await client.submit(await requestFor(client, identity, "同批成功工具"));
  const finished = await terminal(client, identity.sessionId);
  expect(effects).toBe(2); expect(maximum).toBe(1);
  expect(finished.turns.at(-1)?.activity?.map(item => item.state)).toEqual(["completed", "completed"]);
  expect(finished.recovery).toBeUndefined();
}, 30000);

test("failed effect remains gated when the enclosing run fails and after restart", async () => {
  mode = "pure-failure"; let effects = 0;
  scriptedCalls = [() => [{ name: "fetch_bars", args: { symbol: "000300.SH", market: "A" } }]];
  service = createWorkbenchService({ cwd: root, dependencies: () => {
    const deps = createDefaultSessionDependencies({ cwd: root });
    return { ...deps, tools: deps.tools.map(tool => tool.name !== "fetch_bars" ? tool : { ...tool, async execute() { effects++; throw new Error("uncertain effect"); } }) };
  } });
  const client = service.client, identity = await client.identity();
  const first = await client.submit(await requestFor(client, identity, "工具失败且模型随后失败"));
  const failed = await terminal(client, identity.sessionId), count = requests.length;
  expect(failed.state).toBe("failed"); expect(failed.recovery).toMatchObject({ unconfirmedTools: 1, acknowledgementRequired: true }); expect(effects).toBe(1);
  await service.close(); service = createWorkbenchService({ cwd: root });
  const restored = await service.client.session(identity.sessionId);
  expect(restored.recovery?.acknowledgementRequired).toBe(true);
  await expect(service.client.submit(await requestFor(service.client, identity, "未经核对"))).rejects.toMatchObject({ code: "RECONCILE_REQUIRED" });
  await service.client.acknowledgeInterruption!({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, runId: first.runId, expectedRevision: restored.revision! });
  expect(requests).toHaveLength(count); expect(effects).toBe(1);
}, 30000);

test("legacy failed effect is gated across terminal states without rewriting v1", async () => {
  mode = "tool";
  const { client, identity, submit } = await setup();
  const first = await submit("旧版工具记录"); await terminal(client, identity.sessionId); await service!.close(); service = undefined;
  const store = createWorkbenchSessionStore(), template = store.load(identity.workspaceId, identity.sessionId).record;
  for (const state of ["failed", "settled", "needs_input", "interrupted"] as const) {
    const sessionId = randomUUID();
    const legacy = { ...template, sessionId, snapshot: { ...template.snapshot, identity: { ...template.snapshot.identity, sessionId }, state,
      turns: template.snapshot.turns.map(turn => turn.role === "assistant" ? { ...turn, state,
        activity: turn.activity?.map(item => ({ ...item, name: "fetch_bars", state: "failed" as const })) } : turn) } };
    await store.save(legacy, null);
    const original = store.load(identity.workspaceId, sessionId);
    service = createWorkbenchService({ cwd: root });
    const restored = await service.client.session(sessionId);
    expect(restored.recovery).toMatchObject({ runId: first.runId, unconfirmedTools: 1, acknowledgementRequired: true });
    expect(store.load(identity.workspaceId, sessionId)).toEqual(original);
    await expect(service.client.submit({ workspaceId: identity.workspaceId, sessionId, requestId: randomUUID(), expectedRevision: restored.revision!, text: "未核对" })).rejects.toMatchObject({ code: "RECONCILE_REQUIRED" });
    await service.client.acknowledgeInterruption!({ workspaceId: identity.workspaceId, sessionId, runId: first.runId, expectedRevision: restored.revision! });
    expect(store.load(identity.workspaceId, sessionId).record.version).toBe(state === "interrupted" ? 1 : 2);
    await service.close(); service = undefined;
  }
});

test("review cannot start a new run from a session with an unconfirmed effect", async () => {
  phase("effect-review-setup");
  let effects = 0;
  service = createWorkbenchService({ cwd: root, dependencies: () => {
    const deps = createDefaultSessionDependencies({ cwd: root });
    return { ...deps, tools: deps.tools.map(tool => tool.name !== "fetch_bars" ? tool : { ...tool, async execute() { effects++; throw new Error("uncertain effect"); } }) };
  } });
  const client = service.client, identity = await client.identity();
  phase("effect-review-submit-first"); const first = await client.submit(await requestFor(client, identity, "先保存旧报告"));
  phase("effect-review-wait-first"); const finished = await terminal(client, identity.sessionId);
  phase("effect-review-save-report");
  const report = await client.save!({ workspaceId: identity.workspaceId, ...first, expectedRevision: finished.revision!, expectedArtifactRevision: null });
  scriptedCalls = [() => [{ name: "fetch_bars", args: { symbol: "000300.SH", market: "A" } }]];
  phase("effect-review-submit-uncertain"); const second = await client.submit(await requestFor(client, identity, "之后产生未确认结果"));
  phase("effect-review-wait-uncertain");
  const uncertain = await terminal(client, identity.sessionId), count = requests.length;
  expect(uncertain.recovery?.acknowledgementRequired).toBe(true); expect(effects).toBe(1);
  const request = { workspaceId: identity.workspaceId, sessionId: identity.sessionId, artifactId: report.id, sha256: report.sha256,
    requestId: randomUUID(), expectedRevision: uncertain.revision!, text: "复核旧报告" };
  expect((await client.reload!({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, artifactId: report.id, sha256: report.sha256 })).identity.runId).toBe(first.runId);
  expect(requests).toHaveLength(count);
  phase("effect-review-check-gate"); await expect(client.review!(request)).rejects.toMatchObject({ code: "RECONCILE_REQUIRED" });
  expect(requests).toHaveLength(count); expect(effects).toBe(1);
  phase("effect-review-acknowledge"); await client.acknowledgeInterruption!({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, runId: second.runId, expectedRevision: uncertain.revision! });
  phase("effect-review-start-review");
  const reviewed = await client.review!({ ...request, requestId: randomUUID(), expectedRevision: (await client.session(identity.sessionId)).revision! });
  phase("effect-review-wait-review"); expect((await terminal(client, reviewed.sessionId)).state).toBe("settled"); expect(effects).toBe(1);
}, 30000);

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

test("thinking events project actual provider text and freeze the terminal clock", async () => {
  mode = "thinking"; const { client, identity, submit } = await setup();
  const snapshots: SessionSnapshot[] = [];
  const detach = client.subscribe(event => { if (event.type === "snapshot") snapshots.push(event.snapshot); });
  await submit("验证真实 thinking 事件的安全状态投影");
  const finished = await terminal(client, identity.sessionId); detach();
  expect(finished.state).toBe("settled");
  expect(snapshots.filter(value => value.turns[1]?.phase === "thinking").length).toBeGreaterThan(1);
  expect(snapshots.some(value => value.turns[1]?.phase === "answering")).toBe(true);
  expect(finished.turns[1]?.thinking).toBe("PROVIDER_THINKING_FIXTURE".repeat(10));
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
  const result = done.turns[1]?.activity?.[0]?.result;
  expect(result?.text).toContain("100"); expect(result?.truncated).toBe(false);
  expect(JSON.stringify(done)).not.toContain(KEY);
  await service!.close(); service = createWorkbenchService({ cwd: root });
  const restored = await service.client.session(identity.sessionId);
  expect(restored.turns[1]?.activity?.[0]?.result).toEqual(result);
  const other = await service.client.createSession();
  expect((await service.client.session(other.sessionId)).turns).toHaveLength(0);
});

test("cancelled preparation never becomes executed history, and tool failure never becomes completed evidence", async () => {
  mode = "preparing"; const { client, identity, submit } = await setup();
  const run = await submit("停止尚未执行的调用"); await preparing(client, identity.sessionId); await client.cancel({ workspaceId: identity.workspaceId, ...run });
  expect((await client.session(identity.sessionId)).turns[1]?.activity?.[0]?.state).toBe("not-run");
  mode = "bad-tool"; toolSent = false;
  await submit("无效参数仍保留失败记录"); const result = await terminal(client, identity.sessionId);
  expect(result.turns[3]?.activity?.[0]).toMatchObject({ title: "计算持仓情景", state: "failed" });
  expect(result.turns[3]?.activity?.[0]?.result?.text).toBeTruthy();
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
  const preference = { revision: (await client.preferences()).revision, model: "workbench-fixture", source: "none" as const, portfolio: "" };
  const bad: Array<[keyof WorkbenchClient, unknown[]]> = [
    ["session", [null]], ["transcript", [" "]], ["output", [3]], ["references", [identity.sessionId, []]],
    ["renameSession", [{ ...rename, title: "" }]], ["renameSession", [{ ...rename, expectedRevision: "0" }]],
    ["renameSession", [{ ...rename, path: root }]], ["acknowledgeInterruption", ["old-run-only"]],
    ["updatePreferences", [{ ...preference, apiKey: "injected" }]], ["updatePreferences", [null]],
    ["updatePreferences", [{ ...preference, source: "demo" }]], ["updatePreferences", [{ ...preference, thinkingLevel: [] }]],
    ["updatePreferences", [{ ...preference, researchSource: [] }]], ["updatePreferences", [{ ...preference, researchSource: "x".repeat(31) }]],
  ];
  for (const [method, args] of bad) {
    const failure = await (client[method] as (...values: unknown[]) => Promise<unknown>)(...args).then(() => null, error => error as { code: string });
    const response = await remote(method, args);
    expect(response.status).toBe(400); expect(failure).not.toBeNull();
    expect((await response.json() as { error: { code: string } }).error.code).toBe(failure!.code);
  }
  const sourceChange = { ...preference, researchSource: "akshare" as const };
  expect((await remote("updatePreferences", [sourceChange])).status).toBe(200);
  expect((await client.preferences()).researchSource).toBe("akshare");
  await expect(client.updatePreferences(sourceChange)).rejects.toMatchObject({ code: "ESTORAGECONFLICT" });
  const staleSettings = await remote("updatePreferences", [sourceChange]);
  expect(staleSettings.status).toBe(409);
  expect((await staleSettings.json() as { error: { code: string } }).error.code).toBe("ESTORAGECONFLICT");
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


for (const phase of ["waiting", "thinking", "tool", "completed-effect"] as const) test(`actual Host kill/restart preserves ${phase} without replay`, async () => {
  const spawn = async (hold: boolean, effect = false) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../../workbench/test/fixtures/host-process.ts")], {
      env: { ...process.env, WHYJ_TEST_HOLD_TOOL: hold ? "1" : "", WHYJ_TEST_EFFECT_TOOL: effect ? "1" : "" }, stdout: "pipe", stderr: "pipe",
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
  mode = phase === "waiting" || phase === "completed-effect" ? "answer" : phase === "thinking" ? "hold-thinking" : "tool"; toolSent = false;
  if (phase === "completed-effect") scriptedCalls = [() => { mode = "hold"; return [{ name: "fetch_bars", args: { symbol: "000300.SH", market: "A" } }]; }];
  let processHost = await spawn(phase === "tool", phase === "completed-effect");
  try {
    let rpc = await rpcClient(processHost.url);
    const identity = await rpc<SessionSnapshot["identity"]>("identity");
    const target = phase === "tool" ? await rpc<{ sessionId: string }>("createSession") : identity;
    let savedReport: { reference: { workspaceId: string; sessionId: string; artifactId: string; sha256: string }; original: SavedResearch; stored: ReturnType<typeof loadArtifactSnapshot> } | undefined;
    if (phase === "waiting") {
      const completed = await rpc<{ runId: string; sessionId: string }>("submit", [{ workspaceId: identity.workspaceId, sessionId: target.sessionId, requestId: randomUUID(), expectedRevision: (await rpc<SessionSnapshot>("session", [target.sessionId])).revision!, text: "先保存一份完整报告" }]);
      let finished = await rpc<SessionSnapshot>("session", [target.sessionId]);
      for (let i = 0; i < 300 && finished.state === "running"; i++) { await Bun.sleep(10); finished = await rpc<SessionSnapshot>("session", [target.sessionId]); }
      expect(finished.state).toBe("settled");
      const artifact = await rpc<ArtifactSummary>("save", [{ workspaceId: identity.workspaceId, ...completed, expectedRevision: finished.revision!, expectedArtifactRevision: null }]);
      const reference = { workspaceId: identity.workspaceId, sessionId: target.sessionId, artifactId: artifact.id, sha256: artifact.sha256 };
      const original = await rpc<SavedResearch>("reload", [reference]);
      const stored = loadArtifactSnapshot(`${artifact.id}@${artifact.sha256}`);
      expect(stored).toBeDefined(); expect(original.identity.runId).toBe(completed.runId);
      savedReport = { reference, original, stored }; mode = "hold";
    }
    const requestsBeforeInterruptedRun = requests.length;
    const submitted = await rpc<{ runId: string }>("submit", [{ workspaceId: identity.workspaceId, sessionId: target.sessionId, requestId: randomUUID(), expectedRevision: (await rpc<SessionSnapshot>("session", [target.sessionId])).revision!, text: "受控中断测试 " + phase }]);
    for (let i = 0; i < 400; i++) {
      const current = await rpc<SessionSnapshot>("session", [target.sessionId]);
      if (phase === "tool" ? existsSync(join(root, "tool-receipt")) : phase === "thinking" ? current.turns.at(-1)?.phase === "thinking"
        : phase === "completed-effect" ? requests.length > requestsBeforeInterruptedRun + 1 && createWorkbenchSessionStore().load(identity.workspaceId, target.sessionId).record.snapshot.turns.at(-1)?.activity?.some(item => item.name === "fetch_bars" && item.state === "completed")
        : requests.length > requestsBeforeInterruptedRun) break;
      await Bun.sleep(10);
    }
    expect(requests.length).toBeGreaterThan(requestsBeforeInterruptedRun);
    if (phase === "thinking") expect((await rpc<SessionSnapshot>("session", [target.sessionId])).turns.at(-1)?.phase).toBe("thinking");
    if (phase === "tool") expect(readFileSync(join(root, "tool-receipt"), "utf8")).toBe("started\n");
    if (phase === "completed-effect") {
      expect(readFileSync(join(root, "completed-effect-receipt"), "utf8")).toBe("completed\n");
      expect(createWorkbenchSessionStore().load(identity.workspaceId, target.sessionId).record.snapshot.turns.at(-1)?.activity).toEqual(expect.arrayContaining([expect.objectContaining({ name: "fetch_bars", state: "completed" })]));
      expect(requests.length).toBeGreaterThan(requestsBeforeInterruptedRun + 1);
    }
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
    if (savedReport) {
      expect(loadArtifactSnapshot(`${savedReport.reference.artifactId}@${savedReport.reference.sha256}`)).toEqual(savedReport.stored);
      expect(await rpc<SavedResearch>("reload", [savedReport.reference])).toEqual(savedReport.original);
      expect(requests.length).toBe(count);
    }
    if (phase === "completed-effect") {
      await expect(rpc("continue", [{ workspaceId: identity.workspaceId, sessionId: target.sessionId, previousRunId: submitted.runId,
        requestId: randomUUID(), expectedRevision: recovered.revision! }])).rejects.toThrow("CONTINUE_UNSAFE");
      expect(requests.length).toBe(count);
      expect(readFileSync(join(root, "completed-effect-receipt"), "utf8")).toBe("completed\n");
    }
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
    if (phase === "completed-effect") expect(readFileSync(join(root, "completed-effect-receipt"), "utf8")).toBe("completed\n");
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
    const id = randomUUID(), date = new Date(Date.UTC(2026, 9, 20 + i % 3)).toISOString();
    await store.save({ ...template, sessionId: id, name: "历史 " + i, updatedAt: date,
      snapshot: { ...template.snapshot, identity: { ...template.snapshot.identity, sessionId: id }, turns: [{ id: "history", role: "assistant", state: "settled", text: "payload".repeat(10000), at: date }] } }, null);
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
  const reconnects: Array<{ latencyMs: number; bytes: number }> = [];
  for (let i = 0; i < 3; i++) {
    const started = performance.now();
    const response = await fetch(url + "/api/workbench/events", { headers: { "x-workbench-token": token } });
    const reader = response.body!.getReader(), chunk = await reader.read();
    reconnects.push({ latencyMs: performance.now() - started, bytes: chunk.value!.byteLength }); await reader.cancel();
    const frame = new TextDecoder().decode(chunk.value); expect(frame).toContain('"type":"ready"'); expect(frame).not.toContain("payload");
  }
  expect(loads).toBe(0); expect(agents).toBe(0);
  const before = performance.now(); const snapshot = await service.client.session(rows.find(row => row.name === "历史 0")!.sessionId);
  expect(snapshot.turns[0]?.text).toHaveLength(70000); expect(loads).toBe(1); expect(agents).toBe(0);
  const selectedReadMs = performance.now() - before;
  const historicalDays = new Set(rows.filter(row => row.name.startsWith("历史 ")).map(row => store.load(identity.workspaceId, row.sessionId).record.updatedAt.slice(0, 10)));
  expect(historicalDays.size).toBe(3);
  const memory: Array<{ turns: number; rss: number; heapUsed: number; agents: number; cleanups: number }> = [];
  const sample = (turns: number) => { Bun.gc(true); const usage = process.memoryUsage(); memory.push({ turns, rss: usage.rss, heapUsed: usage.heapUsed, agents, cleanups }); };
  sample(0);
  for (let i = 0; i < 12; i++) {
    await service.client.submit(await requestFor(service.client, identity, "资源释放检查 " + i));
    await terminal(service.client, identity.sessionId);
    if ((i + 1) % 4 === 0) sample(i + 1);
  }
  expect(agents).toBe(12); expect(cleanups).toBe(12);
  expect(readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"))).toHaveLength(1);
  console.log(JSON.stringify({ fixture: "30 histories x 70000 characters, timestamps across three simulated days; same process includes test and model server", listMs, selectedReadMs, listBytes: Buffer.byteLength(JSON.stringify(rows)), selectedBytes: Buffer.byteLength(JSON.stringify(snapshot)), reconnects, memory }));
}, 120_000);
});


test("missing original context fails explicitly without a provider call or a replacement journal", async () => {
  const { client, identity, submit } = await setup(); await submit("保存原始上下文"); await terminal(client, identity.sessionId);
  await service!.close(); service = undefined;
  const files = readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"));
  expect(files).toHaveLength(1); rmSync(join(root, "sessions", String(files[0])));
  const count = requests.length; service = createWorkbenchService({ cwd: root });
  await expect(service.terminal.suggestReferences({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, input: "@evidence:" })).rejects.toMatchObject({ code: "CONTEXT_MISSING" });
  await service.client.submit(await requestFor(service.client, identity, "无法恢复时不能假装记得"));
  const stopped = await terminal(service.client, identity.sessionId);
  expect(stopped.state).toBe("failed"); expect(stopped.turns.at(-1)?.text).toContain("原研究上下文无法读取");
  expect(requests.length).toBe(count);
  expect(readdirSync(join(root, "sessions"), { recursive: true }).filter(name => String(name).endsWith(".jsonl"))).toHaveLength(0);
});

async function thinking(client: WorkbenchClient, id: string, text: string) {
  for (let i = 0; i < 250; i++) { const value = await client.session(id); if (value.turns.at(-1)?.thinking?.includes(text)) return value; await Bun.sleep(10); }
  throw new Error("Thinking delta did not arrive");
}
test("thinking streams before the answer, redacts split secrets, and persists without replay", async () => {
  mode = "stream-thinking"; const { client, identity, submit } = await setup(); await submit("显示实际返回的思考文本");
  const first = await thinking(client, identity.sessionId, "第一段");
  expect(first.turns[1]?.text).toBe(""); expect(first.turns[1]?.phase).toBe("thinking");
  releaseThinking!(); const second = await thinking(client, identity.sessionId, "第二段");
  expect(second.turns[1]?.thinking).not.toContain(streamCredential.slice(0, 10));
  releaseThinking!(); const done = await terminal(client, identity.sessionId);
  expect(done.turns[1]?.thinking).toBe("第一段：核对数据日期。第二段：对照风险。[REDACTED] 已完成核对。");
  expect(done.turns[1]?.text).toBe("这是最终回答，假设结果。");
  const count = requests.length; await service!.close(); service = createWorkbenchService({ cwd: root });
  expect((await service.client.session(identity.sessionId)).turns[1]?.thinking).toBe(done.turns[1]?.thinking);
  expect(requests.length).toBe(count);
});
test("cancelling thinking retains its partial text and does not turn it into an answer", async () => {
  mode = "stream-thinking"; const { client, identity, submit } = await setup(); const run = await submit("停止思考流");
  await thinking(client, identity.sessionId, "第一段"); releaseThinking!(); await thinking(client, identity.sessionId, "第二段"); await client.cancel({ workspaceId: identity.workspaceId, ...run });
  const stopped = await client.session(identity.sessionId);
  expect(stopped.state).toBe("cancelled"); expect(stopped.turns[1]?.thinking).toBe("第一段：核对数据日期。第二段：对照风险。");
  expect(stopped.turns[1]?.text).not.toContain("第一段");
});
test("thinking across tool-separated assistant messages is aggregated once in original order", async () => {
  mode = "tool-thinking"; const { client, identity, submit } = await setup(); await submit("计算后继续思考");
  const done = await terminal(client, identity.sessionId);
  expect(done.state).toBe("settled"); expect(done.turns[1]?.thinking).toBe("先规划计算。\n\n再核对结果。");
  expect(done.turns[1]?.activity?.[0]?.state).toBe("completed");
});

for (const slot of ["WHYJ_QUANT_TUSHARE_TOKEN", "WHYJ_QUANT_FINANCIAL_DATASETS_KEY"]) {
  test(`split thinking and checkpoints redact ${slot} with the shared collector`, async () => {
    mode = "stream-thinking"; streamCredential = "dummy-stream-data-secret-" + slot;
    const settings = readSettings(); settings.env = { ...settings.env, [slot]: streamCredential }; saveSettings(settings);
    const { client, identity, submit } = await setup(); await submit("Synthetic streaming credential projection");
    for (let i = 0; !releaseThinking && i < 100; i++) await Bun.sleep(5);
    expect(typeof releaseThinking).toBe("function"); releaseThinking!();
    let partial = await client.session(identity.sessionId);
    for (let i = 0; !partial.turns.at(-1)?.thinking?.includes("第二段") && i < 100; i++) { await Bun.sleep(5); partial = await client.session(identity.sessionId); }
    expect(partial.turns.at(-1)?.thinking).toContain("第二段");
    expect(JSON.stringify(partial)).not.toContain(streamCredential.slice(0, 10));
    releaseThinking!(); const ended = await terminal(client, identity.sessionId);
    expect(JSON.stringify(ended)).not.toContain(streamCredential);
    expect(ended.turns.at(-1)?.text).toContain("最终回答");
    await service!.close();
    expect(JSON.stringify(createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record)).not.toContain(streamCredential);
  });
}


test("authorization credentials never enter actual public snapshots or persisted checkpoints", async () => {
  mode = "tool";
  const basic = Buffer.from(KEY).toString("base64"), digest = "synthetic-private-digest";
  const raw = `Authorization: Basic ${basic}\r\nProxy-Authorization: Digest username=synthetic, response=${digest}\r\nAuthorization: Bearer ${KEY}\r\nprice: 12.00\r\nvolume: 9007199254740993\r\nzero: 0`;
  service = createWorkbenchService({ cwd: root, dependencies: () => {
    const deps = createDefaultSessionDependencies({ cwd: root });
    return { ...deps, tools: deps.tools.map(tool => tool.name !== "calculate_position_scenarios" ? tool : { ...tool, async execute(...args) {
      const value = await tool.execute(...args);
      return { ...value, content: [...value.content, { type: "text" as const, text: raw }] };
    } }) };
  } });
  const { client } = service, identity = await client.identity();
  const publicFrames: string[] = [];
  const detach = client.subscribe(event => publicFrames.push(JSON.stringify(event)));
  await client.submit(await requestFor(client, identity, "Only calculate supplied hypothetical values"));
  const finished = await terminal(client, identity.sessionId); detach();
  expect(finished.turns[1]?.activity?.[0]?.result?.text).toContain("Authorization: [REDACTED]");
  expect(finished.turns[1]?.activity?.[0]?.result?.text).toContain("volume: 9007199254740993");
  await service.close(); service = undefined;
  const checkpoint = readFileSync(join(resolveWorkbenchSessionsDir(), identity.sessionId + ".json"), "utf8");
  for (const value of [checkpoint, JSON.stringify(finished), ...publicFrames]) for (const hidden of [KEY, basic, digest]) expect(value).not.toContain(hidden);
  service = createWorkbenchService({ cwd: root });
  expect((await service.client.session(identity.sessionId)).turns[1]?.activity?.[0]?.result).toEqual(finished.turns[1]?.activity?.[0]?.result);
});

test("research source routing persists separately from overview and rejects invalid or stale changes", async () => {
  const { client, identity, submit } = await setup();
  const editable = (value: Awaited<ReturnType<WorkbenchClient["preferences"]>>) => ({ revision: value.revision, model: value.model, source: value.source, portfolio: value.portfolio, thinkingLevel: value.thinkingLevel, researchSource: value.researchSource });
  const before = await client.preferences();
  expect(before.researchSources?.map(item => item.id)).toEqual(["akshare", "tushare", "llmquant-data", "financial-datasets"]);
  expect(JSON.stringify(before)).not.toContain(KEY);
  await client.updatePreferences({ ...editable(before), researchSource: "akshare" });
  const saved = await client.preferences();
  expect(saved.researchSource).toBe("akshare"); expect(saved.source).toBe("none");
  expect(readSettings().preferences.source).toBe("akshare");
  await expect(client.updatePreferences({ ...editable(before), researchSource: "tushare" })).rejects.toThrow();
  await expect(client.updatePreferences({ ...editable(saved), researchSource: "adata" as "akshare" })).rejects.toThrow("已接入");
  await client.updatePreferences({ ...editable(saved), researchSource: undefined });
  expect((await client.preferences()).researchSource).toBe("akshare");
  mode = "hold"; const started = new Promise<void>(resolve => { reached = resolve; });
  const run = await submit("运行中不能换源"); await started;
  await expect(client.updatePreferences({ ...editable(await client.preferences()), researchSource: "tushare" })).rejects.toThrow("请先等待或停止");
  await client.cancel({ workspaceId: identity.workspaceId, ...run });
  const configured = readSettings(); configured.env.WHYJ_QUANT_TUSHARE_TOKEN = "data-credential-must-stay-local"; saveSettings(configured);
  const publicState = await client.preferences();
  expect(publicState.researchSources?.find(item => item.id === "tushare")?.credentialConfigured).toBe(true);
  expect(JSON.stringify(publicState)).not.toContain("data-credential-must-stay-local");
});

test("Web model requests consistently select Markdown instead of terminal-only formatting", async () => {
  const { submit, client, identity } = await setup(); await submit("比较两个给定指标，列一个表格");
  await terminal(client, identity.sessionId);
  const messages = requests[0]?.messages as { role: string; content: unknown }[];
  const system = JSON.stringify(messages.filter(message => ["system", "developer"].includes(message.role)));
  const user = JSON.stringify(messages.filter(message => message.role === "user"));
  expect(system).toContain("Use Markdown"); expect(system).not.toContain("NO markdown");
  expect(user).toContain("GFM table"); expect(user).not.toContain("three-line plain-text");
});


for (const localPath of [String.raw`C:\Users\synthetic-user\reports\annual.html`, "/home/synthetic-user/reports/annual.html"]) test(`local report path stays private in actual Host projections (${localPath.startsWith("/") ? "POSIX" : "Windows"})`, async () => {
  syntheticReportPath = localPath;
  const reportFile = join(root, "synthetic-report.html"), reportBytes = "<html>immutable fixture</html>";
  writeFileSync(reportFile, reportBytes);
  service = createWorkbenchService({ cwd: root, dependencies: () => {
    const dependencies = createDefaultSessionDependencies({ cwd: root });
    return { ...dependencies, beforeToolCall: () => undefined, tools: dependencies.tools.map(tool => tool.name !== "calculate_position_scenarios" ? tool : {
      ...tool, async execute() { return { content: [{ type: "text" as const, text: `Annual research saved: fixture-id\nHTML: ${localPath}\nPrice: 12.00 CNY\nDate: 2026-10-29\nURL: https://example.com/a` }], details: {} }; },
    }) };
  } });
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const url = host.server.url.origin, { token } = await (await fetch(url + "/api/workbench/bootstrap")).json() as { token: string };
  const eventsResponse = await fetch(url + "/api/workbench/events", { headers: { "x-workbench-token": token } });
  const reader = eventsResponse.body!.getReader(), decoder = new TextDecoder(); let events = "";
  const collect = (async () => { try { while (true) { const part = await reader.read(); if (part.done) break; events += decoder.decode(part.value, { stream: true }); } } catch {} })();
  const client = service.client, identity = await client.identity();
  mode = "stream-report";
  scriptedCalls = [() => [{ name: "calculate_position_scenarios", args: { shares: 100, costPerShare: 10, observedClose: 12, observationDate: "2026-10-23", currency: "CNY", changes: [0.1] } }]];
  try {
    await client.submit(await requestFor(client, identity, "Generate the synthetic report"));
    for (let i = 0; i < 300 && !releaseThinking; i++) await Bun.sleep(10);
    expect(releaseThinking).toBeDefined();
    await Bun.sleep(150);
    const partial = await client.session(identity.sessionId), partialText = JSON.stringify(partial);
    expect(partial.turns[1]?.text).toContain("Report: ");
    expect(partial.turns[1]?.text).not.toContain(localPath.slice(0, 12));
    expect(partialText).not.toContain(JSON.stringify(localPath).slice(1, -1));
    expect(events).toContain("Report: ");
    expect(events).not.toContain(JSON.stringify(localPath.slice(0, 12)).slice(1, -1));
    const remote = await fetch(url + "/api/workbench/rpc", { method: "POST", headers: { "content-type": "application/json", "x-workbench-token": token }, body: JSON.stringify({ method: "session", args: [identity.sessionId] }) });
    expect(JSON.stringify(await remote.json())).not.toContain(localPath.slice(0, 12));
    releaseThinking!(); releaseThinking = undefined;
    const finished = await terminal(client, identity.sessionId);
    expect(finished.state).toBe("settled");
    const visible = JSON.stringify(finished);
    expect(visible).not.toContain(localPath); expect(visible).not.toContain(JSON.stringify(localPath).slice(1, -1));
    expect(visible).toContain("[REDACTED]");
    for (const preserved of ["12.00 CNY", "2026-10-29", "https://example.com/a", "fixture-id"]) expect(visible).toContain(preserved);
    await Bun.sleep(250);
    expect(events).not.toContain(JSON.stringify(localPath).slice(1, -1));
    expect(events).not.toContain(JSON.stringify(localPath.slice(0, 12)).slice(1, -1));
    expect(events).toContain("Report: ");
    const record = createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record;
    expect(JSON.stringify(record.snapshot)).not.toContain(JSON.stringify(localPath).slice(1, -1));
    const dependencies = createDefaultSessionDependencies({ cwd: root });
    const metadata = (await dependencies.sessions.list({ cwd: root })).find(item => item.id === record.coreSessionId)!;
    const journal = readFileSync(metadata.path, "utf8");
    expect(journal).toContain(JSON.stringify(localPath).slice(1, -1));
    expect(readFileSync(reportFile, "utf8")).toBe(reportBytes);
    await dependencies.env.cleanup();
    await host.close(); host = undefined;
    // Model a valid checkpoint written by an older version before this projection boundary existed.
    const store = createWorkbenchSessionStore(), old = store.load(identity.workspaceId, identity.sessionId);
    const oldTurns = old.record.snapshot.turns.map(turn => turn.role !== "assistant" ? turn : { ...turn,
      text: `Legacy: ${localPath} · 12.00 CNY`,
      activity: turn.activity?.map(item => item.result ? { ...item, result: { ...item.result, text: `Annual research saved: fixture-id\nHTML: ${localPath}\nPrice: 12.00 CNY` } } : item),
    });
    await store.save({ ...old.record, snapshot: { ...old.record.snapshot, turns: oldTurns } }, old.revision);
    const checkpointPath = join(resolveWorkbenchSessionsDir(), identity.sessionId + ".json"), oldBytes = readFileSync(checkpointPath);
    service = createWorkbenchService({ cwd: root });
    const oldProjection = await service.client.session(identity.sessionId);
    expect(JSON.stringify(oldProjection)).not.toContain(JSON.stringify(localPath).slice(1, -1));
    expect(oldProjection.turns.at(-1)?.text).toContain("Legacy: [REDACTED] · 12.00 CNY");
    expect(readFileSync(checkpointPath)).toEqual(oldBytes);
    // A later run can echo private journal history after the Host was restarted.
    mode = "answer"; reply = `Reopened: ${localPath} · 12.00 CNY`;
    await service.client.submit(await requestFor(service.client, identity, "Summarize the earlier report"));
    const reopened = await terminal(service.client, identity.sessionId);
    expect(reopened.state).toBe("settled"); expect(reopened.turns.at(-1)?.text).toContain("Reopened: [REDACTED] · 12.00 CNY");
    expect(JSON.stringify(createWorkbenchSessionStore().load(identity.workspaceId, identity.sessionId).record.snapshot)).not.toContain(JSON.stringify(localPath).slice(1, -1));
    expect(readFileSync(metadata.path, "utf8").startsWith(journal)).toBe(true);
    expect(readFileSync(reportFile, "utf8")).toBe(reportBytes);
  } finally { releaseThinking?.(); releaseThinking = undefined; await reader.cancel(); await collect; }
}, 30_000);

for (const failure of ["throw", "error-result"] as const) test(`a terminal effectful ${failure} blocks a subsequent same-run effect and requires acknowledgement`, async () => {
  let effects = 0;
  const call = () => [{ name: "fetch_bars", args: { symbol: "000300.SH", market: "A" } }];
  scriptedCalls = [call, call];
  service = createWorkbenchService({ cwd: root, dependencies: () => {
    const deps = createDefaultSessionDependencies({ cwd: root });
    return { ...deps, tools: deps.tools.map(tool => tool.name !== "fetch_bars" ? tool : { ...tool, async execute() {
      effects++;
      if (failure === "throw") throw new Error("controlled uncertain effect");
      return { content: [{ type: "text" as const, text: "controlled uncertain error" }], details: { error: { code: "FIXTURE" } } };
    } }) };
  } });
  const client = service.client, identity = await client.identity();
  const first = await service.terminal.submit(await requestFor(client, identity, "失败后不要重复副作用"));
  const finished = await terminal(client, identity.sessionId), count = requests.length;
  expect(effects).toBe(1);
  expect(finished.turns.at(-1)?.activity?.[0]?.state).toBe("failed");
  expect(finished.recovery).toMatchObject({ runId: first.runId, unconfirmedTools: 1, acknowledgementRequired: true });
  await expect(service.terminal.submit(await requestFor(client, identity, "未经核对的新问题"))).rejects.toMatchObject({ code: "RECONCILE_REQUIRED" });
  expect(requests).toHaveLength(count);
  host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
  const connection = { ...await host.ready, started: false };
  const seen: SessionSnapshot[] = [];
  const view = await openTerminalSession(connection, { sessionId: identity.sessionId, onSnapshot: snapshot => seen.push(snapshot) });
  const observer = await openTerminalSession(connection, { sessionId: identity.sessionId, onSnapshot: snapshot => seen.push(snapshot) });
  try {
    const target = { workspaceId: identity.workspaceId, sessionId: identity.sessionId, runId: first.runId, expectedRevision: finished.revision! };
    await expect(view.acknowledgeRecovery({ ...target, expectedRevision: target.expectedRevision - 1 })).rejects.toThrow("Recovery changed");
    expect(await view.acknowledgeRecovery(target)).toBe(true);
    for (let n = 0; n < 200 && observer.snapshot?.recovery?.acknowledgementRequired; n++) await Bun.sleep(10);
    expect(observer.snapshot?.recovery?.acknowledgementRequired).toBe(false);
    expect((await client.session(identity.sessionId)).recovery?.acknowledgementRequired).toBe(false);
    expect(seen.some(snapshot => snapshot.recovery?.acknowledgementRequired === false)).toBe(true);
    expect(effects).toBe(1); expect(requests).toHaveLength(count);
  } finally { await view.detach(); await observer.detach(); }
}, 30000);
