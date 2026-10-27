import { expect, test } from "bun:test";
import { createDemoClient } from "../dev/demo-client";
import { createWorkbenchStore } from "../src/state/workbench-store";
import type { ViewStorage } from "../src/state/view-persistence";
import type { SessionSnapshot, WorkbenchClient, WorkbenchEvent } from "../src/client/contract";

function memory(): ViewStorage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
}
test("reload restores per-session drafts and selection without submitting", async () => {
  let submits = 0; const base = createDemoClient();
  const client = { ...base, submit: async () => { submits++; throw new Error("must not send"); } };
  const storage = memory(), first = createWorkbenchStore(client, storage);
  await first.load(); first.setDraft("第一条草稿"); await first.select("empty"); first.setDraft("第二条草稿");
  const second = createWorkbenchStore(client, storage); await second.load();
  expect(second.getSnapshot()).toMatchObject({ selected: "empty", draft: "第二条草稿" });
  await second.select("sample"); expect(second.getSnapshot().draft).toBe("第一条草稿"); expect(submits).toBe(0);
});
test("acceptance clears only the original unchanged draft, including background sessions", async () => {
  const base = createDemoClient(); let accept!: () => void;
  const client = { ...base, submit: async () => { await new Promise<void>(resolve => { accept = resolve; }); return { sessionId: "sample", runId: "r" }; } };
  const storage = memory(), store = createWorkbenchStore(client, storage); await store.load();
  store.setDraft("发送内容"); const sending = store.submit("发送内容"); store.setDraft("正在写的新内容"); accept(); await sending;
  expect(store.getSnapshot().draft).toBe("正在写的新内容");
  const again = store.submit("正在写的新内容"); await store.select("empty"); store.setDraft("另一个会话"); accept(); await again;
  expect(store.getSnapshot().draft).toBe("另一个会话");
  await store.select("sample"); expect(store.getSnapshot().draft).toBe("");
});
test("storage denial retains input and is diagnosed; rejection does not clear it", async () => {
  const base = createDemoClient(); const fail = () => { throw new Error("denied"); };
  const store = createWorkbenchStore({ ...base, submit: async () => { throw new Error("rejected"); } }, { getItem: fail, setItem: fail, removeItem: fail });
  await store.load(); store.setDraft("保留这条"); await store.submit("保留这条");
  expect(store.getSnapshot()).toMatchObject({ draft: "保留这条", error: "rejected" });
  expect(store.getSnapshot().storageWarning).toContain("关闭或刷新前请复制");
});
test("interrupted recovery requires explicit acknowledgement and cannot be revived by late state", async () => {
  const base = createDemoClient(); let submit = 0, ack = 0, emit!: (event: WorkbenchEvent) => void;
  let saved = { ...await base.session("sample"), state: "interrupted" as const, revision: 2, recovery: { runId: "old", unconfirmedTools: 1, acknowledgementRequired: true } };
  saved.identity = { ...saved.identity, runId: "old" };
  const client: WorkbenchClient = { ...base, session: async () => saved, submit: async () => { submit++; return { sessionId: "sample", runId: "new" }; },
    acknowledgeInterruption: async input => {
      expect(input).toEqual({ ...saved.identity, runId: "old", expectedRevision: 2 });
      ack++; saved = { ...saved, revision: 3, recovery: { ...saved.recovery, acknowledgementRequired: false } };
    },
    subscribe(listener) { emit = listener; return () => {}; } };
  const store = createWorkbenchStore(client); const detach = store.connect(); await store.load();
  store.setDraft("新问题"); expect(await store.submit("新问题")).toBe(false); expect(submit).toBe(0);
  emit({ type: "snapshot", identity: saved.identity, snapshot: { ...saved, revision: 4, state: "running", recovery: undefined } });
  expect(store.getSnapshot().snapshot?.state).toBe("interrupted");
  await store.acknowledgeInterruption(); expect(ack).toBe(1); expect(submit).toBe(0);
  expect(store.getSnapshot().draft).toBe("新问题"); expect(await store.submit("新问题")).toBe(true); detach();
});

test("a clarification answer targets its prior run and late events cannot revive the waiting turn", async () => {
  const base = createDemoClient(); let submit = 0, answers = 0, emit!: (event: WorkbenchEvent) => void;
  const initial = await base.session("sample");
  let saved: SessionSnapshot = { ...initial, identity: { ...initial.identity, runId: "question" }, state: "needs_input", revision: 2 };
  const waiting = saved;
  const client: WorkbenchClient = { ...base, session: async () => saved,
    submit: async () => { submit++; throw new Error("A clarification response must preserve the prior run"); },
    followup: async input => {
      expect(input).toMatchObject({ workspaceId: saved.identity.workspaceId, sessionId: "sample", previousRunId: "question", expectedRevision: 2, text: "明确范围" });
      expect(input.requestId).toBeTruthy(); answers++;
      saved = { ...saved, identity: { ...saved.identity, runId: "answer" }, state: "running", revision: 4 };
      return { sessionId: "sample", runId: "answer" };
    }, subscribe(listener) { emit = listener; return () => {}; },
  };
  const store = createWorkbenchStore(client); const detach = store.connect(); await store.load();
  emit({ type: "snapshot", identity: waiting.identity, snapshot: { ...waiting, revision: 3, state: "running" } });
  expect(store.getSnapshot().snapshot?.state).toBe("needs_input");
  store.setDraft("明确范围"); expect(await store.submit("明确范围")).toBe(true);
  expect(submit).toBe(0); expect(answers).toBe(1); expect(store.getSnapshot().draft).toBe("");
  expect(store.getSnapshot().snapshot?.identity.runId).toBe("answer");
  emit({ type: "snapshot", identity: waiting.identity, snapshot: { ...waiting, revision: 3, state: "settled" } });
  expect(store.getSnapshot().snapshot?.identity.runId).toBe("answer"); detach();
});

test("renaming refreshes the session revision before the next submission", async () => {
  const base = createDemoClient(); let saved: SessionSnapshot = { ...await base.session("sample"), revision: 2 };
  const client: WorkbenchClient = { ...base, session: async () => saved,
    renameSession: async input => { expect(input.expectedRevision).toBe(2); saved = { ...saved, revision: 3 }; },
    submit: async input => { expect(input.expectedRevision).toBe(3); return { sessionId: "sample", runId: "after-rename" }; },
  };
  const store = createWorkbenchStore(client); await store.load(); await store.rename("新名称");
  expect(store.getSnapshot().snapshot?.revision).toBe(3); expect(await store.submit("重命名后继续" )).toBe(true);
});
