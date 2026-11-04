/**
 * Slash command parser and dispatcher.
 * / prefix → direct execution.  No prefix → AI Agent.
 */
import { SLASH_COMMANDS } from "./catalog.ts";
import { commandPreflight } from "../runtime/workspace/command-preflight.ts";
import { isInstalledToolProbeSchemaQuery } from "../runtime/data/tool-probe-schema.ts";
import { installedAkshareIndexSchemaResult } from "../runtime/data/installed-akshare-index-schema.ts";
import {
  clearHandler,
  compactHandler,
  configHandler,
  doctorHandler,
  exitHandler,
  helpHandler,
  portfolioHandler,
  resumeHandler,
} from "./handlers/system.ts";
import { skillHandler } from "./handlers/skill.ts";
import { mcpHandler } from "./handlers/mcp.ts";
import { artifactHandler } from "./handlers/artifact.ts";
import type { CommandContext, CommandHandler, CommandResult, ParsedCommand } from "./types.ts";

export { SLASH_COMMANDS };
export { parseCommand } from "./arguments.ts";
export type { CommandContext, CommandResult, ParsedCommand } from "./types.ts";

export { isLocalSlashCommand } from "../runtime/workspace/command-catalog.ts";

const HANDLERS: Record<string, CommandHandler> = {
  config: configHandler,
  portfolio: portfolioHandler,
  compact: compactHandler,
  doctor: doctorHandler,
  resume: resumeHandler,
  skill: skillHandler,
  mcp: mcpHandler,
  artifact: artifactHandler,
  help: helpHandler,
  clear: clearHandler,
};

export async function executeCommand(cmd: ParsedCommand, ctx: CommandContext = {}): Promise<CommandResult> {
  const early = commandPreflight(cmd);
  if (early) return early;
  if (isInstalledToolProbeSchemaQuery(cmd)) return installedAkshareIndexSchemaResult(cmd.flags, cmd.positional, { signal: ctx.commandSignal });
  const { command, flags, positional } = cmd;
  if (command === "exit") return exitHandler();
  const handler = HANDLERS[command];
  if (!handler) {
    return { success: false, message: `Unknown /${command}. Run /help to see available slash commands.` };
  }
  return handler(flags, positional, ctx);
}
