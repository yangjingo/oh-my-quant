import {
  AgentHarness,
  type BranchSummaryEntry,
  type CompactResult,
  type AgentHarnessEvent,
  JsonlSessionRepo,
  type JsonlSessionMetadata,
  type NavigateTreeResult,
  estimateTokens as piEstimateTokens,
  estimateContextTokens as piEstimateContextTokens,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type Session,
  type SessionContext,
  type SessionTreeEntry,
} from "./pi/index.ts";
import { NodeExecutionEnv } from "./pi/node.ts";
import {
  getModels,
  type KnownProvider,
  type Model,
} from "@earendil-works/pi-ai";
import { BUILTIN_TOOLS } from "../../tools/registry.ts";
import { buildSystemPrompt, injectSkillContext, injectTurnContext, type SessionCtx } from "./context.ts";
import { SESSIONS_DIR, ensureDirs, loadSettings } from "../../storage/index.ts";
import type { OhQuantSettings } from "../../types/config.ts";
import { discoverSkills, type QuantSkill } from "./skills.ts";
import { perfLog, perfNow } from "../../perf.ts";

export interface QuantAgentContextUsage {
  tokens: number;
  contextWindow: number;
  percent: number | null;
}

export interface QuantAgentQueueUpdateEvent {
  type: "queue_update";
  steer: AgentMessage[];
  followUp: AgentMessage[];
  nextTurn: AgentMessage[];
}

export type QuantAgentEvent = AgentEvent | QuantAgentQueueUpdateEvent;

export interface QuantAgentState {
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: string;
  tools: AgentTool[];
  messages: AgentMessage[];
  isStreaming: boolean;
  streamingMessage?: AgentMessage;
  /** Live thinking text extracted from the streaming assistant message. */
  thinkingText: string;
  pendingToolCalls: Set<string>;
  errorMessage?: string;
}

export interface QuantAgentSession {
  readonly state: QuantAgentState;
  subscribe(listener: (event: QuantAgentEvent, signal?: AbortSignal) => Promise<void> | void): () => void;
  prompt(input: string, options?: { displayText?: string }): Promise<void>;
  waitForIdle(): Promise<void>;
  steer(message: AgentMessage): Promise<void>;
  followUp(message: AgentMessage): Promise<void>;
  skill(name: string, additionalInstructions?: string): Promise<void>;
  compact(customInstructions?: string): Promise<CompactResult>;
  navigateTree(
    targetId: string,
    options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string },
  ): Promise<NavigateTreeResult>;
  getContextUsage(): QuantAgentContextUsage | undefined;
  getSessionMetadata(): Promise<JsonlSessionMetadata | null>;
  getSessionEntries(): Promise<SessionTreeEntry[]>;
  getSessionBranch(fromId?: string): Promise<SessionTreeEntry[]>;
  getLeafId(): Promise<string | null>;
  listSessions(): Promise<JsonlSessionMetadata[]>;
  resumeSession(sessionId: string): Promise<JsonlSessionMetadata>;
  getSkills(): Promise<QuantSkill[]>;
  abort(): void;
  clearAllQueues(): void;
  reset(): void;
}

export interface QuantAgentOptions {
  cwd?: string;
  sessionsRoot?: string;
  settings?: Partial<Pick<OhQuantSettings, "env" | "model" | "thinkingLevel">>;
  skillPaths?: string[];
}

const sessionCtx: SessionCtx = {
  lastSymbol: null,
  lastMarket: null,
  lastStartDate: null,
  lastEndDate: null,
  recentToolState: {
    toolName: null,
    resultShape: null,
  },
};

const TOOLSET = [...BUILTIN_TOOLS] as AgentTool[];

function createEmptyState(): QuantAgentState {
  const config = loadSettings();
  const modelId = resolveModelId(config.model || "sonnet", config.env);
  const provider = inferProvider(modelId);
  const model = resolveModel(provider, modelId);
  return {
    systemPrompt: buildSystemPrompt(),
    model,
    thinkingLevel: config.thinkingLevel || "high",
    tools: [...TOOLSET],
    messages: [],
    isStreaming: false,
    streamingMessage: undefined,
    thinkingText: "",
    pendingToolCalls: new Set<string>(),
    errorMessage: undefined,
  };
}

class QuantAgentHarnessSession implements QuantAgentSession {
  readonly state: QuantAgentState = createEmptyState();

  private readonly listeners = new Set<(event: QuantAgentEvent, signal?: AbortSignal) => Promise<void> | void>();
  private readonly cwd: string;
  private readonly sessionsRoot: string;
  private readonly settingsOverride?: QuantAgentOptions["settings"];
  private readonly skillPaths: string[];
  private readonly env: NodeExecutionEnv;
  private readonly repo: JsonlSessionRepo;
  private skills: QuantSkill[] = [];
  private initVersion = 0;
  private harness: AgentHarness<QuantSkill> | null = null;
  private session: Session<JsonlSessionMetadata> | null = null;
  private ready: Promise<void>;

  constructor(options: QuantAgentOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.sessionsRoot = options.sessionsRoot ?? SESSIONS_DIR;
    this.settingsOverride = options.settings;
    this.skillPaths = options.skillPaths ?? [];
    this.env = new NodeExecutionEnv({ cwd: this.cwd });
    this.repo = new JsonlSessionRepo({ fs: this.env, sessionsRoot: this.sessionsRoot });
    this.applyConfigToState(this.resolveSettings());
    this.ready = this.initialize({ forceNewSession: false });
  }

  subscribe(listener: (event: QuantAgentEvent, signal?: AbortSignal) => Promise<void> | void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async prompt(input: string, options?: { displayText?: string }): Promise<void> {
    const readyStartedAt = perfNow();
    await this.ready;
    perfLog("agent.ready.wait", readyStartedAt, { phase: "prompt" });
    if (!this.harness) throw new Error("Agent harness not initialized");
    const prompt = injectTurnContext(input, sessionCtx);
    const promptStartedAt = perfNow();
    await this.harness.prompt(prompt, { displayText: options?.displayText });
    perfLog("agent.prompt", promptStartedAt);
  }

  async steer(message: AgentMessage): Promise<void> {
    await this.ready;
    if (!this.harness) throw new Error("Agent harness not initialized");
    await this.harness.steer(injectTurnContext(extractMessageText(message), sessionCtx), { displayText: extractMessageDisplayText(message) });
  }

  async followUp(message: AgentMessage): Promise<void> {
    await this.ready;
    if (!this.harness) throw new Error("Agent harness not initialized");
    await this.harness.followUp(injectTurnContext(extractMessageText(message), sessionCtx), { displayText: extractMessageDisplayText(message) });
  }

  async skill(name: string, additionalInstructions?: string): Promise<void> {
    await this.ready;
    if (!this.harness) throw new Error("Agent harness not initialized");
    await this.harness.skill(name, injectSkillContext(name, additionalInstructions));
  }

  async waitForIdle(): Promise<void> {
    const readyStartedAt = perfNow();
    await this.ready;
    perfLog("agent.ready.wait", readyStartedAt, { phase: "waitForIdle" });
    await this.harness?.waitForIdle();
  }

  async compact(customInstructions?: string): Promise<CompactResult> {
    await this.ready;
    if (!this.harness || !this.session) throw new Error("Agent harness not initialized");
    let result: CompactResult;
    try {
      result = await this.harness.compact(customInstructions);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("requires idle harness") || message.includes("AgentHarness is busy")) {
        throw new Error("Agent is still running. Wait for the current response/tool call to finish, then run /compact again.");
      }
      throw error;
    }
    await this.refreshStateFromSession();
    return result;
  }

  async navigateTree(
    targetId: string,
    options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string },
  ): Promise<NavigateTreeResult> {
    await this.ready;
    if (!this.harness || !this.session) throw new Error("Agent harness not initialized");
    const result = await this.harness.navigateTree(targetId, options);
    await this.refreshStateFromSession();
    return result;
  }

  getContextUsage(): QuantAgentContextUsage | undefined {
    const contextWindow = this.state.model.contextWindow ?? 0;
    if (contextWindow <= 0) return undefined;
    const tokens = piEstimateContextTokens(this.state.messages).tokens;
    return {
      tokens,
      contextWindow,
      percent: contextWindow > 0 ? tokens / contextWindow * 100 : null,
    };
  }

  async getSessionMetadata(): Promise<JsonlSessionMetadata | null> {
    await this.ready;
    return await this.session?.getMetadata() ?? null;
  }

  async getSessionEntries(): Promise<SessionTreeEntry[]> {
    await this.ready;
    return await this.session?.getEntries() ?? [];
  }

  async getSessionBranch(fromId?: string): Promise<SessionTreeEntry[]> {
    await this.ready;
    if (!this.session) return [];
    return await this.session.getBranch(fromId);
  }

  async getLeafId(): Promise<string | null> {
    await this.ready;
    return await this.session?.getLeafId() ?? null;
  }

  async listSessions(): Promise<JsonlSessionMetadata[]> {
    await this.ready;
    return await this.repo.list({ cwd: this.cwd });
  }

  async resumeSession(sessionId: string): Promise<JsonlSessionMetadata> {
    this.abort();
    this.prepareForSessionSwitch();
    this.ready = this.initialize({ forceNewSession: false, resumeSessionId: sessionId });
    await this.ready;
    const metadata = await this.getSessionMetadata();
    if (!metadata) throw new Error(`Session not found: ${sessionId}`);
    return metadata;
  }

  async getSkills(): Promise<QuantSkill[]> {
    await this.ready;
    return [...this.skills];
  }

  abort(): void {
    void this.harness?.abort();
  }

  clearAllQueues(): void {
    this.abort();
  }

  reset(): void {
    this.abort();
    this.prepareForSessionSwitch();
    this.ready = this.initialize({ forceNewSession: true });
  }

  private prepareForSessionSwitch(): void {
    this.state.messages = [];
    this.state.isStreaming = false;
    this.state.streamingMessage = undefined;
    this.state.thinkingText = "";
    this.state.pendingToolCalls = new Set<string>();
    this.state.errorMessage = undefined;
    sessionCtx.lastSymbol = null;
    sessionCtx.lastMarket = null;
    sessionCtx.lastStartDate = null;
    sessionCtx.lastEndDate = null;
    sessionCtx.recentToolState.toolName = null;
    sessionCtx.recentToolState.resultShape = null;
  }

  private async initialize(options: { forceNewSession: boolean; resumeSessionId?: string }): Promise<void> {
    const totalStartedAt = perfNow();
    const version = ++this.initVersion;
    ensureDirs();

    const configStartedAt = perfNow();
    const config = this.resolveSettings();
    const modelId = resolveModelId(config.model || "sonnet", config.env);
    const provider = inferProvider(modelId);
    const model = resolveModel(provider, modelId);
    perfLog("agent.init.config", configStartedAt, { model: modelId, provider });

    const skillsStartedAt = perfNow();
    const discovered = await discoverSkills({ cwd: this.cwd, env: this.env, extraPaths: this.skillPaths });
    perfLog("agent.init.skills", skillsStartedAt, { skills: discovered.skills.length });
    const systemPrompt = buildSystemPrompt(undefined, discovered.skills);

    this.applyConfigToState(config, model, systemPrompt);

    const sessionStartedAt = perfNow();
    const existing = options.forceNewSession ? [] : await this.repo.list({ cwd: this.cwd });
    let session: Session<JsonlSessionMetadata>;
    if (options.resumeSessionId) {
      const target = existing.find((item) => item.id === options.resumeSessionId);
      if (!target) throw new Error(`Session not found: ${options.resumeSessionId}`);
      session = await this.repo.open(target);
    } else {
      session = existing.length > 0
        ? await this.repo.open(existing[0]!)
        : await this.repo.create({ cwd: this.cwd });
    }
    perfLog("agent.init.session", sessionStartedAt, { existing: existing.length, resume: Boolean(options.resumeSessionId) });

    const contextStartedAt = perfNow();
    const context = await session.buildContext();
    perfLog("agent.init.context", contextStartedAt, { messages: context.messages.length });
    if (this.initVersion !== version) return;

    this.skills = discovered.skills;
    this.session = session;
    applySessionContextState(this.state, context, model);

    const harness = new AgentHarness({
      env: this.env,
      session,
      resources: { skills: discovered.skills },
      model: this.state.model,
      thinkingLevel: normalizeThinkingLevel(this.state.thinkingLevel),
      tools: [...TOOLSET],
      activeToolNames: TOOLSET.map((tool) => tool.name),
      systemPrompt,
      getApiKeyAndHeaders: async (_activeModel) => {
        const s = this.resolveSettings();
        const legacy = s.env.WHYJ_AUTH_TOKEN || s.env.WHYJ_API_KEY || process.env.WHYJ_AUTH_TOKEN || process.env.WHYJ_API_KEY;
        return legacy ? { apiKey: legacy } : undefined;
      },
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
    });

    harness.subscribe(async (event, signal) => {
      this.reduceState(event);
      if (!isForwardedAgentEvent(event)) return;
      for (const listener of this.listeners) {
        await listener(event, signal);
      }
    });

    this.harness = harness;
    perfLog("agent.init.total", totalStartedAt, { tools: TOOLSET.length });
  }

  private reduceState(event: AgentHarnessEvent): void {
    switch (event.type) {
      case "message_start":
        this.state.isStreaming = true;
        this.state.streamingMessage = event.message;
        if (event.message.role === "assistant") {
          this.state.thinkingText = "";
        }
        break;
      case "message_update":
        this.state.streamingMessage = event.message;
        if (event.message.role === "assistant") {
          this.state.thinkingText = extractThinkingFromMessage(event.message);
        }
        break;
      case "message_end":
        this.state.streamingMessage = undefined;
        this.state.messages = [...this.state.messages, event.message];
        if (event.message.role === "assistant" && event.message.errorMessage) {
          this.state.errorMessage = event.message.errorMessage;
        }
        break;
      case "tool_execution_start": {
        const pending = new Set(this.state.pendingToolCalls);
        pending.add(event.toolCallId);
        this.state.pendingToolCalls = pending;
        sessionCtx.recentToolState.toolName = event.toolName;
        sessionCtx.recentToolState.resultShape = inferResultShape(event.toolName);
        break;
      }
      case "tool_execution_end": {
        const pending = new Set(this.state.pendingToolCalls);
        pending.delete(event.toolCallId);
        this.state.pendingToolCalls = pending;
        sessionCtx.recentToolState.toolName = event.toolName;
        sessionCtx.recentToolState.resultShape = inferResultShape(event.toolName, event.result);
        break;
      }
      case "agent_end":
        this.state.isStreaming = false;
        this.state.streamingMessage = undefined;
        this.state.thinkingText = "";
        this.state.pendingToolCalls = new Set<string>();
        break;
      case "model_update":
        this.state.model = event.model;
        break;
      case "thinking_level_update":
        this.state.thinkingLevel = event.level;
        break;
      case "tools_update":
        this.state.tools = TOOLSET.filter((tool) => event.toolNames.includes(tool.name));
        break;
    }
  }

  private async refreshStateFromSession(): Promise<void> {
    if (!this.session) return;
    const context = await this.session.buildContext();
    applySessionContextState(this.state, context, this.state.model);
  }

  private resolveSettings(): OhQuantSettings {
    const base = loadSettings();
    return {
      ...base,
      env: { ...base.env, ...(this.settingsOverride?.env ?? {}) },
      model: this.settingsOverride?.model ?? base.model,
      thinkingLevel: this.settingsOverride?.thinkingLevel ?? base.thinkingLevel,
    };
  }

  private applyConfigToState(
    config: Pick<OhQuantSettings, "env" | "model" | "thinkingLevel">,
    model?: Model<any>,
    systemPrompt?: string,
  ): void {
    const resolvedModel = model
      ?? resolveModel(inferProvider(resolveModelId(config.model || "sonnet", config.env)), resolveModelId(config.model || "sonnet", config.env));
    this.state.model = resolvedModel;
    this.state.systemPrompt = systemPrompt ?? buildSystemPrompt(undefined, this.skills);
    this.state.thinkingLevel = config.thinkingLevel || "high";
    this.state.tools = [...TOOLSET];
  }
}

function isCoreAgentEvent(event: AgentHarnessEvent): event is AgentEvent {
  return event.type === "message_start"
    || event.type === "message_update"
    || event.type === "message_end"
    || event.type === "tool_execution_start"
    || event.type === "tool_execution_update"
    || event.type === "tool_execution_end"
    || event.type === "turn_end"
    || event.type === "agent_end";
}

function isForwardedAgentEvent(event: AgentHarnessEvent): event is QuantAgentEvent {
  return isCoreAgentEvent(event) || event.type === "queue_update";
}

function applySessionContextState(
  state: QuantAgentState,
  context: SessionContext,
  fallbackModel: Model<any>,
): void {
  state.messages = [...context.messages];
  if (context.thinkingLevel !== null) state.thinkingLevel = context.thinkingLevel;
  if (context.model) {
    try {
      state.model = resolveModel(context.model.provider, context.model.modelId);
    } catch {
      state.model = fallbackModel;
    }
  } else {
    state.model = fallbackModel;
  }
}

function normalizeThinkingLevel(level: string): "off" | "minimal" | "low" | "medium" | "high" | "xhigh" {
  switch (level) {
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return level;
    default:
      return "off";
  }
}

function extractMessageText(message: AgentMessage): string {
  if (typeof (message as { content?: unknown }).content === "string") {
    return (message as { content: string }).content;
  }
  if (Array.isArray((message as { content?: unknown[] }).content)) {
    return ((message as { content: Array<{ type: string; text?: string }> }).content)
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text!)
      .join("");
  }
  return "";
}

function extractMessageDisplayText(message: AgentMessage): string | undefined {
  const value = (message as { role?: string; displayText?: unknown }).role === "displayUser"
    ? (message as { displayText?: unknown }).displayText
    : undefined;
  return typeof value === "string" ? value : undefined;
}

export function createAgent(options: QuantAgentOptions = {}): QuantAgentSession {
  return new QuantAgentHarnessSession(options);
}

export function updateSessionCtx(update: Partial<SessionCtx>): void {
  if (update.recentToolState) {
    Object.assign(sessionCtx.recentToolState, update.recentToolState);
  }
  Object.assign(sessionCtx, { ...update, recentToolState: sessionCtx.recentToolState });
}

export function getSessionCtx(): Readonly<SessionCtx> {
  return sessionCtx;
}

export function injectContext(input: string): string {
  return injectTurnContext(input, sessionCtx);
}

export function estimateTokens(message: AgentMessage): number {
  return piEstimateTokens(message);
}

export function estimateContextTokens(messages: AgentMessage[]): number {
  return piEstimateContextTokens(messages).tokens;
}

export function resolveModelId(model: string, env: Record<string, string>): string {
  const envKey = `WHYJ_DEFAULT_${model.toUpperCase()}_MODEL`;
  return env[envKey] || process.env[envKey] || inferModelId(model);
}

export function inferModelId(model: string): string {
  switch (model) {
    case "sonnet": return "deepseek-v4-pro";
    case "opus": return "deepseek-v4-pro";
    case "haiku": return "deepseek-v4-flash";
    case "deepseek": return "deepseek-v4-pro";
    case "gpt-5.5": return "openai/gpt-5.5";
    default: return model;
  }
}

function inferProvider(modelId: string): string {
  if (modelId.startsWith("openai/")) return "openrouter";
  if (modelId.startsWith("deepseek-")) return "deepseek";
  if (modelId.startsWith("claude-")) return "anthropic";
  if (modelId.startsWith("gpt-") || modelId.startsWith("o")) return "openai";
  if (modelId.startsWith("gemini-")) return "google";
  if (modelId.startsWith("mistral-")) return "mistral";
  return "deepseek";
}

function resolveModel(provider: string, id: string): Model<any> {
  const models = getModels(provider as KnownProvider);
  const model = models.find((candidate) => candidate.id === id);
  if (!model) {
    const prefix = models.find((candidate) => id.startsWith(candidate.id));
    if (prefix) return prefix;
    throw new Error(`pi-ai model not found: ${provider}/${id}`);
  }
  return model;
}

function extractThinkingFromMessage(m: { role?: string; content?: unknown[] }): string {
  if (!m.content || !Array.isArray(m.content)) return "";
  return (m.content as Array<{ type?: string; thinking?: string }>)
    .filter((c) => c.type === "thinking" && c.thinking)
    .map((c) => c.thinking!)
    .join("\n");
}

function inferResultShape(toolName: string, result?: unknown): string | null {
  const fromDetails = inferResultShapeFromDetails(toolName, result);
  if (fromDetails) return fromDetails;

  switch (toolName) {
    case "fetch_bars":
      return "bars_summary";
    case "search_symbols":
      return "symbol_list";
    case "fetch_snapshot":
      return "snapshot_kv";
    case "compute_factor":
      return "factor_metrics";
    case "run_backtest":
      return "backtest_metrics";
    case "check_risk":
      return "risk_metrics";
    case "score_benchmark":
      return "benchmark_score";
    case "show_dashboard":
      return "dashboard_ranking";
  }

  const text = extractToolResultText(result).toLowerCase();
  if (!text) return null;
  if (text.includes("total return") && text.includes("sharpe")) return "backtest_metrics";
  if (text.includes("var 95") && text.includes("cvar 95")) return "risk_metrics";
  if (text.includes("percentile") && text.includes("latest")) return "factor_metrics";
  if (text.includes("dashboard") && text.includes("evaluations")) return "dashboard_ranking";
  if (text.includes("score") && text.includes("grade")) return "benchmark_score";
  if (text.includes("snapshot")) return "snapshot_kv";
  return null;
}

function inferResultShapeFromDetails(toolName: string, result?: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return null;
  const record = details as Record<string, unknown>;

  if (toolName === "show_dashboard" && record.summary && typeof record.summary === "object") {
    return "dashboard_ranking";
  }
  if (toolName === "score_benchmark" && typeof record.filename === "string") {
    return "benchmark_score";
  }
  if (toolName === "check_risk" && typeof record.annualVol === "number") {
    return "risk_metrics";
  }
  if (toolName === "run_backtest" && typeof record.totalReturn === "number") {
    return "backtest_metrics";
  }
  if (toolName === "compute_factor" && typeof record.percentile === "number") {
    return "factor_metrics";
  }
  if (toolName === "search_symbols" && Array.isArray(record.rows)) {
    return "symbol_list";
  }
  if (toolName === "fetch_snapshot" && record.snapshot && typeof record.snapshot === "object") {
    return "snapshot_kv";
  }
  if (toolName === "fetch_bars" && typeof record.barCount === "number") {
    return "bars_summary";
  }

  return null;
}

function extractToolResultText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text!)
      .join("\n");
  }
  return "";
}
