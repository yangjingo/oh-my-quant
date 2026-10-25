import { describe, expect, it } from "bun:test";
import { buildOverviewPanelSections, collectOverviewSymbols, MARKET_INDICES, overviewProviderSymbol } from "../workspace/overview.ts";

describe("runtime overview service", () => {
  it("builds grouped portfolio and market with one refresh event from overview rows", () => {
    const portfolio = {
      symbols: [{ code: "510300.SH", name: "沪深300ETF" }],
      groups: [{ id: "group-1", name: "核心组合", symbolCodes: ["510300.SH"] }],
    };
    const portfolioSymbols = collectOverviewSymbols(portfolio);
    const sections = buildOverviewPanelSections({
      portfolio,
      portfolioSymbols,
      marketQuotes: [{ code: "000001", name: "上证指数", price: 3000, pct: 1 }],
      portfolioRows: [],
      pullMeta: { sources: ["akshare"], asOfDates: ["2026-06-30"] },
      refreshedAt: new Date("2026-06-30T08:30:00.000Z"),
    });

    expect(MARKET_INDICES.map((entry) => entry.code)).toEqual(["000001.SH", "399001.SZ", "000300.SH", "000905.SH", "399006.SZ"]);
    expect(portfolioSymbols.map((entry) => entry.code)).toEqual(["510300.SH"]);
    expect(sections[0]).toMatchObject({
      kind: "group",
      groupId: "group-1",
      title: "核心组合",
      rows: [{ code: "510300.SH", name: "沪深300ETF", price: Number.NaN, pct: Number.NaN }],
      collapsed: false,
    });
    expect(sections.some((section) => section.title === "Market")).toBe(true);
    expect(sections.some(section => section.title === "Source")).toBe(false);
    expect(sections[0]!.refresh?.at).toMatch(/^2026-06-30 \d{2}:30$/);
    expect(sections[0]!.refresh?.status).toBe("partial");
  });

  it("keeps open-fund identity when preparing provider symbols", () => {
    expect(overviewProviderSymbol({ code: "022364", name: "永赢科技智选发起A", instrument: "fund" })).toBe("022364.OF");
    expect(overviewProviderSymbol({ code: "159995", name: "芯片ETF", instrument: "fund" })).toBe("159995");
    expect(overviewProviderSymbol({ code: "510300", name: "沪深300ETF", instrument: "fund" })).toBe("510300");
    expect(overviewProviderSymbol({ code: "000001", name: "平安银行", instrument: "security" })).toBe("000001");
  });

  it("routes every bare code in the semiconductor fund portfolio through the open-fund provider", () => {
    const funds = [
      ["022364", "永赢科技智选发起A"],
      ["016372", "信澳匠心严选一年持有A"],
      ["022184", "富国全球科技互联网C"],
      ["001986", "前海开源人工智能主题"],
      ["008021", "华富人工智能ETF联接C"],
      ["008888", "华夏国证半导体芯片ETF联接C"],
      ["018345", "华夏中证机器人ETF发起式联接C"],
      ["673060", "西部利得景瑞灵活A"],
      ["040015", "华安动态灵活配置A"],
    ] as const;

    expect(funds.map(([code, name]) => overviewProviderSymbol({ code, name, instrument: "fund" })))
      .toEqual(funds.map(([code]) => `${code}.OF`));
  });

  it("propagates instrument hints while collecting overview symbols", () => {
    expect(collectOverviewSymbols({
      symbols: [{ code: "022364", name: "永赢科技智选发起A", instrument: "fund" }],
      groups: [],
    })).toEqual([{ code: "022364", name: "永赢科技智选发起A", instrument: "fund" }]);
  });
});
