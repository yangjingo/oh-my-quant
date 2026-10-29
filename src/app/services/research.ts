import { createHash, randomUUID } from "node:crypto";
import { createQuantResearchAgent } from "../../runtime/quant-harness.ts";
import { createDefaultSessionDependencies } from "../../runtime/session-dependencies.ts";
import { BUILTIN_TOOL_REGISTRY } from "../../tools/registry.ts";
import { createWorkbenchSessionStore } from "../../storage/index.ts";
import type { QuantAgentDependencies, QuantAgentEvent, QuantAgentSession } from "../../agent/src/session-contracts.ts";
import type { AgentPhase, Preferences, RunState, SessionSnapshot, SubmitRequest, SubmitResult, ToolActivity, Turn, WorkbenchClient, WorkbenchEvent, WorkspaceOutput, WorkspaceSummary } from "../../types/workbench.ts";
import { WorkbenchError, modelError } from "../workbench/errors.ts";
import { localSettings, publicPreferences, secretValues, updateModel, type SettingsPort } from "../workbench/model.ts";
import { recoverSnapshot } from "../workbench/session-recovery.ts";
import { thinkingText } from "../workbench/thinking.ts";
import { reportPathSecrets, toolResult } from "../workbench/tool-result.ts";
import { createMarketOverview } from "../workbench/market.ts";
import type { OverviewRefreshOptions } from "../../runtime/workspace/overview-refresh.ts";
import { toolPresentation } from "../workbench/tool-presentation.ts";
import { redactModelText } from "../workbench/redaction.ts";
import { hasExplicitReference } from "../workbench/references.ts";
import { artifactRequest, deleteSessionRequest, nextRunRequest, preferencesRequest, renameSessionRequest, requestString, reviewRequest, runIdentity, runRevisionRequest, saveRequest, submitRequest } from "./requests.ts";
import { researchWorkspaceId } from "./workspace.ts";
import { forkResearchReport, reloadResearchReport, saveResearchReport } from "./artifacts.ts";
import { clarificationTool, CLARIFICATION_TOOL } from "./clarification.ts";

interface Running {
  id: string; controller: AbortController; promise: Promise<void>; finished: string[];
  activity: Map<string, ToolActivity & { started: number }>;
  secrets: string[]; phase: AgentPhase; thinking: string; finishedThinking: string[]; clarification?: string;
}
interface Session {
  id: string; name: string; state: RunState; revision: number; runCount: number;
  cwd: string; coreSessionId: string | null; updatedAt: string; fileRevision: string | null; writes: Promise<void>; pending: number; timer?: ReturnType<typeof setTimeout>; problem?: string; recovery?: SessionSnapshot["recovery"];
  runId: string | null; turns?: Turn[]; output?: WorkspaceOutput; agent?: QuantAgentSession; active?: Running;
  source?: SessionSnapshot["source"];
  coreLeafId?: string | null;
}
const emptyOutput = () => ({ conclusion: { statement: null, confidence: null, boundary: null, settled: false }, evidence: [], artifacts: [] });
const presentTool = (name: string, args?: unknown) => name === CLARIFICATION_TOOL ? { title: "澄清研究问题" } : toolPresentation(name, args);
const textOf = (message: unknown): string => {
  const content = (message as { content?: unknown } | null)?.content;
  return Array.isArray(content) ? content.filter(part => part?.type === "text" && typeof part.text === "string").map(part => part.text).join("") : "";
};

/** Sanitize recognized historical projections in memory without rewriting their original checkpoint. */
function publicTurns(turns: readonly Turn[]): Turn[] {
  const paths = turns.flatMap(turn => (turn.activity ?? []).flatMap(item => item.result
    ? reportPathSecrets({ content: [{ type: "text", text: item.result.text }] }) : []));
  if (!paths.length) return [...turns];
  return turns.map(turn => turn.role !== "assistant" ? turn : { ...turn,
    text: redactModelText(turn.text, paths),
    ...(turn.thinking === undefined ? {} : { thinking: redactModelText(turn.thinking, paths) }),
    ...(turn.activity === undefined ? {} : { activity: turn.activity.map(item => item.result
      ? { ...item, result: { ...item.result, text: redactModelText(item.result.text, paths) } } : item) }),
  });
}

/** Owns live runs/observers; the existing Quant/Pi session still owns tools, context and its journal. */
export function createResearchService(options: { cwd?: string; workspaceId?: string; settings?: SettingsPort; dependencies?: () => QuantAgentDependencies; store?: ReturnType<typeof createWorkbenchSessionStore>; overview?: OverviewRefreshOptions } = {}) {
  const cwd = options.cwd ?? process.cwd(), settings = options.settings ?? localSettings;
  const clean = (text: string) => redactModelText(text, secretValues(settings.read()));
  const workspaceId = options.workspaceId ?? researchWorkspaceId();
  const sessions = new Map<string, Session>();
  const operations = new Map<string, Promise<unknown>>();
  const acceptedRequests = new Map<string, { fingerprint: string; receipt: Promise<SubmitResult> }>();
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  let closed = false;
  const assertOpen = () => { if (closed) throw new WorkbenchError("CLOSED", "研究服务已关闭。", 503); };
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
  const market = createMarketOverview(value => {
    for (const listener of listeners) { try { listener({ type: "market", identity: { workspaceId, sessionId: initial.id, runId: null }, snapshot: value }); } catch { listeners.delete(listener); } }
  }, options.overview, () => settings.read().preferences.marketColorScheme);
  const storageError = () => new WorkbenchError("SESSION_STORAGE", "会话记录无法安全保存或读取，原文件已保留。请检查存储后重新连接；也可以新建会话。", 409);
  const assertCurrentCheckpoint = (session: Session) => {
    let revision: string;
    try { if (session.problem) throw storageError(); revision = storage.load(workspaceId, session.id).revision; }
    catch { throw storageError(); }
    if (revision !== session.fileRevision) throw new WorkbenchError("REVISION_CONFLICT", "会话已被其他客户端更新，请重新读取后再操作。", 409);
  };
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
        Object.assign(session, { name: record.name, cwd: record.cwd, coreSessionId: record.coreSessionId, coreLeafId: record.coreLeafId, runCount: record.runCount,
          revision: saved.revision!, runId: saved.identity.runId, updatedAt: record.updatedAt, problem: undefined });
        session.turns = publicTurns(saved.turns); session.output = saved.output; session.source = saved.source; session.state = saved.state; session.recovery = saved.recovery; session.fileRevision = loaded.revision;
      } catch { session.problem = "storage"; throw storageError(); }
    }
    return session;
  };
  const summary = (session: Session): WorkspaceSummary => ({ workspaceId, sessionId: session.id, code: "", name: clean(session.name), state: session.state, runCount: session.runCount });
  const snapshot = (session: Session): SessionSnapshot => structuredClone({ identity: { workspaceId, sessionId: session.id, runId: session.runId }, revision: session.revision,
    state: session.state, turns: session.turns!, ...(session.recovery ? { recovery: session.recovery } : {}), ...(session.source ? { source: session.source } : {}), market: market.snapshot(), output: session.output ?? emptyOutput() });
  const flush = (session: Session, saved = snapshot(session), updatedAt = session.updatedAt) => {
    clearTimeout(session.timer); session.timer = undefined;
    const record = { version: 1 as const, workspaceId, sessionId: session.id, name: session.name, cwd: session.cwd,
      coreSessionId: session.coreSessionId, ...(session.coreLeafId === undefined ? {} : { coreLeafId: session.coreLeafId }), runCount: session.runCount, updatedAt, snapshot: saved };
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
  const unload = (session: Session) => { if (!session.active && !operations.has(session.id) && !session.timer && !session.pending && !session.problem) { session.turns = undefined; session.output = undefined; } };
  const read = async (id: string) => {
    id = requestString(id);
    await ready; const session = get(id);
    if (session.state !== "running" && session.active) await session.active.promise;
    const value = snapshot(get(id)); unload(session); return value;
  };
  const publish = (session: Session) => {
    const current = snapshot(session);
    for (const listener of listeners) { try { listener({ type: "snapshot", identity: current.identity, snapshot: current }); } catch { listeners.delete(listener); } }
  };
  const emit = (session: Session) => {
    session.revision++; session.updatedAt = new Date().toISOString();
    session.timer ??= setTimeout(() => { void flush(session).catch(() => {}); }, 200);
    publish(session);
  };
  const redact = (run: Running, text: string) => redactModelText(text, run.secrets);
  const assistant = (session: Session, run: Running, text?: string) => {
    const activity = [...run.activity.values()].map(({ started: _, ...item }) => ({ ...item, name: redact(run, item.name),
      ...(item.context ? { context: redact(run, item.context) } : {}) }));
    const old = session.turns!.find(turn => turn.id === run.id + "-assistant");
    const visible = text === undefined ? old?.text ?? "" : redactModelText(text, run.secrets, session.state === "running");
    const thinking = redactModelText(run.thinking, run.secrets, run.phase === "thinking") || undefined;
    if (old?.text === visible && old.thinking === thinking && old.state === session.state && old.phase === run.phase && JSON.stringify(old.activity) === JSON.stringify(activity)) return;
    session.turns = session.turns!.map(turn => turn.id === run.id + "-assistant" ? { ...turn, text: visible, thinking, activity, phase: run.phase, state: session.state,
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
              ...presentTool(part.name), state: "preparing", started: old?.started ?? performance.now() });
            run.phase = "preparing";
          }
        }
      }
      const text = textOf(event.message);
      const thinking = thinkingText(event.message);
      if (event.type === "message_end") {
        if (text) run.finished.push(text);
        if (thinking) run.finishedThinking.push(thinking);
        run.thinking = run.finishedThinking.join("\n\n"); assistant(session, run, run.finished.join("\n\n"));
      } else {
        run.thinking = [...run.finishedThinking, thinking].filter(Boolean).join("\n\n");
        assistant(session, run, [...run.finished, text].filter(Boolean).join("\n\n"));
      }
    }
    if (event.type === "tool_execution_start") {
      run.phase = "tool";
      run.activity.set(event.toolCallId, { id: event.toolCallId, name: event.toolName, ...presentTool(event.toolName, event.args), state: "running", started: performance.now() }); assistant(session, run);
    }
    if (event.type === "tool_execution_end") {
      for (const path of reportPathSecrets(event.result)) if (!run.secrets.includes(path)) run.secrets.push(path);
      const old = run.activity.get(event.toolCallId);
      run.activity.set(event.toolCallId, { id: event.toolCallId, name: event.toolName, ...presentTool(event.toolName), ...old,
        result: toolResult(event.result, run.secrets),
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
        const dependencies = options.dependencies?.() ?? createDefaultSessionDependencies({ cwd: session.cwd }, "markdown");
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
        const tools = [...dependencies.tools.filter(tool => allowed.has(tool.name)), clarificationTool(question => {
          run.controller.signal.throwIfAborted();
          run.clarification = redact(run, question);
        })].map(tool => ({ ...tool,
          async execute(...args: Parameters<typeof tool.execute>) {
            await flush(session); run.controller.signal.throwIfAborted(); return tool.execute(...args);
          },
        }));
        session.agent = createQuantResearchAgent({ cwd: session.cwd, dependencies: { ...fixed, sessions: restored, tools,
          beforeToolCall: async call => run.clarification
            ? { block: true, reason: "A user answer is required before any further tool calls.", terminate: true }
            : dependencies.beforeToolCall?.(call),
          loadSkills: async () => [], readSkillRevision: undefined, prepareSkills: undefined } });
      }
      const metadata = await session.agent.getSessionMetadata();
      if (!metadata || session.coreSessionId && metadata.id !== session.coreSessionId) throw new WorkbenchError("CONTEXT_MISSING", "原研究上下文不匹配，未发送问题。", 409);
      session.coreSessionId = metadata.id; await flush(session);
      // A later run can echo prior tool output; recover exact paths from the private branch, never the public checkpoint.
      for (const entry of await session.agent.getSessionBranch()) {
        if (entry.type === "message" && entry.message.role === "toolResult") {
          for (const path of reportPathSecrets(entry.message)) if (!run.secrets.includes(path)) run.secrets.push(path);
        }
      }
      release = session.agent.subscribe(event => observe(session, run, event));
      await session.agent.prompt(text, { signal: run.controller.signal });
      await session.agent.waitForIdle();
      run.controller.signal.throwIfAborted();
      if (session.agent.state.errorMessage) throw modelError(new Error(session.agent.state.errorMessage));
      if (!run.finished.some(value => value.trim()) && ![...run.activity.values()].some(item => item.state !== "preparing")) throw new WorkbenchError("EMPTY_REPLY", "模型未返回可显示的回答，请检查配置或重试。", 502);
      session.coreLeafId = await session.agent.getLeafId();
      run.controller.signal.throwIfAborted();
      if (session.active === run && session.state === "running") {
        session.state = run.clarification ? "needs_input" : "settled";
        finishActivities(session, run);
        assistant(session, run, run.clarification ?? (run.finished.join("\n\n") || "本轮工具调用已结束，模型未提供文字总结。请检查工具状态或继续追问。"));
      }
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
  const beginRun = (session: Session, text: string, operation: NonNullable<Turn["operation"]>, previousRunId?: string): Promise<SubmitResult> => {
    const id = randomUUID(), at = new Date().toISOString();
    const run: Running = { id, controller: new AbortController(), promise: Promise.resolve(), finished: [], activity: new Map(), secrets: secretValues(settings.read()), phase: "waiting", thinking: "", finishedThinking: [] };
    session.recovery = undefined; session.coreLeafId = null; session.runId = id; session.state = "running"; session.active = run; session.runCount++;
    if (!session.turns!.length && session.name === "新研究") session.name = redact(run, text.trim()).slice(0, 32);
    session.turns!.push({ id: id + "-user", role: "user", operation, ...(previousRunId ? { previousRunId: previousRunId } : {}), text: redact(run, text.trim()), state: "settled", at }, { id: id + "-assistant", role: "assistant", text: "", state: "running", at, activity: [], phase: "waiting" });
    emit(session);
    const accepted = flush(session);
    run.promise = accepted.then(() => execute(session, run, redact(run, text.trim())), () => {
      session.state = "failed"; session.active = undefined;
    });
    return accepted.then(() => ({ sessionId: session.id, runId: id }));
  };
  const accept = async (operation: "submit" | "continue" | "followup", value: unknown): Promise<SubmitResult> => {
    assertOpen();
    const request: SubmitRequest & { previousRunId?: string } = operation === "submit" ? submitRequest(value)
      : operation === "followup" ? nextRunRequest(value, "followup")
      : { ...nextRunRequest(value, "continue"), text: "继续未完成的研究。先核对已有结果和证据日期，不自动重放已完成的工具或更新既有证据。" };
    if (request.workspaceId !== workspaceId) throw new WorkbenchError("WORKSPACE_MISMATCH", "工作区不匹配，请重新连接。", 409);
    if (hasExplicitReference(request.text)) throw new WorkbenchError("REFERENCE_UNAVAILABLE", "当前连接尚未开放引用读取，未调用模型，草稿已保留。请直接粘贴所需内容；字面示例可用反引号或反斜杠转义。");
    await ready;
    assertOpen();
    const fingerprint = createHash("sha256").update(JSON.stringify({ operation, ...request })).digest("hex");
    const previous = acceptedRequests.get(request.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new WorkbenchError("REQUEST_CONFLICT", "请求标识已用于不同输入，未重复执行。", 409);
      return structuredClone(await previous.receipt);
    }
    const session = get(request.sessionId);
    if (operations.has(session.id)) throw new WorkbenchError("SESSION_BUSY", "会话正在保存或复核，请稍后重新读取。", 409);
    if (session.active) throw new WorkbenchError("RUN_ACTIVE", "当前会话仍在运行，请等待或显式停止。", 409);
    if (session.recovery?.acknowledgementRequired) throw new WorkbenchError("RECONCILE_REQUIRED", "上次工具结果待核对，请先确认后再提问。", 409);
    if (session.revision !== request.expectedRevision) throw new WorkbenchError("REVISION_CONFLICT", "会话已被其他客户端更新，请重新读取后再提交。", 409);
    if (operation === "submit" && session.state === "needs_input") throw new WorkbenchError("CLARIFICATION_PENDING", "请通过追问回答当前澄清问题，或新建会话开始其他研究。", 409);
    if (operation !== "submit") {
      if (session.runId !== request.previousRunId) throw new WorkbenchError("RUN_CONFLICT", "先前运行已变化，请读取最新会话后再操作。", 409);
      if (operation === "followup" && !["settled", "needs_input"].includes(session.state)) throw new WorkbenchError("FOLLOWUP_UNAVAILABLE", "请先完成当前研究、回答澄清问题，或明确继续未完成的运行。", 409);
      if (operation === "continue") {
        const prior = session.turns!.find(turn => turn.id === session.runId + "-assistant");
        if (!["cancelled", "failed", "interrupted"].includes(session.state) || !session.coreSessionId)
          throw new WorkbenchError("CONTINUE_UNAVAILABLE", "这次运行没有可继续的未完成上下文，请新建提交。", 409);
        if (prior?.activity?.some(item => {
          if (["unconfirmed", "cancelled", "running"].includes(item.state)) return true;
          if (item.state !== "failed") return false;
          const registration = BUILTIN_TOOL_REGISTRY.find(entry => entry.tool.name === item.name);
          return !registration || registration.requirements.effects.some(effect => effect !== "local-read");
        }))
          throw new WorkbenchError("CONTINUE_UNSAFE", "上次工具执行结果尚不明确，不能自动继续或重放。请核对结果后明确提交新问题。", 409);
      }
    }
    const receipt = beginRun(session, request.text, operation, request.previousRunId);
    acceptedRequests.set(request.requestId, { fingerprint, receipt });
    return structuredClone(await receipt);
  };
  const client: WorkbenchClient = {
    mode: "host",
    async identity() {
      await ready;
      const current = sessions.get(initial.id) ?? [...sessions.values()].find(item => !item.problem);
      if (!current) throw new WorkbenchError("SESSION_NOT_FOUND", "当前没有可用会话，请新建研究。", 404);
      return { workspaceId, sessionId: current.id, runId: current.runId };
    },
    async workspaces() { await ready; return [...sessions.values()].map(summary); },
    async session(id) { return read(id); },
    async transcript(id) { return (await read(id)).turns; },
    async market() { assertOpen(); return market.read(); },
    async refreshMarket(failedOnly) { assertOpen(); return market.refresh(failedOnly); },
    async output(id) { return (await read(id)).output; },
    async createSession() {
      assertOpen();
      await ready; assertOpen(); const session = blank();
      await flush(session); sessions.set(session.id, session); unload(session); return summary(session);
    },
    async renameSession(value) {
      assertOpen(); const input = renameSessionRequest(value);
      if (input.workspaceId !== workspaceId) throw new WorkbenchError("WORKSPACE_MISMATCH", "工作区不匹配。", 409);
      await ready; assertOpen(); const session = get(input.sessionId);
      if (operations.has(session.id)) throw new WorkbenchError("SESSION_BUSY", "会话正在保存或复核，请稍后重新读取。", 409);
      if (session.revision !== input.expectedRevision) throw new WorkbenchError("REVISION_CONFLICT", "会话已变化，请重新读取后重命名。", 409);
      session.name = clean(input.title); emit(session); await flush(session); unload(session);
    },
    async references(id, query) { requestString(id); requestString(query, 1000, true); throw new WorkbenchError("UNAVAILABLE", "此本地连接暂未开放文件引用，请直接描述研究问题。"); },
    async preferences() { return publicPreferences(settings.read()); },
    async updatePreferences(next: Preferences) {
      assertOpen(); next = preferencesRequest(next);
      if (operations.size || [...sessions.values()].some(session => !!session.active)) throw new WorkbenchError("RUN_ACTIVE", "请先等待或停止研究，再修改研究设置。", 409);
      const source = settings.read().preferences.source;
      updateModel(settings, next);
      if (settings.read().preferences.source !== source) market.invalidate();
    },
    submit: value => accept("submit", value),
    continue: value => accept("continue", value),
    followup: value => accept("followup", value),
    async save(value) {
      assertOpen(); const input = saveRequest(value);
      if (input.workspaceId !== workspaceId) throw new WorkbenchError("WORKSPACE_MISMATCH", "工作区不匹配。", 409);
      await ready; assertOpen(); const session = get(input.sessionId);
      if (session.active || operations.has(session.id)) throw new WorkbenchError("SESSION_BUSY", "会话仍在执行或保存，请稍后重新读取。", 409);
      if (session.revision !== input.expectedRevision) throw new WorkbenchError("REVISION_CONFLICT", "会话已变化，请重新读取后保存。", 409);
      if (session.runId !== input.runId) throw new WorkbenchError("RUN_CONFLICT", "运行已变化，请重新读取后保存。", 409);
      if (session.state !== "settled" || !session.coreSessionId || !session.coreLeafId) throw new WorkbenchError("SAVE_UNAVAILABLE", "只有包含固定上下文位置的已完成研究可以保存为成果。", 409);
      const coreSessionId = session.coreSessionId;
      const leafId = session.coreLeafId;
      const operation = (async () => {
        await session.writes; assertOpen();
        assertCurrentCheckpoint(session);
        const dependencies = options.dependencies?.() ?? createDefaultSessionDependencies({ cwd: session.cwd });
        try {
          const report = await saveResearchReport({ sessionId: session.id, coreSessionId, leafId, runId: input.runId, cwd: session.cwd,
            title: clean(session.name), expectedArtifactRevision: input.expectedArtifactRevision, artifacts: session.output?.artifacts ?? [], dependencies });
          const saved = { ...snapshot(session), revision: session.revision + 1,
            output: { ...(session.output ?? emptyOutput()), artifacts: [...(session.output?.artifacts ?? []), report] } };
          const updatedAt = new Date().toISOString();
          await flush(session, saved, updatedAt);
          Object.assign(session, { output: saved.output, revision: saved.revision, updatedAt });
          publish(session); return structuredClone(report);
        } finally { await dependencies.env.cleanup().catch(() => {}); }
      })();
      operations.set(session.id, operation);
      try { return await operation; } finally { operations.delete(session.id); unload(session); }
    },
    async reload(value) {
      const input = artifactRequest(value);
      if (input.workspaceId !== workspaceId) throw new WorkbenchError("WORKSPACE_MISMATCH", "工作区不匹配。", 409);
      const current = await read(input.sessionId);
      return reloadResearchReport(input, current, clean);
    },
    async review(value) {
      assertOpen(); const input = reviewRequest(value);
      if (hasExplicitReference(input.text)) throw new WorkbenchError("REFERENCE_UNAVAILABLE", "当前连接尚未开放引用读取，未调用模型，草稿已保留。请直接粘贴所需内容；字面示例可用反引号或反斜杠转义。");
      if (input.workspaceId !== workspaceId) throw new WorkbenchError("WORKSPACE_MISMATCH", "工作区不匹配。", 409);
      await ready; assertOpen();
      const fingerprint = createHash("sha256").update(JSON.stringify({ operation: "review", ...input })).digest("hex");
      const previous = acceptedRequests.get(input.requestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new WorkbenchError("REQUEST_CONFLICT", "请求标识已用于不同输入，未重复执行。", 409);
        return structuredClone(await previous.receipt);
      }
      const source = get(input.sessionId);
      if (operations.has(source.id)) throw new WorkbenchError("SESSION_BUSY", "会话正在保存或复核，请稍后重新读取。", 409);
      if (source.revision !== input.expectedRevision) throw new WorkbenchError("REVISION_CONFLICT", "来源会话已变化，请重新读取后复核。", 409);
      const reference = { workspaceId, sessionId: source.id, artifactId: input.artifactId, sha256: input.sha256 };
      const fixed = reloadResearchReport(reference, snapshot(source), clean);
      const operation = (async () => {
        await source.writes; assertOpen();
        assertCurrentCheckpoint(source);
        const dependencies = options.dependencies?.() ?? createDefaultSessionDependencies({ cwd: source.cwd });
        let coreSessionId: string;
        try { coreSessionId = await forkResearchReport(reference, source.cwd, dependencies); }
        finally { await dependencies.env.cleanup().catch(() => {}); }
        assertOpen();
        if (source.revision !== input.expectedRevision) throw new WorkbenchError("REVISION_CONFLICT", "来源会话已变化，复核尚未运行。", 409);
        assertCurrentCheckpoint(source);
        const session = blank();
        session.cwd = source.cwd; session.coreSessionId = coreSessionId;
        session.name = `复核：${fixed.artifact.title}`.slice(0, 100);
        session.source = { ...reference, runId: fixed.identity.runId };
        await flush(session); sessions.set(session.id, session); assertOpen();
        return beginRun(session, input.text, "review", fixed.identity.runId);
      })();
      operations.set(source.id, operation); acceptedRequests.set(input.requestId, { fingerprint, receipt: operation });
      try { return structuredClone(await operation); } finally { operations.delete(source.id); unload(source); }
    },
    async deleteSession(value) {
      assertOpen(); const input = deleteSessionRequest(value);
      if (input.workspaceId !== workspaceId) throw new WorkbenchError("WORKSPACE_MISMATCH", "工作区不匹配。", 409);
      await ready; assertOpen(); const session = get(input.sessionId);
      if (session.active || operations.has(session.id)) throw new WorkbenchError("SESSION_BUSY", "会话仍在执行或保存，不能删除。", 409);
      if (session.revision !== input.expectedRevision) throw new WorkbenchError("REVISION_CONFLICT", "会话已变化，请重新读取后删除。", 409);
      clearTimeout(session.timer); session.timer = undefined;
      const operation = (async () => {
        await session.writes; assertOpen();
        if (session.problem || !session.fileRevision) throw storageError();
        try { await storage.delete(workspaceId, session.id, session.fileRevision); }
        catch (error) {
          if ((error as { code?: string })?.code === "ESTORAGECONFLICT") throw new WorkbenchError("REVISION_CONFLICT", "会话已变化，请重新读取后删除。", 409);
          throw storageError();
        }
        sessions.delete(session.id);
      })();
      operations.set(session.id, operation);
      try { await operation; } finally { operations.delete(session.id); unload(session); }
    },
    async acknowledgeInterruption(value) {
      assertOpen(); const input = runRevisionRequest(value);
      if (input.workspaceId !== workspaceId) throw new WorkbenchError("WORKSPACE_MISMATCH", "工作区不匹配。", 409);
      await ready; assertOpen(); const session = get(input.sessionId);
      if (operations.has(session.id)) throw new WorkbenchError("SESSION_BUSY", "会话正在保存、删除或复核，请稍后重新读取。", 409);
      if (session.runId !== input.runId) throw new WorkbenchError("RUN_NOT_FOUND", "未找到这次中断运行。", 404);
      if (session.revision !== input.expectedRevision) throw new WorkbenchError("REVISION_CONFLICT", "会话已变化，请重新读取后确认。", 409);
      if (session.state !== "interrupted" || !session.recovery) throw new WorkbenchError("RUN_CHANGED", "这次运行不再处于待确认状态。", 409);
      session.recovery = { ...session.recovery, acknowledgementRequired: false }; emit(session); await flush(session); unload(session);
    },
    async cancel(value) {
      const target = runIdentity(value);
      if (target.workspaceId !== workspaceId) throw new WorkbenchError("WORKSPACE_MISMATCH", "工作区不匹配，未取消其他研究。", 409);
      await ready;
      const session = sessions.get(target.sessionId), id = target.runId;
      if (!session || session.runId !== id) throw new WorkbenchError("RUN_NOT_FOUND", "未找到这次运行；未取消其他研究。", 404);
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
    market.close();
    await Promise.allSettled([...operations.values()]);
    const pending = [...sessions.values()].flatMap(session => session.active
      ? [client.cancel({ workspaceId, sessionId: session.id, runId: session.active.id })] : []);
    await Promise.allSettled(pending);
    await Promise.allSettled([...sessions.values()].map(async session => { clearTimeout(session.timer); await session.writes; }));
    listeners.clear();
    acceptedRequests.clear();
  } };
}
