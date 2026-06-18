import { describe, expect, it } from "bun:test";
import { classifySymbols, volatilityRule, drawdownRule, sectorRule } from "./auto-classify.ts";
import type { SymbolProfile } from "./auto-classify.ts";

function rm(overrides: Partial<{
  annualVol: number; maxDrawdown: number;
  downsideVol: number; var95: number; var99: number; var95Parametric: number;
  cvar95: number; cvar99: number; maxDdDays: number; skewness: number; kurtosis: number;
}> = {}) {
  return {
    annualVol: 0.25, maxDrawdown: -0.15, downsideVol: 0.18,
    var95: -0.02, var99: -0.03, var95Parametric: -0.025,
    cvar95: -0.025, cvar99: -0.035, maxDdDays: 30,
    skewness: -0.5, kurtosis: 3.2,
    ...overrides,
  };
}

describe("auto-classify", () => {
  it("classifies symbols by volatility threshold", () => {
    const profiles: SymbolProfile[] = [
      { code: "000001", name: "高波动基金A", riskMetrics: rm({ annualVol: 0.35, maxDrawdown: -0.2 }) },
      { code: "000002", name: "低波动基金B", riskMetrics: rm({ annualVol: 0.15, maxDrawdown: -0.1 }) },
      { code: "000003", name: "高波动基金C", riskMetrics: rm({ annualVol: 0.40, maxDrawdown: -0.25 }) },
    ];

    const result = classifySymbols(profiles, [volatilityRule(profiles[0], 0.25)]);
    expect(result.length).toBe(1);
    expect(result[0].groupName).toBe("高波动");
    expect(result[0].symbolCodes).toContain("000001");
    expect(result[0].symbolCodes).toContain("000003");
    expect(result[0].symbolCodes).not.toContain("000002");
  });

  it("classifies symbols by max drawdown threshold", () => {
    const profiles: SymbolProfile[] = [
      { code: "000001", name: "基金A", riskMetrics: rm({ maxDrawdown: -0.30 }) },
      { code: "000002", name: "基金B", riskMetrics: rm({ maxDrawdown: -0.10 }) },
    ];

    const result = classifySymbols(profiles, [drawdownRule(profiles[0], -0.20)]);
    expect(result.length).toBe(1);
    expect(result[0].groupName).toBe("最大回撤超标");
    expect(result[0].symbolCodes).toEqual(["000001"]);
  });

  it("classifies symbols by sector", () => {
    const profiles: SymbolProfile[] = [
      { code: "000001", name: "科技基金A", sector: "科技" },
      { code: "000002", name: "消费基金B", sector: "消费" },
      { code: "000003", name: "科技基金C", sector: "科技" },
    ];

    const result = classifySymbols(profiles, [sectorRule("科技")]);
    expect(result.length).toBe(1);
    expect(result[0].groupName).toBe("科技");
    expect(result[0].symbolCodes).toEqual(["000001", "000003"]);
  });

  it("supports multi-membership (symbol in multiple groups)", () => {
    const profiles: SymbolProfile[] = [
      { code: "000001", name: "高波动科技A", sector: "科技", riskMetrics: rm({ annualVol: 0.35, maxDrawdown: -0.30 }) },
      { code: "000002", name: "低波动消费B", sector: "消费", riskMetrics: rm({ annualVol: 0.15, maxDrawdown: -0.10 }) },
    ];

    const result = classifySymbols(profiles, [
      volatilityRule(profiles[0], 0.25),
      sectorRule("科技"),
    ]);

    expect(result.length).toBe(2);
    const highVolGroup = result.find((g) => g.groupName === "高波动");
    const techGroup = result.find((g) => g.groupName === "科技");
    expect(highVolGroup?.symbolCodes).toEqual(["000001"]);
    expect(techGroup?.symbolCodes).toEqual(["000001"]);
  });

  it("returns empty groups when no symbols match", () => {
    const profiles: SymbolProfile[] = [
      { code: "000001", name: "基金A", riskMetrics: rm({ annualVol: 0.15, maxDrawdown: -0.10 }) },
    ];

    const result = classifySymbols(profiles, [volatilityRule(profiles[0], 0.50)]);
    expect(result.length).toBe(0);
  });

  it("handles symbols without risk metrics", () => {
    const profiles: SymbolProfile[] = [
      { code: "000001", name: "基金A" },
      { code: "000002", name: "基金B", riskMetrics: rm({ annualVol: 0.35, maxDrawdown: -0.20 }) },
    ];

    const result = classifySymbols(profiles, [volatilityRule(profiles[0], 0.25)]);
    expect(result.length).toBe(1);
    expect(result[0].symbolCodes).toEqual(["000002"]);
  });

  it("merges codes when two rules slugify to the same group id", () => {
    const profiles: SymbolProfile[] = [
      { code: "000001", name: "高波动A", riskMetrics: rm({ annualVol: 0.35 }) },
      { code: "000002", name: "低波动B", riskMetrics: rm({ annualVol: 0.15 }) },
      { code: "000003", name: "无风险C" },
    ];

    const result = classifySymbols(profiles, [
      { groupName: "合并组", predicate: (p) => p.riskMetrics !== undefined && p.riskMetrics.annualVol > 0.25 },
      { groupName: "合并组", predicate: (p) => p.code === "000003" },
    ]);

    expect(result.length).toBe(1);
    expect(result[0].symbolCodes).toContain("000001");
    expect(result[0].symbolCodes).toContain("000003");
  });
});
