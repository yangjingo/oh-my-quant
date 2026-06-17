import { describe, expect, it } from "bun:test";
import {
  BUILTIN_TOOL_REGISTRY,
  BUILTIN_TOOLS,
  builtinToolDisplay,
  findBuiltinTool,
  listBuiltinToolRegistrations,
} from "./registry.ts";

describe("built-in tool registry", () => {
  it("keeps a unique ordered list of enabled built-in tools", () => {
    expect(BUILTIN_TOOLS.map((tool) => tool.name)).toEqual([
      "fetch_bars",
      "search_symbols",
      "fetch_snapshot",
      "compute_factor",
      "run_backtest",
      "check_risk",
      "score_benchmark",
      "show_dashboard",
      "bash",
    ]);
    expect(new Set(BUILTIN_TOOL_REGISTRY.map((entry) => entry.tool.name)).size).toBe(BUILTIN_TOOL_REGISTRY.length);
  });

  it("finds tools and display metadata from the same registration", () => {
    expect(findBuiltinTool("check_risk")?.label).toBe("Risk");
    expect(builtinToolDisplay("check_risk")?.label).toBe("Quant.Risk");
    expect(builtinToolDisplay("fetch_bars")?.provider).toBe("akshare");
    expect(findBuiltinTool("missing_tool")).toBeUndefined();
  });

  it("groups registrations by domain", () => {
    expect(listBuiltinToolRegistrations("data").map((entry) => entry.tool.name)).toEqual([
      "fetch_bars",
      "search_symbols",
      "fetch_snapshot",
    ]);
    expect(listBuiltinToolRegistrations("system").map((entry) => entry.tool.name)).toEqual(["bash"]);
  });
});
