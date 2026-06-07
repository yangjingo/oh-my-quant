import type { CodeEntry } from "./local-snapshot.ts";

export interface ComposerSuggestion {
  label: string;
  fill: string;
}

interface CmdAction {
  label: string;
  fill: string;
}

interface CmdDef {
  name: string;
  desc: string;
  actions?: CmdAction[];
}

const CMDS: CmdDef[] = [
  { name: "/claw", desc: "Snapshot fund info" },
  {
    name: "/skill", desc: "List or trigger skills",
    actions: [
      { label: "Show all skills", fill: "/skill" },
      { label: "Trigger a skill", fill: "/skill trigger " },
    ],
  },
  {
    name: "/watch", desc: "Manage fund watchlist",
    actions: [
      { label: "Show watchlist", fill: "/watch" },
      { label: "Add fund", fill: "/watch " },
      { label: "Remove fund", fill: "/watch remove " },
    ],
  },
  { name: "/portfolio", desc: "Alias for config" },
  { name: "/config", desc: "Interactive settings" },
  { name: "/setup", desc: "Interactive settings" },
  { name: "/benchmark", desc: "Strategy scoring dashboard" },
  {
    name: "/mcp", desc: "Connect to data servers",
    actions: [
      { label: "Show status", fill: "/mcp" },
      { label: "Connect all servers", fill: "/mcp connect" },
    ],
  },
  { name: "/help", desc: "Show all commands" },
  { name: "/clear", desc: "Clear conversation" },
  { name: "/exit", desc: "Exit WhyJ Quant" },
];

export function buildSuggestions(value: string, watchlist: CodeEntry[]): ComposerSuggestion[] {
  if (!value || value.startsWith(" ")) return [];

  const codeMatch = value.match(/^(.+--(code|symbol)\s+)(\S*)$/i);
  if (codeMatch) {
    const prefix = codeMatch[1];
    const partial = codeMatch[3].toLowerCase();
    if (!partial) return [];
    return watchlist
      .filter((c) => c.code.toLowerCase().includes(partial) || c.name.toLowerCase().includes(partial))
      .slice(0, 8)
      .map((c) => ({ label: `${c.code.split(".")[0]}  ${c.name}`, fill: prefix + c.code }));
  }

  const nameMatch = value.match(/^(.+--name\s+)(\S*)$/i);
  if (nameMatch) {
    const prefix = nameMatch[1];
    const partial = nameMatch[2].toLowerCase();
    if (!partial) return [];
    return watchlist
      .filter((c) => c.name.toLowerCase().includes(partial))
      .slice(0, 8)
      .map((c) => ({ label: c.name, fill: prefix + c.name }));
  }

  if (!value.startsWith("/")) return [];

  const exact = CMDS.find((c) => c.name === value && c.actions?.length);
  if (exact?.actions) return exact.actions.map((a) => ({ label: a.label, fill: a.fill }));

  const exactLeaf = CMDS.find((c) => c.name === value && !c.actions?.length);
  if (exactLeaf) return [];

  const lower = value.toLowerCase();
  return CMDS
    .filter((c) => c.name.toLowerCase().startsWith(lower))
    .slice(0, 8)
    .map((c) => ({ label: `${c.name}  ${c.desc}`, fill: c.name }));
}
