export interface CommandAction {
  label: string;
  fill: string;
}

export interface CommandCatalogEntry {
  name: string;
  desc: string;
  help: string;
  example?: string;
  compatibility?: boolean;
  subcommands?: readonly string[];
  actions?: readonly CommandAction[];
}

export const COMMAND_CATALOG: readonly CommandCatalogEntry[] = [
  { name: "/compact", desc: "Compact", help: "Compact session with optional focus instructions", example: "/compact focus on signals" },
  { name: "/session", desc: "Session", help: "Show current session metadata", example: "/session" },
  { name: "/resume", desc: "Resume", help: "List or restore saved sessions", example: "/resume" },
  { name: "/portfolio", desc: "Portfolio", help: "List, compare, and switch local portfolios", example: "/portfolio" },
  { name: "/config", desc: "Config", help: "Show or open config panel", example: "/config" },
  { name: "/skill", desc: "Skill", help: "List, inspect, and run skills", example: "/skill" },
  { name: "/help", desc: "Help", help: "Show commands and hotkeys" },
  { name: "/clear", desc: "Clear", help: "Clear conversation and reset agent" },
  { name: "/exit", desc: "Exit", help: "Exit WhyJ Quant" },
];

export const SLASH_COMMANDS = COMMAND_CATALOG.map((command) => command.name);

export function buildCommandHelpText(): string {
  const lines = [
    "Commands",
    ...COMMAND_CATALOG.map((command) => `  ${command.name.padEnd(10)} ${command.desc}`.trimEnd()),
    "",
    "Hotkeys",
    "  Ctrl+P     Open settings",
    "  Enter      Submit input",
    "  Tab        Accept slash suggestion",
    "  Esc        Clear input / close panel",
    "  Ctrl+C     Clear input or quit",
    "  PgUp/Down  Scroll conversation",
    "  Shift+PgUp/PgDown  Scroll overview",
    "",
    "No / prefix → AI analysis",
  ];
  return lines.join("\n");
}
