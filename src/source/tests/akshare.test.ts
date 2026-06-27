import { describe, expect, it } from "bun:test";
import {
  AKSHARE_PUBLIC_FUND_ENDPOINTS,
  AKSHARE_PUBLIC_INDEX_ENDPOINTS,
  normalizeAkshareIndexConstituentRows,
  normalizeAkshareIndexInfoRows,
  normalizeAkshareIndexQuote,
  parseAkshareFundHistoryJson,
  parseAkshareIndexRowsJson,
  parseAkshareJson,
  parseAkshareRowsJson,
} from "../src/akshare.ts";

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

describe("parseAkshareIndexRowsJson", () => {
  it("normalizes generic AKShare index endpoint rows", () => {
    const parsed = parseAkshareIndexRowsJson({
      endpoint: "stock_zh_index_spot_em",
      params: { symbol: "沪深重要指数" },
      fetched_at: "2026-06-26T10:00:00",
      row_count: 1,
      rows: [{ 代码: "000001", 名称: "上证指数", 最新价: 3381.1, 涨跌幅: 0.8 }],
    });

    expect(parsed.endpoint).toBe("stock_zh_index_spot_em");
    expect(parsed.rowCount).toBe(1);
    expect(parsed.rows[0]?.["名称"]).toBe("上证指数");
  });

  it("keeps public index endpoints whitelisted", () => {
    expect(AKSHARE_PUBLIC_INDEX_ENDPOINTS).toContain("stock_zh_index_spot_em");
    expect(AKSHARE_PUBLIC_INDEX_ENDPOINTS).toContain("index_realtime_sw");
    expect(AKSHARE_PUBLIC_INDEX_ENDPOINTS).toContain("stock_zh_index_hist_csindex");
    expect(() => parseAkshareIndexRowsJson({ endpoint: "stock_zh_a_spot_em", rows: [] })).toThrow("unsupported endpoint");
  });
});

describe("normalizeAkshareIndexInfoRows", () => {
  it("maps AKShare index_stock_info rows to stable index metadata", () => {
    const rows = normalizeAkshareIndexInfoRows([
      { index_code: "000300", display_name: "沪深300", publish_date: "2005/4/8" },
      { index_code: "399300", display_name: "沪深300", publish_date: "2005/4/8" },
      { index_code: "000905", display_name: "中证500", publish_date: "2007/1/15" },
    ], { keyword: "沪深" });

    expect(rows).toEqual([
      { indexCode: "000300", displayName: "沪深300", publishDate: "2005/4/8" },
      { indexCode: "399300", displayName: "沪深300", publishDate: "2005/4/8" },
    ]);
  });
});

describe("normalizeAkshareIndexConstituentRows", () => {
  it("maps legacy Sina constituent rows and removes duplicate stock codes", () => {
    const rows = normalizeAkshareIndexConstituentRows([
      { 品种代码: "000001", 品种名称: "平安银行", 纳入日期: "2005-04-08" },
      { 品种代码: "000001", 品种名称: "平安银行", 纳入日期: "2005-04-08" },
      { 品种代码: "600519", 品种名称: "贵州茅台", 纳入日期: "2005-04-08" },
    ], { symbol: "000300", indexName: "沪深300", source: "index_stock_cons" });

    expect(rows).toEqual([
      expect.objectContaining({ stockCode: "000001", stockName: "平安银行", inclusionDate: "2005-04-08", indexCode: "000300", indexName: "沪深300" }),
      expect.objectContaining({ stockCode: "600519", stockName: "贵州茅台", source: "index_stock_cons" }),
    ]);
  });

  it("maps csindex constituent rows with exchange and weight when present", () => {
    const rows = normalizeAkshareIndexConstituentRows([
      { 指数代码: "000300", 指数名称: "沪深300", 成分券代码: "000001", 成分券名称: "平安银行", 交易所: "深圳证券交易所", 权重: "0.524" },
    ], { symbol: "399300", indexName: null, source: "index_stock_cons_csindex" });

    expect(rows[0]).toEqual(expect.objectContaining({
      stockCode: "000001",
      stockName: "平安银行",
      indexCode: "000300",
      indexName: "沪深300",
      exchange: "深圳证券交易所",
      weight: 0.524,
      source: "index_stock_cons_csindex",
    }));
  });
});

describe("normalizeAkshareIndexQuote", () => {
  it("maps Eastmoney/Sina style index rows to one quote shape", () => {
    const quote = normalizeAkshareIndexQuote({
      代码: "sh000001",
      名称: "上证指数",
      最新价: "3,381.10",
      涨跌幅: "0.80%",
      涨跌额: "26.81",
      今开: 3360,
      最高: 3388,
      最低: 3352,
      昨收: 3354.29,
      成交量: "285455945",
      成交额: "321018391310",
    });

    expect(quote).toEqual(expect.objectContaining({
      code: "000001",
      name: "上证指数",
      price: 3381.1,
      changePct: 0.8,
      source: "akshare",
    }));
  });

  it("returns null when a row is not quote-like", () => {
    expect(normalizeAkshareIndexQuote({ 代码: "000001", 名称: "上证指数" })).toBeNull();
  });
});
