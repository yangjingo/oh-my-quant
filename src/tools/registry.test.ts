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
    const names = BUILTIN_TOOLS.map((tool) => tool.name);
    expect(names.slice(0, 3)).toEqual(["fetch_bars", "search_symbols", "fetch_snapshot"]);
    expect(names).toContain("fetch_index_spot");
    expect(names).toContain("fetch_index_info");
    expect(names).toContain("fetch_index_constituents");
    expect(names).toContain("fetch_index_rows");
    expect(names).toContain("akshare_fund_nav");
    expect(names).toContain("akshare_fund_fee");
    expect(names).toContain("akshare_fund_fund_open_fund_info_em");
    expect(names).toContain("akshare_fund_fund_purchase_em");
    expect(names).toContain("akshare_fund_fund_fee_em");
    expect(names).toContain("akshare_fund_fund_individual_achievement_xq");
    expect(names).toContain("fund_dca_backtest");
    expect(names.at(-1)).toBe("bash");
    expect(new Set(BUILTIN_TOOL_REGISTRY.map((entry) => entry.tool.name)).size).toBe(BUILTIN_TOOL_REGISTRY.length);
  });

  it("finds tools and display metadata from the same registration", () => {
    expect(findBuiltinTool("check_risk")?.label).toBe("Risk");
    expect(builtinToolDisplay("check_risk")?.label).toBe("Quant.Risk");
    expect(builtinToolDisplay("fetch_bars")?.provider).toBe("akshare");
    expect(builtinToolDisplay("fetch_index_spot")?.label).toBe("AKShare · Index Spot");
    expect(builtinToolDisplay("fetch_index_info")?.label).toBe("AKShare · Index Info");
    expect(builtinToolDisplay("fetch_index_constituents")?.label).toBe("AKShare · Index Constituents");
    expect(builtinToolDisplay("fetch_index_rows")?.provider).toBe("akshare");
    expect(builtinToolDisplay("akshare_fund_nav")?.label).toBe("Tool.akshare.fund.nav");
    expect(builtinToolDisplay("akshare_fund_fee")?.label).toBe("Tool.akshare.fund.fee");
    expect(builtinToolDisplay("akshare_fund_fund_open_fund_info_em")?.label).toBe("Tool.akshare.fund.fund_open_fund_info_em");
    expect(builtinToolDisplay("fund_dca_backtest")?.label).toBe("Tool.quant.fund.dca");
    expect(findBuiltinTool("missing_tool")).toBeUndefined();
  });

  it("groups registrations by domain", () => {
    const dataTools = listBuiltinToolRegistrations("data").map((entry) => entry.tool.name);
    expect(dataTools.slice(0, 3)).toEqual(["fetch_bars", "search_symbols", "fetch_snapshot"]);
    expect(dataTools).toContain("fetch_index_spot");
    expect(dataTools).toContain("fetch_index_info");
    expect(dataTools).toContain("fetch_index_constituents");
    expect(dataTools).toContain("fetch_index_rows");
    expect(dataTools).toContain("akshare_fund_fund_overview_em");
    expect(dataTools).toContain("akshare_fund_fund_portfolio_hold_em");
    expect(listBuiltinToolRegistrations("quant").map((entry) => entry.tool.name)).toContain("fund_dca_backtest");
    expect(listBuiltinToolRegistrations("system").map((entry) => entry.tool.name)).toEqual(["bash"]);
  });
});