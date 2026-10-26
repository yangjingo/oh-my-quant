import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createQuantResearchAgent } from "../../runtime/quant-harness.ts";
import { createDefaultSessionDependencies } from "../../runtime/session-dependencies.ts";
import { BUILTIN_TOOL_REGISTRY } from "../../tools/registry.ts";
import { resolveOhquantDir } from "../../storage/index.ts";
import type { QuantAgentDependencies, QuantAgentEvent, QuantAgentSession } from "../../agent/src/session-contracts.ts";
import type { AgentPhase, Preferences, RunState, SessionSnapshot, SubmitRequest, ToolActivity, Turn, WorkbenchClient, WorkbenchEvent, WorkspaceSummary } from "../../types/workbench.ts";
import { WorkbenchError, modelError } from "./errors.ts";
import { localSettings, publicPreferences, secretValues, updateModel, type SettingsPort } from "./model.ts";

interface Running {
  id: string; controller: AbortController; promise: Promise<void>; finished: string[];
  activity: Map<string, ToolActivity & { started: number }>;
  secrets: string[]; phase: AgentPhase;
}
interface Session {
  id: string; name: string; state: RunState; revision: number; runCount: number;
  runId: string | null; turns: Turn[]; agent?: QuantAgentSession; active?: Running;
}
const emptyMarket = () => ({ refreshedAt: "", quotes: [], source: { provider: null, updatedAt: null, available: 0, total: 0 } });
const emptyOutput = () => ({ conclusion: { statement: null, confidence: null, boundary: null, settled: false }, evidence: [], artifacts: [] });
const textOf = (message: unknown): string => {
  const content = (message as { content?: unknown } | null)?.content;
  return Array.isArray(content) ? content.filter(part => part?.type === "text" && typeof part.text === "string").map(part => part.text).join("") : "";
};

/** Owns live runs/observers; the existing Quant/Pi session still owns tools, context and its journal. */
export function createWorkbenchService(options: { cwd?: string; workspaceId?: string; settings?: SettingsPort; dependencies?: () => QuantAgentDependencies } = {}) {
  const cwd = options.cwd ?? process.cwd(), settings = options.settings ?? localSettings;
  const canonical = resolve(resolveOhquantDir());
  const workspaceId = options.workspaceId ?? createHash("sha256").update(process.platform === "win32" ? canonical.toLowerCase() : canonical).digest("hex").slice(0, 24);
  const sessions = new Map<string, Session>();
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  let closed = false;
  const initial: Session = { id: randomUUID(), name: "新研究", state: "idle", revision: 0, runCount: 0, runId: null, turns: [] };
  sessions.set(initial.id, initial);
  const get = (id: string) => {
    const session = sessions.get(id);
    if (!session) throw new WorkbenchError("SESSION_NOT_FOUND", "未找到当前服务中的会话，请重新连接。", 404);
    return session;
  };
  const summary = (session: Session): WorkspaceSummary => ({ workspaceId, sessionId: session.id, code: "", name: session.name, state: session.state, runCount: session.runCount });
  const snapshot = (session: Session): SessionSnapshot => structuredClone({ identity: { workspaceId, sessionId: session.id, runId: session.runId }, revision: session.revision,
    state: session.state, turns: session.turns, market: emptyMarket(), output: emptyOutput() });
  const emit = (session: Session) => {
    session.revision++;
    const current = snapshot(session);
    for (const listener of listeners) { try { listener({ type: "snapshot", identity: current.identity, snapshot: current }); } catch { listeners.delete(listener); } }
  };
  const redact = (run: Running, text: string) => run.secrets.reduce((value, secret) => value.split(secret).join("[REDACTED]"), text);
  const assistant = (session: Session, run: Running, text?: string) => {
    const activity = [...run.activity.values()].map(({ started: _, ...item }) => item);
    const old = session.turns.find(turn => turn.id === run.id + "-assistant");
    const visible = text === undefined ? old?.text ?? "" : redact(run, text);
    if (old?.text === visible && old.state === session.state && old.phase === run.phase && JSON.stringify(old.activity) === JSON.stringify(activity)) return;
    session.turns = session.turns.map(turn => turn.id === run.id + "-assistant" ? { ...turn, text: visible, activity, phase: run.phase, state: session.state,
      ...(session.state === "running" ? {} : { endedAt: new Date().toISOString() }) } : turn);
    emit(session);
  };
  const observe = (session: Session, run: Running, event: QuantAgentEvent) => {
    if (session.active !== run || session.state !== "running" || run.controller.signal.aborted) return;
    if ((event.type === "message_update" || event.type === "message_end") && event.message.role === "assistant") {
      if (event.type === "message_update") {
        const kind = event.assistantMessageEvent.type;
        if (kind === "thinking_start" || kind === "thinking_delta") run.phase = "thinking";
        else if (kind === "text_start" || kind === "text_delta") run.phase = "answering";
        else if (kind === "thinking_end" || kind === "toolcall_start") run.phase = "waiting";
      }
      const text = textOf(event.message);
      if (event.type === "message_end") { if (text) run.finished.push(text); assistant(session, run, run.finished.join("\n\n")); }
      else assistant(session, run, [...run.finished, text].filter(Boolean).join("\n\n"));
    }
    if (event.type === "tool_execution_start") {
      run.phase = "tool";
      run.activity.set(event.toolCallId, { id: event.toolCallId, name: event.toolName, state: "running", started: performance.now() }); assistant(session, run);
    }
    if (event.type === "tool_execution_end") {
      const old = run.activity.get(event.toolCallId);
      run.activity.set(event.toolCallId, { id: event.toolCallId, name: event.toolName, state: event.isError ? "failed" : "completed", started: old?.started ?? performance.now(), elapsedMs: Math.max(0, Math.round(performance.now() - (old?.started ?? performance.now()))) });
      run.phase = [...run.activity.values()].some(item => item.state === "running") ? "tool" : "waiting";
      assistant(session, run);
    }
  };
  const execute = async (session: Session, run: Running, text: string) => {
    let release: (() => void) | undefined;
    try {
      run.controller.signal.throwIfAborted();
      if (!session.agent) {
        const dependencies = options.dependencies?.() ?? createDefaultSessionDependencies({ cwd });
        const allowed = new Set(BUILTIN_TOOL_REGISTRY.filter(item => item.domain !== "system").map(item => item.tool.name));
        // No shell or dynamically loaded external tool registry at this initial Web boundary.
        const { readTools: _readTools, ...fixed } = dependencies;
        session.agent = createQuantResearchAgent({ cwd, dependencies: { ...fixed, tools: dependencies.tools.filter(tool => allowed.has(tool.name)),
          loadSkills: async () => [], readSkillRevision: undefined, prepareSkills: undefined } });
      }
      release = session.agent.subscribe(event => observe(session, run, event));
      await session.agent.prompt(text, { signal: run.controller.signal });
      await session.agent.waitForIdle();
      run.controller.signal.throwIfAborted();
      if (session.agent.state.errorMessage) throw modelError(new Error(session.agent.state.errorMessage));
      if (!run.finished.some(value => value.trim()) && !run.activity.size) throw new WorkbenchError("EMPTY_REPLY", "模型未返回可显示的回答，请检查配置或重试。", 502);
      if (session.active === run && session.state === "running") { session.state = "settled"; assistant(session, run, run.finished.join("\n\n") || "本轮工具调用已结束，模型未提供文字总结。请检查工具状态或继续追问。"); }
    } catch (error) {
      if (session.active === run && session.state === "running") {
        session.state = run.controller.signal.aborted ? "cancelled" : "failed";
        const partial = run.finished.join("\n\n") || session.turns.find(turn => turn.id === run.id + "-assistant")?.text || "";
        const message = session.state === "cancelled" ? "当前研究已停止，已返回的内容保留。" : (error instanceof WorkbenchError ? error : modelError(error)).message;
        assistant(session, run, [partial, message].filter(Boolean).join("\n\n"));
      }
    } finally { release?.(); if (session.active === run) { session.active = undefined; emit(session); } }
  };
  const client: WorkbenchClient = {
    mode: "host",
    async identity() { return snapshot(initial).identity; },
    async workspaces() { return [...sessions.values()].map(summary); },
    async session(id) { return snapshot(get(id)); },
    async transcript(id) { return snapshot(get(id)).turns; },
    async market() { return emptyMarket(); },
    async output(id) { return snapshot(get(id)).output; },
    async createSession() {
      if (closed) throw new WorkbenchError("CLOSED", "研究服务已关闭。", 503);
      const session: Session = { id: randomUUID(), name: "新研究", state: "idle", revision: 0, runCount: 0, runId: null, turns: [] };
      sessions.set(session.id, session); return summary(session);
    },
    async renameSession(id, title) {
      if (typeof title !== "string" || !title.trim() || title.length > 100) throw new WorkbenchError("NAME_INVALID", "请输入不超过 100 字的会话名称。");
      const session = get(id); session.name = title.trim(); emit(session);
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
      const session = get(request.sessionId);
      if (session.active) throw new WorkbenchError("RUN_ACTIVE", "当前会话仍在运行，请等待或显式停止。", 409);
      const id = randomUUID(), at = new Date().toISOString();
      const run: Running = { id, controller: new AbortController(), promise: Promise.resolve(), finished: [], activity: new Map(), secrets: secretValues(settings.read()), phase: "waiting" };
      session.runId = id; session.state = "running"; session.active = run; session.runCount++;
      if (!session.turns.length && session.name === "新研究") session.name = request.text.trim().slice(0, 32);
      session.turns.push({ id: id + "-user", role: "user", text: redact(run, request.text.trim()), state: "settled", at }, { id: id + "-assistant", role: "assistant", text: "", state: "running", at, activity: [], phase: "waiting" });
      emit(session);
      run.promise = Promise.resolve().then(() => execute(session, run, redact(run, request.text.trim())));
      return { sessionId: session.id, runId: id };
    },
    async cancel(id) {
      const session = [...sessions.values()].find(item => item.runId === id);
      if (!session) throw new WorkbenchError("RUN_NOT_FOUND", "未找到这次运行；未取消其他研究。", 404);
      const run = session.active;
      if (!run || session.state !== "running") return;
      run.controller.abort(); session.agent?.abort();
      session.state = "cancelled";
      for (const [key, value] of run.activity) if (value.state === "running") run.activity.set(key, { ...value, state: "cancelled" });
      assistant(session, run, [session.turns.find(turn => turn.id === id + "-assistant")?.text, "当前研究已停止，草稿与已返回内容保留。"].filter(Boolean).join("\n\n"));
      await run.promise;
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return { client, workspaceId, async close() {
    closed = true;
    const pending = [...sessions.values()].flatMap(session => session.active ? [client.cancel(session.active.id)] : []);
    await Promise.allSettled(pending); listeners.clear();
  } };
}
