/**
 * AgentSession — pi Agent wrapper with session management, context compaction, and persistence.
 * Patterns from pi/src/harness/agent-harness.ts + compaction/compaction.ts.
 */
import { Agent, type AgentMessage, type StreamFn } from "@earendil-works/pi-agent-core";
import {
  getEnvApiKey,
  getModels,
  streamSimple,
  type KnownProvider,
  type Message,
  type Model,
} from "@earendil-works/pi-ai";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MCP_TOOLS } from "../tools/mcp-tools.ts";
import { COMPUTE_TOOLS } from "../tools/quant-tools.ts";
import { buildSystemPrompt, injectSessionContext, type SessionCtx } from "./context.ts";
import { SESSIONS_DIR, DATA_DIR, loadSettings, ensureDirs } from "../storage/index.ts";
import { emitFileEvent } from "../storage/fs-events.ts";

// ── Constants (from pi: DEFAULT_COMPACTION_SETTINGS) ──

/** Estimated context window for our models (deepseek-v4-pro: 128k). Reserve 16k for output. */
const CONTEXT_WINDOW = 128_000;
const RESERVE_TOKENS = 16_384;
/** Keep ~24k tokens of recent context after compaction. */
const KEEP_RECENT_TOKENS = 24_000;
/** Trigger compaction when context exceeds ~80% of window. */
const COMPACTION_THRESHOLD = CONTEXT_WINDOW - RESERVE_TOKENS;

// ── Session state ──

const sessionCtx: SessionCtx = {
  lastSymbol: null,
  lastMarket: null,
  lastStartDate: null,
  lastEndDate: null,
};

let compactionCount = 0;

// ── createAgent ──

export function createAgent(): Agent {
  const config = loadSettings();

  const modelId = resolveModelId(config.model || "sonnet", config.env);
  const provider = inferProvider(modelId);
  const model = resolveModel(provider, modelId);

  const systemPrompt = buildSystemPrompt();

  const agent = new Agent({
    sessionId: `whyj-${Date.now()}`,
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: (config.thinkingLevel as any) ?? "off",
      tools: [...MCP_TOOLS, ...COMPUTE_TOOLS],
    },
    convertToLlm,
    streamFn: streamSimple as StreamFn,
    // Load from settings.json each call — picks up changes after /config
    getApiKey: () => {
      return loadSettings().env["WHYJ_AUTH_TOKEN"]
        ?? loadSettings().env["WHYJ_API_KEY"]
        ?? undefined;
    },

    transformContext: async (messages, _signal) => {
      const estimated = estimateContextTokens(messages);
      if (estimated >= COMPACTION_THRESHOLD) return compactMessages(messages);
      return messages;
    },

    transport: "auto",
    maxRetryDelayMs: 60_000,
    toolExecution: "sequential",
    steeringMode: "one-at-a-time",
    followUpMode: "one-at-a-time",
  });

  return agent;
}

// ── LLM message conversion (from pi: harness/messages.ts convertToLlm) ──

function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages
    .filter((m): m is Message => m.role === "user" || m.role === "assistant" || m.role === "toolResult");
}

// ── Token estimation (from pi: compaction/compaction.ts estimateTokens) ──

const ESTIMATED_IMAGE_CHARS = 4800;

function safeJsonStringify(value: unknown): string {
  try { return JSON.stringify(value) ?? "undefined"; } catch { return "[unserializable]"; }
}

export function estimateTokens(message: AgentMessage): number {
  let chars = 0;
  switch (message.role) {
    case "user": {
      const content = (message as { content: string | Array<{ type: string; text?: string }> }).content;
      if (typeof content === "string") { chars = content.length; } else {
        for (const block of content) {
          if (block.type === "text" && block.text) chars += block.text.length;
          else if (block.type === "image") chars += ESTIMATED_IMAGE_CHARS;
        }
      }
      return Math.ceil(chars / 4);
    }
    case "assistant": {
      const assistant = message as { content: Array<{ type: string; text?: string; thinking?: string; name?: string; arguments?: unknown }> };
      for (const block of assistant.content) {
        if (block.type === "text") chars += block.text?.length ?? 0;
        else if (block.type === "thinking") chars += block.thinking?.length ?? 0;
        else if (block.type === "toolCall") chars += (block.name?.length ?? 0) + safeJsonStringify(block.arguments).length;
      }
      return Math.ceil(chars / 4);
    }
    case "toolResult": {
      const content = message.content as Array<{ type: string; text?: string }>;
      for (const block of content) {
        if (block.type === "text" && block.text) chars += block.text.length;
        else if (block.type === "image") chars += ESTIMATED_IMAGE_CHARS;
      }
      return Math.ceil(chars / 4);
    }
    default: return 0;
  }
}

export function estimateContextTokens(messages: AgentMessage[]): number {
  let tokens = 0;
  for (const msg of messages) {
    tokens += estimateTokens(msg);
  }
  return tokens;
}

// ── Lightweight compaction (from pi: compaction/compaction.ts compact()) ──

/**
 * Compact old messages by inserting a summary at the front.
 * Keeps KEEP_RECENT_TOKENS worth of recent messages intact.
 * Does NOT call LLM for summarization — uses a simple heuristic summary.
 */
function compactMessages(messages: AgentMessage[]): AgentMessage[] {
  compactionCount++;

  // Walk backwards to find the cut point
  let accumulated = 0;
  let cutIndex = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    accumulated += estimateTokens(messages[i]);
    if (accumulated >= KEEP_RECENT_TOKENS) {
      // Find next user message boundary (from pi: findValidCutPoints)
      cutIndex = i;
      for (let j = i; j < messages.length; j++) {
        if (messages[j].role === "user") {
          cutIndex = j;
          break;
        }
      }
      break;
    }
  }

  if (cutIndex <= 0) return messages;

  const oldMessages = messages.slice(0, cutIndex);
  const recentMessages = messages.slice(cutIndex);

  // Build heuristic summary (from pi: SUMMARIZATION_PROMPT format)
  const summary = buildHeuristicSummary(oldMessages);

  // Create compaction summary message as a user message (from pi: createCompactionSummaryMessage)
  const compactionMsg: AgentMessage = {
    role: "user",
    content: [
      {
        type: "text",
        text: `## Context compaction #${compactionCount}\nPrevious ${oldMessages.length} messages summarized (≈${estimateContextTokens(oldMessages)} tokens):\n\n${summary}`,
      },
    ],
    timestamp: Date.now(),
  };

  return [compactionMsg, ...recentMessages];
}

// ── Heuristic summary builder (pi: generateSummary format, no LLM call) ──

function buildHeuristicSummary(messages: AgentMessage[]): string {
  const userMessages: string[] = [];
  const assistantActions: string[] = [];
  const symbols = new Set<string>();

  for (const msg of messages) {
    if (msg.role === "user") {
      const text = extractMessageText(msg);
      if (text) userMessages.push(text.slice(0, 200));
    }
    if (msg.role === "assistant") {
      for (const block of msg.content) {
        if (block.type === "toolCall") {
          assistantActions.push(`${block.name}(${safeJsonStringify(block.arguments).slice(0, 80)})`);
          const args = block.arguments as Record<string, unknown>;
          if (args.symbol || args.ts_code || args.ticker) {
            symbols.add(String(args.symbol || args.ts_code || args.ticker));
          }
        }
      }
    }
    if (msg.role === "toolResult") {
      const text = extractMessageText(msg);
      if (text && text.includes("bars for")) {
        const m = text.match(/[\d.]+ bars for (\S+)/);
        if (m) symbols.add(m[1]);
      }
    }
  }

  const lines = [
    "## Activity Summary",
    `**User queries (${userMessages.length}):**`,
    ...userMessages.slice(-5).map((q) => `- ${q}`),
    symbols.size > 0 ? `\n**Symbols analyzed:** ${[...symbols].join(", ")}` : "",
    assistantActions.length > 0 ? `\n**Tools called (${assistantActions.length}):** ${assistantActions.slice(0, 10).join("; ")}` : "",
  ];

  return lines.filter(Boolean).join("\n");
}

function extractMessageText(msg: { content: unknown }): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c): c is { type: "text"; text: string } => (c as { type: string }).type === "text")
      .map((c) => c.text)
      .join(" ");
  }
  return "";
}

// ── Session persistence (from pi: Session + JSONL repo pattern) ──

export function saveSession(messages: AgentMessage[], label?: string): void {
  ensureDirs();
  const now = new Date();
  const dateDir = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 19).replace(/:/g, "");
  const dir = join(SESSIONS_DIR, dateDir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    emitFileEvent({ operation: "MKDIR", path: dir, detail: "session" });
  }

  const lines: string[] = [
    `# Session ${dateDir} ${timeStr}`,
    label ? `\n> ${label}\n` : "",
    "",
  ];

  for (const msg of messages) {
    const time = msg.timestamp ? new Date(msg.timestamp).toISOString().slice(11, 19) : "--:--:--";
    if (msg.role === "user") {
      lines.push(`## ${time} · User`);
      lines.push(extractMessageText(msg));
    } else if (msg.role === "assistant") {
      lines.push(`## ${time} · Assistant`);
      const text = extractMessageText(msg);
      if (text) lines.push(text);
      for (const block of msg.content) {
        if (block.type === "thinking") {
          lines.push(`\n<details><summary>Thinking</summary>\n\n${block.thinking}\n\n</details>`);
        }
        if (block.type === "toolCall") {
          lines.push(`\n- Tool: \`${block.name}\``);
          lines.push(`  Arguments: \`${safeJsonStringify(block.arguments)}\``);
        }
      }
    } else if (msg.role === "toolResult") {
      lines.push(`\n<!-- tool result -->`);
      const text = extractMessageText(msg);
      if (text && text.length < 500) {
        lines.push(`> ${text.replace(/\n/g, "\n> ")}`);
      }
    }
    lines.push("");
  }

  const path = join(dir, `session-${timeStr}.md`);
  const text = lines.join("\n");
  writeFileSync(path, text, "utf-8");
  emitFileEvent({ operation: "WRITE", path, bytes: text.length, detail: "session transcript" });
}

// ── Session context helpers ──

export function updateSessionCtx(update: Partial<SessionCtx>): void {
  Object.assign(sessionCtx, update);
}

export function getSessionCtx(): Readonly<SessionCtx> {
  return sessionCtx;
}

export function injectContext(input: string): string {
  return injectSessionContext(input, sessionCtx);
}

// ── Model resolution ──

export function resolveModelId(model: string, env: Record<string, string>): string {
  const envKey = `WHYJ_DEFAULT_${model.toUpperCase()}_MODEL`;
  return env[envKey] || process.env[envKey] || inferModelId(model);
}

export function inferModelId(model: string): string {
  switch (model) {
    case "sonnet": return "deepseek-v4-pro";
    case "opus": return "deepseek-v4-pro";
    case "haiku": return "deepseek-v4-flash";
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
