import { expect, test } from "bun:test";
import { openTerminalSession } from "../terminal-session.ts";
import { createHostClient } from "../client.ts";
import type { HostConnection } from "../../bootstrap.ts";
import type { SessionSnapshot, WorkbenchClient, WorkbenchEvent, RunIdentity, SubmitRequest } from "../../../types/workbench.ts";
import type { TerminalClient, TerminalContext, TerminalCommandIdentity, TerminalCommandReceipt, TerminalQueueRequest, TerminalQueueReceipt, TerminalReferenceResult, TerminalRestoreReceipt, TerminalRestoreRequest, TerminalResearchRequest } from "../../../types/terminal.ts";
import type { ResearchTaskSpec } from "../../../types/research-task.ts";

const connection: HostConnection = { url: "http://127.0.0.1:12345", workspaceId: "w", instanceId: "instance",
  token: "a".repeat(64), controlToken: "b".repeat(64), protocolVersion: 1, serviceContractVersion: 4, applicationVersion: "1.4.0", started: false };
const snapshot = (id: string, revision = 0): SessionSnapshot => ({ identity: { workspaceId: "w", sessionId: id, runId: "run-" + id }, revision, state: "running", turns: [],
  market: { refreshedAt: "", quotes: [], source: { provider: null, updatedAt: null, available: 0, total: 0 } },
  output: { conclusion: { statement: null, confidence: null, boundary: null, settled: false }, evidence: [], artifacts: [] } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) };
}

test("private context cannot repaint after a newer read, selection, public revision or detach", async () => {
  const pending: ReturnType<typeof deferred<TerminalContext>>[] = [];
  let emit!: (event: WorkbenchEvent) => void;
  const base = createHostClient({ baseUrl: connection.url, fetch: async () => { throw new Error("Unexpected transport operation"); } });
  const client: WorkbenchClient & Pick<TerminalClient, "context"> = { ...base, identity: async () => snapshot("first").identity,
    session: async id => snapshot(id), subscribe: listener => { emit = listener; return () => {}; },
    context: async () => { const next = deferred<TerminalContext>(); pending.push(next); return next.promise; },
  };
  const value = (sessionId = "first", revision = 0): TerminalContext => ({ session: snapshot(sessionId, revision), cwd: "workspace-directory", activeModel: null, latency: { ttftMs: null, tpotMs: null }, coreSessionId: "core", messages: [], thinkingText: "private", turnCount: 0, contextUsage: null, currentSession: null, composerQueue: [] });
  const view = await openTerminalSession(connection, { client, onSnapshot() {}, attach: async () => ({ clientId: "view",
    renew: async () => ({ clientId: "view", expiresAt: 0 }), detach: async () => ({ clientId: "view", expiresAt: 0 }) }) });
  try {
    const old = view.context(), latest = view.context();
    pending[1]!.resolve(value()); expect(await latest).toEqual(value());
    pending[0]!.resolve(value()); expect(await old).toBeUndefined();
    const obsolete = view.context(), newer = snapshot("first", 3);
    emit({ type: "snapshot", identity: newer.identity, snapshot: newer });
    pending[2]!.resolve(value()); expect(await obsolete).toBeUndefined();
    const switching = view.context(); await view.select("second");
    pending[3]!.resolve(value("first", 4)); expect(await switching).toBeUndefined();
    const detached = view.context(); await view.detach();
    pending[4]!.resolve(value("second")); expect(await detached).toBeUndefined();
  } finally { await view.detach(); }
});

test("confirmed selected snapshots reject stale revisions, changed selection and detach", async () => {
  let pending: ReturnType<typeof deferred<SessionSnapshot>> | undefined, emit!: (event: WorkbenchEvent) => void;
  const base = createHostClient({ baseUrl: connection.url, fetch: async () => { throw new Error("Unexpected transport operation"); } });
  const client: WorkbenchClient = { ...base, identity: async () => snapshot("first").identity,
    session: async id => id === "first" && pending ? pending.promise : snapshot(id),
    subscribe: listener => { emit = listener; return () => {}; } };
  const view = await openTerminalSession(connection, { client, onSnapshot() {}, attach: async () => ({ clientId: "view",
    renew: async () => ({ clientId: "view", expiresAt: 0 }), detach: async () => ({ clientId: "view", expiresAt: 0 }) }) });
  try {
    pending = deferred<SessionSnapshot>(); const stale = view.confirmSelectedSnapshot(), newer = snapshot("first", 3);
    emit({ type: "snapshot", identity: newer.identity, snapshot: newer });
    pending.resolve(snapshot("first", 2)); expect(await stale).toBeUndefined();
    pending = deferred<SessionSnapshot>(); const forged = view.confirmSelectedSnapshot();
    pending.resolve(snapshot("other", 4)); await expect(forged).rejects.toThrow("identity changed");
    pending = deferred<SessionSnapshot>(); const switching = view.confirmSelectedSnapshot();
    await view.select("second"); pending.resolve(snapshot("first", 4)); expect(await switching).toBeUndefined();
    await view.select("first");
    pending = deferred<SessionSnapshot>(); const detached = view.confirmSelectedSnapshot();
    await view.detach(); pending.resolve(snapshot("first", 5)); expect(await detached).toBeUndefined();
  } finally { await view.detach(); }
});

test("skill suggestions cannot steal research interruption or repaint a different selected view", async () => {
  let pending = deferred<TerminalCommandReceipt>();
  const base = createHostClient({ baseUrl: connection.url, fetch: async () => { throw new Error("Unexpected transport operation"); } });
  const cancelled: RunIdentity[] = [];
  const client = { ...base, identity: async () => snapshot("first").identity, session: async (id: string) => snapshot(id), subscribe: () => () => {},
    command: async (input: SubmitRequest) => { expect(input.text).toBe("/skill list"); return pending.promise; },
    cancel: async (identity: RunIdentity) => { cancelled.push(identity); },
    cancelCommand: async () => { throw new Error("Suggestions must not become the interruption target"); } };
  const view = await openTerminalSession(connection, { client, onSnapshot: () => {}, attach: async () => ({ clientId: "view",
    renew: async () => ({ clientId: "view", expiresAt: 0 }), detach: async () => ({ clientId: "view", expiresAt: 0 }) }) });
  const receipt = (data: unknown): TerminalCommandReceipt => ({ workspaceId: "w", sessionId: "first", requestId: "catalog", revision: 0,
    result: { success: true, message: "", data } });
  try {
    const reading = view.skills();
    expect(await view.interrupt()).toBe(true);
    expect(cancelled).toEqual([{ workspaceId: "w", sessionId: "first", runId: "run-first" }]);
    await view.select("second");
    pending.resolve(receipt([{ name: "old", description: "Old view", scope: "project" }]));
    expect(await reading).toEqual([]);
    pending = deferred<TerminalCommandReceipt>(); const invalid = view.skills();
    pending.resolve(receipt([{ name: "bad", description: {}, scope: "project" }]));
    await expect(invalid).rejects.toThrow("catalog is invalid");
    pending = deferred<TerminalCommandReceipt>(); const detached = view.skills();
    await view.detach(); pending.resolve(receipt([{ name: "late", description: "Detached", scope: "project" }]));
    expect(await detached).toEqual([]);
  } finally { await view.detach(); }
});

test("reference suggestions discard older queries, new runs, selection changes and detached results without taking cancellation ownership", async () => {
  const pending: ReturnType<typeof deferred<TerminalReferenceResult>>[] = [], cancelled: RunIdentity[] = [];
  let emit!: (event: WorkbenchEvent) => void;
  const base = createHostClient({ baseUrl: connection.url, fetch: async () => { throw new Error("Unexpected transport operation"); } });
  const client = { ...base, identity: async () => snapshot("first").identity, session: async (id: string) => snapshot(id),
    subscribe: (listener: (event: WorkbenchEvent) => void) => { emit = listener; return () => {}; },
    suggestReferences: async () => { const next = deferred<TerminalReferenceResult>(); pending.push(next); return next.promise; },
    cancel: async (identity: RunIdentity) => { cancelled.push(identity); } };
  const view = await openTerminalSession(connection, { client, onSnapshot() {}, attach: async () => ({ clientId: "view",
    renew: async () => ({ clientId: "view", expiresAt: 0 }), detach: async () => ({ clientId: "view", expiresAt: 0 }) }) });
  const value = (sessionId = "first"): TerminalReferenceResult => ({ workspaceId: "w", sessionId, runId: "run-" + sessionId,
    items: [{ kind: "evidence", label: "Selected result", fill: "@evidence:core/entry " }] });
  try {
    const old = view.references("@e"), latest = view.references("@evidence:");
    pending[1]!.resolve(value()); expect(await latest).toEqual(value().items);
    pending[0]!.resolve(value()); expect(await old).toEqual([]);
    const obsolete = view.references("@evidence:");
    const previous = snapshot("first", 2), newer = { ...previous, identity: { ...previous.identity, runId: "new-run" } };
    emit({ type: "snapshot", identity: newer.identity, snapshot: newer });
    pending[2]!.resolve(value()); expect(await obsolete).toEqual([]);
    const switching = view.references("@evidence:"); await view.select("second");
    pending[3]!.resolve(value()); expect(await switching).toEqual([]);
    const detached = view.references("@file:");
    await view.interrupt(); expect(cancelled).toEqual([{ workspaceId: "w", sessionId: "second", runId: "run-second" }]);
    await view.detach(); pending[4]!.resolve(value("second")); expect(await detached).toEqual([]);
  } finally { await view.detach(); }
});

test("selection keeps the newest observed snapshot; a pending cancellation stays bound to its original run", async () => {
  let emit!: (event: WorkbenchEvent) => void, detachCount = 0;
  const seen: SessionSnapshot[] = [], cancelled: RunIdentity[] = [];
  const selected = deferred<SessionSnapshot>(), cancellation = deferred<void>();
  const base = createHostClient({ baseUrl: connection.url, fetch: async () => { throw new Error("Unexpected transport operation"); } });
  const client: WorkbenchClient = { ...base, identity: async () => snapshot("first").identity,
    session: async id => id === "second" ? selected.promise : snapshot(id),
    subscribe: listener => { emit = listener; return () => {}; },
    cancel: async identity => { cancelled.push(identity); await cancellation.promise; },
  };
  const view = await openTerminalSession(connection, { client, onSnapshot: state => seen.push(state), attach: async () => ({ clientId: "view",
    renew: async () => ({ clientId: "view", expiresAt: 0 }), detach: async () => { detachCount++; return { clientId: "view", expiresAt: 0 }; } }) });
  try {
    const changing = view.select("second");
    await expect(view.submit("must wait for selection")).rejects.toThrow("selected session");
    const newer = snapshot("second", 5);
    emit({ type: "snapshot", identity: newer.identity, snapshot: newer });
    selected.resolve(snapshot("second", 1)); await changing;
    expect(view.snapshot?.revision).toBe(5);
    const stopping = view.cancel();
    await view.select("third"); cancellation.resolve(); await stopping;
    expect(cancelled).toEqual([{ workspaceId: "w", sessionId: "second", runId: "run-second" }]);
    const late = { ...snapshot("second", 6), state: "cancelled" as const };
    emit({ type: "snapshot", identity: late.identity, snapshot: late });
    expect(view.snapshot?.identity.sessionId).toBe("third");
    expect(seen.at(-1)?.state).toBe("running");
    await view.detach(); await view.detach();
    expect(detachCount).toBe(1); expect(cancelled).toHaveLength(1);
  } finally { cancellation.resolve(); await view.detach(); }
});

test("an accepted submission completing after detach does not refresh or cancel the Host", async () => {
  const accepted = deferred<{ sessionId: string; runId: string }>();
  let reads = 0, cancelled = 0;
  const base = createHostClient({ baseUrl: connection.url, fetch: async () => { throw new Error("Unexpected transport operation"); } });
  const client: WorkbenchClient = { ...base, identity: async () => snapshot("first").identity,
    session: async id => { reads++; return { ...snapshot(id), state: "idle" }; }, submit: async () => accepted.promise,
    cancel: async () => { cancelled++; }, subscribe: () => () => {},
  };
  const view = await openTerminalSession(connection, { client, onSnapshot() {}, attach: async () => ({ clientId: "view",
    renew: async () => ({ clientId: "view", expiresAt: 0 }), detach: async () => ({ clientId: "view", expiresAt: 0 }) }) });
  const pending = view.submit("continue after detach"); await view.detach();
  accepted.resolve({ sessionId: "first", runId: "accepted" });
  expect(await pending).toEqual({ sessionId: "first", runId: "accepted" });
  expect(reads).toBe(1); expect(cancelled).toBe(0);
});

for (const detach of [false, true]) test(`terminal queued input survives ${detach ? "detach" : "selection change"} without retargeting or replay`, async () => {
  const completed = deferred<TerminalQueueReceipt>(); let submitted: TerminalQueueRequest | undefined, reads = 0, submissions = 0;
  const base = createHostClient({ baseUrl: connection.url, fetch: async () => { throw new Error("Unexpected transport operation"); } });
  const view = await openTerminalSession(connection, { onSnapshot() {}, client: { ...base,
    identity: async () => snapshot("first").identity, session: async id => { reads++; return snapshot(id); }, subscribe: () => () => {},
    enqueue: async input => { submitted = input; return completed.promise; }, submit: async () => { submissions++; throw new Error("Unexpected new run"); },
  }, attach: async () => ({ clientId: "view", renew: async () => ({ clientId: "view", expiresAt: 0 }), detach: async () => ({ clientId: "view", expiresAt: 0 }) }) });
  try {
    const pending = view.submit("Queued original");
    expect(submitted).toMatchObject({ sessionId: "first", runId: "run-first", text: "Queued original" });
    if (detach) await view.detach(); else await view.select("second");
    const before = reads;
    completed.resolve({ workspaceId: "w", sessionId: "first", runId: "run-first", requestId: submitted!.requestId, mode: "followUp" });
    expect((await pending).runId).toBe("run-first");
    expect(reads).toBe(before); expect(submissions).toBe(0);
    expect(view.snapshot?.identity.sessionId).toBe(detach ? "first" : "second");
  } finally { await view.detach(); }
});

for (const detach of [false, true]) test(`terminal command ${detach ? "detach" : "selection change"} preserves original command identity and ignores its late refresh`, async () => {
  const completed = deferred<TerminalCommandReceipt>();
  let submitted: SubmitRequest | undefined, reads = 0;
  const cancellations: TerminalCommandIdentity[] = [];
  const base = createHostClient({ baseUrl: connection.url, fetch: async () => { throw new Error("Unexpected transport operation"); } });
  const view = await openTerminalSession(connection, { onSnapshot() {}, client: { ...base,
    identity: async () => snapshot("first").identity,
    session: async id => { reads++; return snapshot(id); }, subscribe: () => () => {},
    command: async input => { submitted = input; return completed.promise; },
    cancelCommand: async input => { cancellations.push(input); },
  }, attach: async () => ({ clientId: "view", renew: async () => ({ clientId: "view", expiresAt: 0 }), detach: async () => ({ clientId: "view", expiresAt: 0 }) }) });
  try {
    const pending = view.command("/compact");
    expect(submitted?.sessionId).toBe("first");
    if (detach) await view.detach();
    else {
      await view.select("second");
      expect(await view.cancelCommand()).toBe(true);
      expect(cancellations).toEqual([{ workspaceId: "w", sessionId: "first", requestId: submitted!.requestId }]);
    }
    const before = reads;
    completed.resolve({ workspaceId: "w", sessionId: "first", requestId: submitted!.requestId, revision: 2,
      selectedSessionId: "late-resume-target", result: { success: true, message: "Resumed" } });
    expect((await pending).sessionId).toBe("first");
    expect(reads).toBe(before);
    expect(view.snapshot?.identity.sessionId).toBe(detach ? "first" : "second");
    expect(cancellations).toHaveLength(detach ? 0 : 1);
  } finally { await view.detach(); }
});

for (const detach of [false, true]) test(`report restore ${detach ? "detach" : "selection change"} suppresses the late selection and file-open receipt`, async () => {
  const completed = deferred<TerminalRestoreReceipt>(), cancellations: TerminalCommandIdentity[] = [];
  let submitted: TerminalRestoreRequest | undefined;
  const base = createHostClient({ baseUrl: connection.url, fetch: async () => { throw new Error("Unexpected transport operation"); } });
  const view = await openTerminalSession(connection, { onSnapshot() {}, client: { ...base,
    identity: async () => snapshot("first").identity, session: async id => snapshot(id), subscribe: () => () => {},
    restoreReport: async input => { submitted = input; return completed.promise; }, cancelCommand: async input => { cancellations.push(input); },
  }, attach: async () => ({ clientId: "view", renew: async () => ({ clientId: "view", expiresAt: 0 }), detach: async () => ({ clientId: "view", expiresAt: 0 }) }) });
  try {
    const pending = view.restoreReport("fixed-report");
    expect(submitted?.sessionId).toBe("first");
    if (detach) await view.detach(); else { await view.select("second"); expect(await view.interrupt()).toBe(true); }
    completed.resolve({ workspaceId: "w", sessionId: "first", requestId: submitted!.requestId, revision: 1,
      selectedSessionId: "report-target", filePath: "local-report", result: { success: true, message: "Restored" } });
    expect(await pending).toBeUndefined();
    expect(view.snapshot?.identity.sessionId).toBe(detach ? "first" : "second");
    expect(cancellations).toEqual(detach ? [] : [{ workspaceId: "w", sessionId: "first", requestId: submitted!.requestId }]);
  } finally { await view.detach(); }
});

test("structured submission interrupted before acceptance cancels only its captured run", async () => {
  const completed = deferred<{ sessionId: string; runId: string }>(), cancelled: RunIdentity[] = [];
  let submitted: TerminalResearchRequest | undefined;
  const idle = (id: string): SessionSnapshot => ({ ...snapshot(id), state: "idle" });
  const base = createHostClient({ baseUrl: connection.url, fetch: async () => { throw new Error("Unexpected transport operation"); } });
  const view = await openTerminalSession(connection, { onSnapshot() {}, client: { ...base,
    identity: async () => idle("first").identity, session: async id => idle(id), subscribe: () => () => {},
    submitResearch: async input => { submitted = input; return completed.promise; }, cancel: async identity => { cancelled.push(identity); },
  }, attach: async () => ({ clientId: "view", renew: async () => ({ clientId: "view", expiresAt: 0 }), detach: async () => ({ clientId: "view", expiresAt: 0 }) }) });
  try {
    const pending = view.submitResearch({ request: "fixture" } as ResearchTaskSpec, null);
    await view.select("second"); expect(await view.interrupt()).toBe(true);
    completed.resolve({ sessionId: "first", runId: "original-run" }); await pending;
    expect(submitted?.sessionId).toBe("first");
    expect(cancelled).toEqual([{ workspaceId: "w", sessionId: "first", runId: "original-run" }]);
    expect(view.snapshot?.identity.sessionId).toBe("second");
  } finally { await view.detach(); }
});

test("detaching while waiting for structured research releases the wait without cancelling its Host run", async () => {
  const listeners = new Set<(event: WorkbenchEvent) => void>(), cancelled: RunIdentity[] = [];
  const base = createHostClient({ baseUrl: connection.url, fetch: async () => { throw new Error("Unexpected transport operation"); } });
  const view = await openTerminalSession(connection, { onSnapshot() {}, client: { ...base,
    identity: async () => snapshot("first").identity, session: async id => snapshot(id),
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    cancel: async identity => { cancelled.push(identity); },
  }, attach: async () => ({ clientId: "view", renew: async () => ({ clientId: "view", expiresAt: 0 }), detach: async () => ({ clientId: "view", expiresAt: 0 }) }) });
  const waiting = view.waitResearch({ workspaceId: "w", sessionId: "first", runId: "run-first" });
  void waiting.catch(() => {}); await view.detach();
  await expect(waiting).rejects.toThrow("detached"); expect(cancelled).toEqual([]); expect(listeners.size).toBe(0);
});

test("losing the Host connection ends the structured wait without retrying or cancelling research", async () => {
  const listeners = new Set<(event: WorkbenchEvent) => void>(), cancelled: RunIdentity[] = [];
  const base = createHostClient({ baseUrl: connection.url, fetch: async () => { throw new Error("Unexpected transport operation"); } });
  const view = await openTerminalSession(connection, { onSnapshot() {}, client: { ...base,
    identity: async () => snapshot("first").identity, session: async id => snapshot(id),
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    cancel: async identity => { cancelled.push(identity); },
  }, attach: async () => ({ clientId: "view", renew: async () => ({ clientId: "view", expiresAt: 0 }), detach: async () => ({ clientId: "view", expiresAt: 0 }) }) });
  try {
    const waiting = view.waitResearch({ workspaceId: "w", sessionId: "first", runId: "run-first" });
    void waiting.catch(() => {});
    for (const listener of [...listeners]) listener({ type: "connection", connected: false, error: "disconnected" });
    await expect(waiting).rejects.toThrow("connection lost"); expect(cancelled).toEqual([]); expect(listeners.size).toBe(1);
  } finally { await view.detach(); }
});

test("structured wait confirms the terminal snapshot through the service before reporting completion", async () => {
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  let read = 0, rejectFinal!: (error: Error) => void;
  const finalRead = new Promise<SessionSnapshot>((_, reject) => { rejectFinal = reject; });
  const base = createHostClient({ baseUrl: connection.url, fetch: async () => { throw new Error("Unexpected transport operation"); } });
  const view = await openTerminalSession(connection, { onSnapshot() {}, client: { ...base,
    identity: async () => snapshot("first").identity,
    session: async id => ++read <= 2 ? snapshot(id) : finalRead,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  }, attach: async () => ({ clientId: "view", renew: async () => ({ clientId: "view", expiresAt: 0 }), detach: async () => ({ clientId: "view", expiresAt: 0 }) }) });
  try {
    let settled = false;
    const waiting = view.waitResearch({ workspaceId: "w", sessionId: "first", runId: "run-first" }).finally(() => { settled = true; });
    void waiting.catch(() => {}); await Promise.resolve();
    const complete = { ...snapshot("first", 1), state: "settled" as const };
    for (const listener of [...listeners]) listener({ type: "snapshot", identity: complete.identity, snapshot: complete });
    await Promise.resolve(); expect(settled).toBe(false); expect(read).toBe(3);
    rejectFinal(new Error("Controlled final checkpoint failure"));
    await expect(waiting).rejects.toThrow("checkpoint failure");
  } finally { await view.detach(); }
});

test("structured wait rejects a checkpoint older than its terminal event", async () => {
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  let read = 0; const stale = deferred<SessionSnapshot>();
  const base = createHostClient({ baseUrl: connection.url, fetch: async () => { throw new Error("Unexpected transport operation"); } });
  const view = await openTerminalSession(connection, { onSnapshot() {}, client: { ...base,
    identity: async () => snapshot("first").identity, session: async id => ++read <= 2 ? snapshot(id) : stale.promise,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  }, attach: async () => ({ clientId: "view", renew: async () => ({ clientId: "view", expiresAt: 0 }), detach: async () => ({ clientId: "view", expiresAt: 0 }) }) });
  try {
    const waiting = view.waitResearch({ workspaceId: "w", sessionId: "first", runId: "run-first" });
    void waiting.catch(() => {}); await Promise.resolve();
    const event = { ...snapshot("first", 8), state: "settled" as const };
    for (const listener of [...listeners]) listener({ type: "snapshot", identity: event.identity, snapshot: event });
    stale.resolve({ ...snapshot("first", 7), state: "interrupted" });
    await expect(waiting).rejects.toThrow("checkpoint is unconfirmed");
  } finally { await view.detach(); }
});


test("recovery acknowledgement targets the confirmed run and revision and never follows a changed selection", async () => {
  const initial = { ...snapshot("first", 4), state: "interrupted" as const,
    recovery: { runId: "run-first", unconfirmedTools: 1, acknowledgementRequired: true } };
  let current = initial, sent: unknown[] = [], emit!: (event: WorkbenchEvent) => void;
  const pending = deferred<void>();
  const base = createHostClient({ baseUrl: connection.url, fetch: async () => { throw new Error("Unexpected transport operation"); } });
  const client: WorkbenchClient = { ...base, identity: async () => initial.identity,
    session: async id => id === "first" ? current : { ...snapshot(id), state: "idle" },
    subscribe: listener => { emit = listener; return () => {}; },
    acknowledgeInterruption: async value => { sent.push(value); await pending.promise; } };
  const view = await openTerminalSession(connection, { client, onSnapshot() {}, attach: async () => ({ clientId: "view",
    renew: async () => ({ clientId: "view", expiresAt: 0 }), detach: async () => ({ clientId: "view", expiresAt: 0 }) }) });
  const target = { workspaceId: "w", sessionId: "first", runId: "run-first", expectedRevision: 4 };
  try {
    await expect(view.acknowledgeRecovery({ ...target, expectedRevision: 3 })).rejects.toThrow("Recovery changed");
    expect(sent).toHaveLength(0);
    const confirming = view.acknowledgeRecovery(target); expect(sent).toEqual([target]);
    await view.select("second"); pending.resolve();
    expect(await confirming).toBe(false); expect(view.snapshot?.identity.sessionId).toBe("second"); expect(sent).toHaveLength(1);
    await view.select("first"); current = { ...initial, revision: 5 };
    emit({ type: "snapshot", identity: current.identity, snapshot: current });
    await expect(view.acknowledgeRecovery(target)).rejects.toThrow("Recovery changed");
    expect(sent).toHaveLength(1);
  } finally { pending.resolve(); await view.detach(); }
});
