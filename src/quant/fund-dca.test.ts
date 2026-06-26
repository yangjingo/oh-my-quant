import { describe, expect, it } from "bun:test";
import type { FundNavDaily } from "../source/index.ts";
import { buildDcaSchedule, calculateXirr, runDcaBacktest } from "./fund-dca.ts";

describe("fund DCA backtest", () => {
  it("aligns scheduled buys to the next available NAV date", () => {
    const result = runDcaBacktest(sampleNav(), {
      startDate: "2020-01-01",
      endDate: "2020-03-31",
      frequency: "monthly",
      investAmount: 1000,
      investDay: 1,
      purchaseFeeRate: 0,
    });

    expect(result.trades.map((trade) => [trade.scheduledDate, trade.tradeDate])).toEqual([
      ["2020-01-01", "2020-01-02"],
      ["2020-02-01", "2020-02-03"],
      ["2020-03-01", "2020-03-02"],
    ]);
    expect(result.summary.tradeCount).toBe(3);
    expect(result.summary.totalPrincipal).toBe(3000);
    expect(result.summary.finalMarketValue).toBeCloseTo((1000 / 1 + 1000 / 1.1 + 1000 / 1.2) * 1.3, 6);
    expect(result.summary.returnRate).toBeGreaterThan(0);
    expect(result.summary.xirr).toBeGreaterThan(0);
  });

  it("normalizes percent-like fee input and records purchase fee", () => {
    const result = runDcaBacktest(sampleNav().slice(0, 2), {
      startDate: "2020-01-01",
      endDate: "2020-01-02",
      investAmount: 1000,
      purchaseFeeRate: 0.13,
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.purchaseFee).toBeGreaterThan(1);
    expect(result.trades[0]!.purchaseFee).toBeLessThan(2);
  });

  it("builds weekly and quarterly schedules", () => {
    expect(buildDcaSchedule("2020-01-01", "2020-01-20", "weekly", 1)).toEqual([
      "2020-01-06",
      "2020-01-13",
      "2020-01-20",
    ]);
    expect(buildDcaSchedule("2020-01-01", "2020-07-31", "quarterly", 31)).toEqual([
      "2020-01-31",
      "2020-04-30",
      "2020-07-31",
    ]);
  });

  it("returns null XIRR when cashflows cannot be solved", () => {
    expect(calculateXirr([{ date: "2020-01-01", amount: -1000 }])).toBeNull();
  });
});

function sampleNav(): FundNavDaily[] {
  return [
    nav("2020-01-02", 1),
    nav("2020-01-15", 0.9),
    nav("2020-02-03", 1.1),
    nav("2020-03-02", 1.2),
    nav("2020-03-31", 1.3),
  ];
}

function nav(navDate: string, unitNav: number): FundNavDaily {
  return {
    fundCode: "270042",
    navDate,
    unitNav,
    accumulatedNav: unitNav,
    dailyReturnPct: null,
    isOpenDay: true,
    source: "test",
  };
}
