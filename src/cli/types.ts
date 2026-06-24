import type { QuantAgentSession } from "../agent/src/session.ts";

export interface ParsedCommand {
  command: string;
  raw: string;
  flags: Record<string, string | number | boolean>;
  positional: string[];
}

export type CommandEffect =
  | { type: "clearConversation" }
  | { type: "resetAgent" }
  | { type: "openConfig" }
  | { type: "openResume" }
  | { type: "openSession" }
  | { type: "openPortfolio" }
  | { type: "openHelp" }
  | { type: "openArtifact" }
  | { type: "compactSession" }
  | { type: "sessionChanged" }
  | { type: "portfolioChanged" };

export interface CommandContext {
  /** When set, /config opens the settings panel. */
  openConfig?: () => void;
  /** When set, /resume opens the resume panel. */
  openResume?: () => void;
  /** When set, /portfolio opens the portfolio panel. */
  openPortfolio?: () => void;
  /** When set, /help opens the help panel. */
  openHelp?: () => void;
  /** When set, /artifact opens the artifact panel. */
  openArtifact?: () => void;
  openSession?: () => void;
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
