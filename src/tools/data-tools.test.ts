import { describe, expect, it } from "bun:test";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Bar } from "../types/data.ts";
import { fetchBarsTool, fetchIndexRowsTool, formatBarsChartBlock } from "./data-tools.ts";

function resultText(result: AgentToolResult<unknown>): string {
  return result.content
    .map((part) => part.type === "text" ? part.text : "")
    .join("\n");
}

describe("data tools UX messages", () => {
  it("explains unsupported daily-bars markets with a next step", async () => {
    const result = await fetchBarsTool.execute("t1", {
      symbol: "AAPL",
      market: "US",
    });

    const text = resultText(result);
    expect(text).toContain("No daily-bars adapter is available for AAPL in market US.");
    expect(text).toContain("Next");
    expect(text).toContain("configured source");
  });

  it("rejects non-whitelisted AKShare index endpoints before calling Python", async () => {
    const result = await fetchIndexRowsTool.execute("t2", {
      endpoint: "stock_zh_a_spot_em",
    });

    const text = resultText(result);
    expect(text).toContain("Unsupported AKShare index endpoint");
    expect(text).toContain("whitelisted index endpoints");
  });

  it("formats fetched bars with deterministic close and K-line chart blocks", () => {
    const bars = makeBars(6);
    const lines = formatBarsChartBlock(bars);

    expect(lines[0]).toContain("⌁ Close");
    expect(lines[0]).toMatch(/[▁▂▃▄▅▆▇█]/);
    expect(lines[1]).toContain("▥ Volume");
    expect(lines[1]).toMatch(/[▁▂▃▄▅▆▇█]/);
    expect(lines).toContain("┃ K-line");
    expect(lines.some((line) => line.includes("2026-01-06") && line.includes("O=") && line.includes("C="))).toBe(true);
    expect(lines.some((line) => /[▲▼─]/.test(line))).toBe(true);
  });
});

function makeBars(count: number): Bar[] {
  const start = new Date(Date.UTC(2026, 0, 1));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const close = 10 + index * 0.4 + (index % 2 === 0 ? 0.2 : -0.1);
    return {
      date: date.toISOString().slice(0, 10),
      open: close - (index % 2 === 0 ? 0.2 : -0.2),
      high: close + 0.5,
      low: close - 0.6,
      close,
      volume: 1000 + index,
      amount: close * (1000 + index),
    };
  });
}
