import type { AgentTool } from "../agent/src/pi/index.ts";
import { SYSTEM_TOOLS } from "./bash-tool.ts";
import { DATA_TOOLS } from "./data-tools.ts";
import { COMPUTE_TOOLS } from "./quant-tools.ts";
import { shellDisplayName } from "./shell.ts";

export type BuiltinToolDomain = "data" | "quant" | "system";

export type DataProvider =
  | "akshare"
  | "tushare"
  | "llmquant"
  | "financial-datasets"
  | "joinquant";

export interface ToolDisplay {
  label: string;
  provider?: DataProvider;
}

export interface BuiltinToolRegistration {
  tool: AgentTool;
  domain: BuiltinToolDomain;
  display: ToolDisplay;
  enabledByDefault?: boolean;
}

function defineBuiltinTools(registrations: BuiltinToolRegistration[]): BuiltinToolRegistration[] {
  const seen = new Set<string>();
  for (const registration of registrations) {
    const name = registration.tool.name;
    if (seen.has(name)) throw new Error(`Duplicate built-in tool registration: ${name}`);
    seen.add(name);
  }
  return registrations;
}

function mustTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing built-in tool implementation: ${name}`);
  return tool;
}

const DEFAULT_BUILTIN_TOOL_REGISTRATIONS: BuiltinToolRegistration[] = [
  { tool: mustTool(DATA_TOOLS, "fetch_bars"), domain: "data", display: { label: "AKShare · Daily Bars", provider: "akshare" } },
  { tool: mustTool(DATA_TOOLS, "search_symbols"), domain: "data", display: { label: "Tushare · Search", provider: "joinquant" } },
  { tool: mustTool(DATA_TOOLS, "fetch_snapshot"), domain: "data", display: { label: "Direct · Snapshot" } },

  { tool: mustTool(COMPUTE_TOOLS, "compute_factor"), domain: "quant", display: { label: "Quant.Factor" } },
  { tool: mustTool(COMPUTE_TOOLS, "run_backtest"), domain: "quant", display: { label: "Quant.Backtest" } },
  { tool: mustTool(COMPUTE_TOOLS, "check_risk"), domain: "quant", display: { label: "Quant.Risk" } },
  { tool: mustTool(COMPUTE_TOOLS, "score_benchmark"), domain: "quant", display: { label: "Quant.Benchmark" } },
  { tool: mustTool(COMPUTE_TOOLS, "show_dashboard"), domain: "quant", display: { label: "Quant.Dashboard" } },

  { tool: mustTool(SYSTEM_TOOLS, "bash"), domain: "system", display: { label: shellDisplayName() } },
];

export const BUILTIN_TOOL_REGISTRY = defineBuiltinTools(
  DEFAULT_BUILTIN_TOOL_REGISTRATIONS.map((registration) => ({ enabledByDefault: true, ...registration })),
);

export const BUILTIN_TOOLS: AgentTool[] = BUILTIN_TOOL_REGISTRY
  .filter((registration) => registration.enabledByDefault !== false)
  .map((registration) => registration.tool);

export function listBuiltinToolRegistrations(domain?: BuiltinToolDomain): BuiltinToolRegistration[] {
  return BUILTIN_TOOL_REGISTRY.filter((registration) => !domain || registration.domain === domain);
}

export function findBuiltinTool(name: string): AgentTool | undefined {
  return BUILTIN_TOOL_REGISTRY.find((registration) => registration.tool.name === name)?.tool;
}

export function builtinToolDisplay(name: string): ToolDisplay | undefined {
  return BUILTIN_TOOL_REGISTRY.find((registration) => registration.tool.name === name)?.display;
}
