import { builtinToolDisplay } from "../../tools/registry.ts";

/** Project registered titles and a small validated context; never stringify arguments/results. */
export function toolPresentation(name: string, args?: unknown): { title: string; context?: string } {
  const title = builtinToolDisplay(name)?.title ?? "执行研究工具";
  if (!args || typeof args !== "object" || Array.isArray(args)) return { title };
  const input = args as Record<string, unknown>;
  if (name === "calculate_position_scenarios" && typeof input.shares === "number" && Number.isFinite(input.shares)
    && input.shares > 0 && input.shares <= 1e12 && Array.isArray(input.changes) && input.changes.length > 0 && input.changes.length <= 100) {
    return { title, context: `${input.shares} 股 · ${input.changes.length} 个情景` };
  }
  // Only a market identifier is public here; paths, queries, prompts and arbitrary fields are not.
  const symbol = input.symbol ?? input.code;
  if (["fetch_bars", "fetch_bars_archive", "fetch_snapshot", "compute_factor", "run_backtest", "check_risk", "analyze_archived_bars"].includes(name)
    && typeof symbol === "string" && /^[A-Z0-9][A-Z0-9._-]{0,20}$/.test(symbol)) return { title, context: symbol };
  return { title };
}
