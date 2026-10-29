import { describe, expect, test } from "bun:test";
import { createDemoClient } from "../dev/demo-client";
import { createDisconnectedClient } from "../src/client/disconnected";
import { createWorkbenchStore } from "../src/state/workbench-store";
import type { SessionSnapshot, WorkbenchEvent } from "../src/client/contract";

const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const request = { workspaceId: "demo-workspace", sessionId: "empty", requestId: "demo-request", expectedRevision: 0, text: "研究回撤结构" };

describe("client lifecycle and presentation isolation", () => {
  test("accepted submissions refresh the authoritative auto-name and run count without reload", async () => {
    const client = createDemoClient({ settleAfterMs: 60_000 });
    let summaries = [...await client.workspaces()];
    const store = createWorkbenchStore({ ...client, workspaces: async () => summaries, submit: async input => {
      const run = await client.submit(input);
      summaries = summaries.map(row => row.sessionId === input.sessionId ? { ...row, name: input.text, runCount: row.runCount + 1 } : row);
      return run;
    } });
    const release = store.connect(); await tick(); await store.select("empty");
    try {
      expect(await store.submit("Compare supplied scenarios")).toBe(true);
      expect(store.getSnapshot().sessions.find(row => row.sessionId === "empty")).toMatchObject({ name: "Compare supplied scenarios", runCount: 1 });
    } finally { await store.cancel(); release(); }
  });
  test("a summary refresh failure does not reject an already accepted question", async () => {
    const client = createDemoClient({ settleAfterMs: 60_000 });
    const store = createWorkbenchStore({ ...client, workspaces: async () => { throw new Error("List unavailable"); } });
    await store.select("empty");
    try { expect(await store.submit("Accepted only once")).toBe(true); expect((await client.transcript("empty")).filter(turn => turn.role === "user")).toHaveLength(1); }
    finally { await store.cancel(); }
  });
  test("detaching never cancels shared work; cancellation is explicit", async () => {
    const client = createDemoClient({ settleAfterMs: 60_000 });
    const events: WorkbenchEvent[] = [];
    const release = client.subscribe(event => events.push(event));
    const { runId } = await client.submit(request);
    release();
    const count = events.length;
    expect((await client.session("empty")).identity.runId).toBe(runId);
    expect((await client.session("empty")).state).toBe("running");
    await client.cancel({ workspaceId: request.workspaceId, sessionId: request.sessionId, runId });
    expect(events.length).toBe(count);
    expect((await client.session("empty")).state).toBe("cancelled");
  });
  test("cancelled runs cannot be resurrected by delayed completion", async () => {
    const client = createDemoClient({ settleAfterMs: 10 });
    const result = await client.submit(request);
    await client.cancel({ workspaceId: request.workspaceId, ...result });
    await new Promise(resolve => setTimeout(resolve, 30));
    const snapshot = await client.session("empty");
    expect(snapshot.state).toBe("cancelled");
    expect(snapshot.turns[1]?.state).toBe("cancelled");
  });
  test("sessions keep distinct transcripts and exact run cancellation", async () => {
    const client = createDemoClient({ settleAfterMs: 60_000 });
    const first = await client.submit(request);
    const second = await client.submit({ ...request, sessionId: "sample", text: "另一个会话" });
    await client.cancel({ workspaceId: request.workspaceId, ...first });
    expect((await client.session("sample")).state).toBe("running");
    expect((await client.transcript("empty")).map(t => t.role)).toEqual(["user", "assistant"]);
    expect((await client.transcript("empty"))[0]?.text).toBe(request.text);
    await client.cancel({ workspaceId: request.workspaceId, ...second });
  });
  test("missing source stays missing and sample output remains labelled", async () => {
    const client = createDemoClient();
    expect((await client.session("empty")).market.quotes).toHaveLength(0);
    expect((await client.session("empty")).output.conclusion.statement).toBeNull();
    const sample = await client.session("sample");
    expect(sample.output.evidence.every(e => e.label.includes("示例"))).toBe(true);
    expect(sample.output.artifacts.every(a => a.title.includes("示例") && a.sha256.length === 64)).toBe(true);
    await client.updatePreferences({ model: "named-model", source: "akshare", portfolio: "光通信观察组" });
    expect((await client.session("sample")).market.quotes).toHaveLength(0);
    expect((await client.session("sample")).output).toEqual(sample.output);
  });
  test("default application refuses absent Host; never fabricates references or success", async () => {
    const client = createDisconnectedClient();
    expect(client.mode).toBe("disconnected");
    await expect(client.submit(request)).rejects.toThrow("Host 未连接");
    await expect(client.references("sample", "")).rejects.toThrow("Host 未连接");
  });
  test("preference failures reach the dialog caller rather than resolving as success", async () => {
    const store = createWorkbenchStore(createDisconnectedClient());
    await expect(store.preferences({ model: "not-saved", source: "none", portfolio: "" })).rejects.toThrow("Host 未连接");
    expect(store.getSnapshot().preferences.model).not.toBe("not-saved");
    expect(store.getSnapshot().error).toContain("Host 未连接");
  });
  test("a rejected session rename reports failure to its caller and preserves its name", async () => {
    const client = createDemoClient();
    const store = createWorkbenchStore({ ...client, renameSession: async () => { throw new Error("Rename rejected"); } });
    await store.select("sample");
    await expect(store.rename("new title")).rejects.toThrow("Rename rejected");
    expect((await client.workspaces()).find(s => s.sessionId === "sample")?.name).toBe("回撤结构研究");
  });
  test("reference categories include files, sessions and evidence with explicit identity", async () => {
    const refs = await createDemoClient().references("sample", "");
    expect(new Set(refs.map(r => r.kind))).toEqual(new Set(["file", "directory", "session", "evidence"]));
    expect(refs.find(r => r.kind === "evidence")?.token).toStartWith("@evidence:sample/");
  });
  test("late session loads cannot overwrite a newer selection", async () => {
    const client = createDemoClient();
    const sample = await client.session("sample");
    const empty = await client.session("empty");
    let resolveOld!: (snapshot: SessionSnapshot) => void;
    const store = createWorkbenchStore({ ...client, session: id => id === "sample" ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve(empty) });
    const old = store.select("sample");
    await store.select("empty");
    resolveOld(sample);
    await old;
    expect(store.getSnapshot().selected).toBe("empty");
    expect(store.getSnapshot().snapshot?.identity.sessionId).toBe("empty");
  });
  test("background session events do not leak into the selected transcript", async () => {
    const client = createDemoClient({ settleAfterMs: 60_000 });
    const store = createWorkbenchStore(client);
    const disconnect = store.connect();
    await tick(); await store.select("empty");
    const background = await client.submit({ ...request, sessionId: "sample" });
    expect(store.getSnapshot().snapshot?.turns).toHaveLength(0);
    disconnect();
    expect((await client.session("sample")).state).toBe("running");
    await client.cancel({ workspaceId: request.workspaceId, ...background });
  });
  test("failed submission retains the selected session and exposes the failure", async () => {
    const client = createDemoClient();
    const store = createWorkbenchStore({ ...client, submit: async () => { throw new Error("Reference unavailable"); } });
    await store.select("sample");
    expect(await store.submit("@file:missing")).toBe(false);
    expect(store.getSnapshot().error).toBe("Reference unavailable");
    expect(store.getSnapshot().snapshot?.turns).toHaveLength(2);
  });
  test("late previous-run and foreign-workspace events cannot replace the current run", async () => {
    const client = createDemoClient();
    let emit!: (event: WorkbenchEvent) => void;
    const store = createWorkbenchStore({ ...client, subscribe(listener) { emit = listener; return () => {}; } });
    const disconnect = store.connect();
    await tick();
    const identity = { workspaceId: "demo-workspace", sessionId: "sample", runId: "first" };
    emit({ type: "state", identity, state: "running" });
    emit({ type: "state", identity, state: "cancelled" });
    emit({ type: "state", identity, state: "settled" });
    expect(store.getSnapshot().snapshot?.state).toBe("cancelled");
    emit({ type: "state", identity: { ...identity, runId: "second" }, state: "running" });
    emit({ type: "state", identity, state: "running" });
    emit({ type: "state", identity: { ...identity, workspaceId: "foreign" }, state: "running" });
    expect(store.getSnapshot().snapshot?.identity.runId).toBe("second");
    expect(store.getSnapshot().snapshot?.state).toBe("running");
    disconnect();
  });
  test("a terminal update without its run identity is diagnosed instead of silently accepted", async () => {
    const client = createDemoClient();
    let emit!: (event: WorkbenchEvent) => void;
    const store = createWorkbenchStore({ ...client, subscribe(listener) { emit = listener; return () => {}; } });
    const release = store.connect();
    await tick();
    const identity = { workspaceId: "demo-workspace", sessionId: "sample", runId: "active" };
    emit({ type: "state", identity, state: "running" });
    emit({ type: "state", identity: { ...identity, runId: null }, state: "settled" });
    expect(store.getSnapshot().snapshot?.state).toBe("running");
    expect(store.getSnapshot().error).toContain("缺少运行标识");
    emit({ type: "state", identity, state: "settled" });
    expect(store.getSnapshot().snapshot?.state).toBe("settled");
    release();
  });
});
