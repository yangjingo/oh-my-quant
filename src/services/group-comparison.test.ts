import { describe, expect, it } from "bun:test";
import {
  synthesizeEqualWeightNav,
  groupRiskFromNav,
  totalReturn,
} from "./group-comparison.ts";

describe("group-comparison service", () => {
  describe("synthesizeEqualWeightNav", () => {
    it("returns empty array for no symbols", () => {
      const result = synthesizeEqualWeightNav(new Map());
      expect(result).toEqual([]);
    });

    it("synthesizes equal-weight NAV from two symbols", () => {
      const symbolReturns = new Map([
        ["A", new Map([["2024-01-01", 0.0], ["2024-01-02", 0.1], ["2024-01-03", -0.05]])],
        ["B", new Map([["2024-01-01", 0.0], ["2024-01-02", -0.02], ["2024-01-03", 0.03]])],
      ]);
      const nav = synthesizeEqualWeightNav(symbolReturns);
      expect(nav.length).toBe(3);
      expect(nav[0].date).toBe("2024-01-01");
      expect(nav[0].nav).toBe(1.0);
      // Day 2: (0.1 + -0.02) / 2 = 0.04, nav = 1.0 * 1.04 = 1.04
      expect(nav[1].date).toBe("2024-01-02");
      expect(nav[1].nav).toBeCloseTo(1.04, 5);
      // Day 3: (-0.05 + 0.03) / 2 = -0.01, nav = 1.04 * 0.99 = 1.0296
      expect(nav[2].date).toBe("2024-01-03");
      expect(nav[2].nav).toBeCloseTo(1.0296, 5);
    });

    it("handles single symbol", () => {
      const symbolReturns = new Map([
        ["A", new Map([["2024-01-01", 0.0], ["2024-01-02", 0.1]])],
      ]);
      const nav = synthesizeEqualWeightNav(symbolReturns);
      expect(nav.length).toBe(2);
      expect(nav[1].nav).toBeCloseTo(1.1, 5);
    });

    it("skips dates with no common data", () => {
      const symbolReturns = new Map([
        ["A", new Map([["2024-01-01", 0.0], ["2024-01-03", 0.05]])],
        ["B", new Map([["2024-01-01", 0.0], ["2024-01-02", 0.02]])],
      ]);
      const nav = synthesizeEqualWeightNav(symbolReturns);
      // Only 2024-01-01 is common
      expect(nav.length).toBe(1);
      expect(nav[0].date).toBe("2024-01-01");
    });
  });

  describe("groupRiskFromNav", () => {
    it("returns null for too-short series", () => {
      expect(groupRiskFromNav([])).toBeNull();
      expect(groupRiskFromNav([{ date: "2024-01-01", nav: 1.0 }])).toBeNull();
    });

    it("computes risk metrics from NAV series", () => {
      const nav = [
        { date: "2024-01-01", nav: 1.0 },
        { date: "2024-01-02", nav: 1.02 },
        { date: "2024-01-03", nav: 1.01 },
        { date: "2024-01-04", nav: 1.03 },
        { date: "2024-01-05", nav: 1.05 },
      ];
      const risk = groupRiskFromNav(nav);
      expect(risk).not.toBeNull();
      expect(risk!.annualVol).toBeGreaterThan(0);
      expect(typeof risk!.maxDrawdown).toBe("number");
      expect(risk!.maxDrawdown).toBeLessThanOrEqual(0);
    });
  });

  describe("totalReturn", () => {
    it("returns 0 for empty or single-point series", () => {
      expect(totalReturn([])).toBe(0);
      expect(totalReturn([{ date: "2024-01-01", nav: 1.0 }])).toBe(0);
    });

    it("computes total return correctly", () => {
      const nav = [
        { date: "2024-01-01", nav: 1.0 },
        { date: "2024-01-02", nav: 1.1 },
      ];
      expect(totalReturn(nav)).toBeCloseTo(0.1, 5);
    });

    it("handles negative return", () => {
      const nav = [
        { date: "2024-01-01", nav: 1.0 },
        { date: "2024-01-02", nav: 0.95 },
      ];
      expect(totalReturn(nav)).toBeCloseTo(-0.05, 5);
    });
  });
});
