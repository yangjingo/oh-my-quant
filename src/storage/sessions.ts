import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { OHQUANT_DIR } from "./index.ts";
import type { JsonlSessionMetadata } from "../agent/src/pi/index.ts";

export interface StoredSessionSummary extends JsonlSessionMetadata {
  format: "jsonl" | "markdown";
  updatedAt: string;
  preview: string;
  messageCount: number;
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

    for (const line of lines.slice(1)) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
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
