import { afterEach, beforeEach, describe, expect, it } from "bun:test";

describe("tushare adapter", () => {
  const originalToken = process.env.TUSHARE_TOKEN;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.TUSHARE_TOKEN = "test-token";
  });

  afterEach(() => {
    if (originalToken == null) delete process.env.TUSHARE_TOKEN;
    else process.env.TUSHARE_TOKEN = originalToken;
    globalThis.fetch = originalFetch;
  });

  it("maps daily rows into Bar objects", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        code: 0,
        data: {
          fields: ["ts_code", "trade_date", "open", "high", "low", "close", "vol", "amount"],
          items: [
            ["000001.SZ", "20260618", 10.1, 10.6, 10, 10.4, 12345, 67890],
          ],
        },
      }))
    ) as unknown as typeof fetch;

    const { fetchFromTushare } = await import(`../src/tushare.ts?case=daily-${Date.now()}`);
    const bars = await fetchFromTushare("000001.SZ", "2026-06-01", "2026-06-18");
    expect(bars).toEqual([
      {
        date: "2026-06-18",
        open: 10.1,
        high: 10.6,
        low: 10,
        close: 10.4,
        volume: 12345,
        amount: 67890,
      },
    ]);
  });

  it("maps stock_basic rows into SymbolInfo objects", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        code: 0,
        data: {
          fields: ["ts_code", "name", "area", "industry", "market", "list_date"],
          items: [
            ["600000.SH", "浦发银行", "上海", "银行", "主板", "19991110"],
          ],
        },
      }))
    ) as unknown as typeof fetch;

    const { searchTushareSymbols } = await import(`../src/tushare.ts?case=search-${Date.now()}`);
    const rows = await searchTushareSymbols("浦发");
    expect(rows).toEqual([
      {
        code: "600000.SH",
        name: "浦发银行",
        market: "A",
        exchange: "SSE",
        type: "stock",
        listDate: "19991110",
      },
    ]);
  });

  it("returns the first daily_basic snapshot row", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        code: 0,
        data: {
          fields: ["ts_code", "trade_date", "close", "pe", "pe_ttm", "pb", "total_mv", "circ_mv"],
          items: [
            ["000001.SZ", "20260618", 12.3, 8.1, 8.4, 1.2, 1000000, 900000],
          ],
        },
      }))
    ) as unknown as typeof fetch;

    const { fetchTushareSnapshot } = await import(`../src/tushare.ts?case=snapshot-${Date.now()}`);
    const snapshot = await fetchTushareSnapshot("000001.SZ");
    expect(snapshot).toEqual({
      ts_code: "000001.SZ",
      trade_date: "20260618",
      close: 12.3,
      pe: 8.1,
      pe_ttm: 8.4,
      pb: 1.2,
      total_mv: 1000000,
      circ_mv: 900000,
    });
  });
});
