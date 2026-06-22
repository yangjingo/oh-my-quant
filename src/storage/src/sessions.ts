import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { getModels } from "../../agent/src/pi/llm-index.ts";
import { OHQUANT_DIR } from "./dirs.ts";
import { estimateContextTokens, type AgentMessage, type JsonlSessionMetadata, type SessionTreeEntry } from "../../agent/src/pi/index.ts";
import { buildSessionContext } from "../../agent/src/pi/harness/session/session.ts";

export interface StoredSessionContextUsage {
  tokens: number;
  contextWindow: number;
  percent: number | null;
}

export interface StoredSessionEntryCount {
  messages: number;
  compactions: number;
  branches: number;
}

export interface StoredSessionSummary extends JsonlSessionMetadata {
  format: "jsonl" | "markdown";
  updatedAt: string;
  preview: string;
  messageCount: number;
  contextUsage?: StoredSessionContextUsage;
  entryCount?: StoredSessionEntryCount;
  sessionName?: string;
  recentMessages: Array<{ role: "user" | "assistant"; text: string }>;
}

type SessionScope = "cwd" | "all";
type SessionSort = "created" | "updated";

function getSessionsDir(): string {
  return join(process.env.OHQUANT_DIR || OHQUANT_DIR, "sessions");
}

function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

function normalizePreview(text: string): string {
  return text.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
}

function extractMessagePreview(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return normalizePreview(content);
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter((part): part is { type?: unknown; text?: unknown } => !!part && typeof part === "object")
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join(" ");
  return text ? normalizePreview(text) : undefined;
}

function pushRecentMessage(
  recentMessages: Array<{ role: "user" | "assistant"; text: string }>,
  role: string,
  text: string | undefined,
): void {
  if ((role !== "user" && role !== "assistant") || !text) return;
  recentMessages.push({ role, text });
  if (recentMessages.length > 4) recentMessages.shift();
}

function leafIdAfterEntry(entry: SessionTreeEntry): string | null {
  return entry.type === "leaf" ? entry.targetId : entry.id;
}

function normalizeSessionEntry(parsed: Record<string, unknown>, currentLeafId: string | null): SessionTreeEntry | null {
  if (typeof parsed.type !== "string" || typeof parsed.id !== "string" || typeof parsed.timestamp !== "string") {
    return null;
  }
  const entry = { ...parsed } as Record<string, unknown>;
  if (entry.parentId !== null && typeof entry.parentId !== "string") {
    entry.parentId = currentLeafId;
  }
  if (entry.type === "leaf" && entry.targetId !== null && typeof entry.targetId !== "string") {
    entry.targetId = null;
  }
  return entry as unknown as SessionTreeEntry;
}

function buildCurrentBranch(entries: SessionTreeEntry[], leafId: string | null): SessionTreeEntry[] {
  if (leafId === null) return [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const path: SessionTreeEntry[] = [];
  let current = byId.get(leafId);
  while (current) {
    path.unshift(current);
    if (!current.parentId) break;
    current = byId.get(current.parentId);
  }
  return path;
}

function normalizeModelLookupId(modelId: string): string {
  return modelId.replace(/\[\d+m\]$/u, "");
}

function inferContextProviderCandidates(provider: string, modelId: string): string[] {
  const lookupId = normalizeModelLookupId(modelId);
  const candidates = [provider];
  if (provider === "anthropic" && lookupId.startsWith("deepseek-")) candidates.push("deepseek");
  if (lookupId.startsWith("openai/")) candidates.push("openrouter");
  if (lookupId.startsWith("deepseek-")) candidates.push("deepseek");
  if (lookupId.startsWith("gpt-") || lookupId.startsWith("o")) candidates.push("openai", "openrouter");
  if (lookupId.startsWith("claude-")) candidates.push("anthropic");
  return [...new Set(candidates)];
}

function inferContextWindow(model: { provider: string; modelId: string } | null): number {
  if (!model) return 200_000;
  const lookupId = normalizeModelLookupId(model.modelId);
  for (const provider of inferContextProviderCandidates(model.provider, lookupId)) {
    const exact = getModels(provider).find((candidate) => candidate.id === lookupId);
    if (exact?.contextWindow) return exact.contextWindow;
    const prefix = getModels(provider).find((candidate) => lookupId.startsWith(candidate.id));
    if (prefix?.contextWindow) return prefix.contextWindow;
  }
  if (model.provider === "zai" || model.provider === "minimax" || model.provider === "minimax-cn") return 128_000;
  return 200_000;
}

function buildContextUsage(entries: SessionTreeEntry[], leafId: string | null): StoredSessionContextUsage {
  const branch = buildCurrentBranch(entries, leafId);
  const context = buildSessionContext(branch);
  const estimatedTokens = estimateContextTokens(context.messages as AgentMessage[]).tokens;
  const tokens = Number.isFinite(estimatedTokens) ? estimatedTokens : 0;
  const contextWindow = inferContextWindow(context.model);
  return {
    tokens,
    contextWindow,
    percent: contextWindow > 0 ? tokens / contextWindow * 100 : null,
  };
}

function parseSessionFile(filePath: string): StoredSessionSummary | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return null;

    const header = JSON.parse(lines[0]!) as Record<string, unknown>;
    if (header.type !== "session" || header.version !== 3) return null;
    if (typeof header.id !== "string" || typeof header.timestamp !== "string" || typeof header.cwd !== "string") {
      return null;
    }

    let updatedAt = header.timestamp;
    let preview = "";
    let sessionName: string | undefined;
    let messageCount = 0;
    const recentMessages: StoredSessionSummary["recentMessages"] = [];
    const entries: SessionTreeEntry[] = [];
    let leafId: string | null = null;

    for (const line of lines.slice(1)) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const entry = normalizeSessionEntry(parsed, leafId);
      if (entry) {
        entries.push(entry);
        leafId = leafIdAfterEntry(entry);
      }
      if (typeof parsed.timestamp === "string") updatedAt = parsed.timestamp;
      if (parsed.type === "session_info" && typeof parsed.name === "string" && parsed.name.trim()) {
        sessionName = parsed.name.trim();
      }
      if (parsed.type === "message") {
        messageCount += 1;
        const message = parsed.message;
        const role = typeof message === "object" && message && typeof (message as { role?: unknown }).role === "string"
          ? (message as { role: string }).role
          : "";
        if (role === "user" || role === "assistant") {
          const text = extractMessagePreview(message);
          if (!preview) preview = text || preview;
          pushRecentMessage(recentMessages, role, text);
        }
      }
    }

    return {
      format: "jsonl",
      id: header.id,
      createdAt: header.timestamp,
      updatedAt,
      cwd: header.cwd,
      path: filePath,
      parentSessionPath: typeof header.parentSession === "string" ? header.parentSession : undefined,
      preview: preview || sessionName || "Untitled session",
      contextUsage: buildContextUsage(entries, leafId),
      entryCount: {
        messages: messageCount,
        compactions: entries.filter((entry) => entry.type === "compaction").length,
        branches: entries.filter((entry) => entry.type === "branch_summary").length,
      },
      sessionName,
      messageCount,
      recentMessages,
    };
  } catch {
    return null;
  }
}

function parseLegacyMarkdownSession(filePath: string, cwd: string): StoredSessionSummary | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const stat = statSync(filePath);
    const lines = raw.split(/\r?\n/);
    const title = lines.find((line) => line.startsWith("# Session "))?.replace(/^#\s+/, "").trim();
    const blocks: Array<{ role: "user" | "assistant"; text: string }> = [];
    let role: "user" | "assistant" | null = null;
    let buf: string[] = [];

    const flush = () => {
      if (!role) return;
      const text = normalizePreview(buf.join(" "));
      if (text) blocks.push({ role, text });
      role = null;
      buf = [];
    };

    for (const line of lines) {
      const user = /^##\s+.+\s+·\s+User\s*$/.test(line);
      const assistant = /^##\s+.+\s+·\s+Assistant\s*$/.test(line);
      if (user || assistant) {
        flush();
        role = user ? "user" : "assistant";
        continue;
      }
      if (!role) continue;
      if (line.startsWith("<details") || line.startsWith("</details") || line.startsWith("<summary")) continue;
      if (line.startsWith("<!--") || line.startsWith("> ")) continue;
      if (line.startsWith("- Tool:") || line.startsWith("  Arguments:")) continue;
      if (line.startsWith("#")) continue;
      buf.push(line);
    }
    flush();

    const updatedAt = stat.mtime.toISOString();
    const createdAt = stat.birthtimeMs > 0 ? stat.birthtime.toISOString() : updatedAt;
    const id = basename(filePath, ".md");
    return {
      format: "markdown",
      id,
      createdAt,
      updatedAt,
      cwd,
      path: filePath,
      preview: blocks[0]?.text || title || "Legacy transcript",
      sessionName: title,
      messageCount: blocks.length,
      recentMessages: blocks.slice(-4),
    };
  } catch {
    return null;
  }
}

function readSessionDirs(scope: SessionScope, cwd: string): string[] {
  const sessionsDir = getSessionsDir();
  if (scope === "cwd") {
    return [join(sessionsDir, encodeCwd(cwd))];
  }
  if (!existsSync(sessionsDir)) return [];
  return readdirSync(sessionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(sessionsDir, entry.name));
}

function readLegacyMarkdownSessions(scope: SessionScope, cwd: string): StoredSessionSummary[] {
  const sessionsDir = getSessionsDir();
  if (!existsSync(sessionsDir)) return [];
  return readdirSync(sessionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .flatMap((entry) => {
      const dir = join(sessionsDir, entry.name);
      return readdirSync(dir, { withFileTypes: true })
        .filter((file) => file.isFile() && file.name.endsWith(".md"))
        .map((file) => parseLegacyMarkdownSession(join(dir, file.name), cwd))
        .filter((session): session is StoredSessionSummary => session !== null);
    })
    .filter((session) => scope === "all" || session.cwd === cwd);
}

export function listStoredSessions(options?: {
  cwd?: string;
  limit?: number;
  scope?: SessionScope;
  sort?: SessionSort;
}): StoredSessionSummary[] {
  const cwd = options?.cwd ?? process.cwd();
  const limit = options?.limit ?? 20;
  const scope = options?.scope ?? "cwd";
  const sort = options?.sort ?? "updated";

  const sessions = [
    ...readSessionDirs(scope, cwd)
    .flatMap((dir) => {
      if (!existsSync(dir)) return [];
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
        .map((entry) => parseSessionFile(join(dir, entry.name)))
        .filter((entry): entry is StoredSessionSummary => entry !== null);
    }),
    ...readLegacyMarkdownSessions(scope, cwd),
  ]
    .sort((a, b) => {
      const left = new Date(sort === "updated" ? a.updatedAt : a.createdAt).getTime();
      const right = new Date(sort === "updated" ? b.updatedAt : b.createdAt).getTime();
      return right - left;
    });

  return sessions.slice(0, limit);
}
