import { browserViewStorage, draftKey, selectionKey, type ViewStorage } from "./view-persistence";
import type { Preferences, SessionSnapshot, WorkbenchClient, WorkspaceSummary } from "../client/contract";

export interface ViewState {
  phase: "loading" | "ready" | "error";
  sessions: readonly WorkspaceSummary[];
  selected: string | null;
  snapshot: SessionSnapshot | null;
  preferences: Preferences;
  error: string | null;
  draft: string;
  storageWarning: string | null;
}

/** Projection owner only. Services/client own runs; views own drafts and selection. */
export function createWorkbenchStore(client: WorkbenchClient, storage: ViewStorage | undefined = client.mode === "host" ? browserViewStorage() : undefined) {
  let view: ViewState = {
    phase: "loading", sessions: [], selected: null, snapshot: null, error: null, draft: "", storageWarning: null,
    preferences: { model: "", source: "none", portfolio: "" },
  };
  const listeners = new Set<() => void>();
  let generation = 0;
  let eventRevision = 0;
  let release: (() => void) | undefined;
  const retiredRuns = new Set<string>();
  const publish = (patch: Partial<ViewState>) => {
    view = { ...view, ...patch };
    listeners.forEach(listener => listener());
  };
  const report = (error: unknown) => publish({ error: error instanceof Error ? error.message : String(error) });
  const drafts = new Map<string, string>();
  let workspace = "";
  const persistence = <T>(action: () => T): T | undefined => {
    try { return action(); } catch { publish({ storageWarning: "浏览器无法保存草稿或会话选择。当前窗口仍可使用，关闭或刷新前请复制未发送内容。" }); }
  };
  const draft = (id: string) => {
    const key = draftKey(workspace, id);
    if (!drafts.has(key)) drafts.set(key, persistence(() => storage?.getItem(key)) ?? "");
    return drafts.get(key)!;
  };
  const saveDraft = (scope: string, id: string, text: string) => {
    const key = draftKey(scope, id); drafts.set(key, text);
    persistence(() => { if (text) storage?.setItem(key, text); else storage?.removeItem(key); });
    if (scope === workspace && view.selected === id) publish({ draft: text });
  };
  const select = async (id: string) => {
    const ticket = ++generation;
    publish({ selected: id, snapshot: null, phase: "loading", error: null, draft: draft(id) });
    try {
      // A subscription event during the read invalidates that response.
      let snapshot: SessionSnapshot;
      let revision: number;
      do {
        revision = eventRevision;
        snapshot = await client.session(id);
        if (ticket !== generation) return;
      } while (revision !== eventRevision);
      publish({ snapshot, phase: "ready" });
      persistence(() => storage?.setItem(selectionKey(workspace), id));
    } catch (error) {
      if (ticket === generation) { report(error); publish({ phase: "error" }); }
    }
  };
  const load = async () => {
    const ticket = ++generation;
    publish({ phase: "loading", error: null });
    try {
      const [sessions, preferences, identity] = await Promise.all([
        client.workspaces(), client.preferences(), client.identity(),
      ]);
      if (ticket !== generation) return;
      workspace = identity.workspaceId;
      const saved = view.selected ?? persistence(() => storage?.getItem(selectionKey(workspace)));
      publish({ sessions, preferences });
      await select(sessions.some(session => session.workspaceId === workspace && session.sessionId === saved) ? saved! : identity.sessionId);
    } catch (error) {
      if (ticket === generation) { report(error); publish({ phase: "error" }); }
    }
  };
  return {
    getSnapshot: () => view,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect() {
      release?.();
      release = client.subscribe(event => {
        if (event.type === "connection") {
          if (event.connected) void load();
          else publish({ phase: "error", error: event.error ?? "研究服务连接已中断，请重新连接。" });
          return;
        }
        if (event.identity.sessionId !== view.selected) return;
        eventRevision++;
        const snapshot = view.snapshot;
        if (!snapshot) return;
        if (event.identity.workspaceId !== snapshot.identity.workspaceId) return;
        if (event.type === "session-error") {
          if (event.identity.runId === snapshot.identity.runId) report(new Error(event.message));
          return;
        }
        if (event.type === "snapshot") {
          const next = event.snapshot;
          if (next.identity.workspaceId !== event.identity.workspaceId || next.identity.sessionId !== event.identity.sessionId || next.identity.runId !== event.identity.runId
            || !Number.isSafeInteger(next.revision) || next.revision! <= (snapshot.revision ?? -1)) return;
          const oldRun = snapshot.identity.runId, newRun = next.identity.runId;
          const key = (run: string) => JSON.stringify([event.identity.workspaceId, event.identity.sessionId, run]);
          if (newRun && retiredRuns.has(key(newRun))) return;
          if (oldRun === newRun && oldRun && ["cancelled", "failed", "settled", "interrupted"].includes(snapshot.state) && !(snapshot.state === "interrupted" && next.state === "interrupted")) return;
          if (oldRun && oldRun !== newRun) retiredRuns.add(key(oldRun));
          publish({ snapshot: next, sessions: view.sessions.map(session => session.sessionId === view.selected ? { ...session, state: next.state } : session) });
          return;
        }
        const previousRun = snapshot.identity.runId;
        const eventRun = event.identity.runId;
        if (previousRun && eventRun === null && event.type === "state") {
          report(new Error("收到缺少运行标识的状态，当前研究状态未改变。请重新连接以核对。"));
          return;
        }
        const runKey = (run: string) => JSON.stringify([event.identity.workspaceId, event.identity.sessionId, run]);
        if (eventRun && retiredRuns.has(runKey(eventRun))) return;
        if (eventRun !== previousRun) {
          if (event.type !== "state" || event.state !== "running") return;
          if (previousRun) retiredRuns.add(runKey(previousRun));
        } else if (["cancelled", "failed", "settled", "interrupted"].includes(snapshot.state) && eventRun !== null) return;
        if (event.type === "turn") {
          if (snapshot.state === "cancelled" && event.identity.runId === snapshot.identity.runId) return;
          if (snapshot.identity.runId && event.identity.runId !== snapshot.identity.runId) return;
          const turns = snapshot.turns.filter(turn => turn.id !== event.turn.id);
          const oldIndex = snapshot.turns.findIndex(turn => turn.id === event.turn.id);
          turns.splice(oldIndex < 0 ? turns.length : oldIndex, 0, event.turn);
          publish({ snapshot: { ...snapshot, turns } });
        } else if (event.type === "state") {
          if (snapshot.state === "cancelled" && event.identity.runId === snapshot.identity.runId) return;
          publish({ snapshot: { ...snapshot, identity: event.identity, state: event.state }, sessions: view.sessions.map(s => s.sessionId === view.selected ? { ...s, state: event.state } : s) });
        } else publish({ snapshot: { ...snapshot, market: event.snapshot } });
      });
      void load();
      return () => { generation++; release?.(); release = undefined; };
    },
    load, select,
    setDraft(text: string) { if (view.selected) saveDraft(workspace, view.selected, text); },
    async create() {
      try { const session = await client.createSession(); publish({ sessions: await client.workspaces() }); await select(session.sessionId); }
      catch (error) { report(error); }
    },
    async rename(title: string) {
      const id = view.selected;
      if (!id) throw new Error("请先选择会话。");
      try { await client.renameSession(id, title); publish({ sessions: await client.workspaces() }); }
      catch (error) { report(error); throw error; }
    },
    async submit(text: string): Promise<boolean> {
      const snapshot = view.snapshot;
      if (!snapshot || snapshot.state === "running" || snapshot.recovery?.acknowledgementRequired) return false;
      const id = view.selected, scope = workspace;
      try {
        await client.submit({ workspaceId: snapshot.identity.workspaceId, sessionId: snapshot.identity.sessionId, text });
        if (id && drafts.get(draftKey(scope, id)) === text) saveDraft(scope, id, "");
        if (view.selected === id) await select(snapshot.identity.sessionId);
        // Submission is already accepted: a metadata refresh failure cannot turn it into a retry.
        try { const sessions = await client.workspaces(); if (workspace === scope) publish({ sessions }); } catch { /* Reconnect refreshes metadata. */ }
        return true;
      } catch (error) { if (view.selected === id) report(error); return false; }
    },
    async acknowledgeInterruption() {
      const id = view.selected, run = view.snapshot?.recovery?.runId;
      if (!run || !client.acknowledgeInterruption) return;
      try { await client.acknowledgeInterruption(run); if (view.selected === id) await select(id!); }
      catch (error) { if (view.selected === id) report(error); }
    },
    async cancel() {
      const id = view.selected;
      const run = view.snapshot?.identity.runId;
      if (!run) return;
      try { await client.cancel(run); }
      catch (error) { if (view.selected === id) report(error); }
    },
    async preferences(preferences: Preferences) {
      publish({ error: null });
      try { await client.updatePreferences(preferences); publish({ preferences: await client.preferences() }); if (view.selected) await select(view.selected); }
      catch (error) { report(error); throw error; }
    },
    clearError: () => publish({ error: null }),
  };
}
