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
  { name: "/data", desc: "Download/info", help: "Download data or show symbol info", example: "/data download --symbol 000001.SZ", subcommands: ["download", "info"] },
  { name: "/factor", desc: "Factor analysis", help: "List or compute factors", example: "/factor analyze --symbol CODE --factor momentum", subcommands: ["list", "analyze"] },
  { name: "/backtest", desc: "SMA backtest", help: "Run SMA backtests", example: "/backtest run --symbol CODE --fast 20 --slow 60", subcommands: ["run"] },
  { name: "/risk", desc: "Risk metrics", help: "Check risk metrics", example: "/risk check --symbol CODE", subcommands: ["check"] },
  { name: "/benchmark", desc: "Score/dashboard", help: "Run scoring or show dashboard", example: "/benchmark run --symbol CODE", subcommands: ["run", "dashboard"] },
  { name: "/compare", desc: "Compare fund groups", help: "Classify and compare fund groups by risk/sector", example: "/compare run --rule volatility --threshold 0.25", subcommands: ["run"] },
  { name: "/market", desc: "Refresh Overview", help: "Pull live market + portfolio quotes into Overview dock", example: "/market", actions: [
    { label: "Refresh Overview", fill: "/market" },
  ] },
  { name: "/compact", desc: "Compact session", help: "Compact the active harness-backed session", example: "/compact focus on signals" },
  { name: "/session", desc: "Harness session", help: "Inspect, compact, or navigate the current harness-backed session", example: "/session", subcommands: ["info", "entries", "goto", "compact", "reset"] },
  { name: "/add", desc: "Watchlist", help: "Add/list/remove watchlist stocks", example: "/add stock --code CODE --name NAME", subcommands: ["stock", "list", "remove"] },
  { name: "/panel", desc: "Overview portfolio (CLI)", help: "Manage panel-portfolio.json from terminal", compatibility: true, example: "/panel 510300.SH --name 沪深300ETF" },
  { name: "/config", desc: "Settings", help: "Show config status", example: "/config" },
  { name: "/setup", desc: "Credentials setup", help: "Show or save API keys", compatibility: true, example: "/setup whyj sk-..." },
  { name: "/mcp", desc: "Connect to data servers", help: "MCP server status / connect", example: "/mcp connect", actions: [
    { label: "Show status", fill: "/mcp" },
    { label: "Connect all servers", fill: "/mcp connect" },
  ] },
  { name: "/help", desc: "Show all commands", help: "Show all commands" },
  { name: "/clear", desc: "Clear conversation", help: "Clear conversation" },
  { name: "/exit", desc: "Exit WhyJ Quant", help: "Exit WhyJ Quant" },
  { name: "/skill", desc: "Discover skills", help: "List discovered pi/codex/agents skills", compatibility: true, example: "/skill info whyj-quant", actions: [
    { label: "Show all skills", fill: "/skill" },
    { label: "Inspect a skill", fill: "/skill info " },
    { label: "Invoke a skill", fill: "/skill:" },
  ] },
  { name: "/claw", desc: "Snapshot fund info", help: "Snapshot fund info", compatibility: true },
  { name: "/watch", desc: "Manage fund watchlist", help: "Manage fund watchlist", compatibility: true, actions: [
    { label: "Show watchlist", fill: "/watch" },
    { label: "Add fund", fill: "/watch " },
    { label: "Remove fund", fill: "/watch remove " },
  ] },
  { name: "/portfolio", desc: "Portfolio manager", help: "Add/list/remove the Overview portfolio symbols", example: "/portfolio add 510300.SH --name 沪深300ETF", subcommands: ["add", "list", "remove"] },
  { name: "/panel", desc: "Portfolio manager", help: "Alias for /portfolio", compatibility: true, example: "/panel add 510300.SH --name 沪深300ETF", subcommands: ["add", "list", "remove"] },
];

export const SLASH_COMMANDS = COMMAND_CATALOG.map((command) => command.name);

export function buildCommandHelpText(): string {
  const primary = COMMAND_CATALOG.filter((command) => !command.compatibility);
  const compatibility = COMMAND_CATALOG.filter((command) => command.compatibility);
  const lines = [
    "Commands:",
    "",
    ...primary.map((command) => `  ${command.name.padEnd(10)} ${command.desc.padEnd(18)} ${command.example ?? command.help}`.trimEnd()),
    "",
    `Compatibility: ${compatibility.map((command) => command.name).join("  ")}`,
    "",
    "No / prefix -> AI analysis.",
  ];
  return lines.join("\n");
}
