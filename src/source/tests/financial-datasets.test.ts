import { afterEach, beforeEach, describe, expect, it } from "bun:test";

describe("financial datasets adapter", () => {
  const originalKey = process.env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY = "fd-test-key";
  });

  afterEach(() => {
    if (originalKey == null) delete process.env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY;
    else process.env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY = originalKey;
    globalThis.fetch = originalFetch;
  });

  it("maps stock price rows from wrapped payload", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        prices: [
          { date: "2026-06-18", open: 100, high: 103, low: 99, close: 102, volume: 5000 },
        ],
      }))
    ) as unknown as typeof fetch;

    const { fetchFromFinancialDatasets } = await import(`../src/financial-datasets.ts?case=bars-${Date.now()}`);
    const bars = await fetchFromFinancialDatasets("AAPL", "2026-06-01", "2026-06-18");
    expect(bars).toEqual([
      {
        date: "2026-06-18",
        open: 100,
        high: 103,
        low: 99,
        close: 102,
        volume: 5000,
        amount: 0,
      },
    ]);
  });

  it("fetches the real-time price snapshot", async () => {
    let callCount = 0;
    globalThis.fetch = (async (url: string | URL | Request) => {
      callCount += 1;
      const text = String(url);
      expect(text).toContain("/prices/snapshot");
      return new Response(JSON.stringify({ snapshot: { price: 182.9, open: 181, high: 183.5, low: 180.2, close: 182.9 } }));
    }) as unknown as typeof fetch;

    const { fetchFinancialDatasetsSnapshot } = await import(`../src/financial-datasets.ts?case=snapshot-${Date.now()}`);
    const snapshot = await fetchFinancialDatasetsSnapshot("AAPL");
    expect(callCount).toBe(1);
    expect(snapshot).toEqual({
      price: 182.9,
      open: 181,
      high: 183.5,
      low: 180.2,
      close: 182.9,
    });
  });
});
