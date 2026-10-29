import { join } from "node:path";
import { getAgentDir } from "../../agent/src/pi-mcp.ts";
import { resolveSkillsDir, type ResourceLeaseRequest } from "../../storage/index.ts";
import type { ParsedCommand } from "../../types/commands.ts";

/** These paths may be shared even when workspace state directories differ. */
export function terminalReadResources(cwd: string): string[] {
  return [getAgentDir(), join(cwd, ".pi"), resolveSkillsDir()];
}

export function terminalCommandResources(command: ParsedCommand, cwd: string, mode: "read" | "write"): ResourceLeaseRequest[] {
  if (command.command === "mcp") {
    if (["info", "export"].includes(command.positional[0] ?? "")) return [];
    const user = { directory: getAgentDir(), mode: command.flags.local === true ? "read" as const : mode };
    return command.flags.local === true ? [user, { directory: join(cwd, ".pi"), mode }] : [user];
  }
  if (command.command === "skill") return [{ directory: resolveSkillsDir(), mode }];
  return [];
}
