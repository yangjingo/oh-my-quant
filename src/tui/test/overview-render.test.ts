import { describe, expect, it } from "bun:test";
import { buildOverviewLines, buildOverviewView, overviewContentHeight } from "../src/overview-render.ts";
import type { PanelSection } from "../../types/ui.ts";
import { strWidth } from "../src/buffer.ts";

describe("overview render", () => {
  it("builds structured lines for group, quote, and keyvalue sections", () => {
    const sections: PanelSection[] = [
      { kind: "group", groupId: "g1", title: "Tech", rows: [{ code: "NVDA", name: "NVIDIA", price: 100, pct: 1.2 }], collapsed: false },
      { kind: "quotes", title: "Market", rows: [{ code: "SPY", name: "S&P 500", price: 500, pct: -0.2 }] },
      { kind: "keyvalue", title: "Source", rows: [{ label: "Provider", value: "llmquant-data" }] },
    ];

    const lines = buildOverviewLines(sections, 40);
    expect(lines.some((line) => line.text.includes("Tech"))).toBe(true);
    expect(lines.some((line) => line.text.includes("NVDA"))).toBe(true);
    expect(lines.some((line) => line.text.includes("Provider"))).toBe(true);
    expect(overviewContentHeight(sections)).toBeGreaterThan(0);
  });

  it("builds a clipped overview view with scroll offset", () => {
    const sections: PanelSection[] = [
      { kind: "quotes", title: "Market", rows: Array.from({ length: 5 }, (_, i) => ({ code: `Q${i}`, name: `Quote ${i}`, price: i, pct: i })) },
    ];
    const view = buildOverviewView(sections, { x: 0, y: 0, w: 30, h: 5 }, 2);
    expect(view.startLineIdx).toBeGreaterThanOrEqual(0);
    expect(view.lines.length).toBeGreaterThan(0);
  });

  it("preserves exchange identity and compact stale/missing cues with consistent line heights in narrow panels", () => {
    const sections: PanelSection[] = [{ kind: "quotes", title: "Market", rows: [
      { code: "000001.SH", name: "上证指数", price: 100, pct: 0, observation: { symbol: "000001.SH", source: "akshare", sourceLabel: "AKShare",
        asOfDate: "2025-01-17", fetchedAt: "2026-09-14T00:00:00Z", state: "outside-window", fallback: true } },
      { code: "000001.SZ", name: "平安银行", price: NaN, pct: NaN, observation: { symbol: "000001.SZ", source: "unavailable", sourceLabel: "暂无数据",
        asOfDate: null, fetchedAt: "2026-09-14T00:00:00Z", state: "unavailable", fallback: false } },
    ], refresh: { at: "2026-10-25 12:30", status: "timeout" } }];
    for (const width of [28, 40, 60]) {
      const lines = buildOverviewLines(sections, width);
      expect(lines.length).toBe(overviewContentHeight(sections));
      expect(lines.every(line => strWidth(line.text) <= width)).toBe(true);
      const text = lines.map(line => line.text).join("\n");
      expect(text).toContain("000001.SH"); expect(text).toContain("000001.SZ");
      expect(text).not.toContain("2025-01-17"); expect(text).not.toContain("AKShare");
      expect(text).toContain("!"); expect(text).toContain("--");
      expect(text.match(/Refresh:/g)).toHaveLength(1);
    }
  });
});
