/** Tool labels shown in Conversation + session transcripts. */

import { builtinToolDisplay } from "./registry.ts";
import { shellDisplayName } from "./shell.ts";
export type { DataProvider, ToolDisplay } from "./registry.ts";
export { shellDisplayName } from "./shell.ts";

export const DATA_SOURCE_PROMPTS: ReadonlyArray<{
  label: string;
  hint: string;
  prompt: string;
}> = [
  { label: "AKShare bars", hint: "A-share / fund", prompt: "Use Quant.Factor with --source akshare for CODE" },
  { label: "Tushare bars", hint: "A-share direct", prompt: "Use Quant.Factor with --source tushare for CODE" },
  { label: "LLMQuant bars", hint: "US / HK direct", prompt: "Use Quant.Factor with --source llmquant-data for CODE" },
  { label: "FD bars", hint: "US direct", prompt: "Use Quant.Factor with --source financial-datasets for CODE" },
  { label: "JoinQuant bars", hint: "聚宽 JQData", prompt: "Use Quant.Factor with --source joinquant for CODE" },
];

export function toolDisplayLabel(toolName: string): string {
  if (toolName === "bash") return shellDisplayName();
  return builtinToolDisplay(toolName)?.label ?? toolName.replace(/_/g, " ");
}

export function toolSpecificLabel(toolName: string): string {
  switch (toolName) {
    case "compute_factor": return "Factor";
    case "run_backtest": return "Backtest";
    case "check_risk": return "Risk";
    case "score_benchmark": return "Benchmark";
    case "show_dashboard": return "Dashboard";
    case "bash": return "Shell";
    default: return toolName.replace(/_/g, " ");
  }
}

export function formatToolLine(toolName: string, args?: string): string {
  const label = toolNamespacedLabel(toolName, args);
  return args ? `${label} · ${args}` : label;
}

export function toolNamespacedLabel(toolName: string, args?: string): string {
  if (toolName === "bash") return `${shellDisplayName()}.${classifyBashCommand(args)}`;
  return toolDisplayLabel(toolName);
}

export function formatToolArgs(args: unknown, options: { truncate?: boolean } = {}): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const a = args as Record<string, unknown>;
  const value = a.command || a.symbol || a.ts_code || a.ticker || a.code || a.factor;
  if (!value) return undefined;
  const text = String(value);
  if (options.truncate === false) return text;
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

export function formatCompletedToolLine(
  toolName: string,
  args?: string,
  result?: string,
  isError = false,
): string {
  if (isError || toolName !== "bash") return formatToolLine(toolName, args);
  const action = classifyBashCommand(args);
  if (action !== "Write" && action !== "Update") return formatToolLine(toolName, args);
  const target = extractChangedPath(args, result);
  if (!target) return formatToolLine(toolName, args);
  const stats = formatDiffStats(result);
  const verb = inferChangeVerb(args, result);
  return `${verb} ${target}${stats ? ` ${stats}` : ""}`;
}

export function normalizeDataSourceFlag(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (s === "llmquant-data" || s === "llmquant_data") return "llmquant";
  if (s === "jointquant" || s === "jq" || s === "jqdata") return "joinquant";
  return s;
}

function classifyBashCommand(args?: string): "Read" | "Write" | "Update" | "Shell" {
  const command = (args || "").trim().toLowerCase();
  if (!command) return "Shell";
  if (looksLikeUpdateCommand(command)) return "Update";
  if (looksLikeWriteCommand(command)) return "Write";
  if (looksLikeReadCommand(command)) return "Read";
  return "Shell";
}

function looksLikeReadCommand(command: string): boolean {
  return /^(get-content|gc|cat|type|rg|grep|select-string|findstr|ls|dir|get-childitem|gci|pwd|tree|where|which|git\s+(status|diff|log|show)\b|bun\s+test\b|bun\s+run\s+(typecheck|tsc)\b|npx\s+tsc\b)/.test(command);
}

function looksLikeWriteCommand(command: string): boolean {
  return /\b(set-content|add-content|out-file|new-item|copy-item|move-item|mkdir|touch|tee-object)\b/.test(command)
    || /(^|[^>])>{1,2}([^>&]|$)/.test(command)
    || /\b(bun|npm|pnpm|yarn)\s+(add|install|remove)\b/.test(command);
}

function looksLikeUpdateCommand(command: string): boolean {
  return /\b(apply_patch|git\s+(add|commit|merge|rebase|push|pull)|remove-item|rm|del|erase)\b/.test(command)
    || /\b(set-content|add-content|out-file)\b/.test(command) && /\b(get-content|gc|\-replace)\b/.test(command);
}

function extractChangedPath(args?: string, result?: string): string | null {
  return extractPathFromPatchText(result)
    || extractPathFromPatchText(args)
    || extractPathFromCommand(args);
}

function extractPathFromPatchText(text?: string): string | null {
  if (!text) return null;
  const patterns = [
    /^\*\*\* (?:Add|Update|Delete) File:\s+(.+)$/m,
    /^diff --git a\/(.+?) b\/.+$/m,
    /^--- a\/(.+)$/m,
    /^\+\+\+ b\/(.+)$/m,
    /^[MAD]\s+(.+)$/m,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const cleaned = cleanPathToken(match?.[1]);
    if (cleaned) return cleaned;
  }
  return null;
}

function extractPathFromCommand(command?: string): string | null {
  if (!command) return null;
  const text = command.trim();
  const byNamedPath = text.match(/\s-(?:literalpath|path|filepath)\s+("[^"]+"|'[^']+'|[^\s|;]+)/i);
  const byWriteCmd = text.match(/\b(?:set-content|add-content|new-item|out-file|tee-object|touch|mkdir)\s+("[^"]+"|'[^']+'|[^\s|;]+)/i);
  const byCopyMove = text.match(/\b(?:copy-item|move-item)\s+("[^"]+"|'[^']+'|[^\s|;]+)\s+("[^"]+"|'[^']+'|[^\s|;]+)/i);
  const byRedirect = text.match(/(?:^|[^>])>{1,2}\s*("[^"]+"|'[^']+'|[^\s|;&]+)/);
  return cleanPathToken(byNamedPath?.[1])
    || cleanPathToken(byCopyMove?.[2])
    || cleanPathToken(byWriteCmd?.[1])
    || cleanPathToken(byRedirect?.[1]);
}

function cleanPathToken(raw?: string): string | null {
  if (!raw) return null;
  const cleaned = raw
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/^[ab]\//, "")
    .replace(/[),;]+$/g, "");
  if (!cleaned || cleaned === "/dev/null") return null;
  return cleaned;
}

function inferChangeVerb(args?: string, result?: string): "Added" | "Edited" | "Deleted" {
  const text = `${args || ""}\n${result || ""}`;
  if (/^\*\*\* Add File:|^A\s+/m.test(text) || /\bnew-item\b/i.test(args || "")) return "Added";
  if (/^\*\*\* Delete File:|^D\s+/m.test(text) || /\b(remove-item|rm|del|erase)\b/i.test(args || "")) return "Deleted";
  return "Edited";
}

function formatDiffStats(result?: string): string | null {
  if (!result) return null;
  let added = 0;
  let removed = 0;
  for (const line of result.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    if (line.startsWith("-")) removed++;
  }
  if (added === 0 && removed === 0) return null;
  return `(+${added} -${removed})`;
}
