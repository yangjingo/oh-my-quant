import type { Agent } from "@earendil-works/pi-agent-core";
import { parseCommand, executeCommand } from "./commands/registry.ts";
import { connectAll, getServerStatus, type McpServerStatus } from "./data/mcp-client.ts";
import { createAgent, injectContext, saveSession, updateSessionCtx } from "./agent/session.ts";
import { ensureDirs, loadSettings } from "./storage/index.ts";
import type { AppState, UIMessage } from "./tui/types.ts";

export interface AppRuntimeSnapshot {
  model: string;
  modelLabel: string;
  mcpStatuses: McpServerStatus[];
}

interface AppRuntimeCallbacks {
  onMessages: (messages: UIMessage[]) => void;
  onActivity: (activity: AppState["activity"]) => void;
  onComposerStatus?: (status: AppState["composerStatus"]) => void;
  onConfigRequest?: () => void;
  onTurnComplete?: () => void | Promise<void>;
}

const SHORT_MODEL: Record<string, string> = {
  "claude-sonnet-4-6": "sonnet",
  "claude-opus-4-7": "opus",
  "claude-haiku-4-5": "haiku",
  "deepseek-v4-pro": "deepseek",
};

export class AppRuntime {
  private agent: Agent | null = null;
  private busy = false;
  private messages: UIMessage[] = [];

  constructor(private readonly callbacks: AppRuntimeCallbacks) {}

  async init(): Promise<AppRuntimeSnapshot> {
    ensureDirs();
    const settings = loadSettings();

    for (const [key, value] of Object.entries(settings.env)) {
      if (value && !process.env[key]) process.env[key] = value;
    }

    this.callbacks.onActivity("starting");
    try {
      await connectAll();
    } catch {
      // MCP is optional for local startup.
    }

    this.agent = createAgent();
    this.agent.subscribe(async (event) => {
      switch (event.type) {
        case "message_start": {
          const m = event.message;
          if (m.role === "assistant") {
            this.messages.push({ role: "assistant", text: "" });
            this.upsertThinkingMessage("");
            this.flushMessages();
            this.callbacks.onActivity("thinking");
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
          this.removeThinkingMessages();
          this.messages.push({
            role: "tool",
            tool: { name: event.toolName, args: shortArgs(event.args), status: "running", startedAt: Date.now() },
          });
          this.flushMessages();
          this.callbacks.onActivity("running tool");
          break;
        }
        case "tool_execution_update": {
          const last = this.messages[this.messages.length - 1];
          if (last?.role === "tool" && last.tool) {
            last.tool.result = extractTextFromResult(event.partialResult);
            this.flushMessages();
          }
          break;
        }
        case "tool_execution_end": {
          const last = this.messages[this.messages.length - 1];
          if (last?.role === "tool" && last.tool) {
            last.tool.status = event.isError ? "error" : "done";
            last.tool.result = event.isError ? extractToolError(event.result) : extractTextFromResult(event.result);
            this.flushMessages();
          }
          break;
        }
        case "agent_end": {
          this.busy = false;
          this.callbacks.onActivity("ready");
          saveSession(event.messages as never[]);
          await this.callbacks.onTurnComplete?.();
          break;
        }
      }
    });

    this.callbacks.onActivity("ready");
    return {
      model: readModel(settings.env),
      modelLabel: readModelLabel(settings.env),
      mcpStatuses: getServerStatus(),
    };
  }

  async submit(input: string): Promise<"continue" | "exit"> {
    const trimmed = input.trim();
    if (!trimmed || this.busy) return "continue";
    const parsed = parseCommand(trimmed);
    const isSlash = trimmed.startsWith("/");

    if (trimmed === "/exit" || trimmed === "/quit") return "exit";

    if (trimmed === "/clear") {
      this.messages = [];
      this.flushMessages();
      this.callbacks.onComposerStatus?.(null);
      this.agent?.reset();
      this.callbacks.onActivity("ready");
      return "continue";
    }

    if (trimmed === "/config" || trimmed === "/setup" || trimmed === "/portfolio") {
      if (this.callbacks.onConfigRequest) {
        this.callbacks.onConfigRequest();
      } else {
        this.callbacks.onComposerStatus?.({ kind: "info", text: "Set API keys via .ohquant/settings.json and restart." });
      }
      this.callbacks.onActivity("ready");
      return "continue";
    }

    if (trimmed === "/help") {
      this.callbacks.onComposerStatus?.({ kind: "info", text: helpText });
      this.callbacks.onActivity("ready");
      return "continue";
    }

    if (!isSlash) {
      this.removeThinkingMessages();
      this.messages.push({ role: "user", text: trimmed });
      this.flushMessages();
      this.callbacks.onComposerStatus?.(null);
    }

    this.busy = true;
    this.callbacks.onActivity("thinking");
    if (parsed) {
      try {
        const result = await executeCommand(parsed);
        this.callbacks.onComposerStatus?.({
          kind: result.success ? "info" : "error",
          text: result.message,
        });
        if (parsed.flags["symbol"] || parsed.flags["code"]) {
          const sym = String(parsed.flags["symbol"] || parsed.flags["code"]);
          updateSessionCtx({
            lastSymbol: sym,
            lastMarket: String(parsed.flags["market"] || parsed.flags["m"] || "A"),
          });
        }
      } catch (err) {
        this.callbacks.onComposerStatus?.({
          kind: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      }
      this.busy = false;
      this.callbacks.onActivity("ready");
      await this.callbacks.onTurnComplete?.();
      return "continue";
    }

    if (!this.agent) {
      this.busy = false;
      this.callbacks.onComposerStatus?.({ kind: "error", text: "Initializing... please wait a moment." });
      this.callbacks.onActivity("ready");
      return "continue";
    }

    try {
      await this.agent.prompt(injectContext(trimmed));
    } catch (err) {
      this.busy = false;
      this.messages.push({ role: "error", text: `Agent: ${err instanceof Error ? err.message : String(err)}` });
      this.flushMessages();
      this.callbacks.onComposerStatus?.({ kind: "error", text: err instanceof Error ? err.message : String(err) });
      this.callbacks.onActivity("ready");
    }

    return "continue";
  }

  reset(): void {
    this.messages = [];
    this.flushMessages();
    this.agent?.reset();
    this.callbacks.onActivity("ready");
  }

  dispose(): void {
    this.agent?.abort();
  }

  private flushMessages(): void {
    this.callbacks.onMessages([...this.messages]);
  }

  private applyAssistantUpdate(m: { content: unknown[] }): void {
    const assistant = this.findLatestMessage("assistant");
    if (!assistant) return;
    assistant.text = extractText(m);
    const thinking = extractThinking(m);
    if (thinking && thinking.trim()) {
      this.upsertThinkingMessage(thinking);
    }
    if (assistant.text && assistant.text.trim()) this.removeThinkingMessages();
    this.flushMessages();
  }

  private applyAssistantEnd(m: { content: unknown[] }): void {
    const text = extractText(m);
    const stopReason = (m as Record<string, unknown>).stopReason;
    const isError = stopReason === "error" || stopReason === "aborted";
    this.removeThinkingMessages();
    const assistant = this.findLatestMessage("assistant");
    if (assistant) {
      assistant.text = isError ? `Agent error: ${text || `API call failed (${stopReason})`}` : text;
      if (isError) assistant.role = "error";
    } else if (isError) {
      this.messages.push({ role: "error", text: `Agent error: ${text || `API call failed (${stopReason})`}` });
    }
    this.flushMessages();
  }

  private findLatestMessage(role: UIMessage["role"]): UIMessage | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === role) return this.messages[i];
    }
    return undefined;
  }

  private upsertThinkingMessage(text: string): void {
    const existing = this.findLatestMessage("thinking");
    if (existing) existing.text = text;
    else this.messages.push({ role: "thinking", text });
  }

  private removeThinkingMessages(): void {
    this.messages = this.messages.filter((msg) => msg.role !== "thinking");
  }
}

export function createInitialAppState(version: string): AppState {
  const settings = loadSettings();
  const model = readModel(settings.env);
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
    composerStatus: null,
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

function extractThinking(m: { content: unknown[] }): string {
  return (m.content as Array<{ type?: string; thinking?: string }>)
    .filter((c) => c.type === "thinking" && c.thinking)
    .map((c) => c.thinking!)
    .join("\n");
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

function shortArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  return String(a.symbol || a.code || a.ts_code || a.ticker || a.factor || "");
}

export const helpText = [
  "Commands:",
  "",
  "  /data      Download/info      /data download --symbol 000001.SZ",
  "  /factor    Factor analysis    /factor analyze --symbol CODE --factor momentum",
  "  /backtest  SMA backtest       /backtest run --symbol CODE --fast 20 --slow 60",
  "  /risk      Risk metrics       /risk check --symbol CODE",
  "  /benchmark Score/dashboard    /benchmark run --symbol CODE",
  "  /add       Watchlist          /add stock --code CODE --name NAME",
  "  /config    Settings           /config",
  "  /mcp       Data servers       /mcp connect",
  "  /help  /clear  /exit",
  "",
  "Compatibility: /skill  /claw  /watch",
  "",
  "No / prefix -> AI analysis.",
].join("\n");
