import { buildCommandHelpText } from "./cli/catalog.ts";
import { executeCommand, parseCommand } from "./cli/registry.ts";
import { commandPreflight } from "./runtime/workspace/command-preflight.ts";
import { auditCurrentFundAnswer } from "./runtime/evidence/fund-answer-evidence.ts";
import { auditCurrentFactorAnswer } from "./runtime/evidence/factor-answer-evidence.ts";
import { auditCurrentPortfolioAnswer } from "./runtime/evidence/portfolio-answer-evidence.ts";
import { auditCurrentRiskAnswer } from "./runtime/evidence/risk-answer-evidence.ts";
import { auditCurrentNewsAnswer } from "./runtime/evidence/news-answer-evidence.ts";
import { knownNewsPriceBasisViolations } from "./runtime/evidence/news-answer-claims.ts";
import { newsAnswerCitationKeys } from "./research/news-citations.ts";
import { hasRiskMetricLabel, RISK_ANSWER_VIOLATION_LABELS } from "./runtime/evidence/risk-answer-claims.ts";
import { performanceMethodClaimViolations } from "./runtime/evidence/performance-method-claims.ts";
import { portfolioWeightClaimViolations } from "./runtime/evidence/portfolio-weight-claims.ts";
import { comparisonExcessClaimViolations } from "./runtime/evidence/comparison-answer-methods.ts";
import { auditCurrentAnnualAnswer } from "./runtime/evidence/annual-answer-evidence.ts";
import { hasExplicitFactorLatestClaim, knownFactorAnswerViolations } from "./runtime/evidence/factor-answer-claims.ts";
import { isInstalledToolProbeSchemaQuery } from "./runtime/data/tool-probe-schema.ts";
import { generateCurrentSessionArtifact, restoreArtifactReport } from "./runtime/research/artifact-reports.ts";
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
  onConfigRequest?: () => void;
  onDoctorRequest?: (doctor?: unknown) => void;
  onResumeRequest?: (meta?: CurrentSessionMeta) => void;
  onResearchRequest?: (snapshot: ResearchTaskSnapshot) => void;
  onPortfolioRequest?: () => void;
  onArtifactRequest?: () => void;
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

  getReferenceSuggestions(input: string) { return this.references.suggest(input); }

  constructor(
    private readonly callbacks: AppRuntimeCallbacks,
    quoteFetcher: QuoteFetcher = fetchOverviewQuotes,
    holdingFetcher: HoldingFetcher = fetchOverviewHoldings,
    private readonly agentFactory?: AgentFactory,
    private readonly autoArtifactRunner: AutoArtifactRunner = runAutoArtifact,
    private readonly artifactRestoreRunner: ArtifactRestoreRunner = runArtifactRestore,
    marketRefreshTimeoutMs = 120_000,
    marketRefreshIntervalMs = 60_000,
    overviewOptions: Pick<OverviewRefreshOptions, "poolFactory"> = {},
    extensions?: RuntimeExtensions,
  ) {
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
    return this.agent ? toSkillEntries(await this.agent.getSkills()) : loadRuntimeSkillSuggestions();
  }

  /** Structured research entry for hosts; shares the normal UI/event/command runtime. */
  async submitResearch(task: ResearchTaskSpec, expectedRevision: string | null = null, signal?: AbortSignal): Promise<void> {
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
        if (answer && (this.flagContradictoryPerformanceMethod(answer)
          || await this.flagContradictoryWeightSum(answer)
          || await this.flagContradictoryAnnualAnswer(answer)
          || await this.flagContradictoryFundAnswer(answer) || await this.flagUnsupportedFactorAnswer(answer)
          || await this.flagContradictoryRiskAnswer(answer)
          || await this.flagUnsupportedNewsAnswer(answer)
          || await this.flagContradictoryPortfolioAnswer(answer))) return;
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
    this.unsubscribeAgent?.();
    this.unsubscribeAgent = null;
    this.agent?.abort();
    this.extensionShutdown ??= this.extensions?.dispose();
  }

  async shutdown(): Promise<void> {
    this.dispose();
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
    if (this.rememberModelConnection(settings)) this.modelConnectionPending = true;
    if (!isAgentTurnActive(this.agent)) {
      // Saved connections can change credentials/endpoint without changing the model ID.
      // Do not display previous connection measurements beside the new selection.
      if (this.modelConnectionPending) {
        this.hud.contextUsage = null;
        this.resetHudLatency();
      }
      this.callbacks.onModel?.(this.configuredModel);
    }
    this.emitLocalStorageState();
    this.callbacks.onSkillsChanged?.();
    if (!this.agent) void this.bootstrap().then(snapshot => this.callbacks.onModel?.(snapshot)).catch(error => this.setStatus({ kind: "error", text: errorText(error) }));
  }

  /** Handle a report selected in the Artifact panel without routing through slash parsing. */
  async restoreArtifact(reportId: string): Promise<void> {
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
      if (!isInstalledToolProbeSchemaQuery(parsed) && !cancelled() && !isAgentTurnActive(this.agent)) this.setActivity("ready");
      if (doctorRun && this.doctorRun === doctorRun) this.doctorRun = null;
    }
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
    this.setStatus({ kind: "info", text: "Checking public annual evidence and exporting private HTML..." });
    const selected = structuredClone(request);
    const operation = this.writePrivateAnnual(selected);
    this.localOperations.add(operation);
    try { await operation; }
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
    this.messages = reducePushLocalCommandMessage(this.messages, text, role);
    this.emitMessages();
  }

  private syncMessagesFromAgentState(): void {
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

  private flagContradictoryPerformanceMethod(answer: string): boolean {
    const violations = performanceMethodClaimViolations(answer);
    if (!violations.length) return false;
    const detail = violations.map(code => code === "wrong-drawdown-period-method"
      ? "最大回撤是累计峰谷跌幅，不是单期收益"
      : "Sharpe 取决于平均超额收益与收益标准差，零回撤不能解释高 Sharpe").join("；");
    this.pushLocalCommandMessage(`绩效口径回答需要复核：${detail}。`, "error");
    this.setStatus({ kind: "error", text: `Performance answer needs review · ${detail}` });
    this.pendingAutoArtifactInput = null;
    return true;
  }

  private async flagContradictoryWeightSum(answer: string): Promise<boolean> {
    if (!this.agent || !/[+＋]/u.test(answer) || !/[%％]/u.test(answer)) return false;
    try {
      const request = (await this.agent.getResearchState()).requests.at(-1)?.text ?? "";
      if (!portfolioWeightClaimViolations(answer, request).length) return false;
      const detail = "列出的标的权重之和与用户提供的组合权重不一致";
      this.pushLocalCommandMessage(`组合权重回答需要复核：${detail}。`, "error");
      this.setStatus({ kind: "error", text: `Portfolio weights need review · ${detail}` });
      this.pendingAutoArtifactInput = null;
      return true;
    } catch { return false; } // No matched supplied weights means no numerical claim can be checked.
  }

  private async flagContradictoryAnnualAnswer(answer: string): Promise<boolean> {
    if (!this.agent || !comparisonExcessClaimViolations(answer).length) return false;
    try {
      const audit = auditCurrentAnnualAnswer(await this.agent.getResearchState(), answer);
      if (audit.status === "not-annual" || !audit.violations.length) return false;
      const detail = "本年报超额收益是与基准的总收益百分点差，不是风险调整 alpha，表头应标为超额收益";
      this.pushLocalCommandMessage(`年报回答需要复核：${detail}。`, "error");
      this.setStatus({ kind: "error", text: `Annual answer needs review · ${detail}` });
    } catch {
      this.pushLocalCommandMessage("年报回答需要复核：当前无法读取研究证据。", "error");
      this.setStatus({ kind: "error", text: "Annual answer needs review · evidence unavailable" });
    }
    this.pendingAutoArtifactInput = null;
    return true;
  }

  /** The final text stays visible; warn on a proven mismatch and avoid archiving it as an automatic report. */
  private async flagContradictoryFundAnswer(answer: string): Promise<boolean> {
    if (!this.agent || !/(?:Principal\s+return|本金收益率|Time[- ]weighted\s+return|时间加权收益率|Maximum\s+drawdown|最大回撤|TWR)/iu.test(answer))
      return false;
    try {
      const audit = auditCurrentFundAnswer(await this.agent.getResearchState(), answer);
      if (audit.status === "not-fund") return false;
      if (audit.status === "audited" && !audit.violations.length) return false;
      const labels: Record<string, string> = {
        "wrong-verified-principal-return": "本金收益率",
        "wrong-verified-time-weighted-return": "时间加权收益率",
        "wrong-verified-twr-drawdown": "最大回撤",
        "wrong-fixed-principal-formula": "本金收益公式",
      };
      const detail = audit.status === "unavailable" ? "当前任务缺少可匹配的已核验基金指标"
        : audit.violations.map(code => code === "unaligned-direct-twr-comparison"
          ? "基金或基准直接比较缺少同句明确的区间、币种、费用与分红对齐前提"
          : `${labels[code] ?? code}与已核验工具结果不一致`).join("；");
      this.pushLocalCommandMessage(`基金回答需要复核：${detail}。请检查 fund_dca_backtest 的任务参数与原始指标。`, "error");
      this.setStatus({ kind: "error", text: `Fund answer needs review · ${detail}` });
    } catch {
      this.pushLocalCommandMessage("基金回答需要复核：当前无法读取研究证据。", "error");
      this.setStatus({ kind: "error", text: "Fund answer needs review · evidence unavailable" });
    }
    this.pendingAutoArtifactInput = null;
    return true;
  }

  private async flagUnsupportedFactorAnswer(answer: string): Promise<boolean> {
    if (!this.agent || !knownFactorAnswerViolations(answer).length && !hasExplicitFactorLatestClaim(answer)
      && !/\b(?:momentum|reversal|volatility|rsi)\s*[(（]\s*\d+\s*[)）]/iu.test(answer)) return false;
    try {
      const audit = auditCurrentFactorAnswer(await this.agent.getResearchState(), answer);
      if (audit.status === "not-factor" || audit.status === "audited" && !audit.violations.length) return false;
      const detail = audit.status === "unavailable" ? "当前任务缺少可匹配的已核验因子证据"
        : audit.violations.map(code => code === "wrong-verified-factor-latest" ? "最新因子值与已核验工具结果不一致"
          : code === "ambiguous-verified-factor-latest" ? "多个因子结果需要标明因子名和周期才能匹配最新值"
          : code === "unsupported-factor-annualization-prohibition" ? "因子原值未年化；有明确观察频率与假设时可另行按平方根频率换算，不能笼统禁止年化"
          : code === "wrong-factor-close-observation-minimum" ? "N 期收益因子至少需要 N+1 个收盘价观察"
          : "历史因子分位未检验后续收益，不能据此断言均值回归").join("；");
      this.pushLocalCommandMessage(`因子回答需要复核：${detail}。请核对 compute_factor 的任务参数与原始指标。`, "error");
      this.setStatus({ kind: "error", text: `Factor answer needs review · ${detail}` });
    } catch {
      this.pushLocalCommandMessage("因子回答需要复核：当前无法读取研究证据。", "error");
      this.setStatus({ kind: "error", text: "Factor answer needs review · evidence unavailable" });
    }
    this.pendingAutoArtifactInput = null;
    return true;
  }

  private async flagContradictoryRiskAnswer(answer: string): Promise<boolean> {
    if (!this.agent || !hasRiskMetricLabel(answer)) return false;
    try {
      const audit = auditCurrentRiskAnswer(await this.agent.getResearchState(), answer);
      if (audit.status === "not-risk" || audit.status === "audited" && !audit.violations.length) return false;
      const detail = audit.status === "unavailable" ? "当前任务缺少可匹配的已核验风险指标"
        : `${audit.violations.map(code => RISK_ANSWER_VIOLATION_LABELS[code] ?? code).join("、")}与已核验工具结果不一致`;
      this.pushLocalCommandMessage(`风险回答需要复核：${detail}。请检查 check_risk 的任务参数与原始指标。`, "error");
      this.setStatus({ kind: "error", text: `Risk answer needs review · ${detail}` });
    } catch {
      this.pushLocalCommandMessage("风险回答需要复核：当前无法读取研究证据。", "error");
      this.setStatus({ kind: "error", text: "Risk answer needs review · evidence unavailable" });
    }
    this.pendingAutoArtifactInput = null;
    return true;
  }

  private async flagUnsupportedNewsAnswer(answer: string): Promise<boolean> {
    if (!this.agent || !newsAnswerCitationKeys(answer).length && !knownNewsPriceBasisViolations(answer, null).length) return false;
    try {
      const audit = auditCurrentNewsAnswer(await this.agent.getResearchState(), answer);
      if (audit.status === "not-news" || audit.status === "audited" && !audit.violations.length) return false;
      const detail = audit.status === "unavailable" ? "无法唯一匹配新闻结果或引用映射"
        : audit.violations.some(code => code.endsWith("news-citation")) ? "正文引用格式无效，或所引段落不在可引用证据中"
          : audit.violations.includes("unreported-condition-promoted-to-nonoccurrence") ? "原文未报告条件发生，不能据此断言条件未发生"
          : "价格复权口径断言缺少对应新闻快照支持";
      this.pushLocalCommandMessage(`新闻回答需要复核：${detail}。请检查 research_news 的原始正文引用与价格复权说明。`, "error");
      this.setStatus({ kind: "error", text: `News answer needs review · ${detail}` });
    } catch {
      this.pushLocalCommandMessage("新闻回答需要复核：当前无法读取研究证据。", "error");
      this.setStatus({ kind: "error", text: "News answer needs review · evidence unavailable" });
    }
    this.pendingAutoArtifactInput = null;
    return true;
  }

  private async flagContradictoryPortfolioAnswer(answer: string): Promise<boolean> {
    if (!this.agent || !/(?:累计收益|总收益|总回报|total\s+return|最大回撤|max(?:imum)?\s+drawdown|\bTR\b|\bDD\b)/iu.test(answer)
      && !comparisonExcessClaimViolations(answer).length && !/(?:基准|benchmark|跑赢|跑输|outperformed|underperformed|matched|tied|\bbeat\b|\blagged\b)/iu.test(answer)) return false;
    try {
      const audit = auditCurrentPortfolioAnswer(await this.agent.getResearchState(), answer);
      if (audit.status === "not-portfolio" || audit.status === "audited" && !audit.violations.length) return false;
      const detail = audit.status === "unavailable" ? "当前任务缺少可匹配的已核验组合比较"
        : `${audit.violations.map(code => {
          if (code === "excess-return-labelled-alpha") return "超额收益标签";
          const group = code.includes("-a-") ? "组合 A" : "组合 B";
          if (code.endsWith("-benchmark-direction")) return `${group} 相对基准的收益方向`;
          return `${group} ${code.endsWith("-return") ? "累计收益" : "最大回撤"}`;
        }).join("、")}与已核验工具结果不一致`;
      this.pushLocalCommandMessage(`组合回答需要复核：${detail}。请检查 compare_portfolios 的任务参数与原始指标。`, "error");
      this.setStatus({ kind: "error", text: `Portfolio answer needs review · ${detail}` });
    } catch {
      this.pushLocalCommandMessage("组合回答需要复核：当前无法读取研究证据。", "error");
      this.setStatus({ kind: "error", text: "Portfolio answer needs review · evidence unavailable" });
    }
    this.pendingAutoArtifactInput = null;
    return true;
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
          .then(meta => this.callbacks.onResumeRequest?.(meta))
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


