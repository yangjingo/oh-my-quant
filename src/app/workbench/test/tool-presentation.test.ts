import { expect, test } from "bun:test";
import { toolPresentation } from "../tool-presentation.ts";

test("registered actions project a readable title and bounded context without arbitrary argument text", () => {
  expect(toolPresentation("calculate_position_scenarios", { shares: 100, changes: [-0.1, 0, 0.1], apiKey: "never-render-this" }))
    .toEqual({ title: "计算持仓情景", context: "100 股 · 3 个情景" });
  expect(toolPresentation("fetch_bars", { symbol: "000300.SH", prompt: "never-render-this" })).toEqual({ title: "获取日线数据", context: "000300.SH" });
  for (const input of [{ symbol: "https://private.invalid/?key=secret" }, { symbol: { toString: () => "never-render-this" } }, { path: "private.json" }]) {
    expect(toolPresentation("fetch_bars", input)).toEqual({ title: "获取日线数据" });
  }
  expect(toolPresentation("calculate_position_scenarios", { shares: Infinity, changes: [0] })).toEqual({ title: "计算持仓情景" });
  expect(toolPresentation("unregistered", { prompt: "never-render-this" })).toEqual({ title: "执行研究工具" });
});
