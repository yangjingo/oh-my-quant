import { expect, test } from "bun:test";
import { isWorkbenchSnapshot } from "../src/client/contract";
import { createHostClient } from "../src/client/host";
import { createDemoClient } from "../dev/demo-client";
import { createWorkbenchStore } from "../src/state/workbench-store";
import type { WorkbenchEvent } from "../src/client/contract";

const bootstrap = () => Response.json({ version: 1, token: "a".repeat(64) });
test("validated workspace market SSE is independent of research run snapshots", async () => {
  const event: WorkbenchEvent = { type: "market", identity: { workspaceId: "w", sessionId: "s", runId: null },
    snapshot: { refreshedAt: "2026-10-24 12:00", status: "success", quotes: [], source: { provider: "AKShare", updatedAt: null, available: 0, total: 0 } } };
  const request = (async (url: RequestInfo | URL) => String(url).endsWith("bootstrap") ? bootstrap()
    : new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(event) + "\n\n")); } }), { headers: { "Content-Type": "text/event-stream" } })) as typeof fetch;
  const client = createHostClient({ baseUrl: "http://workbench.test", fetch: request });
  let release!: () => void;
  const actual = await new Promise<WorkbenchEvent>(done => { release = client.subscribe(value => { if (value.type === "market") done(value); }); });
  release(); expect(actual).toEqual(event);
});
test("ambiguous network submission is never automatically retried", async () => {
  let submits = 0;
  const request = (async (url: RequestInfo | URL) => {
    if (String(url).endsWith("bootstrap")) return bootstrap();
    submits++; throw new Error("lost response after acceptance");
  }) as typeof fetch;
  const client = createHostClient({ baseUrl: "http://workbench.test", fetch: request });
  await expect(client.submit({ workspaceId: "w", sessionId: "s", text: "Only once" })).rejects.toThrow("不会自动重复提交");
  expect(submits).toBe(1);
});
test("an HTML success response is not accepted as a successful model save", async () => {
  const request = (async (url: RequestInfo | URL) => String(url).endsWith("bootstrap") ? bootstrap() : new Response("<html>fallback</html>")) as typeof fetch;
  const client = createHostClient({ baseUrl: "http://workbench.test", fetch: request });
  await expect(client.updatePreferences({ model: "x", source: "none", portfolio: "" })).rejects.toThrow("无效响应");
});
test("only editable model preferences cross the RPC boundary", async () => {
  let body = "";
  const request = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith("bootstrap")) return bootstrap();
    body = String(init?.body); return Response.json({ ok: true, result: null });
  }) as typeof fetch;
  const client = createHostClient({ baseUrl: "http://workbench.test", fetch: request });
  await client.updatePreferences({ revision: "rev", model: "model", thinkingLevel: "max", source: "none", researchSource: "akshare", portfolio: "", modelProvider: "not-editable", modelCredentialsConfigured: true });
  expect(JSON.parse(body)).toEqual({ method: "updatePreferences", args: [{ revision: "rev", model: "model", thinkingLevel: "max", source: "none", researchSource: "akshare", portfolio: "" }] });
});
test("SSE decodes split UTF-8 snapshots and releasing observation does not send cancellation", async () => {
  const snapshot = { ...await createDemoClient().session("sample"), revision: 2 };
  const frame = new TextEncoder().encode("data: " + JSON.stringify({ type: "snapshot", identity: snapshot.identity, snapshot }) + "\n\n");
  const events: WorkbenchEvent[] = []; const paths: string[] = [];
  const request = (async (url: RequestInfo | URL) => {
    paths.push(String(url));
    if (String(url).endsWith("bootstrap")) return bootstrap();
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < frame.length; i += 7) controller.enqueue(frame.slice(i, i + 7)); } }), { headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
  const client = createHostClient({ baseUrl: "http://workbench.test", fetch: request });
  let release!: () => void;
  await new Promise<void>(resolve => { release = client.subscribe(event => { events.push(event); if (event.type === "snapshot") { release(); resolve(); } }); });
  expect(events.find(event => event.type === "snapshot")).toMatchObject({ snapshot });
  expect(events[0]).toEqual({ type: "connection", connected: true });
  expect(paths.every(path => !path.includes("rpc"))).toBe(true);
});
test("authoritative revisions resync missed starts but never revive a cancelled run", async () => {
  const base = createDemoClient(); let emit!: (event: WorkbenchEvent) => void;
  const store = createWorkbenchStore({ ...base, subscribe(listener) { emit = listener; return () => {}; } });
  const release = store.connect(); await new Promise(resolve => setTimeout(resolve, 10));
  const initial = store.getSnapshot().snapshot!;
  const identity = { ...initial.identity, runId: "first" };
  const first = { ...initial, identity, state: "running" as const, revision: 1 };
  emit({ type: "snapshot", identity, snapshot: first });
  emit({ type: "snapshot", identity, snapshot: { ...first, revision: 2, state: "cancelled" } });
  emit({ type: "snapshot", identity, snapshot: { ...first, revision: 3, state: "settled" } });
  expect(store.getSnapshot().snapshot?.state).toBe("cancelled");
  const second = { ...identity, runId: "second" };
  emit({ type: "snapshot", identity: second, snapshot: { ...first, identity: second, revision: 4, state: "settled" } });
  expect(store.getSnapshot().snapshot?.identity.runId).toBe("second");
  emit({ type: "snapshot", identity, snapshot: { ...first, revision: 5, state: "running" } });
  expect(store.getSnapshot().snapshot?.identity.runId).toBe("second");
  emit({ type: "snapshot", identity: second, snapshot: { ...first, identity: second, revision: 1, state: "running" } });
  expect(store.getSnapshot().snapshot?.state).toBe("settled"); release();
});


test("startup ready is sufficient without replaying histories, and scoped storage errors reach observers", async () => {
  const frames = [ { type: "ready", workspaceId: "w" }, { type: "session-error", identity: { workspaceId: "w", sessionId: "s", runId: "r" }, message: "会话无法安全保存" } ] as const;
  const paths: string[] = [];
  const request = (async (url: RequestInfo | URL) => { paths.push(String(url)); if (String(url).endsWith("bootstrap")) return bootstrap();
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(frames.map(event => "data: " + JSON.stringify(event) + "\n\n").join(""))); } }), { headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
  const client = createHostClient({ baseUrl: "http://workbench.test", fetch: request });
  const events: WorkbenchEvent[] = []; let release!: () => void;
  await new Promise<void>(resolve => { release = client.subscribe(event => { events.push(event); if (event.type === "session-error") { release(); resolve(); } }); });
  expect(events).toEqual([{ type: "connection", connected: true }, frames[1]]); expect(paths).toHaveLength(2);
});


test("optional thinking survives snapshot validation while malformed thinking is rejected", async () => {
  const old = { ...await createDemoClient().session("sample"), revision: 1 };
  expect(isWorkbenchSnapshot(old)).toBe(true);
  const turns = old.turns.map(turn => turn.role === "assistant" ? { ...turn, thinking: "模型返回的过程文本" } : turn);
  expect(isWorkbenchSnapshot({ ...old, turns })).toBe(true);
  expect(isWorkbenchSnapshot({ ...old, turns: turns.map(turn => ({ ...turn, thinking: { signature: "opaque" } })) })).toBe(false);
});
