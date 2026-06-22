import { formatCompletedToolLine, formatToolArgs, formatToolLine, toolDisplayLabel } from "./tools/catalog.ts";
import { buildCommandHelpText } from "./cli/catalog.ts";
import { executeCommand, isLocalSlashCommand, parseCommand } from "./cli/registry.ts";
import type { CommandEffect, CommandResult } from "./cli/types.ts";
import { fetchLiveBars, formatRefreshMinute, formatSourceLabels, type PullSource } from "./source/index.ts";
import { dispatchUserMessage, isAgentTurnActive } from "./agent/src/dispatch.ts";
import { createAgent, updateSessionCtx, type QuantAgentSession } from "./agent/src/session.ts";
import { skillPaths } from "./skill/index.ts";
import { ensureDirs, loadSettings, listLocalPortfolios, loadPanelPortfolio, loadPortfolioSymbols } from "./storage/index.ts";
import type { AppState, PanelSection, UIMessage } from "./tui/src/types.ts";
import type { CodeEntry } from "./tui/src/watchlist.ts";
import type { Bar, Market } from "./types/data.ts";
import type { CurrentSessionMeta } from "./tui/src/panel.ts";
import { perfLog, perfNow } from "./perf.ts";

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
  onResumeRequest?: (meta?: CurrentSessionMeta) => void;
  onPortfolioRequest?: () => void;
  onHelpRequest?: () => void;
  onSessionRequest?: (meta?: CurrentSessionMeta) => void;
  onPanel?: (panel: PanelSection[], loading?: boolean) => void;
}

type Quote = { code: string; name: string; price: number; pct: number };
type Holding = { code: string; name: string; price: number; pct: number };
type QuoteFetcher = (entries: CodeEntry[], meta: PullMeta) => Promise<Quote[]>;
type HoldingFetcher = (entries: CodeEntry[], meta: PullMeta) => Promise<Holding[]>;
type SymbolProvider = () => Promise<CodeEntry[]>;
type AgentFactory = () => QuantAgentSession;

interface PullMeta {
  sources: PullSource[];
  asOfDates: string[];
}

const SHORT_MODEL: Record<string, string> = {
  "claude-sonnet-4-6": "sonnet",
  "claude-opus-4-7": "opus",
  "claude-haiku-4-5": "haiku",
  "deepseek-v4-pro": "deepseek",
};

/** Fixed market indicators that should always lead the Overview panel. */
const MARKET_INDICES: CodeEntry[] = [
  { code: "000001.SH", name: "上证指数" },
  { code: "399001.SZ", name: "深证成指" },
  { code: "000300.SH", name: "沪深300" },
  { code: "000905.SH", name: "中证500" },
  { code: "399006.SZ", name: "创业板指" },
];

export function createRuntimeAgent(): QuantAgentSession {
  return createAgent({ skillPaths: skillPaths() });
}

export class AppRuntime {
  private agent: QuantAgentSession | null = null;
  /** Slash command in flight (panel refresh). Agent concurrency uses agent.state.isStreaming. */
  private slashRunning = false;
  private messages: UIMessage[] = [];
  /** After first successful Overview fetch, later refreshes stay in-place (no spinner wipe). */
  private overviewReady = false;
  private marketSections: PanelSection[] = [];
  private marketRefreshPromise: Promise<void> | null = null;

  constructor(
    private readonly callbacks: AppRuntimeCallbacks,
    private readonly quoteFetcher: QuoteFetcher = fetchQuotes,
    private readonly symbolProvider: SymbolProvider = loadPortfolioSymbols,
    private readonly holdingFetcher: HoldingFetcher = fetchHoldings,
    private readonly agentFactory: AgentFactory = createRuntimeAgent,
  ) {}

  async refreshOverviewPanel(): Promise<void> {
    await this.refreshMarketPanel();
  }

  /** Startup agent, then enter ready before blocking on market quotes. */
  async bootstrap(): Promise<AppRuntimeSnapshot> {
    const startedAt = perfNow();
    ensureDirs();
    const settings = loadSettings();

    for (const [key, value] of Object.entries(settings.env)) {
      if (value && !process.env[key]) process.env[key] = value;
    }

    this.setActivity("starting");

    const agentStartedAt = perfNow();
    this.agent = this.agentFactory();
    perfLog("runtime.agent.create", agentStartedAt);
    this.agent.subscribe(async (event) => {
      switch (event.type) {
        case "message_start": {
          const m = event.message;
          if (m.role === "user" || m.role === "displayUser") {
            this.addUserMessage(extractDisplayText(m));
            break;
          }
          if (m.role === "assistant") {
            const last = this.messages[this.messages.length - 1];
            const prev = this.messages[this.messages.length - 2];
            if (last?.role === "assistant" && prev?.role === "thinking" && prev.thinkingLive) {
              break;
            }
            this.messages.push({ role: "thinking", text: "", thinkingLive: true, startedAt: Date.now() });
            this.messages.push({ role: "assistant", text: "" });
            this.emitMessages();
            this.setActivity("thinking");
          }
          break;
        }
        case "message_update": {
          const m = event.message;
          if (m.role === "assistant") this.applyAssistantUpdate(m);
          break;
        }
        case "message_end": {
          const m = event.message;
          if (m.role === "assistant") this.applyAssistantEnd(m);
          break;
        }
        case "tool_execution_start": {
          this.finalizeThinking();
          const args = formatToolArgs(event.args, { truncate: false });
          this.messages.push({
            role: "tool",
            tool: {
              name: event.toolName,
              label: formatToolLine(event.toolName, args),
              args: args ?? "",
              status: "running",
              startedAt: Date.now(),
            },
          });
          this.emitMessages();
          this.setActivity("running tool");
          break;
        }
        case "tool_execution_update": {
          const last = this.messages[this.messages.length - 1];
          if (last?.role === "tool" && last.tool) {
            last.tool.result = extractTextFromResult(event.partialResult);
            this.emitMessages();
          }
          break;
        }
        case "tool_execution_end": {
          const last = this.messages[this.messages.length - 1];
          if (last?.role === "tool" && last.tool) {
            last.tool.status = event.isError ? "error" : "done";
            last.tool.result = event.isError ? extractToolError(event.result) : extractTextFromResult(event.result);
            last.tool.label = formatCompletedToolLine(
              last.tool.name,
              last.tool.args,
              last.tool.result,
              event.isError,
            );
            this.emitMessages();
          }
          break;
        }
        case "queue_update": {
          this.emitComposerQueue([
            ...event.steer.map((message) => extractAgentMessageText(message)),
            ...event.followUp.map((message) => extractAgentMessageText(message)),
            ...event.nextTurn.map((message) => extractAgentMessageText(message)),
          ]);
          break;
        }
        case "agent_end": {
          this.emitComposerQueue([]);
          this.scheduleMarketRefresh();
          this.setActivity("ready");
          break;
        }
      }
    });

    void this.agent.waitForIdle()
      .then(() => perfLog("runtime.agent.warmup", agentStartedAt))
      .catch(() => {});

    this.setActivity("ready");
    this.scheduleMarketRefresh();
    perfLog("runtime.bootstrap", startedAt);

    return {
      model: readModel(settings.env),
      modelLabel: readModelLabel(settings.env),
    };
  }

  async submit(input: string): Promise<"continue" | "exit"> {
    const trimmed = input.trim();
    if (!trimmed) return "continue";

    if (trimmed === "/exit" || trimmed === "/quit") return "exit";

    const parsed = parseCommand(trimmed);
    const localOnly = parsed ? isPureLocalCommand(parsed) : false;

    if (parsed) {
      if (this.slashRunning && !localOnly) return "continue";
      if (isAgentTurnActive(this.agent) && !localOnly) return "continue";
      if (!localOnly) this.slashRunning = true;
      await this.runSlashCommand(parsed, localOnly);
      return "continue";
    }

    if (this.slashRunning) return "continue";
    await this.runAgentPrompt(trimmed);
    return "continue";
  }

  dispose(): void {
    this.agent?.abort();
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
    const isSkillInvoke = parsed.command === "skill" && parsed.positional[0] && !["list", "info"].includes(parsed.positional[0]);
    const isCompactCommand = parsed.command === "compact";
    const skillName = isSkillInvoke ? parsed.positional[0] : "";
    if (isSkillInvoke) {
      this.messages.push({
        role: "skill",
        skill: { name: skillName, label: `skill:${skillName}`, status: "running", startedAt: Date.now() },
      });
      this.emitMessages();
      this.setActivity("running tool");
    }
    if (isCompactCommand) {
      this.setActivity("compacting");
      this.setStatus({
        kind: "info",
        text: isAgentTurnActive(this.agent)
          ? "Waiting for the active turn to settle before compacting the session context..."
          : "Compacting the current session context...",
      });
    }

    try {
      const result = await executeCommand(parsed, {
        openConfig: this.callbacks.onConfigRequest
          ? () => { this.callbacks.onConfigRequest!(); }
          : undefined,
        openResume: this.callbacks.onResumeRequest
          ? () => { void this.collectCurrentSessionMeta().then(meta => this.callbacks.onResumeRequest?.(meta)); }
          : undefined,
        openPortfolio: this.callbacks.onPortfolioRequest
          ? () => { this.callbacks.onPortfolioRequest!(); }
          : undefined,
        openHelp: this.callbacks.onHelpRequest
          ? () => { this.callbacks.onHelpRequest!(); }
          : undefined,
        openSession: (this.callbacks.onSessionRequest || this.callbacks.onResumeRequest)
          ? () => { void this.collectCurrentSessionMeta().then(meta => (this.callbacks.onSessionRequest ?? this.callbacks.onResumeRequest)?.(meta)); }
          : undefined,
        agentSession: this.agent,
      });
      this.applyCommandResult(result);
      if (isSkillInvoke) this.finalizeSkillMessage(!result.success);
      updateLastSymbol(parsed.flags);
    } catch (err) {
      if (isSkillInvoke) this.finalizeSkillMessage(true);
      this.setStatus({ kind: "error", text: formatSlashRuntimeError(parsed.command, err) });
    } finally {
      this.scheduleMarketRefresh();
      if (!localOnly) this.slashRunning = false;
      if (!isAgentTurnActive(this.agent)) this.setActivity("ready");
    }
  }

  private applyCommandResult(result: CommandResult): void {
    for (const effect of result.effects ?? []) {
      this.applyCommandEffect(effect);
    }
    if (result.message) {
      if (shouldRenderCommandResultAsMessage(result.message)) {
        this.pushLocalCommandMessage(result.message, result.success ? "assistant" : "error");
        this.setStatus(null);
      } else {
        this.setStatus({ kind: result.success ? "info" : "error", text: result.message });
      }
    }
  }

  private applyCommandEffect(effect: CommandEffect): void {
    switch (effect.type) {
      case "clearConversation":
        this.messages = [];
        this.emitComposerQueue([]);
        this.emitMessages();
        this.setStatus(null);
        this.syncOverviewPanel();
        break;
      case "resetAgent":
        this.agent?.abort();
        this.agent?.clearAllQueues();
        this.agent?.reset();
        this.emitComposerQueue([]);
        this.syncOverviewPanel();
        break;
      case "openConfig":
        this.callbacks.onConfigRequest?.();
        break;
      case "openResume":
        void this.collectCurrentSessionMeta().then(meta => this.callbacks.onResumeRequest?.(meta));
        break;
      case "openSession":
        void this.collectCurrentSessionMeta()
          .then(meta => (this.callbacks.onSessionRequest ?? this.callbacks.onResumeRequest)?.(meta));
        break;
      case "openPortfolio":
        this.callbacks.onPortfolioRequest?.();
        break;
      case "openHelp":
        this.callbacks.onHelpRequest?.();
        break;
      case "compactSession":
        this.syncMessagesFromAgentState();
        break;
      case "sessionChanged":
        this.syncMessagesFromAgentState();
        void this.collectCurrentSessionMeta()
          .then(meta => this.callbacks.onSessionRequest?.(meta))
          .catch(() => {});
        break;
      case "portfolioChanged":
        this.emitLocalStorageState();
        void this.refreshMarketPanel().catch(() => this.setMarketUnavailable());
        break;
    }
  }

  private emitLocalStorageState(): void {
    const settings = loadSettings();
    const portfolioFile = settings.preferences.currentPortfolioFile || "holdings.json";
    const portfolios = listLocalPortfolios();
    const activePortfolio = portfolios.find((p) => p.fileName === portfolioFile)?.name || portfolioFile;
    this.callbacks.onLocalState?.({
      activePortfolio,
      source: settings.preferences.source || "llmquant-data",
      showPortfolioPanel: settings.showPortfolioPanel !== false,
    });
  }

  private async runAgentPrompt(input: string): Promise<void> {
    if (!this.agent) {
      this.emitComposerQueue([input]);
      this.setActivity("thinking");
      this.setStatus({ kind: "info", text: "Agent is still starting. Your message is kept in the composer; send it again in a moment." });
      this.setActivity("ready");
      return;
    }
    try {
      const startedAt = perfNow();
      await dispatchUserMessage(this.agent, input, input);
      perfLog("runtime.agent.dispatch", startedAt);
    } catch (err) {
      this.emitComposerQueue([]);
      const message = errorText(err);
      this.messages.push({ role: "error", text: formatAgentError("Agent", message) });
      this.emitMessages();
      this.setStatus({ kind: "error", text: agentStatusText(message) });
      if (!isAgentTurnActive(this.agent)) this.setActivity("ready");
    }
  }

  private emitComposerQueue(queue: string[]): void {
    this.callbacks.onComposerQueue?.([...queue]);
  }

  private addUserMessage(text: string): void {
    this.finalizeThinking();
    this.messages.push({ role: "user", text });
    this.emitMessages();
    this.setStatus(null);
  }

  private pushLocalCommandMessage(text: string, role: "assistant" | "error"): void {
    this.finalizeThinking();
    this.messages.push({ role, text });
    this.emitMessages();
  }

  private syncMessagesFromAgentState(): void {
    const agentMessages = this.agent?.state.messages ?? [];
    this.messages = agentMessages
      .map((message) => toUiMessage(message))
      .filter((message): message is UIMessage => message !== null);
    this.emitMessages();
  }

  private emitMessages(): void {
    this.callbacks.onMessages([...this.messages]);
  }

  private setActivity(activity: AppState["activity"]): void {
    this.callbacks.onActivity(activity);
  }

  private setStatus(status: AppState["composerStatus"]): void {
    this.callbacks.onComposerStatus?.(status);
  }

  private setPanel(panel: PanelSection[], loading = false): void {
    this.callbacks.onPanel?.(panel, loading);
  }

  private syncOverviewPanel(loading = false): void {
    const sections = [...this.marketSections];
    if (!this.overviewReady && sections.length === 0) {
      this.setPanel([{ kind: "keyvalue", title: "Market Refresh", rows: [{ label: "status", value: "fetching" }] }], true);
      return;
    }
    this.setPanel(sections, loading);
  }

  private static readonly MARKET_REFRESH_TIMEOUT_MS = 30_000;

  private scheduleMarketRefresh(): void {
    if (this.marketRefreshPromise) return;
    if (!this.overviewReady) this.syncOverviewPanel(true);
    const startedAt = perfNow();
    this.marketRefreshPromise = this.refreshMarketPanel()
      .then(() => perfLog("runtime.market.refresh", startedAt, { background: true }))
      .catch(() => this.setMarketUnavailable())
      .finally(() => {
        this.marketRefreshPromise = null;
      });
  }

  private async refreshMarketPanel(): Promise<void> {
    if (!this.overviewReady) this.syncOverviewPanel(true);
    await Promise.race([
      this.pullMarketPanel(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("Overview market refresh timed out")),
          AppRuntime.MARKET_REFRESH_TIMEOUT_MS,
        );
      }),
    ]);
  }

  private async pullMarketPanel(): Promise<void> {
    const refreshedAt = new Date();
    const pullMeta: PullMeta = { sources: [], asOfDates: [] };
    const panelPortfolio = loadPanelPortfolio();
    const groups = panelPortfolio.groups ?? [];
    const allSymbols = panelPortfolio.symbols.map(s => ({ code: s.code, name: s.name || s.code }));
    const [marketQuotes, portfolioRows] = await Promise.all([
      this.quoteFetcher(MARKET_INDICES, pullMeta),
      this.holdingFetcher(allSymbols, pullMeta),
    ]);
    const sections: PanelSection[] = [];
    if (allSymbols.length > 0) {
      const rowsByCode = new Map<string, Holding>();
      for (const row of portfolioRows) {
        rowsByCode.set(row.code, row);
      }
      const fallbackRows = allSymbols.map((entry) => ({
        code: entry.code.split(".")[0] || entry.code,
        name: entry.name || entry.code,
        price: 0,
        pct: 0,
      }));
      const fallbackByCode = new Map<string, Holding>();
      for (const row of fallbackRows) {
        fallbackByCode.set(row.code, row);
      }
      const getRow = (code: string): Holding => {
        const baseCode = code.split(".")[0] || code;
        return rowsByCode.get(code) || rowsByCode.get(baseCode) || fallbackByCode.get(code) || fallbackByCode.get(baseCode) || {
          code: baseCode,
          name: allSymbols.find(s => s.code === code || s.code === baseCode)?.name || code,
          price: 0,
          pct: 0,
        };
      };
      if (groups.length > 0) {
        for (const group of groups) {
          const groupRows = group.symbolCodes.map(code => getRow(code));
          sections.push({
            kind: "group",
            groupId: group.id,
            title: group.name,
            rows: groupRows,
            collapsed: false,
          });
        }
      } else {
        const rows = portfolioRows.length > 0 ? portfolioRows : fallbackRows;
        sections.push({ kind: "holdings", title: "Portfolio", rows });
      }
    }
    if (marketQuotes.length > 0) {
      sections.push({ kind: "quotes", title: "Market", rows: marketQuotes });
    } else {
      sections.push({ kind: "keyvalue", title: "Market", rows: [{ label: "data", value: "unavailable" }] });
    }
    sections.push(buildSourceSection(pullMeta, refreshedAt));
    this.marketSections = sections;
    this.overviewReady = true;
    this.syncOverviewPanel();
  }

  private setMarketUnavailable(): void {
    this.overviewReady = true;
    this.marketSections = [{ kind: "keyvalue", title: "Market", rows: [{ label: "data", value: "unavailable" }] }];
    this.syncOverviewPanel();
  }

  private applyAssistantUpdate(m: { content: unknown[] }): void {
    const assistant = this.findLatestMessage("assistant");
    if (!assistant) return;
    const thinking = this.agent?.state.thinkingText ?? "";
    if (thinking.trim()) this.upsertThinkingMessage(thinking);
    assistant.text = extractText(m);
    this.emitMessages();
  }

  private applyAssistantEnd(m: { content: unknown[] }): void {
    const text = extractText(m);
    const thinking = this.agent?.state.thinkingText ?? "";
    const raw = m as Record<string, unknown>;
    const stopReason = raw.stopReason;
    const errorMessage = typeof raw.errorMessage === "string" ? raw.errorMessage : undefined;
    const isError = stopReason === "error" || stopReason === "aborted";
    if (thinking.trim()) this.upsertThinkingMessage(thinking);
    this.finalizeThinking();
    this.removeTrailingThinkingAfterAssistant();
    const assistant = this.findLatestMessage("assistant");
    const errText = errorMessage || text || providerStopReasonText(stopReason);
    if (assistant) {
      assistant.text = isError ? formatAgentError("Agent error", errText) : text;
      if (isError) assistant.role = "error";
    } else if (isError) {
      this.messages.push({ role: "error", text: formatAgentError("Agent error", errText) });
    }
    this.setActivity("ready");
    this.emitMessages();
  }

  private findLatestMessage(role: UIMessage["role"]): UIMessage | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === role) return this.messages[i];
    }
    return undefined;
  }

  private findPairedThinking(): UIMessage | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role !== "assistant") continue;
      const prev = this.messages[i - 1];
      return prev?.role === "thinking" ? prev : undefined;
    }
    return undefined;
  }

  private upsertThinkingMessage(text: string): void {
    const paired = this.findPairedThinking();
    if (paired) {
      paired.text = text;
      return;
    }
    const assistant = this.findLatestMessage("assistant");
    if (assistant) {
      const idx = this.messages.indexOf(assistant);
      this.messages.splice(idx, 0, { role: "thinking", text, thinkingLive: true, startedAt: Date.now() });
      return;
    }
    this.messages.push({ role: "thinking", text, thinkingLive: true, startedAt: Date.now() });
  }

  private finalizeThinking(): void {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.role !== "thinking" || !msg.thinkingLive) continue;
      msg.thinkingLive = false;
      if (!msg.text?.trim()) this.messages.splice(i, 1);
      return;
    }
  }

  private finalizeSkillMessage(isError: boolean): void {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.role !== "skill" || msg.skill?.status !== "running") continue;
      if (msg.skill) msg.skill.status = isError ? "error" : "done";
      this.emitMessages();
      return;
    }
  }

  private removeTrailingThinkingAfterAssistant(): void {
    let lastAssistant = -1;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "assistant") {
        lastAssistant = i;
        break;
      }
    }
    if (lastAssistant < 0) return;
    this.messages = this.messages.filter((msg, idx) => {
      if (idx <= lastAssistant) return true;
      return msg.role !== "thinking";
    });
  }
}

function shouldRenderCommandResultAsMessage(text: string): boolean {
  return text.includes("\n") || text.length > 120;
}

function toUiMessage(message: unknown): UIMessage | null {
  const role = (message as { role?: string }).role;
  const text = extractAgentMessageText(message);
  if (role === "user" || role === "displayUser") return { role: "user", text };
  if (role === "assistant") return { role: "assistant", text };
  return null;
}

function extractAgentMessageText(message: unknown): string {
  const displayText = extractMessageDisplayText(message);
  if (displayText) return displayText;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type?: string; text?: string; thinking?: string } => typeof part === "object" && part !== null)
    .filter((part) => part.type === "text" || part.type === "thinking")
    .map((part) => part.text ?? part.thinking ?? "")
    .join("\n");
}

export function createInitialAppState(version: string): AppState {
  const settings = loadSettings();
  const model = readModel(settings.env);
  const portfolioFile = settings.preferences.currentPortfolioFile || "holdings.json";
  const portfolios = listLocalPortfolios();
  const activePortfolio = portfolios.find((p) => p.fileName === portfolioFile)?.name || portfolioFile;
  return {
    model,
    modelLabel: readModelLabel(settings.env),
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
    activePortfolio,
    source: settings.preferences.source || "llmquant-data",
    showPortfolioPanel: settings.showPortfolioPanel !== false,
  };
}

function readModel(env: Record<string, string>): string {
  return env.WHYJ_DEFAULT_SONNET_MODEL || "deepseek-v4-pro";
}

function readModelLabel(env: Record<string, string>): string {
  const model = readModel(env);
  return SHORT_MODEL[model] || model.split("-").pop() || model;
}

function extractText(m: { content: unknown[] }): string {
  return (m.content as Array<{ type?: string; text?: string }>)
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("");
}

function extractMessageDisplayText(message: unknown): string | undefined {
  const displayText = (message as { role?: string; displayText?: unknown }).role === "displayUser"
    ? (message as { displayText?: unknown }).displayText
    : undefined;
  return typeof displayText === "string" ? displayText : undefined;
}

function extractDisplayText(message: unknown): string {
  return extractAgentMessageText(message);
}

function extractTextFromResult(result: unknown): string {
  if (!result) return "";
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.content)) {
    return (r.content as Array<{ text?: string }>)
      .filter((c) => c.text)
      .map((c) => c.text!)
      .join("\n");
  }
  if (typeof r.text === "string") return r.text;
  return typeof result === "string" ? result : "";
}

function extractToolError(result: unknown): string {
  if (!result || typeof result !== "object") return "Tool execution failed";
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.content)) {
    const first = (r.content as Array<Record<string, unknown>>)[0];
    return String(first?.text ?? "Tool execution failed");
  }
  return "Tool execution failed";
}

function updateLastSymbol(flags: Record<string, unknown>): void {
  const symbol = flags["symbol"] || flags["code"];
  if (!symbol) return;
  updateSessionCtx({
    lastSymbol: String(symbol),
    lastMarket: String(flags["market"] || flags["m"] || "A"),
  });
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatSlashRuntimeError(command: string, err: unknown): string {
  const message = errorText(err);
  if (/^Session not found:/i.test(message)) {
    const sessionId = message.split(":").slice(1).join(":").trim();
    return sessionId
      ? `Could not find session "${sessionId}". Run /resume to see saved sessions, then choose one of them.`
      : "Could not find that session. Run /resume to see saved sessions, then choose one of them.";
  }
  if (/Agent harness not initialized/i.test(message)) {
    return `/${command} needs an active agent session. Send any AI message first, then try again.`;
  }
  if (/Nothing to compact/i.test(message)) {
    return "Nothing to compact. The current session context is already small enough.";
  }
  return message;
}

function formatAgentError(prefix: string, message: string): string {
  const hint = agentErrorHint(message);
  return hint ? `${prefix}: ${message}\nHint: ${hint}` : `${prefix}: ${message}`;
}

function agentStatusText(message: string): string {
  if (agentErrorHint(message)) return "Agent request failed. See the message above for the cause and next step.";
  return "Agent request failed. Check the conversation error above, then retry.";
}

function providerStopReasonText(stopReason: unknown): string {
  if (stopReason === "aborted") return "The agent response was interrupted before it finished.";
  if (stopReason === "error") return "The provider ended the response with an error.";
  return `The provider ended the response unexpectedly (${String(stopReason || "unknown")}).`;
}

function agentErrorHint(message: string): string | null {
  const text = message.toLowerCase();
  if (/\bconnection error\b/i.test(message)) {
    return "Network connection to the agent provider failed. The client may already have retried automatically; if it still fails, check your network/proxy settings and send the message again.";
  }
  if (
    /\b(econnrefused|econnreset|etimedout|enotfound|socket hang up|fetch failed)\b/i.test(message)
    || /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(message)
  ) {
    return "Agent API endpoint is unreachable. Check the local API service/port, proxy settings, and the configured base URL.";
  }
  if (/\b(401|403|unauthorized|forbidden|invalid api key|missing api key)\b/i.test(message)) {
    return "Check WHYJ_QUANT_API_KEY and WHYJ_QUANT_BASE_URL in /config. WHYJ_QUANT_AUTH_TOKEN is kept for legacy setups.";
  }
  if (/\b(404|model not found|not_found)\b/i.test(message)) {
    return "Check the configured model and provider endpoint. If WHYJ_QUANT_BASE_URL points to /anthropic, the runtime will use Anthropic Messages automatically, but the model name still has to exist on that endpoint.";
  }
  if (/\b(429|rate limit|too many requests)\b/i.test(message)) {
    return "The provider is rate limiting requests. Wait briefly or switch to another configured model/provider.";
  }
  if (/\b(500|502|503|504|bad gateway|service unavailable|gateway timeout)\b/i.test(message)) {
    return "The provider returned a server-side error. Retry later or switch the Agent API endpoint/provider.";
  }
  if (text.includes("api") && (text.includes("port") || text.includes("endpoint") || text.includes("base url"))) {
    return "Verify the Agent API base URL, port, and provider configuration in /config.";
  }
  return null;
}


async function fetchQuotes(entries: CodeEntry[], meta: PullMeta): Promise<Quote[]> {
  return Promise.all(entries.map(async (entry) => {
    try {
      const bars = await fetchQuoteBars(entry.code, meta);
      const quote = quoteFromBars(entry, bars);
      if (quote) return quote;
    } catch {
      // Fall through to placeholder row so fixed indices always render.
    }
    return {
      code: entry.code.split(".")[0] || entry.code,
      name: entry.name || entry.code,
      price: 0,
      pct: 0,
    };
  }));
}

async function fetchHoldings(entries: CodeEntry[], meta: PullMeta): Promise<Holding[]> {
  return Promise.all(entries.map(async (entry) => {
    try {
      const bars = await fetchQuoteBars(entry.code, meta);
      const row = holdingFromBars(entry, bars);
      if (row) return row;
    } catch {
      // Fall through to placeholder row.
    }
    return {
      code: entry.code.split(".")[0] || entry.code,
      name: entry.name || entry.code,
      price: 0,
      pct: 0,
    };
  }));
}

async function fetchQuoteBars(symbol: string, meta: PullMeta): Promise<Bar[]> {
  const market = inferMarket(symbol);
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { bars, source, asOfDate } = await fetchLiveBars(symbol, market, start, end);
  meta.sources.push(source);
  if (asOfDate) meta.asOfDates.push(asOfDate);
  return bars.sort((a, b) => a.date.localeCompare(b.date));
}

function buildSourceSection(meta: PullMeta, refreshedAt: Date): PanelSection {
  const asOfDate = meta.asOfDates.sort().at(-1) ?? refreshedAt.toISOString().slice(0, 10);
  return {
    kind: "keyvalue",
    title: "Source",
    rows: [
      { label: "来源", value: formatSourceLabels(meta.sources) },
      { label: "更新", value: formatRefreshMinute(refreshedAt) },
      { label: "数据", value: asOfDate },
    ],
  };
}

function quoteFromBars(entry: CodeEntry, bars: Bar[]): Quote | null {
  if (bars.length < 2) return null;
  const prev = bars[bars.length - 2];
  const last = bars[bars.length - 1];
  return {
    code: entry.code.split(".")[0] || entry.code,
    name: entry.name || entry.code,
    price: last.close,
    pct: prev.close ? (last.close - prev.close) / prev.close * 100 : 0,
  };
}

function holdingFromBars(entry: CodeEntry, bars: Bar[]): Holding | null {
  if (bars.length < 2) return null;
  const prev = bars[bars.length - 2];
  const last = bars[bars.length - 1];
  return {
    code: entry.code.split(".")[0] || entry.code,
    name: entry.name || entry.code,
    price: last.close,
    pct: prev.close ? (last.close - prev.close) / prev.close * 100 : 0,
  };
}

function inferMarket(symbol: string): Market {
  if (/\.HK$/i.test(symbol)) return "HK";
  if (/^[A-Z][A-Z0-9.-]*$/i.test(symbol) && !/^\d{6}/.test(symbol)) return "US";
  return "A";
}

export const helpText = buildCommandHelpText();

function isPureLocalCommand(parsed: NonNullable<ReturnType<typeof parseCommand>>): boolean {
  // skill list/info are local; skill:name, skill run, skill trigger need agent
  if (parsed.command === "skill" && parsed.positional[0] && !["list", "info"].includes(parsed.positional[0])) return false;
  return isLocalSlashCommand(parsed.command);
}
