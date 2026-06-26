import { describe, expect, it } from "bun:test";
import { AKSHARE_PUBLIC_FUND_ENDPOINTS, parseAkshareFundHistoryJson, parseAkshareJson, parseAkshareRowsJson } from "../src/akshare.ts";

describe("parseAkshareJson", () => {
  it("maps AKShare records to Bar rows", () => {
    const rows = parseAkshareJson([
      {
        date: "2026-06-08",
        open: 1.1,
        high: 1.2,
        low: 1.0,
        close: 1.15,
        volume: 1000,
        amount: 2000,
      },
    ]);
    expect(rows).toEqual([
      {
        date: "2026-06-08",
        open: 1.1,
        high: 1.2,
        low: 1,
        close: 1.15,
        volume: 1000,
        amount: 2000,
      },
    ]);
  });

  it("returns empty array for empty payload", () => {
    expect(parseAkshareJson([])).toEqual([]);
  });

  it("throws on error payload", () => {
    expect(() => parseAkshareJson({ error: "No data for 000001.SH" })).toThrow(
      "AKShare error: No data for 000001.SH",
    );
  });
});

describe("parseAkshareFundHistoryJson", () => {
  it("normalizes fund NAV, profile, performance, and attempts", () => {
    const parsed = parseAkshareFundHistoryJson({
      symbol: "270042",
      fetched_at: "2026-06-26T10:00:00",
      nav: [
        {
          fund_code: "270042",
          nav_date: "2026-06-24",
          unit_nav: 8.1772,
          accumulated_nav: 8.4472,
          daily_return_pct: -0.41,
          is_open_day: true,
          source: "akshare:fund_open_fund_info_em",
        },
      ],
      profile: { 基金简称: "广发纳指100ETF联接(QDII)人民币A", 基金经理: "刘杰" },
      rank: { 基金代码: "270042", 近1月: -1.32 },
      purchase: { 申购状态: "限大额", 赎回状态: "开放赎回", 购买起点: 10, 日累计限定金额: 10, 手续费: 0.13 },
      achievement: [
        { 业绩类型: "阶段业绩", 周期: "近1月", 本产品区间收益: -1.32, 本产品最大回撒: null, 周期收益同类排名: "176/437" },
      ],
      analysis: [
        { 周期: "近1年", 年化波动率: 18.31, 年化夏普比率: 1.21, 最大回撤: 14.26 },
      ],
      attempts: [{ endpoint: "fund_info_ths", status: "ok", rows: 18 }],
    });

    expect(parsed.nav[0]).toEqual({
      fundCode: "270042",
      navDate: "2026-06-24",
      unitNav: 8.1772,
      accumulatedNav: 8.4472,
      dailyReturnPct: -0.41,
      isOpenDay: true,
      source: "akshare:fund_open_fund_info_em",
    });
    expect(parsed.profile["基金经理"]).toBe("刘杰");
    expect(parsed.purchase["申购状态"]).toBe("限大额");
    expect(parsed.achievement[0]).toEqual({
      type: "阶段业绩",
      period: "近1月",
      returnPct: -1.32,
      maxDrawdownPct: null,
      rank: "176/437",
    });
    expect(parsed.analysis[0]?.annualSharpe).toBe(1.21);
    expect(parsed.attempts[0]?.endpoint).toBe("fund_info_ths");
  });
});

describe("parseAkshareRowsJson", () => {
  it("normalizes generic AKShare endpoint rows", () => {
    const parsed = parseAkshareRowsJson({
      endpoint: "fund_open_fund_info_em",
      params: { symbol: "270042", indicator: "单位净值走势" },
      fetched_at: "2026-06-26T10:00:00",
      row_count: 1,
      rows: [{ 净值日期: "2026-06-24", 单位净值: 8.1772, 日增长率: -0.41 }],
    });

    expect(parsed.endpoint).toBe("fund_open_fund_info_em");
    expect(parsed.rowCount).toBe(1);
    expect(parsed.rows[0]?.["单位净值"]).toBe(8.1772);
  });

  it("keeps public fund endpoints whitelisted", () => {
    expect(AKSHARE_PUBLIC_FUND_ENDPOINTS).toContain("fund_fee_em");
    expect(AKSHARE_PUBLIC_FUND_ENDPOINTS).toContain("fund_portfolio_hold_em");
    expect(AKSHARE_PUBLIC_FUND_ENDPOINTS).toContain("reits_realtime_em");
    expect(() => parseAkshareRowsJson({ endpoint: "stock_zh_a_spot_em", rows: [] })).toThrow("unsupported endpoint");
  });
});
