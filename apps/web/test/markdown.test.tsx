import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ResearchMarkdown } from "../src/components/Markdown";

test("research prose renders structured paragraphs and GFM tables as accessible text", () => {
  const html = renderToStaticMarkup(<ResearchMarkdown text={"## 观察\n\n**尚待核验**\n\n| 指标 | 值 |\n| --- | --- |\n| 回撤 | 7.2% |"} />);
  expect(html).toContain("<h2>观察</h2>");
  expect(html).toContain("<strong>尚待核验</strong>");
  expect(html).toContain("<table>");
  expect(html).toContain("7.2%");
  expect(html).toContain('aria-label="数据表格"');
});

test("untrusted answers cannot execute HTML, script links or silently request remote images", () => {
  const html = renderToStaticMarkup(<ResearchMarkdown text={'<script>alert(1)</script>\n\n[bad](javascript:alert%281%29)\n\n![private](https://example.com/tracker)\n\n[来源](https://example.com/source)'} />);
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<img");
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain('href="https://example.com/source"');
  expect(html).toContain('rel="noopener noreferrer"');
});
