/**
 * /artifact slash command — generate artifact from current session.
 *
 * /artifact              — generate + open in browser (auto-title)
 * /artifact --title "x"  — generate with custom title
 */
import type { CommandHandler } from "../types.ts";
import { generateArtifact } from "../../artifact/src/generator.ts";
import { saveArtifact, artifactPath } from "../../storage/index.ts";
import { exec } from "node:child_process";

export const artifactHandler: CommandHandler = async (flags, positional, ctx) => {
  async function resolveSessionPath(): Promise<string | undefined> {
    const meta = await ctx.agentSession?.getSessionMetadata?.();
    if (!meta?.id) return undefined;
    const cwd = (meta as any).cwd ?? "default";
    return `.ohquant/sessions/--${cwd}--/${meta.id}.jsonl`;
  }

  // If TUI has artifact panel, delegate
  if (ctx.openArtifact) {
    return { success: true, message: "", effects: [{ type: "openArtifact" }] };
  }

  const sessionPath = await resolveSessionPath();
  if (!sessionPath) return { success: false, message: "No active session. Start a conversation first, then use /artifact." };

  const title = typeof flags.title === "string" ? flags.title : undefined;
  const result = generateArtifact({ sessionPath, title });
  if (!result) return { success: false, message: "Failed to generate artifact from session." };

  saveArtifact(result.sessionId, result.html, { title: result.title, messageCount: result.messageCount });
  const path = artifactPath(result.sessionId);
  exec(`start "" "${path}"`);

  return { success: true, message: `${result.title} — ${(result.html.length / 1024).toFixed(0)}KB · ${result.messageCount} msgs` };
};
