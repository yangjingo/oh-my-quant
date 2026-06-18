/**
 * Slash command parser and dispatcher.
 * / prefix → direct execution.  No prefix → AI Agent.
 */
import { SLASH_COMMANDS } from "./catalog.ts";
import {
  clearHandler,
  compactHandler,
  configHandler,
  exitHandler,
  helpHandler,
  portfolioHandler,
  resumeHandler,
  sessionHandler,
} from "./handlers/system.ts";
import { skillHandler } from "../skill/handler.ts";
import type { CommandContext, CommandHandler, CommandResult, ParsedCommand } from "./types.ts";

export { SLASH_COMMANDS };
export type { CommandContext, CommandResult, ParsedCommand } from "./types.ts";

const LOCAL_COMMANDS = new Set(["help", "session", "clear", "config", "portfolio", "resume", "compact", "skill"]);

export function isLocalSlashCommand(command: string): boolean {
  return LOCAL_COMMANDS.has(command);
}

export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const parts = trimmed.slice(1).split(/\s+/);
  if (parts.length === 0 || !parts[0]) return null;
  let command = parts[0];
  let colonArg = "";
  const colonIdx = command.indexOf(":");
  if (colonIdx > 0) {
    colonArg = command.slice(colonIdx + 1);
    command = command.slice(0, colonIdx);
  }
  const flags: Record<string, string | number | boolean> = {};
  const positional: string[] = colonArg ? [colonArg] : [];
  let i = 1;
  while (i < parts.length) {
    const part = parts[i];
    if (part.startsWith("--")) {
      const key = part.slice(2);
      if (i + 1 < parts.length && !parts[i + 1].startsWith("--")) {
        i++; flags[key] = parts[i];
      } else flags[key] = true;
    } else if (/^-[A-Za-z]$/.test(part)) {
      const key = part.slice(1);
      if (i + 1 < parts.length && !parts[i + 1].startsWith("-")) {
        i++; flags[key] = parts[i];
      } else flags[key] = true;
    } else {
      positional.push(part);
    }
    i++;
  }
  return { command, raw: trimmed, flags, positional };
}

const HANDLERS: Record<string, CommandHandler> = {
  config: configHandler,
  portfolio: portfolioHandler,
  compact: compactHandler,
  resume: resumeHandler,
  session: sessionHandler,
  skill: skillHandler,
  help: helpHandler,
  clear: clearHandler,
};

export async function executeCommand(cmd: ParsedCommand, ctx: CommandContext = {}): Promise<CommandResult> {
  const { command, flags, positional } = cmd;
  if (command === "exit") return exitHandler();
  const handler = HANDLERS[command];
  if (!handler) {
    return { success: false, message: `Unknown /${command}. Try /help` };
  }
  return handler(flags, positional, ctx);
}
