import { describe, expect, it } from "bun:test";
import { classifySymbols, volatilityRule, drawdownRule, sectorRule } from "./auto-classify.ts";
import type { SymbolProfile } from "./auto-classify.ts";

describe("auto-classify", () => {
  it("classifies symbols by volatility threshold", () => {
    const profiles: SymbolProfile[] = [
      { code: "000001", name: "高波动基金A", riskMetrics: { annualVol: 0.35, maxDrawdown: -0.2, sharpe: 1.2, var95: -0.02, var99: -0.03, cvar95: -0.025, cvar99: -0.035, skewness: -0.5, kurtosis: 3.2 } },
      { code: "000002", name: "低波动基金B", riskMetrics: { annualVol: 0.15, maxDrawdown: -0.1, sharpe: 1.5, var95: -0.01, var99: -0.015, cvar95: -0.012, cvar99: -0.018, skewness: -0.2, kurtosis: 2.5 } },
      { code: "000003", name: "高波动基金C", riskMetrics: { annualVol: 0.40, maxDrawdown: -0.25, sharpe: 0.8, var95: -0.025, var99: -0.04, cvar95: -0.03, cvar99: -0.045, skewness: -0.8, kurtosis: 4.0 } },
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
      { code: "000001", name: "基金A", riskMetrics: { annualVol: 0.25, maxDrawdown: -0.30, sharpe: 1.0, var95: -0.02, var99: -0.03, cvar95: -0.025, cvar99: -0.035, skewness: -0.5, kurtosis: 3.2 } },
      { code: "000002", name: "基金B", riskMetrics: { annualVol: 0.15, maxDrawdown: -0.10, sharpe: 1.5, var95: -0.01, var99: -0.015, cvar95: -0.012, cvar99: -0.018, skewness: -0.2, kurtosis: 2.5 } },
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
      { code: "000001", name: "高波动科技A", sector: "科技", riskMetrics: { annualVol: 0.35, maxDrawdown: -0.30, sharpe: 0.8, var95: -0.025, var99: -0.04, cvar95: -0.03, cvar99: -0.045, skewness: -0.8, kurtosis: 4.0 } },
      { code: "000002", name: "低波动消费B", sector: "消费", riskMetrics: { annualVol: 0.15, maxDrawdown: -0.10, sharpe: 1.5, var95: -0.01, var99: -0.015, cvar95: -0.012, cvar99: -0.018, skewness: -0.2, kurtosis: 2.5 } },
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
      { code: "000001", name: "基金A", riskMetrics: { annualVol: 0.15, maxDrawdown: -0.10, sharpe: 1.5, var95: -0.01, var99: -0.015, cvar95: -0.012, cvar99: -0.018, skewness: -0.2, kurtosis: 2.5 } },
    ];

    const result = classifySymbols(profiles, [volatilityRule(profiles[0], 0.50)]);
    expect(result.length).toBe(0);
  });

  it("handles symbols without risk metrics", () => {
    const profiles: SymbolProfile[] = [
      { code: "000001", name: "基金A" },
      { code: "000002", name: "基金B", riskMetrics: { annualVol: 0.35, maxDrawdown: -0.20, sharpe: 1.0, var95: -0.02, var99: -0.03, cvar95: -0.025, cvar99: -0.035, skewness: -0.5, kurtosis: 3.2 } },
    ];

    const result = classifySymbols(profiles, [volatilityRule(profiles[0], 0.25)]);
    expect(result.length).toBe(1);
    expect(result[0].symbolCodes).toEqual(["000002"]);
  });
});
