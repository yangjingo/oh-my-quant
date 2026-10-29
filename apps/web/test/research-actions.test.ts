import { expect, test } from "bun:test";
import { createDemoClient } from "../dev/demo-client";
import { createWorkbenchStore } from "../src/state/workbench-store";
import type { ArtifactSummary, SessionSnapshot, WorkbenchClient } from "../src/client/contract";

const artifact: ArtifactSummary = { id: "workbench-sample", title: "固定记录", version: 2, sha256: "abc", createdAt: "2026-10-29", runId: "run" };
async function settled(base: WorkbenchClient): Promise<SessionSnapshot> {
  const snapshot = await base.session("sample");
  return { ...snapshot, identity: { ...snapshot.identity, runId: "run" }, revision: 8, state: "settled", output: { ...snapshot.output, artifacts: [artifact] } };
}

test("save uses the observed session and report revisions and preserves conflict errors", async () => {
  const base = createDemoClient(), snapshot = await settled(base); let calls = 0;
  const client: WorkbenchClient = { ...base, session: async () => snapshot, save: async request => {
    calls++; expect(request).toEqual({ ...snapshot.identity, runId: "run", expectedRevision: 8, expectedArtifactRevision: "abc" });
    throw new Error("版本冲突");
  } };
  const store = createWorkbenchStore(client); await store.load(); store.setDraft("保留草稿");
  await expect(store.saveReport()).rejects.toThrow("版本冲突");
  expect(calls).toBe(1); expect(store.getSnapshot().draft).toBe("保留草稿");
});

test("a delayed review never changes a newer session selection", async () => {
  const base = createDemoClient(), snapshot = await settled(base); let finish!: () => void;
  const client: WorkbenchClient = { ...base, session: async id => id === "sample" ? snapshot : base.session(id), review: async request => {
    expect(request).toMatchObject({ sessionId: "sample", artifactId: artifact.id, sha256: artifact.sha256, expectedRevision: 8, text: "重新检查" });
    await new Promise<void>(resolve => { finish = resolve; }); return { sessionId: "review", runId: "new" };
  } };
  const store = createWorkbenchStore(client); await store.load();
  const review = store.reviewReport(artifact, "重新检查"); await store.select("empty"); finish(); await review;
  expect(store.getSnapshot().selected).toBe("empty");
});

test("delete sends the observed revision and leaves another session and its draft selected", async () => {
  const base = createDemoClient(), snapshot = await settled(base); let finish!: () => void;
  const client: WorkbenchClient = { ...base, session: async id => id === "sample" ? snapshot : base.session(id), deleteSession: async request => {
    expect(request).toEqual({ workspaceId: snapshot.identity.workspaceId, sessionId: "sample", expectedRevision: 8 });
    await new Promise<void>(resolve => { finish = resolve; });
  } };
  const store = createWorkbenchStore(client); await store.load();
  const deletion = store.deleteSelected(); await store.select("empty"); store.setDraft("其他会话的草稿"); finish(); await deletion;
  expect(store.getSnapshot()).toMatchObject({ selected: "empty", draft: "其他会话的草稿" });
  expect(store.getSnapshot().sessions.some(session => session.sessionId === "sample")).toBe(false);
});

test("continue identifies the prior interrupted run without consuming the draft", async () => {
  const base = createDemoClient(), initial = await settled(base);
  const snapshot: SessionSnapshot = { ...initial, state: "cancelled" };
  const client: WorkbenchClient = { ...base, session: async () => snapshot, continue: async request => {
    expect(request).toMatchObject({ workspaceId: snapshot.identity.workspaceId, sessionId: "sample", previousRunId: "run", expectedRevision: 8 });
    expect(request.requestId).toBeTruthy(); return { sessionId: "sample", runId: "next" };
  } };
  const store = createWorkbenchStore(client); await store.load(); store.setDraft("待发送"); await store.continueRun();
  expect(store.getSnapshot().draft).toBe("待发送");
});
