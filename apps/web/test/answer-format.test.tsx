import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ResearchMarkdown } from "../src/components/Markdown";

test("existing terminal-formatted answers preserve rows instead of collapsing them into a paragraph", () => {
  const text = "工具-根因对照\n────────────────────────\nsearch_symbols     tushare 无token     不可用\nfetch_snapshot     akshare 不可用      不可用";
  const html = renderToStaticMarkup(<ResearchMarkdown text={text} />);
  // HTML paragraphs collapse the newline and alignment spaces seen in the reported answer.
  expect(html).toContain("<pre");
  expect(html).toContain("search_symbols     tushare 无token     不可用\nfetch_snapshot");
});

test("Markdown fenced examples keep their semantic rendering even when they contain terminal separators", () => {
  const text = "## 示例\n\n```text\n工具\n────────────────────────\nfirst    row\nsecond   row\n```";
  const html = renderToStaticMarkup(<ResearchMarkdown text={text} />);
  expect(html).toContain("<h2>示例</h2>"); expect(html).toContain('<code class="language-text">');
});

test("legacy display escapes HTML without modifying the original answer text", () => {
  const text = "原始输出\n────────────────────────\n<script>unsafe()</script>\nrow    value";
  const html = renderToStaticMarkup(<ResearchMarkdown text={text} />);
  expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;");
  expect(text).toContain("<script>unsafe()</script>");
});

test("the same synthetic observations retain object, date, units and missing-value meaning in both formats", async () => {
  const { parseHTML } = await import("linkedom");
  const rows = [
    ["假设标的 A", "2026-10-23", "0.00 CNY", "—"],
    ["假设标的 B", "2026-10-22", "80.00 USD", "窗口不同，不能直接比较"],
  ];
  const terminal = "对象    数据日期    结果    限制\n────────────────────────\n" + rows.map(row => row.join("    ")).join("\n");
  const markdown = "| 对象 | 数据日期 | 结果 | 限制 |\n| --- | --- | --- | --- |\n" + rows.map(row => "| " + row.join(" | ") + " |").join("\n");
  const legacy = parseHTML(renderToStaticMarkup(<ResearchMarkdown text={terminal} />)).document;
  expect(legacy.querySelector("pre")?.textContent).toBe(terminal);
  const web = parseHTML(renderToStaticMarkup(<ResearchMarkdown text={markdown} />)).document;
  const actual = [...web.querySelectorAll("tbody tr")].map(row => [...row.querySelectorAll("td")].map(cell => cell.textContent));
  expect(actual).toEqual(rows);
});
