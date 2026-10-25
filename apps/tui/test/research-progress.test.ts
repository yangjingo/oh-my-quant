import { expect, it } from "bun:test";
import { Buffer } from "../src/buffer.ts";
import { drawComposer, layout } from "../src/render.ts";
import { QuantTui } from "../src/tui.ts";
import type { AppState } from "../../../src/types/ui.ts";

it("shows the active stage, elapsed time and configured stop key, then clears elapsed time when idle", () => {
  const state: AppState = { model: "test", modelLabel: "test", version: "0", user: "u", activity: "ready",
    cost: 0, cacheHit: 0, messages: [], panel: [], panelLoading: false, input: "", composerQueue: [],
    composerStatus: null, activePortfolio: "", source: "", showPortfolioPanel: true };
  const tui = new QuantTui(state, { interruptResearch: ["ctrl+x"] });
  tui.update({ activity: "thinking" });
  const began = state.researchStartedAt;
  expect(began).toBeDefined();
  tui.update({ activity: "running tool" });
  expect(state.researchStartedAt).toBe(began);
  const buffer = new Buffer(120, 32);
  drawComposer(buffer, layout(120, 32).composer, state, "");
  const text = buffer.toPlain().join("\n");
  expect(text).toContain("工具");
  expect(text).toContain("ctrl+x 停止");
  expect(text).toMatch(/\d+s/);
  state.researchInterruptKey = undefined;
  buffer.clear();
  drawComposer(buffer, layout(120, 32).composer, state, "");
  expect(buffer.toPlain().join("\n")).toContain("工具");
  expect(buffer.toPlain().join("\n")).toMatch(/\d+s/);
  tui.update({ activity: "ready" });
  expect(state.researchStartedAt).toBeUndefined();
});
