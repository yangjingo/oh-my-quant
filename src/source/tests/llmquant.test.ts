import { afterEach, beforeEach, describe, expect, it } from "bun:test";

describe("llmquant adapter", () => {
  const originalKey = process.env.WHYJ_QUANT_LLMQUANT_API_KEY;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.WHYJ_QUANT_LLMQUANT_API_KEY = "llmq-test-key";
  });

  afterEach(() => {
    if (originalKey == null) delete process.env.WHYJ_QUANT_LLMQUANT_API_KEY;
    else process.env.WHYJ_QUANT_LLMQUANT_API_KEY = originalKey;
    globalThis.fetch = originalFetch;
  });

  it("maps wrapped equity historical rows and preserves adjClose", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        data: [
          {
            trade_date: "2026-06-18",
            open: 50,
            high: 52,
            low: 49.5,
            close: 51.2,
            volume: 7000,
            adj_close: 50.8,
          },
        ],
      }))
    ) as unknown as typeof fetch;

    const { fetchFromLlmQuant } = await import(`../src/llmquant.ts?case=bars-${Date.now()}`);
    const bars = await fetchFromLlmQuant("AAPL", "2026-06-01", "2026-06-18");
    expect(bars).toEqual([
      {
        date: "2026-06-18",
        open: 50,
        high: 52,
        low: 49.5,
        close: 51.2,
        volume: 7000,
        amount: 0,
        adjClose: 50.8,
      },
    ]);
  });
});
