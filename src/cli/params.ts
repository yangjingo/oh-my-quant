import type { CommandResult } from "./types.ts";

export function normalizeToolParams(
  flags: Record<string, string | number | boolean>,
  defaults: Record<string, unknown> = {},
): Record<string, unknown> {
  const params: Record<string, unknown> = { ...defaults };
  const remap: Record<string, string> = {
    code: "symbol",
    c: "symbol",
    symbol: "symbol",
    s: "symbol",
    market: "market",
    m: "market",
    factor: "factor",
    f: "factor",
    period: "period",
    p: "period",
    fast: "fast",
    slow: "slow",
    cash: "cash",
    benchmark: "benchmark_symbol",
    benchmarkSymbol: "benchmark_symbol",
    "benchmark-symbol": "benchmark_symbol",
    label: "label",
    source: "source",
    start: "start",
    end: "end",
    start_date: "start_date",
    "start-date": "start_date",
    end_date: "end_date",
    "end-date": "end_date",
    frequency: "frequency",
    freq: "frequency",
    invest_amount: "invest_amount",
    "invest-amount": "invest_amount",
    invest_day: "invest_day",
    "invest-day": "invest_day",
    purchase_fee_rate: "purchase_fee_rate",
    "purchase-fee-rate": "purchase_fee_rate",
    "sort-by": "sort_by",
    sort: "sort_by",
  };

  for (const [key, value] of Object.entries(flags)) {
    const mappedKey = remap[key] || key;
    params[mappedKey] = coerceFlagValue(value);
  }
  return params;
}

function coerceFlagValue(value: string | number | boolean): string | number | boolean {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed !== "" && /^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return value;
}

export async function runQuantTool(
  name: string,
  flags: Record<string, string | number | boolean>,
  defaults: Record<string, unknown> = {},
): Promise<CommandResult> {
  try {
    const { findBuiltinTool } = await import("../tools/registry.ts");
    const tool = findBuiltinTool(name);
    if (!tool) return { success: false, message: `Tool "${name}" is unavailable in this build.` };

    const params = normalizeToolParams(flags, defaults);
    const preparedParams = tool.prepareArguments ? tool.prepareArguments(params) : params;
    const result = await tool.execute(`cli-${Date.now()}`, preparedParams, undefined);
    const text = result.content.map((c) => ("text" in c ? c.text : "[image]")).join("\n");
    return { success: true, message: text, data: result.details };
  } catch (err) {
    return { success: false, message: `Command failed.\nCause: ${err instanceof Error ? err.message : String(err)}` };
  }
}
