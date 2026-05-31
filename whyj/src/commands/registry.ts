/**
 * Command parser and dispatcher for slash commands.
 */

export interface ParsedCommand {
  command: string;
  subcommand?: string;
  flags: Record<string, string | number | boolean>;
}

export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
  renderAs?: "text" | "table";
}

/** Parse a slash command string into a structured command */
export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const parts = trimmed.slice(1).split(/\s+/);
  if (parts.length === 0) return null;

  const command = parts[0];
  let subcommand: string | undefined;
  let flagIdx = 1;

  // Check if second part is a subcommand (doesn't start with --)
  if (parts.length > 1 && !parts[1].startsWith("--")) {
    subcommand = parts[1];
    flagIdx = 2;
  }

  const flags: Record<string, string | number | boolean> = {};
  for (let i = flagIdx; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith("--")) {
      const key = part.slice(2);
      // Check if next part is a value (not a flag)
      if (i + 1 < parts.length && !parts[i + 1].startsWith("--")) {
        i++;
        const val = parts[i];
        // Try parse as number
        const num = Number(val);
        flags[key] = isNaN(num) ? val : num;
      } else {
        flags[key] = true; // boolean flag
      }
    }
  }

  return { command, subcommand, flags };
}

/** Execute a parsed command */
export async function executeCommand(cmd: ParsedCommand): Promise<CommandResult> {
  switch (cmd.command) {
    case "mcp":
      return mcpHandler(cmd);
    case "help":
      return { success: true, message: "Use /help to see all commands" };
    default:
      return {
        success: false,
        message: `Command /${cmd.command} is registered but not yet implemented. Coming soon.`,
      };
  }
}

async function mcpHandler(cmd: ParsedCommand): Promise<CommandResult> {
  if (cmd.subcommand === "status" || !cmd.subcommand) {
    const { getConnectedServers } = await import("../data/mcp-client.ts");
    const servers = getConnectedServers();
    if (servers.length === 0) {
      return { success: true, message: "No MCP servers connected. Run /mcp connect to connect." };
    }
    return { success: true, message: `Connected MCP servers: ${servers.join(", ")}` };
  }
  if (cmd.subcommand === "connect") {
    const { connectAll, getConnectedServers } = await import("../data/mcp-client.ts");
    await connectAll();
    const servers = getConnectedServers();
    return { success: true, message: `Connected to ${servers.length} MCP server(s): ${servers.join(", ") || "none"}` };
  }
  return { success: false, message: `Unknown mcp subcommand: ${cmd.subcommand}` };
}
