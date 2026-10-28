import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { ToolActivity } from "../src/client/contract";
import { activitySummary, ToolHistory } from "../src/components/ToolHistory";
import { runStatusLabel } from "../src/components/RunStatus";

test("empty histories disappear and live tool rows expose context without an outer disclosure", () => {
  const turn = { id: "a", role: "assistant" as const, state: "running" as const, text: "", at: "2026-10-27" };
  expect(renderToStaticMarkup(createElement(ToolHistory, { turn }))).toBe("");
  const activity = [{ id: "call-1", name: "fetch_bars", title: "查询历史行情", context: "宁波华翔 · 日线", state: "running" as const }];
  const html = renderToStaticMarkup(createElement(ToolHistory, { turn: { ...turn, activity } }));
  expect(html).toContain('<section class="process tool-history live-tools"');
  expect(html).toContain('class="tool-record-preview">宁波华翔 · 日线</span>');
  expect(html).toContain("调用标识");
  const settled = renderToStaticMarkup(createElement(ToolHistory, { turn: { ...turn, state: "settled", activity: [{ ...activity[0]!, state: "unconfirmed" }] } }));
  expect(settled).toContain('<details class="process tool-history">');
  expect(settled).toContain("待核对");
});

test("mixed execution history keeps preparation, failure and unexecuted calls distinct", () => {
  const states: ToolActivity["state"][] = ["preparing", "running", "completed", "failed", "not-run"];
  const activity = states.map((state, index) => ({ id: String(index), name: "registered_tool", title: "计算持仓情景", state }));
  expect(activitySummary(activity)).toBe("执行中 1 · 准备中 1 · 已完成 1 · 未成功 1 · 未执行 1");
  const turn = { id: "a", role: "assistant" as const, state: "running" as const, text: "", at: "2026-10-26T09:00:00Z", activity };
  expect(runStatusLabel(turn)).toBe("正在调用工具");
  expect(runStatusLabel({ ...turn, activity: activity.slice(0, 1) })).toBe("准备调用工具");
  const html = renderToStaticMarkup(createElement(ToolHistory, { turn }));
  expect(html).toContain("计算持仓情景"); expect(html).toContain("工具尚未开始执行");
  expect(html).toContain("不代表研究结论已完成独立核验");
  expect(html).toContain("data-state=\"failed\""); expect(html).not.toContain("<details class=\"tool-record\" open");
});

test("every tool state keeps its meaning in live and folded history presentations", () => {
  const cases = [
    ["preparing", "准备中"], ["running", "执行中"], ["completed", "已完成"],
    ["failed", "未成功"], ["cancelled", "已停止"], ["not-run", "未执行"], ["unconfirmed", "待核对"],
  ] as const;
  for (const [state, label] of cases) for (const running of [true, false]) {
    const turn = { id: "a", role: "assistant" as const, state: running ? "running" as const : "settled" as const, text: "", at: "2026-10-27",
      activity: [{ id: "synthetic-call", name: "registered_tool", title: "受控工具", context: "假设输入", state }] };
    const html = renderToStaticMarkup(createElement(ToolHistory, { turn }));
    expect(html).toContain(`data-state="${state}"`); expect(html).toContain(label);
    expect(html).toContain(running ? 'class="process tool-history live-tools"' : '<details class="process tool-history">');
    if (state === "completed") expect(html).toContain("不代表研究结论已完成独立核验");
    if (state === "unconfirmed") expect(html).toContain("不能将此记录视为已成功或已取消");
  }
});
