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
import { ensureDirs, loadSettings, resolveSessionsDir } from "../../storage/index.ts";
import { readWhyjEnvValue, stripTerminalControlCodes } from "../../storage/index.ts";
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
  settings?: Partial<Pick<OhQuantSettings, "env" | "model" | "thinkingLevel" | "skillIntegrations">>;
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
  const provider = inferProvider(modelId, config.env);
  const model = resolveModel(provider, modelId, config.env);
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
    this.sessionsRoot = options.sessionsRoot ?? resolveSessionsDir();
    this.settingsOverride = options.settings;
    this.skillPaths = options.skillPaths ?? [];
    this.env = new NodeExecutionEnv({ cwd: this.cwd });
    this.repo = new JsonlSessionRepo({ fs: this.env, sessionsRoot: this.sessionsRoot });
    this.applyConfigToState(this.resolveSettings());
    this.ready = this.initialize();
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
    this.ready = this.initialize({ resumeSessionId: sessionId });
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
    this.ready = this.initialize();
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

  private async initialize(options: { resumeSessionId?: string } = {}): Promise<void> {
    const totalStartedAt = perfNow();
    const version = ++this.initVersion;
    ensureDirs();

    const configStartedAt = perfNow();
    const config = this.resolveSettings();
    const modelId = resolveModelId(config.model || "sonnet", config.env);
    const provider = inferProvider(modelId, config.env);
    const model = resolveModel(provider, modelId, config.env);
    perfLog("agent.init.config", configStartedAt, { model: modelId, provider });

    const skillsStartedAt = perfNow();
    const discovered = await discoverSkills({
      cwd: this.cwd,
      env: this.env,
      extraPaths: this.skillPaths,
      integrations: config.skillIntegrations,
    });
    perfLog("agent.init.skills", skillsStartedAt, { skills: discovered.skills.length });
    const systemPrompt = buildSystemPrompt(undefined, discovered.skills);

    this.applyConfigToState(config, model, systemPrompt);

    const sessionStartedAt = perfNow();
    const existing = options.resumeSessionId ? await this.repo.list({ cwd: this.cwd }) : [];
    let session: Session<JsonlSessionMetadata>;
    if (options.resumeSessionId) {
      const target = existing.find((item) => item.id === options.resumeSessionId);
      if (!target) throw new Error(`Session not found: ${options.resumeSessionId}`);
      session = await this.repo.open(target);
    } else {
      session = await this.repo.create({ cwd: this.cwd });
    }
    perfLog("agent.init.session", sessionStartedAt, { existing: existing.length, resume: Boolean(options.resumeSessionId) });

    const contextStartedAt = perfNow();
    const context = await session.buildContext();
    perfLog("agent.init.context", contextStartedAt, { messages: context.messages.length });
    if (this.initVersion !== version) return;

    this.skills = discovered.skills;
    this.session = session;
    applySessionContextState(this.state, context, model, config.env);

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
        const apiKey =
          readWhyjEnvValue(s.env, "apiKey")
          || readWhyjEnvValue(s.env, "authToken")
          || readWhyjEnvValue(process.env, "apiKey")
          || readWhyjEnvValue(process.env, "authToken");
        return apiKey ? { apiKey } : undefined;
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
    applySessionContextState(this.state, context, this.state.model, this.resolveSettings().env);
  }

  private resolveSettings(): OhQuantSettings {
    const base = loadSettings();
    return {
      ...base,
      env: { ...base.env, ...(this.settingsOverride?.env ?? {}) },
      model: this.settingsOverride?.model ?? base.model,
      thinkingLevel: this.settingsOverride?.thinkingLevel ?? base.thinkingLevel,
      skillIntegrations: this.settingsOverride?.skillIntegrations ?? base.skillIntegrations,
    };
  }

  private applyConfigToState(
    config: Pick<OhQuantSettings, "env" | "model" | "thinkingLevel">,
    model?: Model<any>,
    systemPrompt?: string,
  ): void {
    const resolvedModel = model
      ?? resolveModel(
        inferProvider(resolveModelId(config.model || "sonnet", config.env), config.env),
        resolveModelId(config.model || "sonnet", config.env),
        config.env,
      );
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
  env: Record<string, string>,
): void {
  state.messages = [...context.messages];
  if (context.thinkingLevel !== null) state.thinkingLevel = context.thinkingLevel;
  if (context.model) {
    try {
      state.model = resolveModel(context.model.provider, context.model.modelId, env);
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

function normalizeModelLookupId(modelId: string): string {
  return modelId.replace(/\[\d+m\]$/u, "");
}

function getUrlTail(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const segments = url.pathname.split("/").filter(Boolean);
    return (segments.at(-1) || "").toLowerCase();
  } catch {
    return "";
  }
}

function isAnthropicStyleEndpoint(baseUrl: string): boolean {
  const tail = getUrlTail(baseUrl);
  return tail === "anthropic" || baseUrl.includes("anthropic.com");
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

function inferProvider(modelId: string, env: Record<string, string>): string {
  const baseUrl = stripTerminalControlCodes(env.WHYJ_QUANT_BASE_URL || process.env.WHYJ_QUANT_BASE_URL || "");
  const lookupId = normalizeModelLookupId(modelId);
  if (isAnthropicStyleEndpoint(baseUrl)) return "anthropic";
  if (baseUrl.includes("open.bigmodel.cn") || baseUrl.includes("api.z.ai")) return "zai";
  if (baseUrl.includes("api.minimaxi.com") || baseUrl.includes("minimaxi.com")) return "minimax";
  if (lookupId.startsWith("openai/")) return "openrouter";
  if (lookupId.startsWith("deepseek-")) return "deepseek";
  if (lookupId.startsWith("claude-")) return "anthropic";
  if (lookupId.startsWith("gpt-") || lookupId.startsWith("o")) return "openai";
  if (lookupId.startsWith("gemini-")) return "google";
  if (lookupId.startsWith("mistral-")) return "mistral";
  return "deepseek";
}

function resolveModel(provider: string, id: string, env: Record<string, string>): Model<any> {
  const baseUrl =
    stripTerminalControlCodes(env.WHYJ_QUANT_BASE_URL || process.env.WHYJ_QUANT_BASE_URL || "");
  const lookupId = normalizeModelLookupId(id);
  const resolvedProvider = isAnthropicStyleEndpoint(baseUrl)
    ? "anthropic"
    : provider;

  const models = getModels(resolvedProvider as KnownProvider);
  const model = models.find((candidate) => candidate.id === lookupId);
  const resolved = model ? { ...model } : (() => {
    const prefix = models.find((candidate) => lookupId.startsWith(candidate.id));
    if (prefix) return { ...prefix };
    if (resolvedProvider === "anthropic") {
      const anthropicModel = buildAnthropicFallbackModel(lookupId, baseUrl || undefined);
      if (anthropicModel) return anthropicModel;
    }
    const genericModel = buildGenericFallbackModel(resolvedProvider, lookupId, baseUrl || undefined);
    if (genericModel) return genericModel;
    throw new Error(`pi-ai model not found: ${resolvedProvider}/${lookupId}`);
  })();
  if (baseUrl) {
    resolved.baseUrl = baseUrl;
  }
  return resolved;
}

function buildGenericFallbackModel(provider: string, id: string, baseUrl?: string): Model<"openai-completions"> | undefined {
  if (!baseUrl) return undefined;
  if (provider !== "zai" && provider !== "minimax" && provider !== "minimax-cn") return undefined;
  return {
    id,
    name: id,
    api: "openai-completions",
    provider: provider as "zai" | "minimax" | "minimax-cn",
    baseUrl,
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 128000,
  };
}

function buildAnthropicFallbackModel(id: string, baseUrl?: string): Model<any> | undefined {
  const anthropicBaseUrl = baseUrl || "https://api.anthropic.com";
  if (id.startsWith("deepseek-")) {
    const deepseekModels = getModels("deepseek" as KnownProvider);
    const template = deepseekModels.find((candidate) => candidate.id === id);
    if (!template) return undefined;
    return {
      ...template,
      provider: "anthropic",
      api: "anthropic-messages",
      baseUrl: anthropicBaseUrl,
    };
  }

  const genericAnthropicModel: Model<"anthropic-messages"> = {
    id,
    name: id,
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: anthropicBaseUrl,
    reasoning: true,
    thinkingLevelMap: { minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 128000,
  };

  switch (id) {
    case "claude-opus-4-6":
      return {
        id,
        name: "Claude Opus 4.6",
        api: "anthropic-messages",
        provider: "anthropic",
        baseUrl: anthropicBaseUrl,
        reasoning: true,
        thinkingLevelMap: { minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
        input: ["text", "image"],
        cost: { input: 5, output: 25, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 128000,
      };
    case "claude-sonnet-4-6":
      return {
        id,
        name: "Claude Sonnet 4.6",
        api: "anthropic-messages",
        provider: "anthropic",
        baseUrl: anthropicBaseUrl,
        reasoning: true,
        thinkingLevelMap: { minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
        input: ["text", "image"],
        cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 128000,
      };
    case "claude-haiku-4-5":
      return {
        id,
        name: "Claude Haiku 4.5",
        api: "anthropic-messages",
        provider: "anthropic",
        baseUrl: anthropicBaseUrl,
        reasoning: true,
        thinkingLevelMap: { minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
        input: ["text", "image"],
        cost: { input: 1, output: 5, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 128000,
      };
    default:
      return genericAnthropicModel;
  }
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
