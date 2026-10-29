import { createHash, randomUUID } from "node:crypto";
import { createQuantResearchAgent, QuantResearchHarness } from "../../runtime/quant-harness.ts";
import { createDefaultSessionDependencies } from "../../runtime/session-dependencies.ts";
import { BUILTIN_TOOL_REGISTRY } from "../../tools/registry.ts";
import { acquireResourceLeaseSet, acquireResourceLeases, artifactReference, createWorkbenchSessionStore, loadArtifactSnapshot } from "../../storage/index.ts";
import type { QuantAgentDependencies, QuantAgentEvent, QuantAgentSession } from "../../agent/src/session-contracts.ts";
import type { AgentPhase, Preferences, RunState, SessionSnapshot, SubmitRequest, SubmitResult, ToolActivity, Turn, WorkbenchClient, WorkbenchEvent, WorkspaceOutput, WorkspaceSummary } from "../../types/workbench.ts";
import { WorkbenchError, modelError } from "../workbench/errors.ts";
import { localSettings, publicPreferences, secretValues, updateModel, type SettingsPort } from "../workbench/model.ts";
import { completeRunActivity, recoverSnapshot } from "../workbench/session-recovery.ts";
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
import { TerminalEnvironment } from "./terminal-environment.ts";
import { reviewTerminalAnswer } from "./terminal-answer-review.ts";
import { generateCurrentSessionArtifact, restoreArtifactReport } from "../../runtime/research/artifact-reports.ts";
import { isQuantAnalysisRequest } from "../../agent/src/context.ts";
import { executeCommand, parseCommand } from "../../cli/registry.ts";
import { restoredSessionRepository, waitForResearch } from "./session-agent.ts";
import { terminalCommandIdentity, terminalContextRequest, terminalQueueRequest, terminalReferenceRequest, terminalRestoreRequest, terminalResearchRequest } from "./requests.ts";
import type { TerminalCommandIdentity, TerminalCommandReceipt, TerminalQueueReceipt, TerminalRestoreReceipt } from "../../types/terminal.ts";
import { readLegacySession } from "./legacy-session.ts";
import { readTerminalContext } from "./terminal-context.ts";
import { ComposerReferences } from "../../runtime/workspace/composer-references.ts";
import { getRuntimeCommandInvocation } from "../../runtime/workspace/commands.ts";
import { commandPreflight } from "../../runtime/workspace/command-preflight.ts";
import type { CommandResult, ParsedCommand } from "../../types/commands.ts";
import { enqueueAgentMessage } from "../../agent/src/dispatch.ts";
import { extractDisplayText } from "../../runtime/workspace/messages.ts";
import { activeResearchSelection, researchSelectionKey, singlePortfolioToolDenial, type ResearchPortfolioSelection } from "../../runtime/research/active-portfolio.ts";
import type { ResearchTaskSpec } from "../../types/research-task.ts";
import { TerminalHudLatency, terminalModelSettingsKey } from "./terminal-hud.ts";
import type { HudContextUsage } from "../../types/hud.ts";
import { terminalCommandResources, terminalReadResources } from "./resource-paths.ts";

interface Running {
  id: string; controller: AbortController; promise: Promise<void>; finished: string[];
  activity: Map<string, ToolActivity & { started: number }>;
  effects: Promise<void>; effectFailed: boolean; blockedTools: Set<string>;
  secrets: string[]; phase: AgentPhase; thinking: string; finishedThinking: string[]; clarification?: string; terminal: boolean; answer?: string;
  command?: { parsed: ParsedCommand; result?: CommandResult };
  research?: { task: ResearchTaskSpec; expectedTaskRevision: string | null };
  portfolio?: { selection: ResearchPortfolioSelection; key: string; timer?: ReturnType<typeof setInterval> };
  hudSettingsKey?: string;
  acceptingInput?: boolean; composerQueue: string[];
}
interface Session {
  version: 1 | 2;
  id: string; name: string; state: RunState; revision: number; runCount: number;
  cwd: string; coreSessionId: string | null; updatedAt: string; fileRevision: string | null; writes: Promise<void>; pending: number; timer?: ReturnType<typeof setTimeout>; problem?: string; recovery?: SessionSnapshot["recovery"];
  runId: string | null; turns?: Turn[]; output?: WorkspaceOutput; agent?: QuantAgentSession; active?: Running;
  source?: SessionSnapshot["source"];
  coreLeafId?: string | null;
  /** An unconfirmed journal mutation cannot be safely reloaded from the old checkpoint in this Host. */
  uncertain?: boolean;
  terminalHud?: TerminalHudLatency;
  terminalUsage?: { settingsKey: string; coreSessionId: string; leafId: string | null; usage: HudContextUsage };
}
const emptyOutput = () => ({ conclusion: { statement: null, confidence: null, boundary: null, settled: false }, evidence: [], artifacts: [] });
const presentTool = (name: string, args?: unknown) => name === CLARIFICATION_TOOL ? { title: "澄清研究问题" } : toolPresentation(name, args);
const hasEffects = (name: string) => {
  if (name === CLARIFICATION_TOOL) return false;
  const registration = BUILTIN_TOOL_REGISTRY.find(entry => entry.tool.name === name);
  return !registration || registration.requirements.effects.some(effect => effect !== "local-read");
};
const toolReturnedError = (value: unknown) => {
  if (!value || typeof value !== "object" || !("details" in value)) return false;
  const details = value.details;
  return !!details && typeof details === "object" && "error" in details && !!details.error;
};
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
  const terminalCommands = new Map<string, { identity: TerminalCommandIdentity; fingerprint: string; cancel(): void; receipt: Promise<TerminalCommandReceipt> }>();
  const terminalQueues = new Map<string, { fingerprint: string; receipt: Promise<TerminalQueueReceipt> }>();
  const legacyImports = new Map<string, Promise<Session>>();
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const terminalEnvironment = new TerminalEnvironment();
  let terminalResourcesChanging = false;
  let closed = false;
  let closing: Promise<void> | undefined;
  const assertOpen = () => { if (closed) throw new WorkbenchError("CLOSED", "研究服务已关闭。", 503); };
  const acquireResourceRead = async (cwd: string, signal: AbortSignal) => {
    try { return await acquireResourceLeases(terminalReadResources(cwd), "read", signal); }
    catch (error) {
      if ((error as { code?: string }).code === "RESOURCES_IN_USE") throw new WorkbenchError("RESOURCES_IN_USE", "共享资源正在修改，请稍后重试。", 409);
      throw error;
    }
  };
  const storage = options.store ?? createWorkbenchSessionStore();
  const blank = (): Session => ({ version: 1, id: randomUUID(), name: "新研究", state: "idle", revision: 0, runCount: 0, runId: null, turns: [], cwd,
    coreSessionId: null, updatedAt: new Date().toISOString(), fileRevision: null, writes: Promise.resolve(), pending: 0 });
  for (const item of storage.list(workspaceId)) {
    const h = item.header;
    sessions.set(item.sessionId, h ? { version: h.version, id: h.sessionId, name: h.name, state: h.state === "running" ? "interrupted" : h.state,
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
    if (session.uncertain) throw new WorkbenchError("CONTEXT_UNCONFIRMED", "原会话可能已变化但未能保存视图，请保留原文件并核对后再继续。", 409);
    if (session.problem) {
      if (session.active || session.pending) throw storageError();
      session.turns = undefined;
    }
    if (!session.turns) {
      try {
        const loaded = storage.load(workspaceId, id), saved = recoverSnapshot(loaded.record.snapshot, hasEffects);
        const record = loaded.record;
        Object.assign(session, { version: record.version, name: record.name, cwd: record.cwd, coreSessionId: record.coreSessionId, coreLeafId: record.coreLeafId, runCount: record.runCount,
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
    if (saved.state !== "interrupted" && saved.recovery) session.version = 2;
    const record = { version: session.version, workspaceId, sessionId: session.id, name: session.name, cwd: session.cwd,
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
    const thinking = run.terminal ? undefined : redactModelText(run.thinking, run.secrets, run.phase === "thinking") || undefined;
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
    if (run.hudSettingsKey) session.terminalHud?.observe(event, run.hudSettingsKey, session.agent?.state.thinkingLevel);
    if (event.type === "queue_update") {
      run.composerQueue = [...event.steer, ...event.followUp, ...event.nextTurn].map(message => redact(run, extractDisplayText(message)));
      emit(session);
    }
    if (event.type === "agent_end") { run.acceptingInput = false; run.composerQueue = []; emit(session); }
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
        run.answer = event.message.stopReason === "stop" && !event.message.content.some(part => part.type === "toolCall") ? text : undefined;
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
        ...(run.blockedTools.has(event.toolCallId) ? {} : { result: toolResult(event.result, run.secrets) }),
        state: run.blockedTools.has(event.toolCallId) ? "not-run" : event.isError || toolReturnedError(event.result) ? "failed" : "completed", started: old?.started ?? performance.now(), elapsedMs: Math.max(0, Math.round(performance.now() - (old?.started ?? performance.now()))) });
      run.phase = [...run.activity.values()].some(item => item.state === "running") ? "tool" : "waiting";
      assistant(session, run);
    }
  };
  const referencesFor = (session: Session, agent?: QuantAgentSession, repository?: QuantAgentDependencies["sessions"]) => {
    const coreSessionId = session.coreSessionId;
    return new ComposerReferences(session.cwd, { current: async () => {
      if (agent) {
        const current = await agent.getSessionMetadata();
        if (!current) return null;
        const entries = await agent.getSessionBranch();
        if ((await agent.getSessionMetadata())?.id !== current.id) throw new WorkbenchError("CONTEXT_CHANGED", "会话已切换，请重新选择引用。", 409);
        return { id: current.id, path: current.path, entries };
      }
      if (!coreSessionId) return null;
      const current = (await repository!.list({ cwd: session.cwd })).find(item => item.id === coreSessionId);
      if (!current) throw new WorkbenchError("CONTEXT_MISSING", "原会话引用不可用；未创建替代会话。", 409);
      const source = await repository!.open(current);
      return { id: current.id, path: current.path, entries: await source.getBranch() };
    } });
  };
  const portfolioChanged = (run: Running) => {
    if (!run.portfolio) return false;
    try { return researchSelectionKey() !== run.portfolio.key; } catch { return true; }
  };
  const stopChangedPortfolio = (session: Session, run: Running) => {
    if (!portfolioChanged(run)) return false;
    run.controller.abort(); session.agent?.abort();
    return true;
  };
  const execute = async (session: Session, run: Running, text: string) => {
    let release: (() => void) | undefined;
    let cleanup: (() => Promise<void>) | undefined;
    let releaseResources: (() => Promise<void>) | undefined;
    try {
      run.controller.signal.throwIfAborted();
      releaseResources = await acquireResourceRead(session.cwd, run.controller.signal);
      if (!session.agent) {
        const dependencies = run.terminal ? await terminalEnvironment.dependencies(session.cwd, options.dependencies, run.portfolio?.selection)
          : options.dependencies?.() ?? createDefaultSessionDependencies({ cwd: session.cwd }, "markdown");
        cleanup = () => dependencies.env.cleanup();
        run.controller.signal.throwIfAborted();
        const allowed = new Set(BUILTIN_TOOL_REGISTRY.filter(item => item.domain !== "system").map(item => item.tool.name));
        // Browser requests never opt into the local terminal execution capability.
        const { readTools: _readTools, ...fixed } = dependencies;
        const restored = restoredSessionRepository(dependencies.sessions, session.cwd, session.coreSessionId);
        const clarification = clarificationTool(question => {
          run.controller.signal.throwIfAborted();
          run.clarification = redact(run, question);
        });
        const protect = (items: QuantAgentDependencies["tools"]) => [...items.filter(tool => tool.name !== CLARIFICATION_TOOL), clarification].map(tool => ({ ...tool,
          async execute(...args: Parameters<typeof tool.execute>) {
            const invoke = async () => {
              run.controller.signal.throwIfAborted();
              if (run.effectFailed && hasEffects(tool.name) && tool.name !== CLARIFICATION_TOOL) {
                run.blockedTools.add(args[0]); throw new Error("Previous effectful tool outcome requires user reconciliation.");
              }
              await flush(session); run.controller.signal.throwIfAborted();
              try {
                const result = await tool.execute(...args);
                if (hasEffects(tool.name) && tool.name !== CLARIFICATION_TOOL && toolReturnedError(result)) run.effectFailed = true;
                return result;
              } catch (error) {
                if (hasEffects(tool.name) && tool.name !== CLARIFICATION_TOOL) run.effectFailed = true;
                throw error;
              }
            };
            if (!hasEffects(tool.name) || tool.name === CLARIFICATION_TOOL) return invoke();
            const pending = run.effects.then(invoke); run.effects = pending.then(() => {}, () => {}); return pending;
          },
        }));
        const tools = protect(run.terminal ? dependencies.tools : dependencies.tools.filter(tool => allowed.has(tool.name)));
        session.agent = createQuantResearchAgent({ cwd: session.cwd, dependencies: { ...fixed, sessions: restored, tools,
          beforeToolCall: async call => {
            if (stopChangedPortfolio(session, run)) {
              return { block: true, reason: "The selected portfolio changed; this research was stopped.", terminate: true };
            }
            if (run.clarification) return { block: true, reason: "A user answer is required before any further tool calls.", terminate: true };
            if (run.effectFailed && hasEffects(call.toolName) && call.toolName !== CLARIFICATION_TOOL) {
              run.blockedTools.add(call.toolCallId);
              return { block: true, reason: "Previous effectful tool outcome requires user reconciliation.", terminate: true };
            }
            return dependencies.beforeToolCall?.(call);
          },
          ...(run.terminal ? { ...(dependencies.readTools ? { readTools: () => {
            const snapshot = dependencies.readTools!(); return { ...snapshot, tools: protect(snapshot.tools) };
          } } : {}) } : { loadSkills: async () => [], readSkillRevision: undefined, prepareSkills: undefined }) } });
      }
      const metadata = await session.agent.getSessionMetadata();
      if (!metadata || session.coreSessionId && metadata.id !== session.coreSessionId) throw new WorkbenchError("CONTEXT_MISSING", "原研究上下文不匹配，未发送问题。", 409);
      session.coreSessionId = metadata.id; await flush(session);
      stopChangedPortfolio(session, run);
      // A later run can echo prior tool output; recover exact paths from the private branch, never the public checkpoint.
      for (const entry of await session.agent.getSessionBranch()) {
        if (entry.type === "message" && entry.message.role === "toolResult") {
          for (const path of reportPathSecrets(entry.message)) if (!run.secrets.includes(path)) run.secrets.push(path);
        }
      }
      run.controller.signal.throwIfAborted();
      release = session.agent.subscribe(event => observe(session, run, event));
      const agent = session.agent;
      const references = run.terminal && !run.command ? referencesFor(session, agent) : undefined;
      if (run.command) {
        run.acceptingInput = true;
        try { run.command.result = await executeCommand(run.command.parsed, { agentSession: agent, commandSignal: run.controller.signal }); }
        finally { run.acceptingInput = false; }
        if (!run.command.result.success) throw new WorkbenchError("COMMAND_FAILED", clean(run.command.result.message), 400);
      } else {
        if (run.research) {
          try {
            await new QuantResearchHarness(agent).update({ version: 1, type: "declare", expectedRevision: run.research.expectedTaskRevision,
              task: run.research.task }, run.controller.signal);
          } catch (error) {
            if (run.controller.signal.aborted) throw error;
            throw new WorkbenchError("TASK_INVALID", clean(redact(run, error instanceof Error ? error.message : String(error))).slice(0, 500), 409);
          }
          run.controller.signal.throwIfAborted();
        }
        let prompt = text;
        if (references) {
          try { prompt = await references.expand(text, run.controller.signal); }
          catch (error) {
            if (run.controller.signal.aborted) throw error;
            throw new WorkbenchError("REFERENCE_INVALID", "引用无法读取，请检查名称、大小和权限后重试。", 400);
          }
        }
        stopChangedPortfolio(session, run);
        run.controller.signal.throwIfAborted();
        run.acceptingInput = true;
        try { await agent.prompt(prompt, { displayText: text, signal: run.controller.signal }); }
        finally { run.acceptingInput = false; }
      }
      await session.agent.waitForIdle();
      stopChangedPortfolio(session, run);
      run.controller.signal.throwIfAborted();
      if (session.agent.state.errorMessage) {
        throw modelError(new Error(session.agent.state.errorMessage));
      }
      if (!run.finished.some(value => value.trim()) && ![...run.activity.values()].some(item => item.state !== "preparing")) throw new WorkbenchError("EMPTY_REPLY", "模型未返回可显示的回答，请检查配置或重试。", 502);
      session.coreLeafId = await session.agent.getLeafId();
      const review = run.terminal && run.answer && !run.clarification ? await reviewTerminalAnswer(run.answer, session.agent) : undefined;
      stopChangedPortfolio(session, run);
      run.controller.signal.throwIfAborted();
      let artifactMessage: string | undefined;
      if (run.terminal && run.answer && !review && !run.clarification && settings.read().artifactGeneration.auto && isQuantAnalysisRequest(text)) {
        // Keep the accepted run as the owner through report persistence. A view
        // detaching does not skip generation or open a file in the Host process.
        await flush(session); run.controller.signal.throwIfAborted();
        try {
          const result = await generateCurrentSessionArtifact({ agentSession: session.agent, openFile: () => {}, commandSignal: run.controller.signal });
          const artifact = result.data?.artifact;
          if (!result.success || !artifact?.revision) throw new Error("Automatic report was not saved");
          const artifacts = session.output?.artifacts ?? [];
          const output = { ...(session.output ?? emptyOutput()), artifacts: [...artifacts, {
            id: artifact.sessionId, title: clean(artifact.title), sha256: artifact.revision, createdAt: artifact.createdAt,
            version: artifacts.filter(item => item.id === artifact.sessionId).length + 1, runId: run.id,
          }] };
          // The existing generator appends an artifact_export context note.
          // Preserve a saved report even if cancellation arrived during that note.
          await flush(session, { ...snapshot(session), output });
          session.output = output;
          artifactMessage = `自动报告已保存 · ${clean(result.message)}`;
        } catch (error) {
          if (session.problem || run.controller.signal.aborted) throw error;
          artifactMessage = "自动报告生成失败；研究回答已保留，请核对本机报告后再操作。";
        }
      }
      stopChangedPortfolio(session, run);
      run.controller.signal.throwIfAborted();
      if (session.active === run && session.state === "running") {
        session.state = run.clarification ? "needs_input" : "settled";
        finishActivities(session, run);
        const uncertain = [...run.activity.values()].filter(item => item.state === "failed" && hasEffects(item.name)).length;
        if (uncertain) session.recovery = { runId: run.id, unconfirmedTools: uncertain, acknowledgementRequired: true };
        assistant(session, run, [run.clarification ?? (run.finished.join("\n\n") || "本轮工具调用已结束，模型未提供文字总结。请检查工具状态或继续追问。"), review?.message, artifactMessage].filter(Boolean).join("\n\n"));
      }
    } catch (error) {
      if (run.command) run.command.result = { success: false,
        message: clean(redact(run, error instanceof Error ? error.message : String(error))).slice(0, 2000) };
      if (session.active === run && session.state === "running") {
        session.state = run.controller.signal.aborted && !session.problem ? "cancelled" : "failed";
        finishActivities(session, run);
        const uncertain = [...run.activity.values()].filter(item => ["failed", "cancelled"].includes(item.state) && hasEffects(item.name)).length;
        if (uncertain) session.recovery = { runId: run.id, unconfirmedTools: uncertain, acknowledgementRequired: true };
        const partial = run.finished.join("\n\n") || session.turns!.find(turn => turn.id === run.id + "-assistant")?.text || "";
        const message = session.state === "cancelled" ? "当前研究已停止，已返回的内容保留。" : (session.problem ? storageError() : error instanceof WorkbenchError ? error : modelError(error)).message;
        assistant(session, run, [partial, message].filter(Boolean).join("\n\n"));
      }
    } finally {
      run.acceptingInput = false; run.composerQueue = [];
      clearInterval(run.portfolio?.timer);
      let usage: Session["terminalUsage"];
      if (run.terminal && session.agent && session.coreSessionId && run.hudSettingsKey) {
        try {
          const current = session.agent.getContextUsage(), leafId = await session.agent.getLeafId();
          if (current) usage = { settingsKey: run.hudSettingsKey, coreSessionId: session.coreSessionId, leafId, usage: structuredClone(current) };
        } catch { /* A missing estimate remains unknown. */ }
      }
      release?.(); session.agent = undefined; await cleanup?.().catch(() => {});
      try { await releaseResources?.(); }
      catch { if (session.active === run) { session.state = "failed"; assistant(session, run, "资源租约无法释放，请停止后端并检查共享资源后再重试。"); } }
      if (session.active === run) {
        emit(session);
        try { await flush(session); session.terminalUsage = usage; } catch { session.terminalUsage = undefined; }
        session.active = undefined; unload(session);
      }
    }
  };
  const beginRun = (session: Session, text: string, operation: NonNullable<Turn["operation"]>, previousRunId?: string, terminal = false, command?: ParsedCommand,
    research?: Running["research"]): Promise<SubmitResult> => {
    const selection = terminal ? activeResearchSelection() : undefined;
    const hudSettingsKey = terminal ? terminalModelSettingsKey(settings.read()) : undefined;
    if (terminal) session.terminalHud ??= new TerminalHudLatency();
    else { session.terminalHud = undefined; session.terminalUsage = undefined; }
    const id = randomUUID(), at = new Date().toISOString();
    const run: Running = { id, controller: new AbortController(), promise: Promise.resolve(), finished: [], activity: new Map(), effects: Promise.resolve(), effectFailed: false, blockedTools: new Set(), secrets: secretValues(settings.read()), phase: "waiting", thinking: "", finishedThinking: [], terminal, composerQueue: [],
      ...(command ? { command: { parsed: command } } : {}), ...(research ? { research } : {}),
      ...(selection ? { portfolio: { selection, key: researchSelectionKey(selection) } } : {}), ...(hudSettingsKey ? { hudSettingsKey } : {}) };
    session.recovery = undefined; session.coreLeafId = null; session.runId = id; session.state = "running"; session.active = run; session.runCount++;
    if (!session.turns!.length && session.name === "新研究") session.name = redact(run, text.trim()).slice(0, 32);
    session.turns!.push({ id: id + "-user", role: "user", operation, ...(previousRunId ? { previousRunId: previousRunId } : {}), text: redact(run, text.trim()), state: "settled", at }, { id: id + "-assistant", role: "assistant", text: "", state: "running", at, activity: [], phase: "waiting" });
    if (run.portfolio) {
      run.portfolio.timer = setInterval(() => {
        if (session.active !== run || run.controller.signal.aborted) return;
        if (portfolioChanged(run)) {
          clearInterval(run.portfolio!.timer);
          void client.cancel({ workspaceId, sessionId: session.id, runId: run.id }).catch(() => {});
        }
      }, 250);
      run.portfolio.timer.unref?.();
    }
    emit(session);
    const accepted = flush(session);
    run.promise = accepted.then(() => execute(session, run, redact(run, text.trim())), () => {
      clearInterval(run.portfolio?.timer); session.state = "failed"; session.active = undefined;
    });
    return accepted.then(() => ({ sessionId: session.id, runId: id }));
  };
  const accept = async (operation: "submit" | "continue" | "followup", value: unknown, terminal = false, research?: Running["research"]): Promise<SubmitResult> => {
    assertOpen();
    const request: SubmitRequest & { previousRunId?: string } = operation === "submit" ? submitRequest(value)
      : operation === "followup" ? nextRunRequest(value, "followup")
      : { ...nextRunRequest(value, "continue"), text: "继续未完成的研究。先核对已有结果和证据日期，不自动重放已完成的工具或更新既有证据。" };
    if (request.workspaceId !== workspaceId) throw new WorkbenchError("WORKSPACE_MISMATCH", "工作区不匹配，请重新连接。", 409);
    if (!terminal && hasExplicitReference(request.text)) throw new WorkbenchError("REFERENCE_UNAVAILABLE", "当前连接尚未开放引用读取，未调用模型，草稿已保留。请直接粘贴所需内容；字面示例可用反引号或反斜杠转义。");
    await ready;
    assertOpen();
    const fingerprint = createHash("sha256").update(JSON.stringify({ operation, terminal, ...request, ...(research ? { research } : {}) })).digest("hex");
    if (terminalCommands.has(request.requestId)) throw new WorkbenchError("REQUEST_CONFLICT", "请求标识已用于终端命令，未重复执行。", 409);
    if (terminalQueues.has(request.requestId)) throw new WorkbenchError("REQUEST_CONFLICT", "请求标识已用于排队输入，未重复执行。", 409);
    const previous = acceptedRequests.get(request.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new WorkbenchError("REQUEST_CONFLICT", "请求标识已用于不同输入，未重复执行。", 409);
      return structuredClone(await previous.receipt);
    }
    if (research) {
      const denied = singlePortfolioToolDenial("research_task", { action: "declare", task: research.task });
      if (denied) throw new WorkbenchError("TASK_SCOPE", denied, 409);
    }
    if (terminalResourcesChanging) throw new WorkbenchError("RESOURCES_BUSY", "终端资源正在更新，请完成后重新提交。", 409);
    const session = get(request.sessionId);
    if (operations.has(session.id)) throw new WorkbenchError("SESSION_BUSY", "会话正在保存或复核，请稍后重新读取。", 409);
    if (session.active) throw new WorkbenchError("RUN_ACTIVE", "当前会话仍在运行，请等待或显式停止。", 409);
    if (session.recovery?.acknowledgementRequired) throw new WorkbenchError("RECONCILE_REQUIRED", "上次运行或上下文待核对，请先确认后再提问。", 409);
    if (session.revision !== request.expectedRevision) throw new WorkbenchError("REVISION_CONFLICT", "会话已被其他客户端更新，请重新读取后再提交。", 409);
    if (operation === "submit" && session.state === "needs_input") throw new WorkbenchError("CLARIFICATION_PENDING", "请通过追问回答当前澄清问题，或新建会话开始其他研究。", 409);
    if (operation !== "submit") {
      if (session.runId !== request.previousRunId) throw new WorkbenchError("RUN_CONFLICT", "先前运行已变化，请读取最新会话后再操作。", 409);
      if (operation === "followup" && !["settled", "needs_input"].includes(session.state)) throw new WorkbenchError("FOLLOWUP_UNAVAILABLE", "请先完成当前研究、回答澄清问题，或明确继续未完成的运行。", 409);
      if (operation === "continue") {
        const priorTurns = session.turns!.filter(turn => turn.id === session.runId + "-assistant");
        const prior = priorTurns[0];
        if (!["cancelled", "failed", "interrupted"].includes(session.state) || !session.coreSessionId)
          throw new WorkbenchError("CONTINUE_UNAVAILABLE", "这次运行没有可继续的未完成上下文，请新建提交。", 409);
        if (!completeRunActivity(session.turns!, session.runId!, session.state) || prior!.activity!.some(item => item.state === "preparing"))
          throw new WorkbenchError("CONTINUE_UNSAFE", "上次运行的工具记录不完整或存在歧义，不能安全继续。请核对原记录后明确提交新问题。", 409);
        if (prior!.activity!.some(item => {
          if (["unconfirmed", "cancelled", "running"].includes(item.state)) return true;
          if (item.state !== "failed" && item.state !== "completed") return false;
          return hasEffects(item.name);
        }))
          throw new WorkbenchError("CONTINUE_UNSAFE", "上次运行包含可能产生副作用或结果未确认的工具，不能安全自动继续。请核对结果后明确提交新问题。", 409);
      }
    }
    const receipt = beginRun(session, request.text, operation, request.previousRunId, terminal, undefined, research);
    acceptedRequests.set(request.requestId, { fingerprint, receipt });
    return structuredClone(await receipt);
  };
  const enqueue = async (value: unknown): Promise<TerminalQueueReceipt> => {
    assertOpen(); const input = terminalQueueRequest(value);
    if (input.workspaceId !== workspaceId) throw new WorkbenchError("WORKSPACE_MISMATCH", "工作区不匹配。", 409);
    await ready; assertOpen();
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex"), previous = terminalQueues.get(input.requestId);
    if (acceptedRequests.has(input.requestId) || terminalCommands.has(input.requestId) || previous && previous.fingerprint !== fingerprint)
      throw new WorkbenchError("REQUEST_CONFLICT", "请求标识已用于不同操作，未重复执行。", 409);
    if (previous) return structuredClone(await previous.receipt);
    const session = get(input.sessionId), run = session.active, agent = session.agent;
    const assertOwner = () => {
      assertOpen();
      if (run) stopChangedPortfolio(session, run);
      if (!run?.terminal || !agent || !run.acceptingInput || run.controller.signal.aborted || run.clarification
        || session.active !== run || session.agent !== agent || run.id !== input.runId || session.state !== "running")
        throw new WorkbenchError("QUEUE_CLOSED", "这次运行已不再接收输入；请核对结果后重新提交。", 409);
    };
    assertOwner();
    const receipt = Promise.resolve().then(async (): Promise<TerminalQueueReceipt> => {
      assertOwner();
      let prompt: string;
      try { prompt = await referencesFor(session, agent!).expand(redact(run!, input.text), run!.controller.signal); }
      catch {
        assertOwner();
        throw new WorkbenchError("REFERENCE_INVALID", "引用无法读取，请检查名称、大小和权限后重试。", 400);
      }
      assertOwner();
      try {
        const mode = await enqueueAgentMessage(agent!, prompt, redact(run!, input.text));
        return { workspaceId, sessionId: input.sessionId, runId: input.runId, requestId: input.requestId, mode: mode as "steer" | "followUp" };
      } catch (error) {
        if ((error as { code?: string })?.code === "invalid_state") throw new WorkbenchError("QUEUE_CLOSED", "这次运行已结束接收输入；请核对结果后重新提交。", 409);
        throw new WorkbenchError("QUEUE_UNKNOWN", "排队结果未确认；请检查原运行，不要自动重试。", 409);
      }
    });
    terminalQueues.set(input.requestId, { fingerprint, receipt });
    return structuredClone(await receipt);
  };
  const selectCoreSession = async (repository: QuantAgentDependencies["sessions"], cwd: string, coreId: string, signal: AbortSignal) => {
    coreId = requestString(coreId); signal.throwIfAborted();
    const target = (await repository.list({ cwd })).find(item => item.id === coreId);
    if (!target) throw new WorkbenchError("SESSION_NOT_FOUND", `Session not found: ${coreId}`, 404);
    assertOpen(); signal.throwIfAborted();
    const matches = [...sessions.values()].filter(item => item.coreSessionId === coreId);
    if (matches.length > 1) throw new WorkbenchError("CONTEXT_CONFLICT", "多个工作台会话指向同一上下文，请先核对，未启动另一所有者。", 409);
    let selected = matches[0];
    if (selected) {
      selected = get(selected.id);
      if (selected.coreSessionId !== coreId) throw new WorkbenchError("CONTEXT_CHANGED", "目标会话已变化，请重新读取。", 409);
    } else {
      if ([...sessions.values()].some(item => item.problem)) throw storageError();
      let importing = legacyImports.get(coreId);
      if (!importing) {
        importing = (async () => {
          const projection = await readLegacySession(repository, target, clean);
          assertOpen();
          const imported: Session = { ...blank(), ...projection, cwd: target.cwd, coreSessionId: coreId };
          await flush(imported);
          sessions.set(imported.id, imported); publish(imported); unload(imported);
          return imported;
        })();
        legacyImports.set(coreId, importing);
      }
      selected = await importing;
      if (legacyImports.get(coreId) === importing) legacyImports.delete(coreId);
      selected = get(selected.id);
    }
    signal.throwIfAborted(); assertOpen();
    return { selected, target };
  };
  const command = async (value: unknown): Promise<TerminalCommandReceipt> => {
    assertOpen(); const input = submitRequest(value), parsed = parseCommand(input.text);
    const managesExtensions = parsed?.command === "config" && parsed.flags.extensions !== undefined;
    const managesSkills = parsed?.command === "skill" && !getRuntimeCommandInvocation(parsed).isSkillInvoke;
    const managesResources = managesExtensions || managesSkills || parsed?.command === "mcp";
    if (!parsed || !["compact", "resume", "clear", "mcp", "skill"].includes(parsed.command) && !managesExtensions)
      throw new WorkbenchError("COMMAND_UNAVAILABLE", "此共享终端接口尚未接入该命令。", 400);
    if (input.workspaceId !== workspaceId) throw new WorkbenchError("WORKSPACE_MISMATCH", "工作区不匹配。", 409);
    await ready; assertOpen();
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex"), previous = terminalCommands.get(input.requestId);
    if (acceptedRequests.has(input.requestId) || terminalQueues.has(input.requestId) || previous && previous.fingerprint !== fingerprint)
      throw new WorkbenchError("REQUEST_CONFLICT", "请求标识已用于不同操作，未重复执行。", 409);
    if (previous) return structuredClone(await previous.receipt);
    if (terminalResourcesChanging) throw new WorkbenchError("RESOURCES_BUSY", "终端资源正在更新，请完成后重新执行命令。", 409);
    const session = get(input.sessionId);
    if (operations.has(session.id)) throw new WorkbenchError("SESSION_BUSY", "会话正在执行其他保存或命令，请稍后重试。", 409);
    if (session.revision !== input.expectedRevision) throw new WorkbenchError("REVISION_CONFLICT", "会话已变化，请重新读取后执行命令。", 409);
    const changesResources = managesExtensions ? ![true, "list"].includes(parsed.flags.extensions as true | string)
      : parsed.command === "mcp" ? ["install", "remove"].includes(parsed.positional[0] ?? "")
        : managesSkills && (["remove", "reload"].includes(parsed.positional[0] ?? "")
          || parsed.positional[0] === "install" && (parsed.positional.length > 1 || parsed.flags.repo !== undefined || parsed.flags.all !== undefined));
    if (changesResources && (operations.size || [...sessions.values()].some(item => item.active)))
      throw new WorkbenchError("RESOURCES_IN_USE", "请等待所有会话的研究和命令结束，再修改共享终端资源。", 409);
    if (changesResources) terminalResourcesChanging = true;
    const identity = { workspaceId, sessionId: session.id, requestId: input.requestId }, controller = new AbortController();
    let agent: QuantAgentSession | undefined;
    const cancel = () => { controller.abort(); agent?.abort(); };
    const deadline = setTimeout(cancel, 300_000); deadline.unref?.();
    const operation = (async (): Promise<TerminalCommandReceipt> => {
      let dependencies: QuantAgentDependencies | undefined;
      let releaseResources: (() => Promise<void>) | undefined;
      try {
        if (managesResources) {
          try { releaseResources = await acquireResourceLeaseSet(terminalCommandResources(parsed, session.cwd, changesResources ? "write" : "read"), controller.signal); }
          catch (error) {
            if ((error as { code?: string }).code === "RESOURCES_IN_USE") throw new WorkbenchError("RESOURCES_IN_USE", "共享资源正被其他工作区使用，请稍后重试。", 409);
            throw error;
          }
          const result = await executeCommand(parsed, { cwd: session.cwd, commandSignal: controller.signal,
            skillCatalog: () => terminalEnvironment.catalog(session.cwd, options.dependencies),
            manageExtensions: (action, id, signal) => terminalEnvironment.manage(session.cwd, action, id, signal, options.dependencies) });
          controller.signal.throwIfAborted(); assertOpen();
          return { ...identity, revision: session.revision, result };
        }
        if (parsed.command === "clear") {
          const early = commandPreflight(parsed);
          if (early) return { ...identity, revision: session.revision, result: early };
          const owned = session.active;
          if (owned) await client.cancel({ workspaceId, sessionId: session.id, runId: owned.id });
          controller.signal.throwIfAborted(); assertOpen();
          if (session.problem) throw storageError();
          // Clear resets this view without deleting the old core journal or
          // mutating another view's selected conversation.
          const next = blank();
          await flush(next);
          sessions.set(next.id, next); unload(next);
          return { ...identity, revision: session.revision, selectedSessionId: next.id, result: await executeCommand(parsed, {}) };
        }
        const invocation = getRuntimeCommandInvocation(parsed);
        if (invocation.isSkillInvoke) {
          const early = commandPreflight(parsed);
          if (early) return { ...identity, revision: session.revision, result: early };
          if (session.active) throw new WorkbenchError("RUN_ACTIVE", "当前会话仍在运行，请等待或显式停止。", 409);
          if (session.recovery?.acknowledgementRequired) throw new WorkbenchError("RECONCILE_REQUIRED", "请先核对中断工具结果，再执行技能。", 409);
          const accepted = beginRun(session, `SKILL.${invocation.skillName}`, "submit", undefined, true, parsed);
          const owned = session.active!;
          const abort = () => { owned.controller.abort(); if (session.active === owned) session.agent?.abort(); };
          controller.signal.addEventListener("abort", abort, { once: true });
          try {
            if (controller.signal.aborted) abort();
            await accepted; await owned.promise;
            controller.signal.throwIfAborted();
            if (session.problem) throw storageError();
            const result = owned.command?.result;
            return { ...identity, revision: session.revision, result: result && (!result.success || ["settled", "needs_input"].includes(session.state))
              ? result : { success: false, message: "技能运行未完整结束，请核对当前会话后再操作。" } };
          } finally { controller.signal.removeEventListener("abort", abort); }
        }
        if (parsed.command === "resume") {
          // Selection is read-only for the source, including while it is running.
          dependencies = options.dependencies?.() ?? createDefaultSessionDependencies({ cwd: session.cwd });
          const repository = dependencies.sessions;
          let selectedSessionId: string | undefined;
          const metadata = () => repository.list({ cwd: session.cwd });
          const result = await executeCommand(parsed, { sessionCommands: {
            listSessions: metadata,
            getSessionMetadata: async () => (await metadata()).find(item => item.id === session.coreSessionId) ?? null,
            async resumeSession(coreId) {
              const { selected, target } = await selectCoreSession(repository, session.cwd, coreId, controller.signal);
              selectedSessionId = selected.id; return target;
            },
            ...(session.coreSessionId || session.agent ? { getResearchState: async () => {
              if (session.agent) return session.agent.getResearchState();
              await session.writes; assertCurrentCheckpoint(session); controller.signal.throwIfAborted();
              agent = createQuantResearchAgent({ cwd: session.cwd, dependencies: { ...dependencies!,
                sessions: restoredSessionRepository(repository, session.cwd, session.coreSessionId) } });
              return agent.getResearchState();
            } } : {}),
          } });
          controller.signal.throwIfAborted();
          return { ...identity, revision: session.revision, result, ...(selectedSessionId ? { selectedSessionId } : {}) };
        }
        await waitForResearch(session.active?.promise, controller.signal);
        assertOpen(); controller.signal.throwIfAborted();
        await session.writes; assertCurrentCheckpoint(session);
        if (session.recovery?.acknowledgementRequired) throw new WorkbenchError("RECONCILE_REQUIRED", "请先核对中断运行，再修改其上下文。", 409);
        if (!session.coreSessionId) return { ...identity, revision: session.revision, result: await executeCommand(parsed) };
        const commandSettingsKey = terminalModelSettingsKey(settings.read());
        releaseResources = await acquireResourceRead(session.cwd, controller.signal);
        dependencies = await terminalEnvironment.dependencies(session.cwd, options.dependencies);
        controller.signal.throwIfAborted(); assertCurrentCheckpoint(session);
        agent = createQuantResearchAgent({ cwd: session.cwd, dependencies: { ...dependencies,
          sessions: restoredSessionRepository(dependencies.sessions, session.cwd, session.coreSessionId) } });
        if ((await agent.getSessionMetadata())?.id !== session.coreSessionId) throw new WorkbenchError("CONTEXT_MISSING", "原研究上下文不匹配，未执行命令。", 409);
        controller.signal.throwIfAborted();
        const result = await executeCommand(parsed, { agentSession: agent, commandSignal: controller.signal });
        if (parsed.command === "compact" && result.success) session.terminalHud?.reset();
        controller.signal.throwIfAborted();
        const leaf = await agent.getLeafId();
        const usage = parsed.command === "compact" && result.success ? agent.getContextUsage() : undefined;
        assertCurrentCheckpoint(session);
        session.coreLeafId = leaf;
        const saved = { ...snapshot(session), revision: session.revision + 1 }, updatedAt = new Date().toISOString();
        await flush(session, saved, updatedAt);
        if (parsed.command === "compact" && result.success) session.terminalUsage = usage
          ? { settingsKey: commandSettingsKey, coreSessionId: session.coreSessionId, leafId: leaf, usage: structuredClone(usage) }
          : undefined;
        Object.assign(session, { revision: saved.revision, updatedAt }); publish(session);
        return { ...identity, revision: session.revision, result };
      } catch (error) {
        if (controller.signal.aborted) throw new WorkbenchError("COMMAND_CANCELLED", "终端命令已取消或超时；请核对当前上下文，不会自动重试。", 409);
        throw error;
      } finally { clearTimeout(deadline); await dependencies?.env.cleanup().catch(() => {}); agent = undefined; await releaseResources?.(); }
    })();
    const receipt = operation.finally(() => {
      if (changesResources) terminalResourcesChanging = false;
      operations.delete(session.id); unload(session);
    });
    terminalCommands.set(input.requestId, { identity, fingerprint, cancel, receipt }); operations.set(session.id, receipt);
    return structuredClone(await receipt);
  };
  const restoreReport = async (value: unknown): Promise<TerminalRestoreReceipt> => {
    assertOpen(); const input = terminalRestoreRequest(value);
    if (input.workspaceId !== workspaceId) throw new WorkbenchError("WORKSPACE_MISMATCH", "工作区不匹配。", 409);
    await ready; assertOpen();
    const fingerprint = createHash("sha256").update(JSON.stringify({ restoreReport: input })).digest("hex"), previous = terminalCommands.get(input.requestId);
    if (acceptedRequests.has(input.requestId) || terminalQueues.has(input.requestId) || previous && previous.fingerprint !== fingerprint)
      throw new WorkbenchError("REQUEST_CONFLICT", "请求标识已用于不同操作，未重复执行。", 409);
    if (previous) return structuredClone(await previous.receipt) as TerminalRestoreReceipt;
    if (terminalResourcesChanging) throw new WorkbenchError("RESOURCES_BUSY", "终端资源正在更新，请完成后重新恢复报告。", 409);
    const source = get(input.sessionId);
    if (operations.has(source.id) || source.active) throw new WorkbenchError("SESSION_BUSY", "当前会话仍在运行或执行命令。", 409);
    if (source.revision !== input.expectedRevision) throw new WorkbenchError("REVISION_CONFLICT", "会话已变化，请重新读取后恢复报告。", 409);
    const identity = { workspaceId, sessionId: source.id, requestId: input.requestId }, controller = new AbortController();
    let agent: QuantAgentSession | undefined;
    const cancel = () => { controller.abort(); agent?.abort(); };
    const deadline = setTimeout(cancel, 300_000); deadline.unref?.();
    const operation = (async (): Promise<TerminalRestoreReceipt> => {
      let dependencies: QuantAgentDependencies | undefined, target: Session | undefined;
      let releaseTarget: (() => void) | undefined, targetLock: Promise<void> | undefined;
      let releaseResources: (() => Promise<void>) | undefined, releaseTargetResources: (() => Promise<void>) | undefined;
      let mutationMayHaveOccurred = false;
      try {
        // Register the source operation before resolving or locking its target.
        await Promise.resolve(); controller.signal.throwIfAborted();
        const report = loadArtifactSnapshot(input.reportId);
        if (!report) return { ...identity, revision: source.revision, result: { success: false, message: "Report version is unavailable or damaged. Saved revisions have been retained." } };
        const fixedReportId = artifactReference(report.meta);
        const coreId = report.meta.sourceSessionId ?? report.meta.sessionId;
        releaseResources = await acquireResourceRead(source.cwd, controller.signal);
        dependencies = await terminalEnvironment.dependencies(source.cwd, options.dependencies);
        const resolved = await selectCoreSession(dependencies.sessions, source.cwd, coreId, controller.signal);
        target = resolved.selected;
        if (target.id !== source.id) {
          if (operations.has(target.id) || target.active) throw new WorkbenchError("SESSION_BUSY", "报告的原会话仍在运行或执行命令。", 409);
          targetLock = new Promise<void>(resolve => { releaseTarget = resolve; }); operations.set(target.id, targetLock);
        } else if (target.active) throw new WorkbenchError("SESSION_BUSY", "报告的原会话仍在运行。", 409);
        await target.writes; assertCurrentCheckpoint(target); controller.signal.throwIfAborted();
        if (target.recovery?.acknowledgementRequired) throw new WorkbenchError("RECONCILE_REQUIRED", "请先核对中断运行，再恢复报告。", 409);
        if (target.cwd !== source.cwd) releaseTargetResources = await acquireResourceRead(target.cwd, controller.signal);
        const restoreSettingsKey = terminalModelSettingsKey(settings.read());
        agent = createQuantResearchAgent({ cwd: target.cwd, dependencies: { ...dependencies,
          sessions: restoredSessionRepository(dependencies.sessions, target.cwd, target.coreSessionId) } });
        if ((await agent.getSessionMetadata())?.id !== coreId) throw new WorkbenchError("CONTEXT_MISSING", "原研究上下文不匹配，未恢复报告。", 409);
        controller.signal.throwIfAborted();
        // A legacy unversioned report can be replaced while ownership is being
        // acquired. Never restore its new contents under the old source lock.
        if (JSON.stringify(loadArtifactSnapshot(fixedReportId)) !== JSON.stringify(report))
          throw new WorkbenchError("REPORT_CHANGED", "报告在恢复期间发生变化，请重新选择。", 409);
        const originalLeaf = await agent.getLeafId();
        const before = snapshot(target), previousLeaf = target.coreLeafId;
        const recoveryRunId = target.runId ?? randomUUID(), at = new Date().toISOString();
        // Persist a recovery barrier before moving the journal. If the Host
        // dies or the final checkpoint fails, restart requires explicit review.
        const barrier = { ...before, revision: target.revision + 1, identity: { ...before.identity, runId: recoveryRunId }, state: "interrupted" as const,
          recovery: { runId: recoveryRunId, unconfirmedTools: 0, acknowledgementRequired: true },
          turns: [...before.turns, { id: randomUUID(), role: "assistant" as const, state: "interrupted" as const, at,
            text: "报告恢复未确认；请核对原会话和已保存的报告后再继续。" }] };
        await flush(target, barrier, at);
        Object.assign(target, { revision: barrier.revision, updatedAt: at, runId: recoveryRunId, state: barrier.state,
          recovery: barrier.recovery, turns: barrier.turns });
        publish(target);
        mutationMayHaveOccurred = true;
        controller.signal.throwIfAborted();
        let filePath: string | undefined;
        const result = await restoreArtifactReport(fixedReportId, { cwd: target.cwd, agentSession: agent, openFile: path => { filePath = path; } });
        if (!result.success) {
          const original = await dependencies.sessions.open(resolved.target);
          if (await original.getLeafId() !== originalLeaf) throw new WorkbenchError("CONTEXT_UNCONFIRMED", "报告恢复失败后原会话位置已变化，请核对原文件。", 409);
          const restored = { ...before, revision: target.revision + 1 }, updatedAt = new Date().toISOString();
          target.coreLeafId = previousLeaf;
          await flush(target, restored, updatedAt);
          Object.assign(target, { revision: restored.revision, updatedAt, runId: restored.identity.runId, state: restored.state,
            recovery: restored.recovery, turns: [...restored.turns], output: restored.output });
          publish(target);
          mutationMayHaveOccurred = false;
          return { ...identity, revision: source.revision, result };
        }
        // Resume may move the original journal leaf. Rebuild and persist its view
        // before releasing either owner, even if cancellation arrives meanwhile.
        const projection = await readLegacySession(dependencies.sessions, resolved.target, clean);
        const usage = agent.getContextUsage();
        assertCurrentCheckpoint(target);
        Object.assign(target, { turns: projection.turns, coreLeafId: projection.coreLeafId, runId: projection.runId,
          state: projection.state, recovery: projection.recovery, output: emptyOutput() });
        const saved = { ...snapshot(target), revision: target.revision + 1 }, updatedAt = new Date().toISOString();
        await flush(target, saved, updatedAt);
        target.terminalUsage = usage && target.coreSessionId
          ? { settingsKey: restoreSettingsKey, coreSessionId: target.coreSessionId, leafId: projection.coreLeafId, usage: structuredClone(usage) }
          : undefined;
        Object.assign(target, { revision: saved.revision, updatedAt }); publish(target);
        target.terminalHud?.reset();
        mutationMayHaveOccurred = false;
        controller.signal.throwIfAborted(); assertOpen();
        return { ...identity, revision: source.revision, result, selectedSessionId: target.id, ...(filePath ? { filePath } : {}) };
      } catch (error) {
        if (target && mutationMayHaveOccurred) {
          target.uncertain = true;
          for (const listener of listeners) {
            try { listener({ type: "session-error", identity: { workspaceId, sessionId: target.id, runId: target.runId },
              message: "报告恢复的上下文未能确认，请保留原文件并核对。" }); } catch { listeners.delete(listener); }
          }
        }
        if (controller.signal.aborted) throw new WorkbenchError("COMMAND_CANCELLED", "报告恢复已取消或结果未确认；请核对原会话，不会自动重试。", 409);
        throw error;
      } finally {
        clearTimeout(deadline); await dependencies?.env.cleanup().catch(() => {}); agent = undefined;
        if (target && targetLock && operations.get(target.id) === targetLock) { operations.delete(target.id); releaseTarget?.(); unload(target); }
        try { await releaseTargetResources?.(); } finally { await releaseResources?.(); }
      }
    })();
    const receipt = operation.finally(() => { operations.delete(source.id); unload(source); });
    terminalCommands.set(input.requestId, { identity, fingerprint, cancel, receipt }); operations.set(source.id, receipt);
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
      if (terminalCommands.has(input.requestId)) throw new WorkbenchError("REQUEST_CONFLICT", "请求标识已用于终端命令，未重复执行。", 409);
      const previous = acceptedRequests.get(input.requestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new WorkbenchError("REQUEST_CONFLICT", "请求标识已用于不同输入，未重复执行。", 409);
        return structuredClone(await previous.receipt);
      }
      const source = get(input.sessionId);
      if (operations.has(source.id)) throw new WorkbenchError("SESSION_BUSY", "会话正在保存或复核，请稍后重新读取。", 409);
      if (source.recovery?.acknowledgementRequired) throw new WorkbenchError("RECONCILE_REQUIRED", "上次工具结果待核对，请先确认后再复核。", 409);
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
      if (session.active || operations.has(session.id)) throw new WorkbenchError("SESSION_BUSY", "会话仍在收尾或处理其他操作，请稍后重新读取。", 409);
      if (session.runId !== input.runId) throw new WorkbenchError("RUN_NOT_FOUND", "未找到这次中断运行。", 404);
      if (session.revision !== input.expectedRevision) throw new WorkbenchError("REVISION_CONFLICT", "会话已变化，请重新读取后确认。", 409);
      if (!["interrupted", "cancelled", "failed", "settled", "needs_input"].includes(session.state) || !session.recovery) throw new WorkbenchError("RUN_CHANGED", "这次运行不再处于待确认状态。", 409);
      if (!session.recovery.acknowledgementRequired) return;
      const operation = (async () => {
        await session.writes; assertOpen(); assertCurrentCheckpoint(session);
        const saved = { ...snapshot(session), revision: session.revision + 1, recovery: { ...session.recovery!, acknowledgementRequired: false } };
        const updatedAt = new Date().toISOString();
        await flush(session, saved, updatedAt);
        Object.assign(session, { recovery: saved.recovery, revision: saved.revision, updatedAt });
        publish(session);
      })();
      operations.set(session.id, operation);
      try { await operation; } finally { operations.delete(session.id); unload(session); }
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
      const uncertain = [...run.activity.values()].filter(item => ["running", "failed"].includes(item.state) && hasEffects(item.name)).length;
      run.controller.abort(); session.agent?.abort();
      session.state = "cancelled";
      session.recovery = uncertain ? { runId: run.id, unconfirmedTools: uncertain, acknowledgementRequired: true } : undefined;
      finishActivities(session, run);
      assistant(session, run, [session.turns!.find(turn => turn.id === id + "-assistant")?.text, "当前研究已停止，草稿与已返回内容保留。"].filter(Boolean).join("\n\n"));
      await run.promise;
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return { client, workspaceId,
    // Deliberately separate from WorkbenchClient and its browser RPC dispatcher.
    terminal: {
      async suggestReferences(value: unknown) {
        assertOpen(); const input = terminalReferenceRequest(value);
        if (input.workspaceId !== workspaceId) throw new WorkbenchError("WORKSPACE_MISMATCH", "工作区不匹配。", 409);
        await ready; assertOpen();
        const session = get(input.sessionId), agent = session.agent, active = session.active, coreSessionId = session.coreSessionId;
        const operation = operations.get(session.id), runId = session.runId;
        if (operation && !(active?.command && agent)) throw new WorkbenchError("SESSION_BUSY", "会话操作尚未完成，请稍后读取引用。", 409);
        const dependencies = !agent && coreSessionId ? options.dependencies?.() ?? createDefaultSessionDependencies({ cwd: session.cwd }) : undefined;
        try {
          const items = await referencesFor(session, agent, dependencies?.sessions).suggest(input.input);
          assertOpen();
          if (sessions.get(session.id) !== session || session.agent !== agent || session.active !== active || session.coreSessionId !== coreSessionId
            || session.runId !== runId || operations.get(session.id) !== operation)
            throw new WorkbenchError("CONTEXT_CHANGED", "所选会话已变化，请重新读取引用。", 409);
          return { workspaceId, sessionId: session.id, runId,
            items: items.filter(item => clean(item.fill) === item.fill).map(item => ({ ...item, label: clean(item.label) })) };
        } finally { await dependencies?.env.cleanup().catch(() => {}); unload(session); }
      },
      async context(value: unknown) {
        assertOpen(); const input = terminalContextRequest(value);
        if (input.workspaceId !== workspaceId) throw new WorkbenchError("WORKSPACE_MISMATCH", "工作区不匹配。", 409);
        await ready; assertOpen();
        let session = get(input.sessionId);
        if (session.state !== "running" && session.active) { await session.active.promise; assertOpen(); session = get(input.sessionId); }
        const current = snapshot(session), coreSessionId = session.coreSessionId;
        const agent = session.agent, active = session.active, operation = operations.get(session.id);
        // A skill command owns a normal research run. Its operation lock still
        // excludes mutations, but must not hide the live terminal presentation.
        if (operation && !(active?.command && agent)) throw new WorkbenchError("SESSION_BUSY", "会话操作尚未完成，请稍后读取上下文。", 409);
        const dependencies = !agent && coreSessionId ? options.dependencies?.() ?? createDefaultSessionDependencies({ cwd: session.cwd }) : undefined;
        try {
          const result = await readTerminalContext({ session: current, coreSessionId, agent, repository: dependencies?.sessions, cwd: session.cwd,
            composerQueue: active && !active.controller.signal.aborted ? active.composerQueue : [],
            latency: session.terminalHud?.snapshot(terminalModelSettingsKey(settings.read())),
            cachedUsage: !active && session.terminalUsage?.settingsKey === terminalModelSettingsKey(settings.read()) ? session.terminalUsage : undefined,
            clean: text => clean(active ? redact(active, text) : text) });
          assertOpen();
          if (sessions.get(session.id) !== session || operations.get(session.id) !== operation || session.active !== active || session.revision !== current.revision || session.coreSessionId !== coreSessionId || session.agent !== agent)
            throw new WorkbenchError("CONTEXT_CHANGED", "终端上下文已变化，请重新读取。", 409);
          return result;
        } finally { await dependencies?.env.cleanup().catch(() => {}); unload(session); }
      },
      command, enqueue, restoreReport,
      async cancelCommand(value: unknown) {
        const identity = terminalCommandIdentity(value), pending = terminalCommands.get(identity.requestId);
        if (identity.workspaceId !== workspaceId || !pending || pending.identity.sessionId !== identity.sessionId)
          throw new WorkbenchError("COMMAND_NOT_FOUND", "未找到这次终端命令；未取消其他操作。", 404);
        pending.cancel(); await pending.receipt.catch(() => {});
      },
      submit: (value: unknown) => accept("submit", value, true),
      submitResearch: async (value: unknown) => {
        const input = terminalResearchRequest(value);
        return accept("submit", { workspaceId: input.workspaceId, sessionId: input.sessionId, requestId: input.requestId,
          expectedRevision: input.expectedRevision, text: input.task.request }, true, { task: input.task, expectedTaskRevision: input.expectedTaskRevision });
      },
      followup: (value: unknown) => accept("followup", value, true),
      continue: (value: unknown) => accept("continue", value, true),
    },
    close() {
      if (closing) return closing;
      closed = true;
      market.close();
      for (const command of terminalCommands.values()) command.cancel();
      const pending = [...sessions.values()].flatMap(session => session.active
        ? [client.cancel({ workspaceId, sessionId: session.id, runId: session.active.id })] : []);
      return closing = (async () => {
        await Promise.allSettled([...operations.values(), ...pending]);
        await Promise.allSettled([...terminalQueues.values()].map(item => item.receipt));
        await Promise.allSettled([...sessions.values()].map(async session => { clearTimeout(session.timer); await session.writes; }));
        await terminalEnvironment.close();
        listeners.clear(); acceptedRequests.clear(); terminalCommands.clear(); terminalQueues.clear(); legacyImports.clear();
      })();
    },
  };
}
