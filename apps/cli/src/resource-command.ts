import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { acquireResourceLeaseSet, createHostRuntimeStore } from "../../../src/storage/index.ts";
import { terminalCommandResources } from "../../../src/app/services/resource-paths.ts";
import type { CommandResult, ParsedCommand } from "../../../src/types/commands.ts";

/** Only commands that actually change managed resources need the execution owner. */
export function changesResources(command: ParsedCommand): boolean {
  const action = command.positional[0] ?? "";
  if (command.command === "mcp") return action === "install" || action === "remove";
  if (command.command === "skill") return action === "remove" || action === "reload"
    || action === "install" && (command.positional.length > 1 || command.flags.repo !== undefined || command.flags.all !== undefined);
  return command.command === "config" && command.flags.extensions !== undefined && ![true, "list"].includes(command.flags.extensions as true | string);
}

/** Static help and MCP preset descriptions do not read managed resource state. */
export function readsResources(command: ParsedCommand): boolean {
  if (command.command === "skill") return !changesResources(command);
  return command.command === "mcp" && ["", "list"].includes(command.positional[0] ?? "");
}

export async function executeResourceRead(command: ParsedCommand, execute: () => Promise<CommandResult>): Promise<CommandResult> {
  const release = await acquireResourceLeaseSet(terminalCommandResources(command, process.cwd(), "read"));
  try { return await execute(); } finally { await release(); }
}

/** A local operation owns the workspace; an existing Host executes its own operation. */
export async function executeResourceCommand(command: ParsedCommand, execute: () => Promise<CommandResult>): Promise<CommandResult> {
  const registry = createHostRuntimeStore();
  let lease: ReturnType<typeof registry.acquire> | undefined;
  try {
    lease = registry.acquire("owner");
  } catch (error) {
    if ((error as { code?: string }).code !== "HOST_LOCKED") throw error;
  }
  if (lease) {
    try {
      const release = await acquireResourceLeaseSet(terminalCommandResources(command, process.cwd(), "write"));
      try { return await execute(); } finally { await release(); }
    } finally { lease.release(); }
  }
  const { connectExistingWorkspaceHost } = await import("../../../src/app/bootstrap.ts");
  const { createTerminalClient } = await import("../../../src/app/host/terminal-client.ts");
  const connection = await connectExistingWorkspaceHost(), client = createTerminalClient(connection);
  const identity = await client.identity(), context = await client.context(identity);
  const current = statSync(process.cwd()), host = statSync(context.cwd);
  if (current.dev !== host.dev || current.ino !== host.ino) throw new Error("The active Host uses a different project directory; use its terminal or stop it before changing these resources.");
  const receipt = await client.command({ workspaceId: identity.workspaceId, sessionId: identity.sessionId,
    requestId: randomUUID(), expectedRevision: context.session.revision!, text: command.raw });
  return receipt.result;
}
