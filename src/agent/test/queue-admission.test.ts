import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { AgentHarness, JsonlSessionRepo } from "../src/session-runtime/index.ts";
import { NodeExecutionEnv } from "../src/session-runtime/node.ts";
import type { AgentMessage, QueueMode } from "../src/session-runtime/types.ts";
import { resolveModel } from "../src/model-config.ts";

let root: string, server: ReturnType<typeof Bun.serve>, env: NodeExecutionEnv, requests: unknown[];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "whyj-queue-admission-")); requests = [];
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    requests.push(await request.json());
    const base = { id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture" };
    return new Response([{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: `Answer ${requests.length}` }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }]
      .map(chunk => "data: " + JSON.stringify(chunk) + "\n\n").join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
});
afterEach(async () => {
  await env?.cleanup(); server.stop(true);
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected fixture root");
  rmSync(root, { recursive: true, force: true });
});
function deferred() { let resolve!: () => void; return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() }; }
async function fixture(mode: QueueMode = "one-at-a-time") {
  env = new NodeExecutionEnv({ cwd: root });
  const session = await new JsonlSessionRepo({ fs: env, sessionsRoot: root }).create({ cwd: root });
  const harness = new AgentHarness({ env, session, steeringMode: mode, followUpMode: mode,
    model: { ...resolveModel("openai", "gpt-4o", {}), api: "openai-completions", baseUrl: server.url.origin + "/v1" },
    getApiKeyAndHeaders: async () => ({ apiKey: "fixture" }) });
  return { harness, session };
}
type QueueInternals = { steerQueue: AgentMessage[]; followUpQueue: AgentMessage[];
  drainQueuedMessages(queue: AgentMessage[], mode: QueueMode): Promise<AgentMessage[]> };

for (const mode of ["one-at-a-time", "all"] as const) test(`active steer and follow-up retain ${mode} ordering`, async () => {
  const { harness, session } = await fixture(mode); let queued = false;
  harness.on("before_provider_payload", async (): Promise<undefined> => {
    if (queued) return; queued = true;
    await harness.followUp("follow-1"); await harness.followUp("follow-2");
    await harness.steer("steer-1"); await harness.steer("steer-2");
  });
  await harness.prompt("first");
  const inputs = (await session.getEntries()).flatMap(entry => entry.type === "message" && entry.message.role === "displayUser" ? [entry.message.displayText] : []);
  expect(inputs).toEqual(["first", "steer-1", "steer-2", "follow-1", "follow-2"]);
  expect(requests).toHaveLength(mode === "all" ? 3 : 5);
});

test("agent_end listeners cannot acknowledge new input while terminal work still owns the operation", async () => {
  const { harness, session } = await fixture(); const entered = deferred(), release = deferred();
  harness.subscribe(async event => { if (event.type === "agent_end") { entered.resolve(); await release.promise; } });
  const running = harness.prompt("first");
  try {
    await entered.promise; expect(harness.isIdle).toBe(false);
    await expect(harness.followUp("late-follow")).rejects.toThrow();
    await expect(harness.steer("late-steer")).rejects.toThrow();
  } finally { release.resolve(); await running; }
  expect(JSON.stringify(await session.getEntries())).not.toContain("late-");
  expect(requests).toHaveLength(1);
});

test("the final empty follow-up poll closes admission before its promise resolves", async () => {
  const { harness, session } = await fixture(); const internal = harness as unknown as QueueInternals;
  const original = internal.drainQueuedMessages; let reached = false, rejected = false;
  internal.drainQueuedMessages = async function(queue, mode) {
    const result = await original.call(this, queue, mode);
    if (!reached && queue === this.followUpQueue && !result.length) {
      reached = true;
      try { await harness.followUp("after-final-poll"); } catch { rejected = true; }
    }
    return result;
  };
  await harness.prompt("first");
  expect(reached).toBe(true); expect(rejected).toBe(true);
  expect(JSON.stringify(await session.getEntries())).not.toContain("after-final-poll");
  expect(requests).toHaveLength(1);
});

test("steering after the last steering poll is consumed in the same run", async () => {
  const { harness, session } = await fixture(); const internal = harness as unknown as QueueInternals;
  const original = internal.drainQueuedMessages; let queued = false;
  internal.drainQueuedMessages = async function(queue, mode) {
    const result = await original.call(this, queue, mode);
    if (!queued && requests.length === 1 && queue === this.steerQueue && !result.length) {
      queued = true; await harness.steer("between-final-polls");
    }
    return result;
  };
  await harness.prompt("first");
  expect(queued).toBe(true); expect(requests).toHaveLength(2);
  expect(JSON.stringify(await session.getEntries())).toContain("between-final-polls");
});

test("failed runs discard pending steer/follow-up without discarding explicit next-turn input", async () => {
  const { harness, session } = await fixture(); let failed = false, next = false;
  harness.on("before_provider_payload", async (): Promise<undefined> => {
    if (failed) return; failed = true;
    await harness.steer("stale-steer"); await harness.followUp("stale-follow");
    throw new Error("Synthetic failure before model dispatch");
  });
  harness.subscribe(async event => { if (event.type === "agent_end" && !next) { next = true; await harness.nextTurn("intentional-next"); } });
  await harness.prompt("failed-first"); await harness.prompt("independent-second");
  expect(JSON.stringify(await session.getEntries())).not.toContain("stale-");
  expect(JSON.stringify(requests)).toContain("intentional-next");
  expect(JSON.stringify(requests)).not.toContain("stale-"); expect(requests).toHaveLength(1);
});

test("abort closes admission before pending request hooks finish", async () => {
  const { harness } = await fixture(); const entered = deferred(), release = deferred();
  harness.on("before_provider_payload", async (): Promise<undefined> => { entered.resolve(); await release.promise; });
  const running = harness.prompt("first"); await entered.promise;
  const stopping = harness.abort();
  try {
    await expect(harness.followUp("after-abort")).rejects.toThrow();
    await expect(harness.steer("after-abort")).rejects.toThrow();
  } finally { release.resolve(); await Promise.all([running, stopping]); }
  expect(requests).toHaveLength(0);
});

test("compaction does not accept input intended for a model turn", async () => {
  const { harness, session } = await fixture();
  const first = await session.appendMessage({ role: "user", content: "old", timestamp: 1 });
  await session.appendMessage({ role: "user", content: "new", timestamp: 2 });
  const entered = deferred(), release = deferred();
  harness.on("session_before_compact", async () => { entered.resolve(); await release.promise;
    return { compaction: { summary: "fixture summary", firstKeptEntryId: first, tokensBefore: 1 } }; });
  const compacting = harness.compact();
  try {
    await entered.promise;
    await expect(harness.followUp("during-compaction")).rejects.toThrow();
    await expect(harness.steer("during-compaction")).rejects.toThrow();
  } finally { release.resolve(); await compacting; }
  expect(requests).toHaveLength(0);
});

test("failure persistence closes admission before waiting for the journal", async () => {
  const { harness, session } = await fixture(); const entered = deferred(), release = deferred();
  const append = session.appendMessage.bind(session);
  session.appendMessage = async message => {
    if (message.role === "assistant" && message.stopReason === "error") {
      entered.resolve(); await release.promise;
    }
    return append(message);
  };
  harness.on("before_provider_payload", () => { throw new Error("Synthetic failure"); });
  const running = harness.prompt("first");
  try {
    await entered.promise; expect(harness.isIdle).toBe(false);
    await expect(harness.followUp("late-persistence")).rejects.toThrow();
    await expect(harness.steer("late-persistence")).rejects.toThrow();
    await expect(harness.prompt("second-owner")).rejects.toThrow();
  } finally { release.resolve(); await running; }
  expect(requests).toHaveLength(0);
});

test("preparation and terminal observer failures release ownership and discard this turn's queues", async () => {
  const { harness, session } = await fixture();
  const stop = harness.on("before_agent_start", async () => {
    await harness.followUp("stale-preparation"); throw new Error("Preparation failed");
  });
  await expect(harness.prompt("first")).rejects.toThrow("Preparation failed"); stop();
  expect(harness.isIdle).toBe(true);
  await expect(harness.steer("idle-steer")).rejects.toThrow();
  await expect(harness.followUp("idle-follow")).rejects.toThrow();
  const unsubscribe = harness.subscribe(event => { if (event.type === "agent_end") throw new Error("Observer failed"); });
  await expect(harness.prompt("second")).rejects.toThrow(); unsubscribe();
  expect(harness.isIdle).toBe(true);
  await harness.prompt("third");
  expect(JSON.stringify(await session.getEntries())).not.toContain("stale-");
  expect(requests).toHaveLength(2);
});
