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
  { name: "/factor", desc: "Factor analysis", help: "List or compute factors", example: "/factor analyze --symbol CODE --factor momentum", subcommands: ["list", "analyze"] },
  { name: "/backtest", desc: "SMA backtest", help: "Run SMA backtests", example: "/backtest run --symbol CODE --fast 20 --slow 60", subcommands: ["run"] },
  { name: "/risk", desc: "Risk metrics", help: "Check risk metrics", example: "/risk check --symbol CODE", subcommands: ["check"] },
  { name: "/benchmark", desc: "Score/dashboard", help: "Run scoring or show dashboard", example: "/benchmark run --symbol CODE", subcommands: ["run", "dashboard"] },
  { name: "/compact", desc: "Compact session", help: "Compact the active harness-backed session", example: "/compact focus on signals" },
  { name: "/resume", desc: "Resume session", help: "Open the resume panel or restore a previous harness-backed session", example: "/resume" },
  { name: "/portfolio", desc: "Local portfolios", help: "Open the local portfolio comparison panel", example: "/portfolio" },
  { name: "/config", desc: "Settings", help: "Show config status", example: "/config" },
  { name: "/help", desc: "Show all commands", help: "Show all commands" },
  { name: "/clear", desc: "Clear conversation", help: "Clear conversation" },
  { name: "/exit", desc: "Exit WhyJ Quant", help: "Exit WhyJ Quant" },
];

export const SLASH_COMMANDS = COMMAND_CATALOG.map((command) => command.name);

export function buildCommandHelpText(): string {
  const lines = [
    "Commands",
    ...COMMAND_CATALOG.map((command) => `  ${command.name.padEnd(10)} ${command.desc}`.trimEnd()),
    "No / prefix → AI analysis",
  ];
  return lines.join("\n");
}
