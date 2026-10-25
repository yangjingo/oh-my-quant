import type { CurrentSessionMeta } from "../../../src/types/ui.ts";
import type { ArtifactItemView, ArtifactMetaView, ConfigRowView, ResumeListItemView, ResumeMetaView } from "./panel-views.ts";
import type { ArtifactMeta, StoredSessionContextUsage, StoredSessionSummary } from "../../../src/runtime/workspace/panel-data.ts";
import { COMMAND_CATALOG } from "../../../src/runtime/workspace/command-catalog.ts";

export function buildConfigRowViews(
  rows: Array<{ section: string } | { field: { label: string; action?: string }; index: number }>,
  cursor: number,
  draft: string | null,
  valueText: (field: { label: string; action?: string }, active: boolean) => string,
): ConfigRowView[] {
  return rows.map((row) => {
    if ("section" in row) return { kind: "section", label: row.section };
    const active = row.index === cursor;
    const field = row.field;
    return {
      kind: "field",
      label: field.label,
      value: valueText(field, active),
      active,
      editing: draft !== null && active,
      action: !!field.action,
    };
  });
}

export function buildResumePanelData(args: {
  sessions: StoredSessionSummary[];
  selection: number;
  currentSessionMeta: CurrentSessionMeta | null;
  resumeFilter: "cwd" | "all";
  resumeSort: "updated" | "created";
  status: string;
  innerWidth: number;
  formatRelativeAge: (value: string) => string;
}): {
  meta?: ResumeMetaView;
  items: ResumeListItemView[];
  footer: string;
  emptyMessage?: string;
} {
  const { sessions, selection, currentSessionMeta: meta, resumeFilter, resumeSort, status, innerWidth, formatRelativeAge } = args;
  const selected = sessions[selection];
  const isCurrent = selected && meta && selected.id === meta.id;
  const footer = status || `${sessions.length} session${sessions.length === 1 ? "" : "s"}`;

  const metaView = selected ? (() => {
    const label = isCurrent ? "Current" : "Selected";
    const previewLines = (() => {
      if (isCurrent && selected.recentMessages.length > 0) {
        return selected.recentMessages.slice(-3).map((message) => `${message.role === "user" ? "U" : "A"}: ${message.text}`);
      }
      const previewRows = !isCurrent
        ? (selected.recentMessages.length > 0 ? selected.recentMessages : [{ role: "user" as const, text: selected.preview }]).slice(-3)
        : [];
      return previewRows.map((message) => `${message.role === "user" ? "U" : "A"}: ${message.text}`);
    })();
    const usage = isCurrent
      ? (meta?.usage ?? selected.contextUsage)
      : selected.contextUsage;
    const usagePct = usage
      ? (usage.percent ?? (usage.contextWindow > 0 ? usage.tokens / usage.contextWindow * 100 : 0))
      : undefined;
    const usageBar = usage && usagePct !== undefined
      ? formatUsageBar(usage, usagePct, innerWidth)
      : undefined;
    const stats = isCurrent && meta?.entryCount
      ? `Msgs ${meta.entryCount.messages}  Comps ${meta.entryCount.compactions}  Branches ${meta.entryCount.branches}`
      : !isCurrent
        ? formatHistoricalStats(selected)
        : undefined;
    return {
      title: `${label}: ${isCurrent ? meta!.id : selected.id}  ·  ${isCurrent ? meta!.createdAt : selected.createdAt}`,
      usageBar,
      usageCritical: !!(usagePct !== undefined && usagePct > 80),
      stats,
      previewLines,
    };
  })() : undefined;

  return {
    meta: metaView,
    items: sessions.map((session, index) => ({
      age: formatRelativeAge(resumeSort === "updated" ? session.updatedAt : session.createdAt).padEnd(10),
      preview: session.preview,
      selected: index === selection,
      secondary: resumeFilter === "all" ? session.cwd : undefined,
      legacy: session.format === "markdown",
    })),
    footer,
    emptyMessage: "No saved sessions yet.\n\nStart a conversation first, then come back to /resume.",
  };
}

function formatUsageBar(usage: StoredSessionContextUsage, usagePct: number, innerWidth: number): string {
  const barW = Math.min(30, Math.max(8, innerWidth - 25));
  const filled = Math.round(barW * usagePct / 100);
  const bar = "█".repeat(Math.min(filled, barW)) + "░".repeat(Math.max(0, barW - filled));
  return `${bar}  ${usage.tokens.toLocaleString()}/${usage.contextWindow.toLocaleString()} (${usagePct.toFixed(0)}%)`;
}

function formatHistoricalStats(session: StoredSessionSummary): string {
  if (session.format === "markdown") return `Legacy transcript · ${session.messageCount} messages`;
  if (!session.entryCount) return `JSONL session · ${session.messageCount} messages`;
  return `JSONL session · Msgs ${session.entryCount.messages}  Comps ${session.entryCount.compactions}  Branches ${session.entryCount.branches}`;
}

export function buildArtifactPanelData(args: {
  items: ArtifactMeta[];
  selection: number;
  status: string;
  formatRelativeAge: (value: string) => string;
}): {
  meta?: ArtifactMetaView;
  items: ArtifactItemView[];
  footer: string;
  emptyMessage?: string;
} {
  const { items, selection, status, formatRelativeAge } = args;
  const selected = items[selection];
  return {
    meta: selected ? {
      title: `Selected: ${selected.title}`,
      details: `${selected.sessionId}  ·  ${selected.messageCount} messages  ·  ${formatBytes(selected.bytes)}`,
      subdetails: `${selected.createdAt || "-"}${selected.revision ? ` · version ${selected.revision.slice(0, 8)}` : " · legacy"}`,
    } : undefined,
    items: items.map((item, index) => ({
      age: item.createdAt ? formatRelativeAge(item.createdAt).padEnd(8) : "-".padEnd(8),
      title: item.title || item.sessionId,
      stats: `${item.messageCount} msg · ${formatBytes(item.bytes)}${item.revision ? ` · ${item.revision.slice(0, 8)}` : ""}`,
      selected: index === selection,
    })),
    footer: status || `${items.length} report${items.length === 1 ? "" : "s"}`,
    emptyMessage: "No artifacts yet. 暂无研究报告。\n\n1. /config → Auto Artifacts 开启自动报告。\n2. 完成量化研究并通过核验。\n3. /artifact → Enter 恢复会话并打开报告。",
  };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0B";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
export function buildHelpPanelData(selection: number): {
  commands: { name: string; desc: string; selected: boolean }[];
  hotkeys: { key: string; desc: string }[];
  footer: string;
} {
  return {
    commands: COMMAND_CATALOG.map((cmd, index) => ({ name: cmd.name, desc: cmd.desc, selected: index === selection })),
    hotkeys: [
      { key: "Ctrl+P", desc: "Open settings" },
      { key: "Enter", desc: "Submit input" },
      { key: "Tab", desc: "Accept suggestion" },
      { key: "Esc", desc: "Clear / close panel" },
      { key: "Ctrl+C", desc: "Clear input or quit" },
      { key: "PgUp/Down", desc: "Scroll conversation" },
      { key: "Shift+PgUp/Down", desc: "Scroll overview" },
      { key: "Ctrl+Shift+C", desc: "Copy selection" },
      { key: "↑↓", desc: "Navigate / history" },
      { key: "1-9", desc: "Quick-select" },
      { key: "/", desc: "Slash command mode" },
    ],
    footer: `Usage: /help ${COMMAND_CATALOG[selection]?.name.slice(1) ?? "COMMAND"}`,
  };
}
