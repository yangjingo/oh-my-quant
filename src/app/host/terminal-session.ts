import { randomUUID } from "node:crypto";
import { attachWorkspaceHost, type HostConnection } from "../bootstrap.ts";
import type { SessionSnapshot, WorkbenchClient, WorkbenchEvent } from "../../types/workbench.ts";
import { createTerminalClient } from "./terminal-client.ts";
import type { TerminalClient, TerminalCommandIdentity } from "../../types/terminal.ts";
import type { SkillEntry } from "../../types/skills.ts";
import type { ResearchTaskSpec } from "../../types/research-task.ts";
import type { RunIdentity, RunRevisionRequest } from "../../types/workbench.ts";

type SessionClient = WorkbenchClient & Partial<Pick<TerminalClient, "command" | "cancelCommand" | "context" | "enqueue" | "suggestReferences" | "restoreReport" | "submitResearch">>;

/** Owns only a terminal's selected view and presence. Execution stays in the Host. */
export async function openTerminalSession(connection: HostConnection, options: {
  sessionId?: string;
  onSnapshot: (snapshot: SessionSnapshot) => void;
  onConnection?: (connected: boolean, message?: string) => void;
  client?: SessionClient;
  attach?: typeof attachWorkspaceHost;
}) {
  const client: SessionClient = options.client ?? createTerminalClient(connection);
  const lease = await (options.attach ?? attachWorkspaceHost)(connection, "tui");
  let closed = false, generation = 0, contextGeneration = 0, referenceGeneration = 0, selected = options.sessionId ?? "";
  let current: SessionSnapshot | undefined;
  let pendingSelection: { sessionId: string; generation: number; snapshot?: SessionSnapshot } | undefined;
  let pendingCommand: TerminalCommandIdentity | undefined;
  let pendingResearch: { cancelled: boolean; run?: RunIdentity } | undefined;
  const waiters = new Set<() => void>();
  let release: (() => void) | undefined, heartbeat: ReturnType<typeof setInterval> | undefined;
  function accept(snapshot: SessionSnapshot, expected = generation) {
    if (closed || expected !== generation || snapshot.identity.workspaceId !== connection.workspaceId || snapshot.identity.sessionId !== selected) return;
    if (current && (snapshot.revision ?? -1) <= (current.revision ?? -1)) return;
    current = structuredClone(snapshot); options.onSnapshot(structuredClone(snapshot));
  }
  async function refresh(expected = generation) {
    const id = selected, snapshot = await client.session(id);
    accept(snapshot, expected); return snapshot;
  }
  function observe(event: WorkbenchEvent) {
    if (closed) return;
    if (event.type === "connection") options.onConnection?.(event.connected, event.error);
    else if (event.type === "snapshot") {
      if (pendingSelection && event.identity.workspaceId === connection.workspaceId && event.identity.sessionId === pendingSelection.sessionId
        && (event.snapshot.revision ?? -1) > (pendingSelection.snapshot?.revision ?? -1)) pendingSelection.snapshot = event.snapshot;
      accept(event.snapshot);
    }
    else if (event.type === "session-error" && event.identity.workspaceId === connection.workspaceId && event.identity.sessionId === selected)
      options.onConnection?.(false, event.message);
  }
  async function detach() {
    if (closed) return;
    closed = true; generation++; release?.(); clearInterval(heartbeat);
    for (const stop of waiters) stop();
    await lease.detach();
  }
  try {
    if (!selected) {
      const identity = await client.identity();
      if (identity.workspaceId !== connection.workspaceId) throw new Error("Terminal workspace identity changed.");
      selected = identity.sessionId;
    }
    release = client.subscribe(observe);
    await refresh();
    heartbeat = setInterval(() => {
      void lease.renew().catch(() => { if (!closed) options.onConnection?.(false, "Host presence expired; reconnect explicitly."); });
    }, 30_000);
    heartbeat.unref?.();
  } catch (error) { await detach().catch(() => {}); throw error; }
  function assertOpen() { if (closed) throw new Error("Terminal view is detached; reconnect before another action."); }
  async function select(sessionId: string) {
      assertOpen();
      // Read before switching so a missing/corrupt target does not discard this view.
      const expected = ++generation;
      pendingSelection = { sessionId, generation: expected };
      try {
        const next = await client.session(sessionId);
        if (closed || expected !== generation) return;
        if (next.identity.workspaceId !== connection.workspaceId || next.identity.sessionId !== sessionId) throw new Error("Terminal session identity changed.");
        const observed = pendingSelection?.snapshot;
        selected = sessionId; current = undefined;
        accept(observed && (observed.revision ?? -1) > (next.revision ?? -1) ? observed : next, expected);
      } finally { if (pendingSelection?.generation === expected) pendingSelection = undefined; }
  }
  return {
    get snapshot() { return current ? structuredClone(current) : undefined; },
    get selectionVersion() { return generation; },
    async interrupt() {
      if (pendingCommand) return this.cancelCommand();
      if (pendingResearch) {
        pendingResearch.cancelled = true;
        if (pendingResearch.run) await client.cancel(pendingResearch.run);
        return true;
      }
      return this.cancel();
    },
    select,
    async references(input: string) {
      assertOpen(); const snapshot = current, expected = generation, request = ++referenceGeneration;
      if (pendingSelection || !snapshot || !client.suggestReferences) throw new Error("Wait for a selected session with terminal reference support.");
      const result = await client.suggestReferences({ workspaceId: connection.workspaceId, sessionId: snapshot.identity.sessionId, input });
      if (closed || expected !== generation || request !== referenceGeneration || result.runId !== snapshot.identity.runId
        || current?.identity.runId !== snapshot.identity.runId) return [];
      return result.items;
    },
    async skills(): Promise<SkillEntry[]> {
      assertOpen(); const snapshot = current, expected = generation;
      if (pendingSelection || !snapshot || !client.command) throw new Error("Wait for a selected session with terminal resource support.");
      // Catalog reads reuse the registry, but do not become the selected command:
      // Ctrl+C must still target research while suggestions are loading.
      const receipt = await client.command({ workspaceId: connection.workspaceId, sessionId: snapshot.identity.sessionId,
        requestId: randomUUID(), expectedRevision: snapshot.revision!, text: "/skill list" });
      if (closed || expected !== generation) return [];
      if (!receipt.result.success) throw new Error(receipt.result.message);
      const items = receipt.result.data;
      if (!Array.isArray(items) || items.some(item => !item || typeof item.name !== "string" || typeof item.description !== "string"
        || !["project", "user"].includes(item.scope))) throw new Error("Terminal skill catalog is invalid.");
      return items.map(({ name, description, scope }) => ({ name, description, scope }));
    },
    async context() {
      assertOpen(); const expected = generation, request = ++contextGeneration, sessionId = selected;
      if (pendingSelection || !client.context) throw new Error("Wait for a selected session with terminal context support.");
      const result = await client.context({ workspaceId: connection.workspaceId, sessionId });
      if (closed || expected !== generation || request !== contextGeneration || (result.session.revision ?? -1) < (current?.revision ?? -1)) return undefined;
      accept(result.session, expected); return result;
    },
    async confirmSelectedSnapshot() {
      assertOpen(); const expected = generation, sessionId = selected;
      if (pendingSelection) throw new Error("Wait for the selected session before continuing.");
      const result = await client.session(sessionId);
      if (closed || expected !== generation) return undefined;
      if (result.identity.workspaceId !== connection.workspaceId || result.identity.sessionId !== sessionId
        || !Number.isSafeInteger(result.revision) || Number(result.revision) < 0)
        throw new Error("Terminal session identity changed.");
      if ((result.revision ?? -1) < (current?.revision ?? -1)
        || current && result.revision === current.revision && result.identity.runId !== current.identity.runId) return undefined;
      accept(result, expected); return result;
    },
    async acknowledgeRecovery(target: RunRevisionRequest) {
      assertOpen(); const snapshot = current, expected = generation;
      if (pendingSelection || !snapshot || !client.acknowledgeInterruption
        || snapshot.identity.workspaceId !== target.workspaceId || snapshot.identity.sessionId !== target.sessionId
        || snapshot.identity.runId !== target.runId || snapshot.revision !== target.expectedRevision
        || !snapshot.recovery?.acknowledgementRequired) throw new Error("Recovery changed; inspect the selected session before confirming.");
      await client.acknowledgeInterruption(target);
      if (closed || expected !== generation) return false;
      await refresh(expected);
      return !closed && expected === generation;
    },
    async submit(text: string) {
      assertOpen(); const snapshot = current, expected = generation;
      if (pendingSelection) throw new Error("Wait for the selected session before submitting.");
      if (!snapshot || snapshot.revision === undefined) throw new Error("Read the current session before submitting.");
      const target = { workspaceId: connection.workspaceId, sessionId: snapshot.identity.sessionId, requestId: randomUUID(), text };
      if (snapshot.state === "running" && (!snapshot.identity.runId || !client.enqueue))
        throw new Error("This running session cannot accept terminal queued input.");
      const result = snapshot.state === "running"
        ? await client.enqueue!({ ...target, runId: snapshot.identity.runId! })
        : await client.submit({ ...target, expectedRevision: snapshot.revision });
      if (!closed && expected === generation) await refresh(expected);
      return result;
    },
    async submitResearch(task: ResearchTaskSpec, expectedTaskRevision: string | null, signal?: AbortSignal) {
      assertOpen(); signal?.throwIfAborted(); const snapshot = current, expected = generation;
      if (!client.submitResearch) throw new Error("This connection does not support structured research.");
      if (pendingSelection || pendingCommand || pendingResearch) throw new Error("Wait for the selected session or current terminal operation.");
      if (!snapshot || snapshot.revision === undefined || snapshot.state === "running") throw new Error("Research requires a ready, idle session.");
      const pending = { cancelled: false } as { cancelled: boolean; run?: RunIdentity }; pendingResearch = pending;
      const abort = () => { pending.cancelled = true; };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        signal?.throwIfAborted();
        const result = await client.submitResearch({ workspaceId: connection.workspaceId, sessionId: snapshot.identity.sessionId,
          requestId: randomUUID(), expectedRevision: snapshot.revision, expectedTaskRevision, task });
        pending.run = { workspaceId: connection.workspaceId, sessionId: result.sessionId, runId: result.runId };
        if (pending.cancelled) { await client.cancel(pending.run); signal?.throwIfAborted(); }
        if (!closed && expected === generation) await refresh(expected);
        return result;
      } finally { signal?.removeEventListener("abort", abort); if (pendingResearch === pending) pendingResearch = undefined; }
    },
    async waitResearch(identity: RunIdentity, signal?: AbortSignal): Promise<SessionSnapshot> {
      assertOpen();
      return new Promise<SessionSnapshot>((resolve, reject) => {
        let done = false, cancelling = false, confirming = false, minimumRevision = -1, releaseWait = () => {};
        const cleanup = () => { releaseWait(); signal?.removeEventListener("abort", abort); waiters.delete(detached); };
        const finish = (error?: Error, result?: SessionSnapshot) => {
          if (done) return; done = true; cleanup();
          if (error) reject(error); else resolve(result!);
        };
        const abort = () => {
          if (done || cancelling) return;
          cancelling = true;
          void client.cancel(identity).then(() => finish(new Error("Research was cancelled.")),
            () => finish(new Error("Cancellation outcome is unknown; inspect the original research.")));
        };
        const detached = () => finish(new Error("Terminal detached while research continues in the Host."));
        const inspect = (value: SessionSnapshot, confirmed = false) => {
          if (cancelling || value.identity.workspaceId !== identity.workspaceId || value.identity.sessionId !== identity.sessionId) return;
          if (value.identity.runId !== identity.runId) { finish(new Error("Research identity changed; inspect the original session.")); return; }
          if (value.state === "running") return;
          if (confirmed) {
            if ((value.revision ?? -1) < minimumRevision) { finish(new Error("Final research checkpoint is unconfirmed; inspect the session.")); return; }
            finish(undefined, value); return;
          }
          minimumRevision = Math.max(minimumRevision, value.revision ?? -1);
          if (confirming) return;
          // A terminal event can precede the final checkpoint. The service's
          // session read waits for the owning run to finish its persistence.
          confirming = true;
          void client.session(identity.sessionId).then(value => {
            if (value.state === "running") { finish(new Error("Terminal research state is unconfirmed; inspect the session.")); return; }
            inspect(value, true);
          }, error => finish(error instanceof Error ? error : new Error(String(error))));
        };
        waiters.add(detached);
        try {
          releaseWait = client.subscribe(event => {
            if (event.type === "snapshot") inspect(event.snapshot);
            else if (event.type === "connection" && !event.connected && !cancelling)
              finish(new Error("Host connection lost; inspect the original research after reconnecting."));
            else if (event.type === "session-error" && event.identity.workspaceId === identity.workspaceId && event.identity.sessionId === identity.sessionId)
              finish(new Error(event.message));
          });
        } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); return; }
        if (done) { releaseWait(); return; }
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        void client.session(identity.sessionId).then(value => inspect(value, true), error => finish(error instanceof Error ? error : new Error(String(error))));
      });
    },
    async cancel() {
      assertOpen(); const snapshot = current, expected = generation;
      if (!snapshot?.identity.runId || snapshot.state !== "running") return false;
      // Capture the complete identity before awaiting; selection changes cannot retarget cancellation.
      await client.cancel({ ...snapshot.identity, runId: snapshot.identity.runId });
      if (!closed && expected === generation) await refresh(expected);
      return true;
    },
    async command(text: string) {
      assertOpen(); const snapshot = current, expected = generation;
      if (!client.command) throw new Error("This connection does not support terminal commands.");
      if (pendingSelection || pendingCommand) throw new Error("Wait for the selected session or current terminal command.");
      if (!snapshot || snapshot.revision === undefined) throw new Error("Read the current session before running a command.");
      const target = { workspaceId: connection.workspaceId, sessionId: snapshot.identity.sessionId, requestId: randomUUID() };
      pendingCommand = target;
      try {
        const receipt = await client.command({ ...target, expectedRevision: snapshot.revision, text });
        if (!closed && expected === generation) {
          if (receipt.selectedSessionId) await select(receipt.selectedSessionId);
          else await refresh(expected);
        }
        return receipt;
      } catch (error) {
        if (!closed && expected === generation) await refresh(expected).catch(() => {});
        throw error;
      } finally { if (pendingCommand === target) pendingCommand = undefined; }
    },
    async restoreReport(reportId: string) {
      assertOpen(); const snapshot = current, expected = generation;
      if (!client.restoreReport) throw new Error("This connection does not support report restoration.");
      if (pendingSelection || pendingCommand) throw new Error("Wait for the selected session or current terminal command.");
      if (!snapshot || snapshot.revision === undefined) throw new Error("Read the current session before restoring a report.");
      const target = { workspaceId: connection.workspaceId, sessionId: snapshot.identity.sessionId, requestId: randomUUID() };
      pendingCommand = target;
      try {
        const receipt = await client.restoreReport({ ...target, expectedRevision: snapshot.revision, reportId });
        if (closed || expected !== generation) return undefined;
        if (receipt.selectedSessionId) {
          await select(receipt.selectedSessionId);
          if (closed || generation !== expected + 1 || selected !== receipt.selectedSessionId) return undefined;
        } else await refresh(expected);
        return receipt;
      } catch (error) {
        if (!closed && expected === generation) await refresh(expected).catch(() => {});
        throw error;
      } finally { if (pendingCommand === target) pendingCommand = undefined; }
    },
    async cancelCommand() {
      assertOpen(); const target = pendingCommand, expected = generation;
      if (!target) return false;
      if (!client.cancelCommand) throw new Error("This connection does not support terminal command cancellation.");
      await client.cancelCommand(target);
      if (!closed && expected === generation && selected === target.sessionId) await refresh(expected);
      return true;
    },
    detach,
  };
}
