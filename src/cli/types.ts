import type { QuantAgentSession } from "../agent/session.ts";

export interface ParsedCommand {
  command: string;
  raw: string;
  flags: Record<string, string | number | boolean>;
  positional: string[];
}

export type CommandEffect =
  | { type: "clearConversation" }
  | { type: "resetAgent" }
  | { type: "openConfig" };

export interface CommandContext {
  /** When set, /config /setup /portfolio open the settings panel instead of printing status. */
  openConfig?: () => void;
  /** Active agent session for session/harness commands. */
  agentSession?: QuantAgentSession | null;
}

export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
  renderAs?: "text" | "table" | "card";
  effects?: CommandEffect[];
}

export type CommandHandler = (
  flags: Record<string, string | number | boolean>,
  positional: string[],
  ctx: CommandContext,
) => Promise<CommandResult>;
