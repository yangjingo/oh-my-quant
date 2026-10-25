import type { Preferences, SessionSnapshot, WorkbenchClient, WorkspaceSummary } from "../client/contract";

export interface ViewState {
  phase: "loading" | "ready" | "error";
  sessions: readonly WorkspaceSummary[];
  selected: string | null;
  snapshot: SessionSnapshot | null;
  preferences: Preferences;
  error: string | null;
}

/** Projection owner only. Services/client own runs; views own drafts and selection. */
export function createWorkbenchStore(client: WorkbenchClient) {
  let view: ViewState = {
    phase: "loading", sessions: [], selected: null, snapshot: null, error: null,
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
  const select = async (id: string) => {
    const ticket = ++generation;
    publish({ selected: id, snapshot: null, phase: "loading", error: null });
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
      publish({ sessions, preferences });
      await select(view.selected ?? identity.sessionId);
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
        if (event.identity.sessionId !== view.selected) return;
        eventRevision++;
        const snapshot = view.snapshot;
        if (!snapshot) return;
        if (event.identity.workspaceId !== snapshot.identity.workspaceId) return;
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
        } else if (["cancelled", "failed", "settled"].includes(snapshot.state) && eventRun !== null) return;
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
      if (!snapshot || snapshot.state === "running") return false;
      const id = view.selected;
      try {
        await client.submit({ workspaceId: snapshot.identity.workspaceId, sessionId: snapshot.identity.sessionId, text });
        if (view.selected === id) await select(snapshot.identity.sessionId);
        return true;
      } catch (error) { if (view.selected === id) report(error); return false; }
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
