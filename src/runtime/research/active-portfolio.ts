import { loadPanelPortfolio } from "../../storage/index.ts";
import type { QuantAgentDependencies } from "../../agent/src/session.ts";
import { selectResearchPortfolio } from "../workspace/overview.ts";
import { normalizeSymbol } from "../../market/symbols.ts";

export function activeResearchSelection() {
  return selectResearchPortfolio(loadPanelPortfolio());
}

export type ResearchPortfolioSelection = ReturnType<typeof activeResearchSelection>;

export function researchSelectionKey(data = activeResearchSelection()): string {
  return JSON.stringify([data.groups.map(group => [group.id, group.symbolCodes]), data.symbols.map(entry => entry.code)]);
}

export function singlePortfolioToolDenial(toolName: string, input: unknown, selection?: ResearchPortfolioSelection): string | null {
  if (toolName === "compare_portfolios") return "Research supports one portfolio at a time. Cross-portfolio comparison is disabled.";
  if (toolName !== "research_task" || !input || typeof input !== "object") return null;
  const action = input as { action?: string; task?: { scope?: { groupIds?: unknown; symbols?: unknown; benchmark?: string }; criteria?: Array<{ tool?: string }> } };
  if (action.action !== "declare" || !action.task) return null;
  if (action.task.criteria?.some(item => item.tool === "compare_portfolios")) return "Research supports one portfolio at a time. Cross-portfolio criteria are disabled.";
  const groups = action.task.scope?.groupIds;
  const active = (selection ?? activeResearchSelection()).groups[0];
  if (Array.isArray(groups) && (groups.length > 1 || groups.some(id => id !== active?.id)))
    return "Research scope must use only the currently selected portfolio. Switch portfolios before starting another research task.";
  if (active && Array.isArray(action.task.scope?.symbols)) {
    const allowed = new Set([...active.symbolCodes, ...(action.task.scope?.benchmark ? [action.task.scope.benchmark] : [])].map(symbol => normalizeSymbol(symbol)));
    if (action.task.scope.symbols.some(symbol => typeof symbol !== "string" || !allowed.has(normalizeSymbol(symbol)))) return "Research scope contains symbols outside the currently selected portfolio.";
  }
  return null;
}

/** CLI host policy; saved comparisons and independent calculation services remain readable. */
export function withSinglePortfolioResearch(deps: QuantAgentDependencies, fixedSelection?: ResearchPortfolioSelection): QuantAgentDependencies {
  const selection = () => fixedSelection ?? activeResearchSelection();
  const tools = (items: QuantAgentDependencies["tools"]) => items.filter(tool => tool.name !== "compare_portfolios");
  const context = (input: string): string => {
    const data = selection(), group = data.groups[0];
    if (!group && !data.symbols.length) return input;
    return `${input}\n\nCurrent research portfolio: ${JSON.stringify({ id: group?.id, name: group?.name ?? "Portfolio", symbols: group?.symbolCodes ?? data.symbols.map(entry => entry.code) })}\nResearch only this portfolio. Do not merge or compare other portfolios. Ask the user to select another portfolio before changing the research scope. A separate market benchmark is allowed.`;
  };
  return {
    ...deps,
    tools: tools(deps.tools),
    ...(deps.readTools ? { readTools: () => { const snapshot = deps.readTools!(); return { ...snapshot, tools: tools(snapshot.tools) }; } } : {}),
    async beforeToolCall(call) {
      const result = await deps.beforeToolCall?.(call);
      if (result?.block) return result;
      const reason = singlePortfolioToolDenial(call.toolName, call.input, fixedSelection);
      return reason ? { block: true, reason, terminate: true } : result;
    },
    prompts: { ...deps.prompts, turn: (input, state) => context(deps.prompts.turn(input, state)),
      skill: (name, instructions) => context(deps.prompts.skill(name, instructions)) },
  };
}
