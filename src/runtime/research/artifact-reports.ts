import { spawn } from "node:child_process";
import { verifyReportSession } from "../../artifact/src/report-input.ts";
import { generateArtifact } from "../../artifact/src/generator.ts";
import {
  artifactPath,
  listStoredSessions,
  loadArtifactSnapshot,
  artifactReference,
  materializeArtifact,
  listArtifactVersions,
  pruneUnrestorableArtifacts,
  saveArtifact,
  loadSettings,
  type ArtifactMeta,
} from "../../storage/index.ts";
import type { CommandContext, CommandResult } from "../../types/commands.ts";

export function openLocalFile(path: string): void {
  const command = process.platform === "win32" ? "cmd.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "start", "", path] : [path];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {});
  child.unref();
}

function storedJsonlSessions(cwd = process.cwd()) {
  return listStoredSessions({ cwd, scope: "all", limit: Number.MAX_SAFE_INTEGER })
    .filter((session) => session.format === "jsonl" && session.cwd === cwd);
}

/** List committed versions with available source sessions; retain unavailable files for repair. */
export function listRestorableArtifactReports(cwd = process.cwd()): ArtifactMeta[] {
  const sourceSessionIds = new Set(storedJsonlSessions(cwd).map((session) => session.id));
  return pruneUnrestorableArtifacts(sourceSessionIds).artifacts.flatMap(meta => {
    const versions = listArtifactVersions(meta.sessionId).filter(version => sourceSessionIds.has(version.sourceSessionId ?? version.sessionId));
    return versions.length ? versions : [meta];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function buildArtifactContextNote(input: {
  event: "exported" | "restored";
  title: string;
  sessionId: string;
  displayPath: string;
  bytes: number;
  messageCount: number;
}): string {
  return [
    input.event === "exported" ? "Artifact export completed." : "Artifact session restored.",
    `title: ${input.title}`,
    `session_id: ${input.sessionId}`,
    `path: ${input.displayPath}`,
    `html_bytes: ${input.bytes}`,
    `message_count: ${input.messageCount}`,
    "If the user refers to the exported report, artifact, or report file, use this metadata as current session context.",
  ].join("\n");
}

/** Restore a report selected in the Artifact panel. This is an internal UI action, not a slash command. */
export async function restoreArtifactReport(reportId: string, ctx: CommandContext): Promise<CommandResult> {
  const snapshot = loadArtifactSnapshot(reportId);
  if (!snapshot) return { success: false, message: "Report version is unavailable or damaged. Saved revisions have been retained." };
  const { meta } = snapshot;
  const sourceSessionId = meta.sourceSessionId ?? meta.sessionId;
  const stored = storedJsonlSessions(ctx.cwd).find(session => session.id === sourceSessionId);
  if (!stored) return { success: false, message: "Report source session is unavailable. The saved report has been retained for recovery." };
  if (meta.provenance && !verifyReportSession(stored.path, meta.provenance)) {
    return { success: false, message: "Report source entries changed or are unavailable. The current session was not replaced." };
  }
  const selected = artifactReference(meta);
  // Materialize before switching: a failed disk write must not replace the user's session.
  const outputPath = materializeArtifact(selected);
  const agentSession = ctx.agentSession;
  if (!agentSession) {
    (ctx.openFile ?? openLocalFile)(outputPath);
    return { success: true, message: `Opened artifact ${selected} · saved version` };
  }
  try {
    if (meta.provenance) await agentSession.resumeSession(sourceSessionId, { report: meta.provenance });
    else await agentSession.resumeSession(sourceSessionId);
  } catch (error) {
    return { success: false, message: `Could not restore artifact: ${error instanceof Error ? error.message : String(error)}` };
  }
  let contextNoteFailed = false;
  try {
    await agentSession.appendContextNote?.("artifact_restore", buildArtifactContextNote({
      event: "restored", title: meta.title, sessionId: sourceSessionId, displayPath: outputPath,
      bytes: meta.bytes, messageCount: meta.messageCount,
    }) + `\nreport_ref: ${selected}\nUse this saved report version and its referenced observations, not newer prices.`, {
      title: meta.title, sessionId: sourceSessionId, reportRef: selected, path: outputPath,
      bytes: meta.bytes, messageCount: meta.messageCount, provenance: meta.provenance,
    });
  } catch { contextNoteFailed = true; }
  (ctx.openFile ?? openLocalFile)(outputPath);
  return { success: true, message: `Restored artifact ${selected} · saved version · ${contextNoteFailed ? "context note failed" : "context updated"}`,
    effects: [{ type: "sessionChanged" }] };
}

/** Generate a report after an eligible turn when Auto Artifacts is enabled. */
export async function generateCurrentSessionArtifact(
  ctx: CommandContext,
  titleOverride?: string,
): Promise<CommandResult & { data?: { artifact: ArtifactMeta } }> {
  ctx.commandSignal?.throwIfAborted();
  const meta = await ctx.agentSession?.getSessionMetadata?.();
  const sessionPath = meta?.path;
  if (!sessionPath) return { success: false, message: "No active session is available for automatic artifact generation." };

  const leafId = await ctx.agentSession?.getLeafId?.();
  ctx.commandSignal?.throwIfAborted();
  const marketColorScheme = loadSettings().preferences.marketColorScheme;
  const result = generateArtifact({ sessionPath, title: titleOverride, leafId, marketColorScheme });
  if (!result) return { success: false, message: "Failed to generate artifact from session." };

  const saved = saveArtifact(result.sessionId, result.html, {
    title: result.title,
    messageCount: result.messageCount,
    sourceSessionId: result.sessionId,
    provenance: result.provenance,
  });
  const reportRef = artifactReference(saved);
  const outputPath = artifactPath(reportRef);
  const displayPath = outputPath;
  let contextNoteFailed = false;
  if (ctx.agentSession?.appendContextNote) {
    try {
      await ctx.agentSession.appendContextNote("artifact_export", buildArtifactContextNote({
        event: "exported",
        title: result.title,
        sessionId: result.sessionId,
        displayPath,
        bytes: saved.bytes,
        messageCount: result.messageCount,
      }), {
        title: result.title,
        sessionId: result.sessionId,
        path: displayPath,
        reportRef,
        provenance: result.provenance,
        bytes: saved.bytes,
        messageCount: result.messageCount,
      });
    } catch {
      contextNoteFailed = true;
    }
  }
  (ctx.openFile ?? openLocalFile)(outputPath);

  const suffix = contextNoteFailed ? " · context note failed" : " · context updated";
  return { success: true, message: `${result.title} — ${(saved.bytes / 1024).toFixed(0)}KB · ${result.messageCount} msgs${suffix}`, data: { artifact: saved } };
}
