/**
 * Slash command parser and dispatcher.
 * / prefix → direct execution.  No prefix → AI Agent.
 */
import { SLASH_COMMANDS } from "./catalog.ts";
import { clawHandler, dataHandler } from "./handlers/data.ts";
import { skillHandler } from "./handlers/skill.ts";
import {
  clearHandler,
  compactHandler,
  configHandler,
  exitHandler,
  helpHandler,
  marketHandler,
  mcpHandler,
  portfolioHandler,
  sessionHandler,
  setupHandler,
} from "./handlers/system.ts";
import { addHandler, watchHandler } from "./handlers/watchlist.ts";
import { backtestHandler, benchmarkHandler, compareHandler, factorHandler, riskHandler } from "./handlers/workflow.ts";
import type { CommandContext, CommandHandler, CommandResult, ParsedCommand } from "./types.ts";

export { SLASH_COMMANDS };
export type { CommandContext, CommandResult, ParsedCommand } from "./types.ts";

const LOCAL_COMMANDS = new Set(["market", "help", "clear", "config", "setup", "portfolio", "panel", "session", "compact", "skill"]);

export function isLocalSlashCommand(command: string): boolean {
  return LOCAL_COMMANDS.has(command);
}

export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const parts = trimmed.slice(1).split(/\s+/);
  if (parts.length === 0) return null;
  const command = parts[0];
  const flags: Record<string, string | number | boolean> = {};
  const positional: string[] = [];
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
  data: dataHandler,
  factor: factorHandler,
  backtest: backtestHandler,
  risk: riskHandler,
  skill: skillHandler,
  claw: clawHandler,
  add: addHandler,
  watch: watchHandler,
  config: configHandler,
  setup: setupHandler,
  portfolio: portfolioHandler,
  panel: portfolioHandler,
  compact: compactHandler,
  benchmark: benchmarkHandler,
  compare: compareHandler,
  market: marketHandler,
  session: sessionHandler,
  mcp: mcpHandler,
  help: helpHandler,
  clear: clearHandler,
};

export async function executeCommand(cmd: ParsedCommand, ctx: CommandContext = {}): Promise<CommandResult> {
  const { command, flags, positional } = cmd;
  if (command === "exit" || command === "quit") return exitHandler();
  if (command.startsWith("skill:")) {
    const skillName = command.slice("skill:".length);
    return skillHandler(flags, ["run", skillName, ...positional], ctx);
  }
  const handler = HANDLERS[command];
  if (!handler) {
    return { success: false, message: `Unknown /${command}. Try /help` };
  }
  return handler(flags, positional, ctx);
}
