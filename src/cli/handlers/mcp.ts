import type { CommandHandler } from "../../types/commands.ts";
import { manageMcpPresets } from "../../runtime/skills/mcp-config.ts";

export const mcpHandler: CommandHandler = async (flags, positional, ctx) =>
  manageMcpPresets(positional[0] || "list", positional.slice(1), { local: flags.local === true, cwd: ctx.cwd, signal: ctx.commandSignal });
