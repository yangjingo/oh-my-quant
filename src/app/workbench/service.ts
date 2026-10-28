import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createQuantResearchAgent } from "../../runtime/quant-harness.ts";
import { createDefaultSessionDependencies } from "../../runtime/session-dependencies.ts";
import { BUILTIN_TOOL_REGISTRY } from "../../tools/registry.ts";
import { createWorkbenchSessionStore, resolveOhquantDir } from "../../storage/index.ts";
import type { QuantAgentDependencies, QuantAgentEvent, QuantAgentSession } from "../../agent/src/session-contracts.ts";
import type { AgentPhase, Preferences, RunState, SessionSnapshot, SubmitRequest, ToolActivity, Turn, WorkbenchClient, WorkbenchEvent, WorkspaceSummary } from "../../types/workbench.ts";
import { WorkbenchError, modelError } from "./errors.ts";
import { localSettings, publicPreferences, secretValues, updateModel, type SettingsPort } from "./model.ts";
import { recoverSnapshot } from "./session-recovery.ts";
import { toolPresentation } from "./tool-presentation.ts";
import { redactModelText } from "./redaction.ts";
import { hasExplicitReference } from "./references.ts";

interface Running {
  id: string; controller: AbortController; promise: Promise<void>; finished: string[];
  activity: Map<string, ToolActivity & { started: number }>;
  secrets: string[]; phase: AgentPhase;
}
interface Session {
  id: string; name: string; state: RunState; revision: number; runCount: number;
  cwd: string; coreSessionId: string | null; updatedAt: string; fileRevision: string | null; writes: Promise<void>; pending: number; timer?: ReturnType<typeof setTimeout>; problem?: string; recovery?: SessionSnapshot["recovery"];
  runId: string | null; turns?: Turn[]; agent?: QuantAgentSession; active?: Running;
}
const emptyMarket = () => ({ refreshedAt: "", quotes: [], source: { provider: null, updatedAt: null, available: 0, total: 0 } });
const emptyOutput = () => ({ conclusion: { statement: null, confidence: null, boundary: null, settled: false }, evidence: [], artifacts: [] });
const textOf = (message: unknown): string => {
  const content = (message as { content?: unknown } | null)?.content;
  return Array.isArray(content) ? content.filter(part => part?.type === "text" && typeof part.text === "string").map(part => part.text).join("") : "";
};

/** Owns live runs/observers; the existing Quant/Pi session still owns tools, context and its journal. */
export function createWorkbenchService(options: { cwd?: string; workspaceId?: string; settings?: SettingsPort; dependencies?: () => QuantAgentDependencies; store?: ReturnType<typeof createWorkbenchSessionStore> } = {}) {
  const cwd = options.cwd ?? process.cwd(), settings = options.settings ?? localSettings;
  const canonical = resolve(resolveOhquantDir());
  const workspaceId = options.workspaceId ?? createHash("sha256").update(process.platform === "win32" ? canonical.toLowerCase() : canonical).digest("hex").slice(0, 24);
  const sessions = new Map<string, Session>();
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  let closed = false;
  const storage = options.store ?? createWorkbenchSessionStore();
  const blank = (): Session => ({ id: randomUUID(), name: "新研究", state: "idle", revision: 0, runCount: 0, runId: null, turns: [], cwd,
    coreSessionId: null, updatedAt: new Date().toISOString(), fileRevision: null, writes: Promise.resolve(), pending: 0 });
  for (const item of storage.list(workspaceId)) {
    const h = item.header;
    sessions.set(item.sessionId, h ? { id: h.sessionId, name: h.name, state: h.state === "running" ? "interrupted" : h.state,
      revision: h.revision, runCount: h.runCount, runId: h.runId, cwd: h.cwd, coreSessionId: h.coreSessionId,
      updatedAt: h.updatedAt, fileRevision: null, writes: Promise.resolve(), pending: 0 }
      : { ...blank(), id: item.sessionId, name: "无法读取的会话", problem: item.problem });
  }
  let initial = [...sessions.values()].filter(item => !item.problem).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const fresh = !initial;
  if (!initial) { initial = blank(); sessions.set(initial.id, initial); }
  const storageError = () => new WorkbenchError("SESSION_STORAGE", "会话记录无法安全保存或读取，原文件已保留。请检查存储后重新连接；也可以新建会话。", 409);
  const get = (id: string) => {
    const session = sessions.get(id);
    if (!session) throw new WorkbenchError("SESSION_NOT_FOUND", "未找到当前服务中的会话，请重新连接。", 404);
    if (session.problem) {
      if (session.active || session.pending) throw storageError();
      session.turns = undefined;
    }
    if (!session.turns) {
      try {
        const loaded = storage.load(workspaceId, id), saved = recoverSnapshot(loaded.record.snapshot);
        const record = loaded.record;
        Object.assign(session, { name: record.name, cwd: record.cwd, coreSessionId: record.coreSessionId, runCount: record.runCount,
          revision: saved.revision!, runId: saved.identity.runId, updatedAt: record.updatedAt, problem: undefined });
        session.turns = [...saved.turns]; session.state = saved.state; session.recovery = saved.recovery; session.fileRevision = loaded.revision;
      } catch { session.problem = "storage"; throw storageError(); }
    }
    return session;
  };
  const summary = (session: Session): WorkspaceSummary => ({ workspaceId, sessionId: session.id, code: "", name: session.name, state: session.state, runCount: session.runCount });
  const snapshot = (session: Session): SessionSnapshot => structuredClone({ identity: { workspaceId, sessionId: session.id, runId: session.runId }, revision: session.revision,
    state: session.state, turns: session.turns!, ...(session.recovery ? { recovery: session.recovery } : {}), market: emptyMarket(), output: emptyOutput() });
  const flush = (session: Session) => {
    clearTimeout(session.timer); session.timer = undefined;
    const saved = snapshot(session), updatedAt = session.updatedAt;
    const record = { version: 1 as const, workspaceId, sessionId: session.id, name: session.name, cwd: session.cwd,
      coreSessionId: session.coreSessionId, runCount: session.runCount, updatedAt, snapshot: saved };
    session.pending++;
    const write = session.writes.then(async () => {
      if (session.problem) throw storageError();
      try { session.fileRevision = await storage.save(record, session.fileRevision); }
      catch {
        session.problem = "storage"; session.active?.controller.abort(); session.agent?.abort();
        for (const listener of listeners) {
          try { listener({ type: "session-error", identity: { workspaceId, sessionId: session.id, runId: session.runId }, message: storageError().message }); }
          catch { listeners.delete(listener); }
        }
        throw storageError();
      }
    }).finally(() => { session.pending--; });
    session.writes = write.catch(() => {});
    return write;
  };
  const ready = fresh ? flush(initial) : Promise.resolve(); ready.catch(() => {});
  const unload = (session: Session) => { if (!session.active && !session.timer && !session.pending && !session.problem) session.turns = undefined; };
  const read = async (id: string) => {
    await ready; const session = get(id);
    if (session.state !== "running" && session.active) await session.active.promise;
    const value = snapshot(get(id)); unload(session); return value;
  };
  const emit = (session: Session) => {
    session.revision++; session.updatedAt = new Date().toISOString();
    session.timer ??= setTimeout(() => { void flush(session).catch(() => {}); }, 200);
    const current = snapshot(session);
    for (const listener of listeners) { try { listener({ type: "snapshot", identity: current.identity, snapshot: current }); } catch { listeners.delete(listener); } }
  };
  const redact = (run: Running, text: string) => redactModelText(text, run.secrets);
  const assistant = (session: Session, run: Running, text?: string) => {
    const activity = [...run.activity.values()].map(({ started: _, ...item }) => ({ ...item, name: redact(run, item.name),
      ...(item.context ? { context: redact(run, item.context) } : {}) }));
    const old = session.turns!.find(turn => turn.id === run.id + "-assistant");
    const visible = text === undefined ? old?.text ?? "" : redactModelText(text, run.secrets, session.state === "running");
    if (old?.text === visible && old.state === session.state && old.phase === run.phase && JSON.stringify(old.activity) === JSON.stringify(activity)) return;
    session.turns = session.turns!.map(turn => turn.id === run.id + "-assistant" ? { ...turn, text: visible, activity, phase: run.phase, state: session.state,
      ...(session.state === "running" ? {} : { endedAt: new Date().toISOString() }) } : turn);
    emit(session);
  };
  const finishActivities = (session: Session, run: Running) => {
    for (const [id, item] of run.activity) {
      if (item.state === "preparing") run.activity.set(id, { ...item, state: "not-run" });
      else if (item.state === "running") run.activity.set(id, { ...item, state: session.state === "cancelled" ? "cancelled" : "failed",
        elapsedMs: Math.max(0, Math.round(performance.now() - item.started)) });
    }
  };
  const observe = (session: Session, run: Running, event: QuantAgentEvent) => {
    if (session.active !== run || session.state !== "running" || run.controller.signal.aborted) return;
    if ((event.type === "message_update" || event.type === "message_end") && event.message.role === "assistant") {
      if (event.type === "message_update") {
        const kind = event.assistantMessageEvent.type;
        if (kind === "thinking_start" || kind === "thinking_delta") run.phase = "thinking";
        else if (kind === "text_start" || kind === "text_delta") run.phase = "answering";
        else if (kind === "thinking_end") run.phase = "waiting";
        const update = event.assistantMessageEvent;
        if ((kind === "toolcall_start" || kind === "toolcall_delta" || kind === "toolcall_end") && "contentIndex" in update) {
          const part = event.message.content[update.contentIndex];
          if (part?.type === "toolCall" && part.id && part.name) {
            const old = run.activity.get(part.id);
            if (!old || old.state === "preparing") run.activity.set(part.id, { id: part.id, name: part.name,
              ...toolPresentation(part.name), state: "preparing", started: old?.started ?? performance.now() });
            run.phase = "preparing";
          }
        }
      }
      const text = textOf(event.message);
      if (event.type === "message_end") { if (text) run.finished.push(text); assistant(session, run, run.finished.join("\n\n")); }
      else assistant(session, run, [...run.finished, text].filter(Boolean).join("\n\n"));
    }
    if (event.type === "tool_execution_start") {
      run.phase = "tool";
      run.activity.set(event.toolCallId, { id: event.toolCallId, name: event.toolName, ...toolPresentation(event.toolName, event.args), state: "running", started: performance.now() }); assistant(session, run);
    }
    if (event.type === "tool_execution_end") {
      const old = run.activity.get(event.toolCallId);
      run.activity.set(event.toolCallId, { id: event.toolCallId, name: event.toolName, ...toolPresentation(event.toolName), ...old,
        state: event.isError ? "failed" : "completed", started: old?.started ?? performance.now(), elapsedMs: Math.max(0, Math.round(performance.now() - (old?.started ?? performance.now()))) });
      run.phase = [...run.activity.values()].some(item => item.state === "running") ? "tool" : "waiting";
      assistant(session, run);
    }
  };
  const execute = async (session: Session, run: Running, text: string) => {
    let release: (() => void) | undefined;
    let cleanup: (() => Promise<void>) | undefined;
    try {
      run.controller.signal.throwIfAborted();
      if (!session.agent) {
        const dependencies = options.dependencies?.() ?? createDefaultSessionDependencies({ cwd: session.cwd });
        cleanup = () => dependencies.env.cleanup();
        const allowed = new Set(BUILTIN_TOOL_REGISTRY.filter(item => item.domain !== "system").map(item => item.tool.name));
        // No shell or dynamically loaded external tool registry at this initial Web boundary.
        const { readTools: _readTools, ...fixed } = dependencies;
        let opening = true;
        const repository = dependencies.sessions;
        const restored = { create: async (input: Parameters<typeof repository.create>[0]) => {
          if (opening && session.coreSessionId) {
            opening = false;
            try {
              const target = (await repository.list({ cwd: session.cwd })).find(item => item.id === session.coreSessionId);
              if (!target) throw new Error("Missing journal");
              return await repository.open(target);
            } catch { throw new WorkbenchError("CONTEXT_MISSING", "原研究上下文无法读取。请保留记录并新建会话，不会使用空上下文继续。", 409); }
          }
          opening = false; return repository.create(input);
        }, open: repository.open.bind(repository), list: repository.list.bind(repository) };
        const tools = dependencies.tools.filter(tool => allowed.has(tool.name)).map(tool => ({ ...tool,
          async execute(...args: Parameters<typeof tool.execute>) {
            await flush(session); run.controller.signal.throwIfAborted(); return tool.execute(...args);
          },
        }));
        session.agent = createQuantResearchAgent({ cwd: session.cwd, dependencies: { ...fixed, sessions: restored, tools,
          loadSkills: async () => [], readSkillRevision: undefined, prepareSkills: undefined } });
      }
      const metadata = await session.agent.getSessionMetadata();
      if (!metadata || session.coreSessionId && metadata.id !== session.coreSessionId) throw new WorkbenchError("CONTEXT_MISSING", "原研究上下文不匹配，未发送问题。", 409);
      session.coreSessionId = metadata.id; await flush(session);
      release = session.agent.subscribe(event => observe(session, run, event));
      await session.agent.prompt(text, { signal: run.controller.signal });
      await session.agent.waitForIdle();
      run.controller.signal.throwIfAborted();
      if (session.agent.state.errorMessage) throw modelError(new Error(session.agent.state.errorMessage));
      if (!run.finished.some(value => value.trim()) && ![...run.activity.values()].some(item => item.state !== "preparing")) throw new WorkbenchError("EMPTY_REPLY", "模型未返回可显示的回答，请检查配置或重试。", 502);
      if (session.active === run && session.state === "running") { session.state = "settled"; finishActivities(session, run); assistant(session, run, run.finished.join("\n\n") || "本轮工具调用已结束，模型未提供文字总结。请检查工具状态或继续追问。"); }
    } catch (error) {
      if (session.active === run && session.state === "running") {
        session.state = run.controller.signal.aborted && !session.problem ? "cancelled" : "failed";
        finishActivities(session, run);
        const partial = run.finished.join("\n\n") || session.turns!.find(turn => turn.id === run.id + "-assistant")?.text || "";
        const message = session.state === "cancelled" ? "当前研究已停止，已返回的内容保留。" : (session.problem ? storageError() : error instanceof WorkbenchError ? error : modelError(error)).message;
        assistant(session, run, [partial, message].filter(Boolean).join("\n\n"));
      }
    } finally {
      release?.(); session.agent = undefined; await cleanup?.().catch(() => {});
      if (session.active === run) {
        emit(session); await flush(session).catch(() => {}); session.active = undefined; unload(session);
      }
    }
  };
  const client: WorkbenchClient = {
    mode: "host",
    async identity() { await ready; return { workspaceId, sessionId: initial.id, runId: initial.runId }; },
    async workspaces() { await ready; return [...sessions.values()].map(summary); },
    async session(id) { return read(id); },
    async transcript(id) { return (await read(id)).turns; },
    async market() { return emptyMarket(); },
    async output(id) { return (await read(id)).output; },
    async createSession() {
      if (closed) throw new WorkbenchError("CLOSED", "研究服务已关闭。", 503);
      await ready; const session = blank();
      await flush(session); sessions.set(session.id, session); unload(session); return summary(session);
    },
    async renameSession(id, title) {
      if (typeof title !== "string" || !title.trim() || title.length > 100) throw new WorkbenchError("NAME_INVALID", "请输入不超过 100 字的会话名称。");
      await ready; const session = get(id); session.name = redactModelText(title.trim(), secretValues(settings.read())); emit(session); await flush(session); unload(session);
    },
    async references() { throw new WorkbenchError("UNAVAILABLE", "此本地连接暂未开放文件引用，请直接描述研究问题。"); },
    async preferences() { return publicPreferences(settings.read()); },
    async updatePreferences(next: Preferences) {
      if ([...sessions.values()].some(session => !!session.active)) throw new WorkbenchError("RUN_ACTIVE", "请先等待或停止研究，再修改模型。", 409);
      updateModel(settings, next);
    },
    async submit(request: SubmitRequest) {
      if (closed) throw new WorkbenchError("CLOSED", "研究服务已关闭。", 503);
      if (request.workspaceId !== workspaceId) throw new WorkbenchError("WORKSPACE_MISMATCH", "工作区不匹配，请重新连接。", 409);
      if (typeof request.text !== "string" || !request.text.trim() || request.text.length > 16000) throw new WorkbenchError("QUESTION_INVALID", "请输入不超过 16000 字的研究问题。");
      if (hasExplicitReference(request.text)) throw new WorkbenchError("REFERENCE_UNAVAILABLE", "当前连接尚未开放引用读取，未调用模型，草稿已保留。请直接粘贴所需内容；字面示例可用反引号或反斜杠转义。");
      await ready; const session = get(request.sessionId);
      if (session.active) throw new WorkbenchError("RUN_ACTIVE", "当前会话仍在运行，请等待或显式停止。", 409);
      if (session.recovery?.acknowledgementRequired) throw new WorkbenchError("RECONCILE_REQUIRED", "上次工具结果待核对，请先确认后再提问。", 409);
      const id = randomUUID(), at = new Date().toISOString();
      const run: Running = { id, controller: new AbortController(), promise: Promise.resolve(), finished: [], activity: new Map(), secrets: secretValues(settings.read()), phase: "waiting" };
      session.recovery = undefined; session.runId = id; session.state = "running"; session.active = run; session.runCount++;
      if (!session.turns!.length && session.name === "新研究") session.name = redact(run, request.text.trim()).slice(0, 32);
      session.turns!.push({ id: id + "-user", role: "user", text: redact(run, request.text.trim()), state: "settled", at }, { id: id + "-assistant", role: "assistant", text: "", state: "running", at, activity: [], phase: "waiting" });
      emit(session);
      const accepted = flush(session);
      run.promise = accepted.then(() => execute(session, run, redact(run, request.text.trim())), () => {
        session.state = "failed"; session.active = undefined;
      });
      await accepted;
      return { sessionId: session.id, runId: id };
    },
    async acknowledgeInterruption(id) {
      await ready;
      const found = [...sessions.values()].find(item => item.runId === id);
      if (!found) throw new WorkbenchError("RUN_NOT_FOUND", "未找到这次中断运行。", 404);
      const session = get(found.id);
      if (session.state !== "interrupted" || !session.recovery) throw new WorkbenchError("RUN_CHANGED", "这次运行不再处于待确认状态。", 409);
      session.recovery = { ...session.recovery, acknowledgementRequired: false }; emit(session); await flush(session); unload(session);
    },
    async cancel(id) {
      const session = [...sessions.values()].find(item => item.runId === id);
      if (!session) throw new WorkbenchError("RUN_NOT_FOUND", "未找到这次运行；未取消其他研究。", 404);
      const run = session.active;
      if (!run) return;
      if (session.state !== "running") { await run.promise; return; }
      run.controller.abort(); session.agent?.abort();
      session.state = "cancelled";
      finishActivities(session, run);
      assistant(session, run, [session.turns!.find(turn => turn.id === id + "-assistant")?.text, "当前研究已停止，草稿与已返回内容保留。"].filter(Boolean).join("\n\n"));
      await run.promise;
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return { client, workspaceId, async close() {
    closed = true;
    const pending = [...sessions.values()].flatMap(session => session.active ? [client.cancel(session.active.id)] : []);
    await Promise.allSettled(pending);
    await Promise.allSettled([...sessions.values()].map(async session => { clearTimeout(session.timer); await session.writes; }));
    listeners.clear();
  } };
}
