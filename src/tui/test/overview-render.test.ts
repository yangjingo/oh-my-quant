import { describe, expect, it } from "bun:test";
import { buildOverviewLines, buildOverviewView, overviewContentHeight } from "../src/overview-render.ts";
import type { PanelSection } from "../src/types.ts";

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
});
