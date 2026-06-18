import { describe, expect, it, mock } from "bun:test";
import type { Bar } from "../../types/data.ts";
import { filterBarsByDate, formatRefreshMinute, formatSourceLabels } from "../src/sources.ts";

const SAMPLE_BARS: Bar[] = [
  { date: "2026-06-06", open: 1, high: 1, low: 1, close: 10, volume: 0, amount: 0 },
  { date: "2026-06-07", open: 1, high: 1, low: 1, close: 10.5, volume: 0, amount: 0 },
  { date: "2026-06-08", open: 1, high: 1, low: 1, close: 11, volume: 0, amount: 0 },
];

describe("source attribution labels", () => {
  it("formats single and mixed providers", () => {
    expect(formatSourceLabels(["akshare"])).toBe("AKShare · 东方财富");
    expect(formatSourceLabels(["akshare", "akshare"])).toBe("AKShare · 东方财富");
    expect(formatSourceLabels(["unavailable"])).toBe("暂无数据");
  });

  it("formats refresh time to minute precision", () => {
    const text = formatRefreshMinute(new Date(2026, 5, 8, 14, 32, 59));
    expect(text).toBe("2026-06-08 14:32");
  });
});

describe("filterBarsByDate", () => {
  it("keeps inclusive start/end bounds", () => {
    const filtered = filterBarsByDate(SAMPLE_BARS, "2026-06-07", "2026-06-08");
    expect(filtered.map((b) => b.date)).toEqual(["2026-06-07", "2026-06-08"]);
  });

  it("returns all bars when range is open", () => {
    expect(filterBarsByDate(SAMPLE_BARS)).toHaveLength(3);
  });
});

describe("pullBarsFromProviders", () => {
  it("prefers akshare for A-share symbols", async () => {
    const fetchFromAKShare = mock(() => Promise.resolve(SAMPLE_BARS));
    mock.module("../src/akshare.ts", () => ({ fetchFromAKShare, parseAkshareJson: () => [] }));
    const { pullBarsFromProviders: pull } = await import("../src/sources.ts");
    const result = await pull("000300.SH", "A");
    expect(result.source).toBe("akshare");
    expect(result.bars.at(-1)?.close).toBe(11);
    mock.restore();
  });

  it("returns unavailable when akshare returns empty", async () => {
    const fetchFromAKShare = mock(() => Promise.resolve([]));
    const fetchFromTushare = mock(() => Promise.resolve([]));
    mock.module("../src/tushare.ts", () => ({ fetchFromTushare, searchTushareSymbols: async () => [] }));
    mock.module("../src/akshare.ts", () => ({ fetchFromAKShare, parseAkshareJson: () => [] }));
    const { pullBarsFromProviders: pull } = await import("../src/sources.ts");
    const result = await pull("000300.SH", "A");
    expect(result).toEqual({ bars: [], source: "unavailable" });
    mock.restore();
  });

  it("returns unavailable when all providers fail", async () => {
    const fetchFromAKShare = mock(() => Promise.reject(new Error("offline")));
    const fetchFromTushare = mock(() => Promise.reject(new Error("token missing")));
    mock.module("../src/akshare.ts", () => ({ fetchFromAKShare, parseAkshareJson: () => [] }));
    mock.module("../src/tushare.ts", () => ({ fetchFromTushare, searchTushareSymbols: async () => [] }));
    const { pullBarsFromProviders: pull } = await import("../src/sources.ts");
    const result = await pull("000300.SH", "A");
    expect(result).toEqual({ bars: [], source: "unavailable" });
    mock.restore();
  });

  it("falls back to tushare when akshare fails for A-share symbols", async () => {
    const fetchFromAKShare = mock(() => Promise.resolve([]));
    const fetchFromTushare = mock(() => Promise.resolve([
      { date: "2026-06-08", open: 1, high: 1, low: 1, close: 11, volume: 0, amount: 0 },
    ]));
    mock.module("../src/akshare.ts", () => ({ fetchFromAKShare, parseAkshareJson: () => [] }));
    mock.module("../src/tushare.ts", () => ({ fetchFromTushare, searchTushareSymbols: async () => [] }));
    const { pullBarsFromProviders: pull } = await import("../src/sources.ts");
    const result = await pull("000300.SH", "A");
    expect(result.source).toBe("tushare");
    expect(result.bars[0]?.close).toBe(11);
    mock.restore();
  });
});

describe("fetchLiveBars", () => {
  it("applies date filter and reports latest asOfDate", async () => {
    const fetchFromAKShare = mock(() => Promise.resolve(SAMPLE_BARS));
    mock.module("../src/akshare.ts", () => ({ fetchFromAKShare, parseAkshareJson: () => [] }));
    const { fetchLiveBars: fetchLive } = await import("../src/sources.ts");
    const result = await fetchLive("000300.SH", "A", "2026-06-07", "2026-06-08");
    expect(result.source).toBe("akshare");
    expect(result.asOfDate).toBe("2026-06-08");
    expect(result.bars).toHaveLength(2);
    mock.restore();
  });

  it("falls back to the latest available bars when the requested window is empty", async () => {
    const fetchFromAKShare = mock(() => Promise.resolve(SAMPLE_BARS));
    mock.module("../src/akshare.ts", () => ({ fetchFromAKShare, parseAkshareJson: () => [] }));
    const { fetchLiveBars: fetchLive } = await import("../src/sources.ts");
    const result = await fetchLive("000300.SH", "A", "2030-01-01", "2030-01-31");
    expect(result.source).toBe("akshare");
    expect(result.asOfDate).toBe("2026-06-08");
    expect(result.bars).toHaveLength(3);
    mock.restore();
  });
});
