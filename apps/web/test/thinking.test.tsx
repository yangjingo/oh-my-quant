import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Thinking, thinkingSummary } from "../src/components/Thinking";
import type { Turn } from "../src/client/contract";

const base: Turn = { id: "a", role: "assistant", state: "running", text: "", at: "2026-10-27", phase: "thinking" };
test("live summaries follow the latest nonblank provider line and settle on the first line", () => {
  const text = "先检查来源\r\n\r\n再核对日期\n";
  expect(thinkingSummary(text, true)).toBe("再核对日期");
  expect(thinkingSummary(text, false)).toBe("先检查来源");
  expect(thinkingSummary(undefined, true)).toBe("");
  expect(thinkingSummary("\n  ", true)).toBe("");
  const html = renderToStaticMarkup(<Thinking turn={{ ...base, thinking: text }} />);
  expect(html).toContain('class="thinking-preview">再核对日期</span>');
  const settled = renderToStaticMarkup(<Thinking turn={{ ...base, state: "settled", thinking: text }} />);
  expect(settled).toContain('class="thinking-preview">先检查来源</span>');
});
test("thinking defaults collapsed, renders escaped text and distinguishes live and stopped output", () => {
  const html = renderToStaticMarkup(<Thinking turn={{ ...base, thinking: '<img src="https://test.invalid/leak">\n核对日期' }} />);
  expect(html).toContain("思考过程"); expect(html).toContain("正在输出"); expect(html).not.toContain("<details open");
  expect(html).not.toContain("<img"); expect(html).toContain("&lt;img"); expect(html).toContain('tabindex="0"');
  expect(renderToStaticMarkup(<Thinking turn={{ ...base, state: "cancelled", thinking: "保留片段" }} />)).toContain("已停止");
  expect(renderToStaticMarkup(<Thinking turn={{ ...base, state: "interrupted", thinking: "保留片段" }} />)).toContain("已中断");
});
test("no text is invented for providers without displayable thinking", () => {
  expect(renderToStaticMarkup(<Thinking turn={base} />)).toContain("尚未返回可显示");
  expect(renderToStaticMarkup(<Thinking turn={{ ...base, state: "settled", phase: "answering" }} />)).toBe("");
});
