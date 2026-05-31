import type { Bar } from "./data.ts";

export type MessageRole = "user" | "system" | "error";

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  /** Structured rendering hint */
  renderAs?: "text" | "table" | "card" | "error";
  /** Optional structured data for table/card rendering */
  data?: unknown;
}

export interface ParsedCommand {
  command: string;
  subcommand?: string;
  flags: Record<string, string | number | boolean>;
}

export interface CommandSpec {
  name: string;
  description: string;
  usage: string;
  subcommands: SubcommandSpec[];
  handler?: (cmd: ParsedCommand) => Promise<CommandResult>;
}

export interface SubcommandSpec {
  name: string;
  description: string;
  flags: FlagSpec[];
}

export interface FlagSpec {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  default?: unknown;
  description: string;
}

export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
  renderAs?: "text" | "table" | "card";
}

/** Bar data with source tracking */
export interface BarsResult {
  symbol: string;
  name: string;
  market: string;
  source: string;
  bars: Bar[];
}
