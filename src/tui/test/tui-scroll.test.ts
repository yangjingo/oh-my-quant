import { describe, expect, it } from "bun:test";
import { layout } from "../src/render.ts";
import { applyScrollDelta, clampScrollState, scrollRegionDelta, wheelStep } from "../src/tui-scroll.ts";
import type { PanelSection, UIMessage } from "../src/types.ts";

describe("tui scroll helpers", () => {
  it("resets overview scroll when the overview panel is hidden", () => {
    const hidden = layout(77, 32);
    const next = clampScrollState(hidden, [], [], "ready", {
      convScrollUp: 3,
      overviewScrollTop: 9,
    });

    expect(next.overviewScrollTop).toBe(0);
    expect(next.convScrollUp).toBeGreaterThanOrEqual(0);
  });

  it("clamps conversation scroll into valid bounds", () => {
    const L = layout(120, 20);
    const messages: UIMessage[] = [
      { role: "assistant", text: Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n") },
    ];

    const next = applyScrollDelta(L, "conversation", 999, messages, [], "ready", {
      convScrollUp: 0,
      overviewScrollTop: 0,
    });

    expect(next.convScrollUp).toBeGreaterThan(0);

    const back = applyScrollDelta(L, "conversation", -999, messages, [], "ready", next);
    expect(back.convScrollUp).toBe(0);
  });

  it("clamps overview scroll into valid bounds", () => {
    const L = layout(120, 20);
    const panel: PanelSection[] = [
      {
        kind: "holdings",
        title: "Portfolio",
        rows: Array.from({ length: 40 }, (_, i) => ({
          code: `F${i}`,
          name: `Fund ${i}`,
          price: i,
          pct: i / 10,
        })),
      },
    ];

    const next = applyScrollDelta(L, "overview", 999, [], panel, "ready", {
      convScrollUp: 0,
      overviewScrollTop: 0,
    });

    expect(next.overviewScrollTop).toBeGreaterThan(0);

    const back = applyScrollDelta(L, "overview", -999, [], panel, "ready", next);
    expect(back.overviewScrollTop).toBe(0);
  });

  it("uses opposite delta directions for conversation and overview arrow scrolling", () => {
    const L = layout(120, 32);

    expect(scrollRegionDelta(L, "conversation", true, false)).toBe(1);
    expect(scrollRegionDelta(L, "conversation", false, false)).toBe(-1);
    expect(scrollRegionDelta(L, "overview", true, false)).toBe(-1);
    expect(scrollRegionDelta(L, "overview", false, false)).toBe(1);
  });

  it("derives wheel step from the target panel height", () => {
    const L = layout(120, 32);

    expect(wheelStep(L, "conversation")).toBeGreaterThan(0);
    expect(wheelStep(L, "overview")).toBeGreaterThan(0);
  });
});
