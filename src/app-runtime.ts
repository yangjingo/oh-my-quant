import { reviewTerminalAnswer } from "./app/services/terminal-answer-review.ts";
import { buildCommandHelpText } from "./cli/catalog.ts";
import { executeCommand, parseCommand } from "./cli/registry.ts";
import { commandPreflight } from "./runtime/workspace/command-preflight.ts";
import { isInstalledToolProbeSchemaQuery } from "./runtime/data/tool-probe-schema.ts";
import { generateCurrentSessionArtifact, openLocalFile, restoreArtifactReport } from "./runtime/research/artifact-reports.ts";
import { dispatchUserMessage, isAgentTurnActive } from "./agent/src/dispatch.ts";
import { isQuantAnalysisRequest } from "./agent/src/context.ts";
import type { QuantAgentSession } from "./agent/src/session.ts";
import { createQuantResearchAgent, QuantResearchHarness } from "./runtime/quant-harness.ts";
import type { ResearchTaskSnapshot, ResearchTaskSpec } from "./types/research-task.ts";
import type { QuantAgentEvent, QuantAgentDependencies } from "./agent/src/session-contracts.ts";
import { createDefaultSessionDependencies } from "./runtime/session-dependencies.ts";
import { RuntimeExtensions } from "./runtime/extensions.ts";
import { extensionSessionDependencies } from "./runtime/extension-session.ts";
import { loadRuntimeSkillSuggestions, toSkillEntries } from "./runtime/skills/skill-suggestions.ts";
import { resolveConfiguredModel } from "./agent/src/model-config.ts";
import type { OhQuantSettings } from "./types/config.ts";
import { DEFAULT_TERMINAL_OPERATION_KEYBINDINGS } from "./types/config.ts";
import { skillPaths } from "./runtime/skills/skill-store.ts";
import { ensureDirs, loadSettings, loadPanelPortfolio } from "./storage/index.ts";
import type { AppState, CurrentSessionMeta, PanelSection, UIMessage } from "./types/ui.ts";
import { fetchOverviewHoldings, fetchOverviewQuotes } from "./runtime/workspace/overview-data.ts";
import type { OverviewHoldingFetcher, OverviewQuoteFetcher } from "./runtime/workspace/overview-data.ts";
import { OverviewRefresh } from "./runtime/workspace/overview-refresh.ts";
import { researchSelectionKey, singlePortfolioToolDenial, withSinglePortfolioResearch } from "./runtime/research/active-portfolio.ts";
import type { OverviewRefreshMeasurement, OverviewRefreshOptions } from "./runtime/workspace/overview-refresh.ts";
import { agentStatusText, errorText, formatAgentError, formatSlashRuntimeError } from "./runtime/errors.ts";
import {
  applyCommandResult as applyRuntimeCommandResult,
  compactingStatusText,
  getRuntimeCommandInvocation,
  type CommandResultRuntimeContext,
} from "./runtime/workspace/commands.ts";
import {
  buildLocalStorageState,
} from "./runtime/workspace/panel-service.ts";
import {
  finalizeSkillMessage as reduceFinalizeSkillMessage,
  handleAgentEvent,
  pushLocalCommandMessage as reducePushLocalCommandMessage,
  syncMessagesFromAgentState as reduceSyncMessagesFromAgentState,
} from "./runtime/workspace/agent-events.ts";
import { extractAssistantText } from "./runtime/workspace/messages.ts";
import { perfLog, perfNow } from "./perf.ts";
import { ComposerReferences } from "./runtime/workspace/composer-references.ts";
import { researchTaskLines } from "./runtime/workspace/research-task-view.ts";
import type { HostConnection } from "./app/bootstrap.ts";
import { openTerminalSession } from "./app/host/terminal-session.ts";
import type { RunRevisionRequest, SessionSnapshot } from "./types/workbench.ts";
import type { DoctorResult } from "./types/doctor.ts";
import type { CommandResult } from "./types/commands.ts";
import type { PrivateAnnualExportRequest } from "./types/private-annual-export.ts";
import { runPrivateAnnualFileCommand } from "./cli/private-annual-file.ts";
import {
  assistantEventHasVisibleOutput,
  computeTpotMs,
  countConversationTurns,
  createHudMetrics,
  createLatencyTracker,
  extractAssistantOutputTokens,
} from "./runtime/workspace/hud.ts";

export interface AppRuntimeSnapshot {
  model: string;
  modelLabel: string;
}

interface AppRuntimeCallbacks {
  onMessages: (messages: UIMessage[]) => void;
  onActivity: (activity: AppState["activity"]) => void;
  onLocalState?: (state: Pick<AppState, "activePortfolio" | "source" | "showPortfolioPanel">) => void;
  onComposerStatus?: (status: AppState["composerStatus"]) => void;
  onComposerQueue?: (queue: string[]) => void;
  onRecoverySnapshot?: (snapshot: SessionSnapshot) => void;
  onConfigRequest?: () => void;
  onDoctorRequest?: (doctor?: unknown) => void;
  onResumeRequest?: (meta?: CurrentSessionMeta) => void;
  onResearchRequest?: (snapshot: ResearchTaskSnapshot) => void;
  onPortfolioRequest?: () => void;
  onArtifactRequest?: () => void;
  onArtifactCwd?: (cwd: string | null) => void;
  onHelpRequest?: () => void;
  onSessionRequest?: (meta?: CurrentSessionMeta) => void;
  onPanel?: (panel: PanelSection[], loading?: boolean) => void;
  onHud?: (hud: AppState["hud"]) => void;
  onMarketRefresh?: (measurement: OverviewRefreshMeasurement) => void | Promise<void>;
  onModel?: (model: AppRuntimeSnapshot) => void;
  onSkillsChanged?: () => void;
}

type QuoteFetcher = OverviewQuoteFetcher;
type HoldingFetcher = OverviewHoldingFetcher;
type AgentFactory = () => QuantAgentSession;
type AutoArtifactRunner = (agent: QuantAgentSession) => Promise<{ success: boolean; message: string }>;
type ArtifactRestoreRunner = (reportId: string, agent: QuantAgentSession) => Promise<CommandResult>;

export function createRuntimeAgent(dependencies?: QuantAgentDependencies): QuantAgentSession {
  return createQuantResearchAgent({ skillPaths, dependencies: withSinglePortfolioResearch(dependencies ?? createDefaultSessionDependencies({ skillPaths })) });
}

async function runAutoArtifact(agent: QuantAgentSession): Promise<{ success: boolean; message: string }> {
  return generateCurrentSessionArtifact({ agentSession: agent });
}

async function runArtifactRestore(reportId: string, agent: QuantAgentSession): Promise<CommandResult> {
  return restoreArtifactReport(reportId, { agentSession: agent });
}

export class AppRuntime {
  private readonly agentFactory?: AgentFactory;
  private readonly sharedConnection?: HostConnection;
  private terminal?: Awaited<ReturnType<typeof openTerminalSession>>;
  private terminalDetach?: Promise<void>;
  private terminalPoll?: ReturnType<typeof setTimeout>;
  private terminalReading?: Promise<void>;
  private terminalRefreshPending = false;
  private terminalSessionMeta?: { sessionId: string; meta: CurrentSessionMeta | null };
  private terminalArtifactSession?: string;
  private terminalDisplayedModel?: AppRuntimeSnapshot;
  private terminalHudResetPending = false;
  private terminalCommandMessages: UIMessage[] = [];
  private terminalCommandScope?: { sessionId: string; runId: string | null };
  private agent: QuantAgentSession | null = null;
  private unsubscribeAgent: (() => void) | null = null;
  /** Slash command in flight (panel refresh). Agent concurrency uses agent.state.isStreaming. */
  private slashRunning = false;
  private messages: UIMessage[] = [];
  private readonly overview: OverviewRefresh;
  private disposed = false;
  private readonly lifetime = new AbortController();
  private readonly localOperations = new Set<Promise<void>>();
  private currentDoctor: DoctorResult | null = null;
  private doctorRun: AbortController | null = null;
  private hud = createHudMetrics();
  private latencyTracker = createLatencyTracker();
  private ttftTotalMs = 0;
  private ttftSamples = 0;
  private tpotTotalMs = 0;
  private tpotSamples = 0;
  private turnTtftRecorded = false;
  private latencyScope: string | null = null;
  private modelConnectionSettings = "";
  private configuredModel: AppRuntimeSnapshot | null = null;
  private configuredProvider: string | undefined;
  private modelConnectionPending = false;
  private pendingAutoArtifactInput: string | null = null;
  private latestCompletedAssistantText: string | null = null;
  private autoArtifactRunning = false;
  private activePrompts = 0;
  private researchPortfolioKey: string | null = null;
  private interruption: Promise<boolean> | null = null;
  private interruptionVersion = 0;
  private researchInterrupted = false;
  private readonly promptControllers = new Set<AbortController>();
  private failedQuotesRetryKey: string | undefined = DEFAULT_TERMINAL_OPERATION_KEYBINDINGS.retryFailedQuotes[0];
  private extensions: RuntimeExtensions | undefined;
  private baseDependencies: QuantAgentDependencies | undefined;
  private extensionShutdown: Promise<void> | undefined;
  private bootstrapTask: Promise<AppRuntimeSnapshot> | undefined;
  private readonly references = new ComposerReferences(process.cwd(), { current: async () => {
    if (!this.agent?.getSessionMetadata || !this.agent?.getSessionBranch) return null;
    const metadata = await this.agent.getSessionMetadata();
    if (!metadata) return null;
    const entries = await this.agent.getSessionBranch();
    if ((await this.agent.getSessionMetadata())?.id !== metadata.id) throw new Error("会话已切换，请重新选择引用。");
    return { id: metadata.id, path: metadata.path, entries };
  } });

  async getReferenceSuggestions(input: string) {
    if (this.sharedConnection) {
      if (this.disposed) return [];
      if (!this.terminal) await this.bootstrap();
      return this.disposed ? [] : this.terminal!.references(input);
    }
    return this.references.suggest(input);
  }

  constructor(
    private readonly callbacks: AppRuntimeCallbacks,
    quoteFetcher: QuoteFetcher = fetchOverviewQuotes,
    holdingFetcher: HoldingFetcher = fetchOverviewHoldings,
    execution?: AgentFactory | { host: HostConnection },
    private readonly autoArtifactRunner: AutoArtifactRunner = runAutoArtifact,
    private readonly artifactRestoreRunner: ArtifactRestoreRunner = runArtifactRestore,
    marketRefreshTimeoutMs = 120_000,
    marketRefreshIntervalMs = 60_000,
    overviewOptions: Pick<OverviewRefreshOptions, "poolFactory"> = {},
    extensions?: RuntimeExtensions,
    private readonly openArtifactFile: (path: string) => void = openLocalFile,
  ) {
    if (typeof execution === "function") this.agentFactory = execution;
    else this.sharedConnection = execution?.host;
    this.extensions = extensions;
    this.overview = new OverviewRefresh({ ...overviewOptions, quoteFetcher, holdingFetcher,
      retryKey: () => this.failedQuotesRetryKey,
      onPanel: callbacks.onPanel, onMeasurement: callbacks.onMarketRefresh,
      timeoutMs: marketRefreshTimeoutMs, intervalMs: marketRefreshIntervalMs });
  }

  async refreshOverviewPanel(): Promise<void> {
    if (this.activePrompts > 0 && this.researchPortfolioKey !== researchSelectionKey()) await this.interruptResearch();
    this.emitLocalStorageState();
    await this.overview.refresh();
  }
  retryFailedOverviewQuotes(): Promise<void> { return this.overview.retryFailed(); }

  /** Stop the current operation, retaining the session and its research evidence. */
  interruptResearch(): Promise<boolean> {
    if (this.sharedConnection) {
      if (this.disposed || !this.terminal) return Promise.resolve(false);
      return this.terminal.interrupt().catch(error => {
        if (!this.disposed) this.setStatus({ kind: "error", text: errorText(error) }); return false;
      });
    }
    if (this.interruption) return this.interruption;
    const agent = this.agent;
    if (this.disposed || !agent || !this.activePrompts && !isAgentTurnActive(agent)) return Promise.resolve(false);
    this.interruptionVersion++;
    this.researchInterrupted = true;
    for (const controller of this.promptControllers) controller.abort(new Error("Research interrupted"));
    this.pendingAutoArtifactInput = null;
    this.latestCompletedAssistantText = null;
    this.emitComposerQueue([]);
    this.setStatus({ kind: "info", text: "正在停止当前请求，保留已保存的研究记录…" });
    this.interruption = Promise.resolve().then(async () => {
      try {
        agent.abort();
        await agent.waitForIdle();
        if (!this.disposed) {
          this.setActivity("ready");
          this.setStatus({ kind: "info", text: "请求已停止 · 已保存的研究记录保留；输入“继续”恢复未完成工作。" });
        }
        return true;
      } catch (error) {
        if (!this.disposed) this.setStatus({ kind: "error", text: `停止请求失败 · ${errorText(error)}` });
        return false;
      } finally { this.interruption = null; }
    });
    return this.interruption;
  }

  async getSkillSuggestions() {
    if (this.disposed) return [];
    if (this.sharedConnection) {
      if (!this.terminal) await this.bootstrap();
      return this.disposed ? [] : this.terminal!.skills();
    }
    return this.agent ? toSkillEntries(await this.agent.getSkills()) : loadRuntimeSkillSuggestions();
  }

  /** Structured research entry for hosts; shares the normal UI/event/command runtime. */
  async submitResearch(task: ResearchTaskSpec, expectedRevision: string | null = null, signal?: AbortSignal): Promise<void> {
    if (this.sharedConnection) {
      if (this.slashRunning) throw new Error("Research requires a ready, idle session.");
      if (!this.terminal) await this.bootstrap();
      if (this.disposed || !this.terminal) throw new Error("Terminal view is detached.");
      if (this.slashRunning) throw new Error("Research requires a ready, idle session.");
      const accepted = await this.terminal.submitResearch(structuredClone(task), expectedRevision, signal);
      if (this.disposed) return;
      const finished = await this.terminal.waitResearch({ workspaceId: this.sharedConnection.workspaceId, ...accepted }, signal);
      if (!this.disposed && ["failed", "interrupted"].includes(finished.state))
        throw new Error(finished.turns.at(-1)?.text || "Research task did not finish; inspect the session.");
      return;
    }
    if (!this.agent || this.slashRunning || isAgentTurnActive(this.agent)) throw new Error("Research requires a ready, idle session.");
    const snapshot = structuredClone(task);
    const denied = singlePortfolioToolDenial("research_task", { action: "declare", task: snapshot });
    if (denied) throw new Error(denied);
    await new QuantResearchHarness(this.agent).update({ version: 1, type: "declare", expectedRevision, task: snapshot }, signal);
    signal?.throwIfAborted();
    const abort = () => this.agent?.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try { await this.runAgentPrompt(snapshot.request, signal); }
    finally { signal?.removeEventListener("abort", abort); }
  }

  /** Startup agent, then enter ready before blocking on market quotes. */
  bootstrap(): Promise<AppRuntimeSnapshot> {
    this.bootstrapTask ??= this.startRuntime().catch(error => { this.bootstrapTask = undefined; throw error; });
    return this.bootstrapTask;
  }

  private async startRuntime(): Promise<AppRuntimeSnapshot> {
    this.lifetime.signal.throwIfAborted();
    const startedAt = perfNow();
    ensureDirs();
    const settings = loadSettings();
    this.failedQuotesRetryKey = (settings.keybindings?.retryFailedQuotes ?? DEFAULT_TERMINAL_OPERATION_KEYBINDINGS.retryFailedQuotes)[0];
    this.rememberModelConnection(settings);
    this.configuredModel = { model: readModel(settings), modelLabel: readModelLabel(settings) };
    this.configuredProvider = settings.provider;

    this.setActivity("starting");

    if (this.sharedConnection) {
      const view = await openTerminalSession(this.sharedConnection, {
        onSnapshot: snapshot => this.observeTerminal(snapshot),
        onConnection: (connected, message) => {
          if (!this.disposed && !connected) this.setStatus({ kind: "error", text: message ?? "Host connection lost; reconnect before submitting again." });
        },
      });
      this.terminal = view;
      if (this.disposed) { await view.detach(); throw new Error("Terminal view closed during startup."); }
      await this.refreshTerminalContext();
      this.observeTerminal(view.snapshot!);
      this.scheduleMarketRefresh();
      return this.terminalDisplayedModel ?? this.configuredModel;
    }

    const agentStartedAt = perfNow();
    if (this.agentFactory) this.agent = this.agentFactory();
    else {
      this.extensions ??= new RuntimeExtensions();
      this.baseDependencies = createDefaultSessionDependencies({ skillPaths });
      await this.extensions.host.reserve({ skills: (await this.baseDependencies.loadSkills()).map(skill => skill.name),
        capabilities: Object.keys(this.baseDependencies.readSkillCapabilities?.() ?? {}) });
      await this.extensions.start();
      const dependencies = await extensionSessionDependencies(this.baseDependencies, this.extensions.host);
      this.lifetime.signal.throwIfAborted();
      this.agent = createRuntimeAgent(dependencies);
      const failures = this.extensions.startupErrors;
      if (failures.length) this.pushLocalCommandMessage(`Extensions could not start:\n${failures.join("\n")}\nInspect /config --extensions list.`, "error");
    }
    perfLog("runtime.agent.create", agentStartedAt);
    this.unsubscribeAgent = this.agent.subscribe(async (event) => {
      if (this.disposed) return;
      this.trackHudFromAgentEvent(event);
      handleAgentEvent(event, {
        messages: this.messages,
        thinkingText: this.agent?.state.thinkingText ?? "",
        setMessages: (messages) => { this.messages = messages; },
        emitMessages: () => this.emitMessages(),
        setActivity: (activity) => this.setActivity(activity),
        setStatus: (status) => this.setStatus(status),
        emitComposerQueue: (queue) => this.emitComposerQueue(queue),
        scheduleMarketRefresh: () => this.scheduleMarketRefresh(),
      });
      this.refreshHudFromAgentState();
      if (event.type === "message_start" && ["assistant", "user", "displayUser"].includes(event.message.role))
        this.latestCompletedAssistantText = null;
      if (event.type === "message_end" && event.message.role === "assistant")
        this.latestCompletedAssistantText = event.message.stopReason === "stop"
          && !event.message.content.some(part => part.type === "toolCall") ? extractAssistantText(event.message) : null;
      if (event.type === "agent_end") {
        if (this.researchInterrupted) return;
        const answer = this.latestCompletedAssistantText;
        this.latestCompletedAssistantText = null;
        if (answer) {
          const review = await reviewTerminalAnswer(answer, this.agent);
          if (review) {
            this.pushLocalCommandMessage(review.message, "error");
            this.setStatus({ kind: "error", text: review.status });
            this.pendingAutoArtifactInput = null;
            return;
          }
        }
        await this.maybeAutoGenerateArtifact();
      }
    });

    void this.agent.waitForIdle()
      .then(() => perfLog("runtime.agent.warmup", agentStartedAt))
      .catch(() => {});

    this.setActivity("ready");
    this.refreshHudFromAgentState();
    this.scheduleMarketRefresh();
    perfLog("runtime.bootstrap", startedAt);

    return {
      model: readModel(settings),
      modelLabel: readModelLabel(settings),
    };
  }

  async submit(input: string): Promise<"continue" | "exit"> {
    const trimmed = input.trim();
    if (!trimmed) return "continue";

    if (trimmed === "/exit" || trimmed === "/quit") return "exit";

    const parsed = parseCommand(trimmed);
    const early = parsed && commandPreflight(parsed);
    if (early) {
      applyRuntimeCommandResult(early, this.commandResultContext());
      return "continue";
    }
    if (this.sharedConnection) return this.submitTerminal(trimmed, parsed);
    const localOnly = parsed ? getRuntimeCommandInvocation(parsed).localOnly : false;

    if (parsed) {
      if (!localOnly && parsed.command === "config" && parsed.flags.extensions !== undefined && (this.activePrompts > 0 || this.localOperations.size > 0)) {
        this.setStatus({ kind: "error", text: "Wait for the current operation to finish before changing extensions." });
        return "continue";
      }
      if (!localOnly && (this.slashRunning || isAgentTurnActive(this.agent))) {
        if (parsed.command === "config" && parsed.flags.extensions !== undefined) this.setStatus({ kind: "error", text: "Wait for the current operation to finish before changing extensions." });
        return "continue";
      }
      if (!localOnly) this.slashRunning = true;
      const operation = this.runSlashCommand(parsed, localOnly);
      this.localOperations.add(operation);
      try { await operation; } finally { this.localOperations.delete(operation); }
      return "continue";
    }

    if (this.slashRunning) return "continue";
    await this.runAgentPrompt(trimmed);
    return "continue";
  }

  dispose(): void {
    this.disposed = true;
    this.lifetime.abort();
    this.cancelDoctor();
    this.overview.dispose();
    clearTimeout(this.terminalPoll);
    this.terminalDetach ??= this.terminal?.detach();
    this.unsubscribeAgent?.();
    this.unsubscribeAgent = null;
    this.agent?.abort();
    this.extensionShutdown ??= this.extensions?.dispose();
  }

  async shutdown(): Promise<void> {
    this.dispose();
    if (this.sharedConnection) {
      // Host-owned commands/research can outlive this view. Only local panel
      // operations and connection establishment belong to terminal shutdown.
      await Promise.allSettled([this.bootstrapTask, this.terminalDetach, ...this.localOperations]);
      return;
    }
    await Promise.allSettled([this.bootstrapTask, this.extensionShutdown, ...this.localOperations]);
    await Promise.allSettled([this.agent?.waitForIdle()]);
  }

  cancelDoctor(): void {
    this.doctorRun?.abort();
    this.doctorRun = null;
  }

  refreshConfiguration(): void {
    const settings = loadSettings();
    this.configuredModel = { model: readModel(settings), modelLabel: readModelLabel(settings) };
    this.configuredProvider = settings.provider;
    if (this.rememberModelConnection(settings)) {
      this.modelConnectionPending = true;
      if (this.sharedConnection) this.terminalHudResetPending = true;
    }
    const active = this.sharedConnection ? this.terminal?.snapshot?.state === "running" : isAgentTurnActive(this.agent);
    if (!active) {
      // Saved connections can change credentials/endpoint without changing the model ID.
      // Do not display previous connection measurements beside the new selection.
      if (this.modelConnectionPending) {
        this.hud.contextUsage = null;
        this.resetHudLatency();
        this.terminalHudResetPending = false;
      }
      if (this.sharedConnection) this.emitTerminalModel(this.configuredModel);
      else this.callbacks.onModel?.(this.configuredModel);
    }
    this.emitLocalStorageState();
    this.callbacks.onSkillsChanged?.();
    if (!this.agent && !this.sharedConnection) void this.bootstrap().then(snapshot => this.callbacks.onModel?.(snapshot)).catch(error => this.setStatus({ kind: "error", text: errorText(error) }));
  }

  /** Handle a report selected in the Artifact panel without routing through slash parsing. */
  async restoreArtifact(reportId: string): Promise<void> {
    if (this.sharedConnection) {
      try {
        if (!this.terminal) await this.bootstrap();
        if (this.disposed || !this.terminal) return;
        this.setStatus({ kind: "info", text: "Restoring artifact session..." });
        const receipt = await this.terminal.restoreReport(reportId);
        if (this.disposed || !receipt) return;
        if (receipt.result.success && receipt.filePath) this.openArtifactFile(receipt.filePath);
        await this.refreshTerminalContext();
        if (this.disposed || receipt.selectedSessionId && this.terminal.snapshot?.identity.sessionId !== receipt.selectedSessionId) return;
        applyRuntimeCommandResult(receipt.result, this.commandResultContext());
      } catch (error) {
        if (!this.disposed) this.setStatus({ kind: "error", text: `Artifact restore failed · ${errorText(error)}` });
      }
      return;
    }
    if (!this.agent || this.slashRunning || isAgentTurnActive(this.agent)) return;
    this.slashRunning = true;
    this.setStatus({ kind: "info", text: "Restoring artifact session..." });
    try {
      const result = await this.artifactRestoreRunner(reportId, this.agent);
      if (result.success) this.resetHudLatency();
      applyRuntimeCommandResult(result, this.commandResultContext());
      this.refreshHudFromAgentState();
    } catch (error) {
      this.setStatus({ kind: "error", text: `Artifact restore failed · ${errorText(error)}` });
    } finally {
      this.slashRunning = false;
      this.scheduleMarketRefresh();
      if (!isAgentTurnActive(this.agent)) this.setActivity("ready");
    }
  }

  private async collectCurrentSessionMeta(): Promise<CurrentSessionMeta | undefined> {
    if (this.sharedConnection) return this.terminalSessionMeta?.sessionId === this.terminal?.snapshot?.identity.sessionId
      ? structuredClone(this.terminalSessionMeta?.meta ?? undefined) : undefined;
    if (!this.agent) return undefined;
    if (
      typeof this.agent.getSessionMetadata !== "function"
      || typeof this.agent.getSessionEntries !== "function"
    ) {
      return undefined;
    }
    const [metadata, usage, entries] = await Promise.all([
      this.agent.getSessionMetadata(),
      Promise.resolve(this.agent.getContextUsage()),
      this.agent.getSessionEntries(),
    ]);
    if (!metadata) return undefined;
    return {
      id: metadata.id,
      createdAt: metadata.createdAt,
      usage: usage ?? null,
      entryCount: {
        messages: entries.filter(e => e.type === "message").length,
        compactions: entries.filter(e => e.type === "compaction").length,
        branches: entries.filter(e => e.type === "branch_summary").length,
      },
    };
  }

  private async runSlashCommand(
    parsed: NonNullable<ReturnType<typeof parseCommand>>,
    localOnly: boolean,
  ): Promise<void> {
    const invocation = getRuntimeCommandInvocation(parsed);
    let doctorRun: AbortController | null = null;
    if (parsed.command === "doctor" && !isInstalledToolProbeSchemaQuery(parsed)) {
      this.cancelDoctor();
      doctorRun = new AbortController();
      this.doctorRun = doctorRun;
    }
    const cancelled = () => this.disposed || Boolean(doctorRun && (doctorRun.signal.aborted || this.doctorRun !== doctorRun));
    if (invocation.isSkillInvoke) {
      this.prepareHudForRequest();
      this.messages.push({
        role: "skill",
        skill: { name: invocation.skillName, label: `SKILL.${invocation.skillName}`, status: "running", startedAt: Date.now() },
      });
      this.emitMessages();
      this.setActivity("running tool");
    }
    if (invocation.isCompactCommand) {
      this.setActivity("compacting");
      this.setStatus({
        kind: "info",
        text: compactingStatusText(isAgentTurnActive(this.agent)),
      });
    }

    try {
      const result = await executeCommand(parsed, {
        openConfig: this.callbacks.onConfigRequest
          ? () => { this.callbacks.onConfigRequest!(); }
          : undefined,
        openDoctor: this.callbacks.onDoctorRequest
          ? (doctor) => {
            if (cancelled()) return;
            this.currentDoctor = isDoctorResult(doctor) ? doctor : null;
            this.callbacks.onDoctorRequest?.(doctor);
          }
          : undefined,
        currentDoctor: this.currentDoctor,
        doctorSignal: doctorRun?.signal,
        commandSignal: this.lifetime.signal,
        manageExtensions: async (action, id, signal) => {
          if (!this.extensions) return { success: false, message: "Extension management is available after the default runtime has started." };
          if (action !== "list") await this.agent?.waitForIdle();
          if ((action === "enable" || action === "reload") && this.baseDependencies) {
            await this.extensions.host.reserve({ skills: (await this.baseDependencies.loadSkills()).map(skill => skill.name),
              capabilities: Object.keys(this.baseDependencies.readSkillCapabilities?.() ?? {}) });
          }
          const result = await this.extensions.manage(action, id, signal);
          if (result.success && action !== "list") {
            try { await this.agent?.getSkills(); }
            catch (error) { return { success: false, message: `Extension state changed, but session resources could not refresh: ${errorText(error)}. Review /config --extensions list and disable the conflicting extension or correct the skill before retrying.` }; }
            this.callbacks.onSkillsChanged?.();
          }
          return result;
        },
        openResume: this.callbacks.onResumeRequest
          ? () => { void this.collectCurrentSessionMeta().then(meta => this.callbacks.onResumeRequest?.(meta)); }
          : undefined,
        openResearch: this.callbacks.onResearchRequest ? snapshot => { if (!cancelled()) this.callbacks.onResearchRequest?.(snapshot); } : undefined,
        openPortfolio: this.callbacks.onPortfolioRequest
          ? () => { this.callbacks.onPortfolioRequest!(); }
          : undefined,
        openHelp: this.callbacks.onHelpRequest
          ? () => { this.callbacks.onHelpRequest!(); }
          : undefined,
        openArtifact: this.callbacks.onArtifactRequest
          ? () => { this.callbacks.onArtifactRequest!(); }
          : undefined,
        openSession: (this.callbacks.onSessionRequest || this.callbacks.onResumeRequest)
          ? () => { void this.collectCurrentSessionMeta().then(meta => (this.callbacks.onSessionRequest ?? this.callbacks.onResumeRequest)?.(meta)); }
          : undefined,
        agentSession: this.agent,
      });
      if (cancelled()) return;
      applyRuntimeCommandResult(result, this.commandResultContext());
      if (parsed.command === "skill" && ["install", "remove", "reload"].includes(parsed.positional[0] ?? "")) this.callbacks.onSkillsChanged?.();
      this.refreshHudFromAgentState();
      if (invocation.isSkillInvoke) this.finalizeSkillMessage(!result.success);
      if (result.success) updateLastSymbol(this.agent, parsed.flags);
    } catch (err) {
      if (cancelled()) return;
      if (invocation.isSkillInvoke) this.finalizeSkillMessage(true);
      this.setStatus({ kind: "error", text: formatSlashRuntimeError(parsed.command, err) });
    } finally {
      if (!localOnly && !(parsed.command === "config" && parsed.flags.extensions !== undefined)) this.scheduleMarketRefresh();
      if (!localOnly) this.slashRunning = false;
      const active = this.sharedConnection ? this.terminal?.snapshot?.state === "running" : isAgentTurnActive(this.agent);
      if (!isInstalledToolProbeSchemaQuery(parsed) && !cancelled() && !active) this.setActivity("ready");
      if (doctorRun && this.doctorRun === doctorRun) this.doctorRun = null;
    }
  }

  private observeTerminal(snapshot: SessionSnapshot): void {
    if (!this.disposed) this.callbacks.onRecoverySnapshot?.(snapshot);
    if (snapshot.state === "running" && (this.terminalCommandScope?.sessionId !== snapshot.identity.sessionId || this.terminalCommandScope?.runId !== snapshot.identity.runId)) {
      this.emitTerminalModel({ model: "", modelLabel: "Starting…" });
    }
    if (this.terminalArtifactSession !== snapshot.identity.sessionId) {
      this.terminalArtifactSession = snapshot.identity.sessionId;
      this.callbacks.onArtifactCwd?.(null);
    }
    if (this.terminalCommandScope?.sessionId !== snapshot.identity.sessionId || this.terminalCommandScope?.runId !== snapshot.identity.runId) {
      this.terminalCommandMessages = [];
      this.emitComposerQueue([]);
    }
    this.terminalCommandScope = snapshot.identity;
    if (this.disposed) return;
    const phase = snapshot.turns.at(-1)?.phase;
    this.setActivity(snapshot.state === "running" ? phase === "tool" ? "running tool" : "thinking" : "ready");
    this.terminalRefreshPending = true;
    clearTimeout(this.terminalPoll);
    this.terminalPoll = setTimeout(() => { void this.refreshTerminalContext(); }, 0);
  }

  private refreshTerminalContext(): Promise<void> {
    if (this.disposed || !this.terminal) return Promise.resolve();
    if (this.terminalReading) return this.terminalReading.then(() => this.refreshTerminalContext());
    const reading = this.readTerminalContext().finally(() => {
      if (this.terminalReading === reading) this.terminalReading = undefined;
    });
    return this.terminalReading = reading;
  }

  private async readTerminalContext(): Promise<void> {
    this.terminalRefreshPending = false;
    try {
      const context = await this.terminal!.context();
      if (!context || this.disposed) return;
      if (context.session.state === "running") {
        this.emitTerminalModel(context.activeModel ? { model: context.activeModel.id, modelLabel: context.activeModel.label } : { model: "", modelLabel: "Starting…" });
      } else {
        const settings = loadSettings();
        if (this.rememberModelConnection(settings)) {
          this.configuredModel = { model: readModel(settings), modelLabel: readModelLabel(settings) };
          this.configuredProvider = settings.provider; this.modelConnectionPending = true; this.terminalHudResetPending = true;
        }
        if (this.terminalHudResetPending) { this.resetHudLatency(); this.terminalHudResetPending = false; }
        if (this.configuredModel) this.emitTerminalModel(this.configuredModel);
      }
      this.callbacks.onArtifactCwd?.(context.cwd);
      this.terminalSessionMeta = { sessionId: context.session.identity.sessionId, meta: context.currentSession };
      this.callbacks.onSessionRequest?.(context.currentSession ?? undefined);
      this.messages = [...context.messages];
      if (context.thinkingText && context.session.state === "running") this.messages.push({ role: "thinking", text: context.thinkingText, thinkingLive: true });
      this.messages.push(...this.terminalCommandMessages);
      this.emitMessages();
      this.emitComposerQueue(context.composerQueue);
      this.hud.contextUsage = context.contextUsage;
      this.hud.ttftMs = context.latency.ttftMs;
      this.hud.tpotMs = context.latency.tpotMs;
      this.hud.turnCount = context.turnCount;
      this.emitHud();
      if (["failed", "cancelled", "needs_input", "interrupted"].includes(context.session.state)) {
        const text = context.session.turns.at(-1)?.text;
        if (text) this.setStatus({ kind: context.session.state === "failed" ? "error" : "info", text });
      }
    } catch (error) {
      if (["CONTEXT_CHANGED", "SESSION_BUSY"].includes(String((error as { code?: string })?.code))) this.terminalRefreshPending = true;
      else if (!this.disposed) this.setStatus({ kind: "error", text: errorText(error) });
    } finally {
      if (!this.disposed && (this.terminalRefreshPending || this.terminal?.snapshot?.state === "running")) {
        clearTimeout(this.terminalPoll);
        this.terminalPoll = setTimeout(() => { void this.refreshTerminalContext(); }, 100);
      }
    }
  }

  /** Acknowledgement never submits or replays a draft; it is bound to the displayed run and revision. */
  async acknowledgeRecovery(target: RunRevisionRequest): Promise<boolean> {
    if (this.disposed || !this.terminal) return false;
    try {
      const confirmed = await this.terminal.acknowledgeRecovery(target);
      if (confirmed && !this.disposed) this.setStatus({ kind: "info", text: "已记录核对；草稿保留，需手动发送。" });
      return confirmed;
    } catch (error) {
      if (!this.disposed) this.setStatus({ kind: "error", text: errorText(error) });
      return false;
    }
  }

  private async submitTerminal(input: string, parsed: ReturnType<typeof parseCommand>): Promise<"continue"> {
    if (this.disposed) return "continue";
    try {
      if (!this.terminal) await this.bootstrap();
      if (this.disposed || !this.terminal) return "continue";
      if (this.slashRunning && (!parsed || !getRuntimeCommandInvocation(parsed).localOnly)) {
        this.setStatus({ kind: "error", text: "Wait for the current operation before starting research." });
        return "continue";
      }
      if (!parsed) {
        this.setStatus(null);
        await this.terminal.submit(input);
      } else if (parsed.command === "resume" && !parsed.positional.length && !Object.keys(parsed.flags).length && this.callbacks.onResumeRequest) {
        // Opening the existing picker is local UI; selecting a row still uses
        // the private Host command and its journal ownership checks.
        await this.refreshTerminalContext();
        if (!this.disposed) await this.runSlashCommand(parsed, true);
      } else if (["compact", "resume", "skill", "mcp", "clear"].includes(parsed.command)
        || parsed.command === "config" && parsed.flags.extensions !== undefined) {
        // Session commands never fall back to a second local Agent. Remaining
        // command adapters must be completed before the #76 release gate.
        const expectedSelection = this.terminal.selectionVersion, expectedIdentity = this.terminal.snapshot?.identity;
        const receipt = await this.terminal.command(input);
        await this.refreshTerminalContext();
        if (this.disposed) return "continue";
        if (parsed.command === "resume" && parsed.flags.task === true && !parsed.positional.length && Object.keys(parsed.flags).length === 1
          && receipt.result.success && this.callbacks.onResearchRequest) {
          if (expectedSelection !== this.terminal.selectionVersion || expectedIdentity?.sessionId !== this.terminal.snapshot?.identity.sessionId
            || expectedIdentity?.runId !== this.terminal.snapshot?.identity.runId) return "continue";
          const data = receipt.result.data as ResearchTaskSnapshot;
          try {
            if (!data || typeof data !== "object" || !(data.leafId === null || typeof data.leafId === "string")
              || !(data.task === null || typeof data.task === "object" && !Array.isArray(data.task))
              || !Array.isArray(data.taskErrors) || !Array.isArray(data.unresolved) || !researchTaskLines(data).every(line => typeof line === "string"))
              throw new Error("Invalid task snapshot");
          } catch { throw new Error("The Host returned an invalid research task snapshot; reconnect before inspecting it."); }
          this.callbacks.onResearchRequest(data);
          return "continue";
        }
        applyRuntimeCommandResult(receipt.result, this.commandResultContext());
        if (receipt.result.success && (parsed.command === "skill" && ["install", "remove", "reload"].includes(parsed.positional[0] ?? "")
          || parsed.command === "config" && parsed.flags.extensions !== undefined)) this.callbacks.onSkillsChanged?.();
      } else {
        const operation = this.runSlashCommand(parsed, getRuntimeCommandInvocation(parsed).localOnly);
        this.localOperations.add(operation);
        try { await operation; } finally { this.localOperations.delete(operation); }
      }
      await this.refreshTerminalContext();
    } catch (error) {
      if (!this.disposed) this.setStatus({ kind: "error", text: errorText(error) });
    }
    return "continue";
  }

  private emitLocalStorageState(): void {
    this.callbacks.onLocalState?.(buildLocalStorageState(loadSettings(), loadPanelPortfolio()));
  }

  private async runAgentPrompt(input: string, signal?: AbortSignal): Promise<void> {
    let dispatchStarted = false;
    if (this.interruption) await this.interruption;
    const version = this.interruptionVersion;
    const controller = new AbortController();
    this.promptControllers.add(controller);
    this.researchInterrupted = false;
    this.activePrompts++;
    try {
      if (!this.agent && this.bootstrapTask) await this.bootstrapTask;
      if (this.disposed || version !== this.interruptionVersion) return;
      if (!this.agent) {
        this.emitComposerQueue([input]);
        this.setActivity("thinking");
        this.setStatus({ kind: "info", text: "Agent is still starting. Your message is kept in the composer; send it again in a moment." });
        this.setActivity("ready");
        return;
      }
      const promptSignal = signal ? AbortSignal.any([signal, controller.signal, this.lifetime.signal]) : AbortSignal.any([controller.signal, this.lifetime.signal]);
      const expanded = await this.references.expand(input, promptSignal);
      dispatchStarted = true;
      this.pendingAutoArtifactInput = input;
      this.researchPortfolioKey = researchSelectionKey();
      this.prepareHudForRequest();
      if (!isAgentTurnActive(this.agent)) this.setActivity("thinking");
      const startedAt = perfNow();
      await dispatchUserMessage(this.agent, expanded, input, promptSignal);
      perfLog("runtime.agent.dispatch", startedAt);
    } catch (err) {
      if (this.disposed || version !== this.interruptionVersion) return;
      if (dispatchStarted) {
        this.pendingAutoArtifactInput = null;
        this.emitComposerQueue([]);
      }
      const message = errorText(err);
      this.messages.push({ role: "error", text: formatAgentError("Agent", message) });
      this.emitMessages();
      this.setStatus({ kind: "error", text: agentStatusText(message) });
      if (!isAgentTurnActive(this.agent)) this.setActivity("ready");
    } finally {
      this.promptControllers.delete(controller);
      this.activePrompts--;
      if (!this.disposed && version === this.interruptionVersion && !isAgentTurnActive(this.agent)) this.setActivity("ready");
    }
  }

  /** Local private file export; neither the request nor its result enters the Agent session. */
  async exportPrivateAnnual(request: PrivateAnnualExportRequest): Promise<void> {
    if (this.disposed) return;
    if (this.slashRunning || this.activePrompts > 0 || this.autoArtifactRunning || isAgentTurnActive(this.agent)) {
      this.setStatus({ kind: "error", text: "Wait for the current operation before exporting a private annual report." });
      return;
    }
    this.slashRunning = true;
    const selected = structuredClone(request);
    const operation = (async () => {
      if (this.sharedConnection) {
        if (!this.terminal) await this.bootstrap();
        if (this.disposed || !this.terminal) return;
        const selection = this.terminal.selectionVersion, snapshot = await this.terminal.confirmSelectedSnapshot();
        if (this.disposed) return;
        if (!snapshot || selection !== this.terminal.selectionVersion) throw new Error("Selected session changed; review the export before trying again.");
        if (snapshot.state === "running") {
          this.setStatus({ kind: "error", text: "Wait for the current operation before exporting a private annual report." });
          return;
        }
      }
      this.setStatus({ kind: "info", text: "Checking public annual evidence and exporting private HTML..." });
      await this.writePrivateAnnual(selected);
    })();
    this.localOperations.add(operation);
    try { await operation; }
    catch (error) { if (!this.disposed) this.setStatus({ kind: "error", text: `Private annual export failed · ${errorText(error)}` }); }
    finally { this.localOperations.delete(operation); this.slashRunning = false; }
  }

  private async writePrivateAnnual(request: PrivateAnnualExportRequest): Promise<void> {
    try {
      const args = ["--comparison", request.comparisonId, "--year", String(request.year), "--cutoff", request.valuationCutoff,
        "--history-file", request.historyFile, "--output", request.output,
        ...request.decisionIds.flatMap(id => ["--decision", id])];
      const result = await runPrivateAnnualFileCommand(args, AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(60_000)]));
      if (!this.disposed) this.setStatus({ kind: "info", text: `Private annual HTML written to ${result.output}` });
    } catch (error) {
      if (!this.disposed) this.setStatus({ kind: "error", text: `Private annual export failed · ${errorText(error)}` });
    }
  }

  private async maybeAutoGenerateArtifact(): Promise<void> {
    const input = this.pendingAutoArtifactInput;
    this.pendingAutoArtifactInput = null;
    if (!input || this.autoArtifactRunning || !this.agent) return;

    const settings = loadSettings();
    if (!settings.artifactGeneration.auto || !isQuantAnalysisRequest(input)) return;

    this.autoArtifactRunning = true;
    this.setStatus({ kind: "info", text: "Generating artifact report..." });
    try {
      const result = await this.autoArtifactRunner(this.agent);
      this.setStatus({
        kind: result.success ? "info" : "error",
        text: result.success ? `Artifact ready · ${result.message}` : `Artifact generation failed · ${result.message}`,
      });
    } catch (error) {
      this.setStatus({ kind: "error", text: `Artifact generation failed · ${errorText(error)}` });
    } finally {
      this.autoArtifactRunning = false;
    }
  }

  private emitComposerQueue(queue: string[]): void {
    this.callbacks.onComposerQueue?.([...queue]);
  }

  private pushLocalCommandMessage(text: string, role: "assistant" | "error"): void {
    if (this.sharedConnection) this.terminalCommandMessages = reducePushLocalCommandMessage(this.terminalCommandMessages, text, role);
    this.messages = reducePushLocalCommandMessage(this.messages, text, role);
    this.emitMessages();
  }

  private syncMessagesFromAgentState(): void {
    if (this.sharedConnection) { void this.refreshTerminalContext(); return; }
    this.resetHudLatency();
    const agentMessages = this.agent?.state.messages ?? [];
    this.messages = reduceSyncMessagesFromAgentState(agentMessages);
    this.emitMessages();
    this.refreshHudFromAgentState();
  }

  private emitMessages(): void {
    this.callbacks.onMessages([...this.messages]);
  }

  private emitHud(): void {
    const usage = this.hud.contextUsage
      ? { ...this.hud.contextUsage }
      : null;
    this.callbacks.onHud?.({
      ...this.hud,
      contextUsage: usage,
    });
  }

  private refreshHudFromAgentState(): void {
    if (this.sharedConnection) { this.emitHud(); return; }
    if (!this.agent) {
      this.hud.contextUsage = null;
      this.hud.turnCount = 0;
      this.emitHud();
      return;
    }
    const active = isAgentTurnActive(this.agent);
    const agentModel = this.agent.state.model?.id
      ? { model: this.agent.state.model.id, modelLabel: this.agent.state.model.name || this.agent.state.model.id } : null;
    const display = active ? agentModel ?? this.configuredModel : this.configuredModel ?? agentModel;
    if (display) this.callbacks.onModel?.(display);
    this.hud.contextUsage = this.modelConnectionPending && !active ? null : typeof this.agent.getContextUsage === "function"
      ? this.agent.getContextUsage() ?? null
      : null;
    this.hud.turnCount = countConversationTurns(this.agent.state.messages as Array<{ role?: unknown }>);
    this.emitHud();
  }

  private trackHudFromAgentEvent(event: QuantAgentEvent): void {
    const now = Date.now();
    if (event.type === "before_provider_request") {
      if (event.model.id === this.configuredModel?.model && event.model.provider === this.configuredProvider)
        this.modelConnectionPending = false;
      const scope = JSON.stringify([event.sessionId, event.model.provider, event.model.id, event.model.baseUrl, this.agent?.state.thinkingLevel]);
      if (this.latencyScope !== scope) this.resetHudLatency();
      this.latencyScope = scope;
      this.latencyTracker = { turnStartedAt: now, firstOutputAt: null };
      this.turnTtftRecorded = false;
      return;
    }
    if (event.type === "message_start") {
      const role = event.message?.role;
      if (role === "user" || role === "displayUser") {
        this.latencyTracker.turnStartedAt = now;
        this.latencyTracker.firstOutputAt = null;
        this.turnTtftRecorded = false;
        this.emitHud();
      }
      return;
    }

    if (
      event.type === "message_update"
      && event.message?.role === "assistant"
      && this.latencyTracker.turnStartedAt !== null
      && this.latencyTracker.firstOutputAt === null
      && assistantEventHasVisibleOutput(event.assistantMessageEvent)
    ) {
      this.recordTurnTtft(now);
      this.emitHud();
      return;
    }

    if (event.type === "message_end" && event.message?.role === "assistant") {
      const outputTokens = extractAssistantOutputTokens(event.message);
      const decodeMs = this.latencyTracker.firstOutputAt === null
        ? null
        : now - this.latencyTracker.firstOutputAt;
      const success = event.message.stopReason !== "error" && event.message.stopReason !== "aborted";
      if (success && this.latencyTracker.firstOutputAt !== null && this.latencyTracker.turnStartedAt !== null) {
        this.ttftTotalMs += Math.max(0, this.latencyTracker.firstOutputAt - this.latencyTracker.turnStartedAt);
        this.ttftSamples += 1;
        this.hud.ttftMs = this.ttftTotalMs / this.ttftSamples;
      }
      const turnTpotMs = success ? computeTpotMs(decodeMs, outputTokens) : null;
      if (turnTpotMs !== null) {
        this.tpotTotalMs += turnTpotMs;
        this.tpotSamples += 1;
        this.hud.tpotMs = this.tpotTotalMs / this.tpotSamples;
      }
      this.latencyTracker.turnStartedAt = null;
      this.latencyTracker.firstOutputAt = null;
      this.emitHud();
    }
  }

  private recordTurnTtft(now: number): void {
    if (this.latencyTracker.turnStartedAt === null || this.turnTtftRecorded) return;
    this.latencyTracker.firstOutputAt = now;
    this.turnTtftRecorded = true;
  }

  private resetHudLatency(): void {
    this.latencyTracker = createLatencyTracker();
    this.ttftTotalMs = this.ttftSamples = this.tpotTotalMs = this.tpotSamples = 0;
    this.turnTtftRecorded = false;
    this.latencyScope = null;
    this.hud.ttftMs = this.hud.tpotMs = null;
    this.emitHud();
  }

  private rememberModelConnection(settings: OhQuantSettings): boolean {
    const signature = JSON.stringify([settings.provider, settings.model, settings.providers, settings.thinkingLevel, settings.env]);
    const changed = signature !== this.modelConnectionSettings;
    this.modelConnectionSettings = signature;
    return changed;
  }

  private prepareHudForRequest(): void {
    if (isAgentTurnActive(this.agent)) return;
    const settings = loadSettings();
    if (this.rememberModelConnection(settings)) {
      this.configuredModel = { model: readModel(settings), modelLabel: readModelLabel(settings) };
      this.configuredProvider = settings.provider;
      this.modelConnectionPending = true;
    }
    if (!this.modelConnectionPending) return;
    this.hud.contextUsage = null;
    this.resetHudLatency();
  }

  private setActivity(activity: AppState["activity"]): void {
    this.callbacks.onActivity(activity);
  }

  private emitTerminalModel(model: AppRuntimeSnapshot): void {
    if (this.terminalDisplayedModel?.model === model.model && this.terminalDisplayedModel.modelLabel === model.modelLabel) return;
    this.terminalDisplayedModel = { ...model }; this.callbacks.onModel?.({ ...model });
  }

  private setStatus(status: AppState["composerStatus"]): void {
    this.callbacks.onComposerStatus?.(status);
  }

  private syncOverviewPanel(): void { this.overview.render(); }

  private scheduleMarketRefresh(): void { void this.overview.start(); }

  private commandResultContext(): CommandResultRuntimeContext {
    return {
      getMessages: () => this.messages,
      setMessages: (messages) => { this.messages = messages; },
      emitMessages: () => this.emitMessages(),
      emitComposerQueue: (queue) => this.emitComposerQueue(queue),
      setStatus: (status) => this.setStatus(status),
      pushLocalCommandMessage: (text, role) => this.pushLocalCommandMessage(text, role),
      syncOverviewPanel: () => this.syncOverviewPanel(),
      resetAgent: () => {
        this.resetHudLatency();
        this.agent?.abort();
        this.agent?.clearAllQueues();
        this.agent?.reset();
      },
      openConfig: () => this.callbacks.onConfigRequest?.(),
      openDoctor: (doctor) => {
        this.currentDoctor = isDoctorResult(doctor) ? doctor : null;
        this.callbacks.onDoctorRequest?.(doctor);
      },
      openResume: () => {
        void this.collectCurrentSessionMeta()
          .then(meta => { if (!this.disposed) this.callbacks.onResumeRequest?.(meta); })
          .catch(() => {});
      },
      openSession: () => {
        void this.collectCurrentSessionMeta()
          .then(meta => (this.callbacks.onSessionRequest ?? this.callbacks.onResumeRequest)?.(meta))
          .catch(() => {});
      },
      openPortfolio: () => this.callbacks.onPortfolioRequest?.(),
      openHelp: () => this.callbacks.onHelpRequest?.(),
      openArtifact: () => this.callbacks.onArtifactRequest?.(),
      syncMessagesFromAgentState: () => this.syncMessagesFromAgentState(),
      syncSessionPanel: () => {
        void this.collectCurrentSessionMeta()
          .then(meta => this.callbacks.onSessionRequest?.(meta))
          .catch(() => {});
      },
      emitLocalStorageState: () => this.emitLocalStorageState(),
      refreshMarketPanel: () => {
        void this.refreshOverviewPanel();
      },
    };
  }

  private finalizeSkillMessage(isError: boolean): void {
    const result = reduceFinalizeSkillMessage(this.messages, isError);
    this.messages = result.messages;
    if (result.changed) this.emitMessages();
  }
}

function isDoctorResult(value: unknown): value is DoctorResult {
  return typeof value === "object"
    && value !== null
    && Array.isArray((value as { phases?: unknown }).phases)
    && typeof (value as { mode?: unknown }).mode === "string"
    && typeof (value as { overall?: unknown }).overall === "string";
}

export function createInitialAppState(version: string): AppState {
  const settings = loadSettings();
  const model = readModel(settings);
  const localState = buildLocalStorageState(settings, loadPanelPortfolio());
  return {
    model,
    modelLabel: readModelLabel(settings),
    version,
    user: process.env.USER || process.env.USERNAME || "trader",
    activity: "starting",
    cost: 0,
    cacheHit: 100,
    messages: [],
    panel: [],
    panelLoading: true,
    input: "",
    composerQueue: [],
    composerStatus: null,
    hud: createHudMetrics(),
    ...localState,
  };
}

function readModel(settings: OhQuantSettings): string {
  try { return resolveConfiguredModel(settings).id; } catch { return settings.model || "Configure model"; }
}

function readModelLabel(settings: OhQuantSettings): string {
  return readModel(settings);
}

function updateLastSymbol(agent: QuantAgentSession | null, flags: Record<string, unknown>): void {
  const symbol = flags["symbol"] || flags["code"];
  if (!symbol) return;
  agent?.updateContext({
    lastSymbol: String(symbol),
    lastMarket: String(flags["market"] || flags["m"] || "A"),
  });
}

export const helpText = buildCommandHelpText();


