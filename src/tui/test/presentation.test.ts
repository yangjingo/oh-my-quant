import { expect, it } from "bun:test";
import { Buffer, strWidth } from "../src/buffer.ts";
import { drawHeader, drawStatus } from "../src/chrome.ts";
import { BRAND_MARK_ROWS, thinkingBrandMark } from "../src/brand.ts";
import { buildConversationLines } from "../src/render-lines.ts";
import { buildOverviewLines, overviewContentHeight } from "../src/overview-render.ts";
import { buildOverviewPanelSections } from "../../runtime/workspace/overview.ts";
import type { AppState } from "../../types/ui.ts";
import { S } from "../src/styles.ts";

it("animates only the two header cells while thinking and restores the static mark when thinking ends", () => {
  const frames = Array.from({ length: 8 }, (_, index) => thinkingBrandMark(index * 160));
  expect(new Set(frames).size).toBe(8);
  expect(frames.every(frame => strWidth(frame) === 2)).toBe(true);
  expect(thinkingBrandMark(1280)).toBe(frames[0]);
  expect(thinkingBrandMark(159)).toBe(frames[0]);
  for (const width of [60, 120]) {
    const state = { activity: "thinking", researchStartedAt: 1000, version: "test" } as AppState;
    const buffer = new Buffer(width, 2);
    drawHeader(buffer, state, 1000);
    const first = buffer.toPlain();
    drawHeader(buffer, state, 1160);
    const next = buffer.toPlain();
    expect(next[0]!.slice(2, 4)).not.toBe(first[0]!.slice(2, 4));
    expect(next[0]!.slice(4)).toBe(first[0]!.slice(4));
    expect(next[1]).toBe(first[1]);
    for (const activity of ["ready", "running tool", "compacting", "starting"] as const) {
      state.activity = activity;
      drawHeader(buffer, state, 1320);
      expect(buffer.toPlain()[0]!.slice(2, 4)).toBe(BRAND_MARK_ROWS[0]);
    }
  }
});

it("uses warm reading text, selective cream emphasis and labelled thinking throughout streaming", () => {
  const thinking = { role: "thinking" as const, text: "Check the dates.\n\nCheck missing values.", thinkingLive: true };
  const answer = { role: "assistant" as const, text: "## Summary\nOrdinary explanation.\n- Check **risk** first.\n\n| Metric | Value |\n| --- | --- |\n| Count | 3 |\n\n```ts\n## literal code\n```" };
  for (const width of [32, 72]) {
    const lines = buildConversationLines([thinking, answer], width);
    expect(lines.every(line => strWidth(line.text) <= width)).toBe(true);
    expect(lines.filter(line => line.text.includes("Thinking"))).toHaveLength(1);
    expect(lines.find(line => line.text.includes("Check the dates"))).toMatchObject({ text: "  Check the dates.", style: { fg: "#8F8A7B" } });
    const parts = lines.flatMap(line => line.segments ?? [{ text: line.text, style: line.style }]);
    expect(parts.find(part => part.text === "Ordinary explanation.")?.style?.fg).toBe("#B8B4A8");
    expect(parts.find(part => part.text === "risk")?.style?.fg).toBe("#FFF3C4");
    expect(parts.find(part => part.text === "Summary")?.style?.fg).toBe("#FFF3C4");
    expect(parts.find(part => part.text === "## literal code")?.style?.fg).toBe("#B8B4A8");
    expect(parts.filter(part => part.text.trim()).every(part => !part.style?.dim)).toBe(true);
    thinking.text += " More evidence.";
    expect(buildConversationLines([thinking], width).map(line => line.text.trim()).join(" ")).toContain("More evidence.");
    thinking.thinkingLive = false;
    expect(buildConversationLines([thinking], width)[0]!.text).toBe("  Thinking");
    thinking.text = "Check the dates.\n\nCheck missing values.";
  }
});

it("keeps one refresh line, original provenance and the source footer together", () => {
  const observation = { symbol: "022364.OF", source: "akshare", sourceLabel: "AKShare", asOfDate: "2026-10-20", fetchedAt: "2026-10-25T04:30:00Z", state: "available" as const, fallback: true };
  const row = { code: "022364.OF", name: "科技基金", price: 1.2, pct: 1.32, observation, refreshState: "stale" as const };
  const panel = buildOverviewPanelSections({ portfolio: { symbols: [row] }, portfolioRows: [row], marketQuotes: [{ ...row, code: "000001.SH" }], pullMeta: { sources: ["akshare"], asOfDates: ["2026-10-20"] }, refreshedAt: new Date(2026, 9, 25, 12, 30) });
  for (const width of [28, 36, 48]) {
    const lines = buildOverviewLines(panel, width), text = lines.map(line => line.text).join("\n");
    expect(text.match(/Refresh:/g)).toHaveLength(1);
    expect(text).toContain("Refresh: 2026-10-25 12:30");
    expect(text).not.toMatch(/AKShare|Source|2026-10-20|回退/);
    expect(text).toContain("!");
    expect(lines).toHaveLength(overviewContentHeight(panel));
  }
  expect(row.observation).toEqual(observation);
  expect(panel[0]!.kind !== "keyvalue" && panel[0]!.rows[0]!.observation).toEqual(observation);
  const state: AppState = { modelLabel: "fixture", user: "u", activity: "ready", cost: 0, cacheHit: 0, messages: [], panelLoading: false, input: "", composerQueue: [], composerStatus: null, activePortfolio: "科技基金", showPortfolioPanel: true, panel, model: "custom/very-long-model-name-for-review", source: "AKShare", version: "test" };
  for (const width of [80, 120]) {
    const buffer = new Buffer(width, 5);
    drawHeader(buffer, state); drawStatus(buffer, 4, width, state);
    expect(buffer.toPlain()[4]).toContain("AKShare");
    expect(buffer.cells[4 * width]!).toMatchObject({ ch: "◈", fg: "#FFF3C4" });
    expect(buffer.toPlain().slice(0, 3).join("\n")).not.toContain("JQ");
    expect(BRAND_MARK_ROWS).toHaveLength(1);
    expect(buffer.toPlain()[0]).toContain("⢎⣵ WhyJ Quant vtest");
    BRAND_MARK_ROWS.forEach((line, y) => {
      expect(strWidth(line)).toBe(2);
      expect(buffer.toPlain()[y]).toContain(line);
    });
    expect(buffer.render()).not.toContain("\x1b[2m");
  }
  expect(S.tableGain.fgRole).toBe("market-up");
});

it("keeps wrapped segment text identical to visible text, including emphasis, CJK and punctuation", () => {
  const text = "A long explanation with  **重点和 risk** followed by several words and final punctuation.";
  for (const width of [18, 32, 72]) {
    const lines = buildConversationLines([{ role: "assistant", text }], width).filter(line => line.text);
    for (const line of lines) expect(line.segments!.map(segment => segment.text).join("")).toBe(line.text);
    expect(lines.at(-1)!.segments!.at(-1)!.text).toEndWith("punctuation.");
    expect(lines.flatMap(line => line.segments!).filter(segment => segment.style === S.creamB).map(segment => segment.text).join("").replace(/\s/g, "")).toBe("重点和risk");
  }
});
