import { expect, test } from "bun:test";
import {
  escapeHtml,
  sanitizeUrl,
  parseInline,
  renderMarkdownToHtml,
} from "../web/markdown.js";

test("escapeHtml prevents HTML injection and escapes basic entities", () => {
  expect(escapeHtml("<script>alert('xss')</script>")).toBe(
    "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;",
  );
  expect(escapeHtml('foo & "bar"')).toBe("foo &amp; &quot;bar&quot;");
});

test("sanitizeUrl permits safe protocols and blocks javascript/data", () => {
  expect(sanitizeUrl("https://example.com")).toBe("https://example.com");
  expect(sanitizeUrl("http://localhost:3000/foo")).toBe(
    "http://localhost:3000/foo",
  );
  expect(sanitizeUrl("mailto:user@domain.com")).toBe("mailto:user@domain.com");
  expect(sanitizeUrl("javascript:alert(1)")).toBe("#");
  expect(sanitizeUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe("#");
});

test("parseInline handles bold, italic, strikethrough, inline code, and links", () => {
  expect(parseInline("**当前状态**")).toBe("<strong>当前状态</strong>");
  expect(parseInline("`get_market_evidence`")).toBe(
    '<code class="md-inline-code">get_market_evidence</code>',
  );
  expect(parseInline("*斜体*")).toBe("<em>斜体</em>");
  expect(parseInline("~~删除~~")).toBe("<del>删除</del>");
  expect(parseInline("[链接](https://whyj.ai)")).toContain(
    '<a href="https://whyj.ai"',
  );
  expect(parseInline("混合 `code` 和 **加粗** 以及 [安全](https://test.com)")).toBe(
    '混合 <code class="md-inline-code">code</code> 和 <strong>加粗</strong> 以及 <a href="https://test.com" target="_blank" rel="noopener noreferrer" class="md-link">安全</a>',
  );
});

test("renderMarkdownToHtml handles headings and horizontal rules", () => {
  const md = "# 标题一\n## 标题二\n---\n普通段落";
  const html = renderMarkdownToHtml(md);
  expect(html).toContain('<h3 class="md-heading md-h1">标题一</h3>');
  expect(html).toContain('<h4 class="md-heading md-h2">标题二</h4>');
  expect(html).toContain('<hr class="md-hr" />');
  expect(html).toContain('<p class="md-p">普通段落</p>');
});

test("renderMarkdownToHtml handles unordered and ordered lists", () => {
  const md = `- 项 1
- 项 2
- 项 3

1. 第一步
2. 第二步`;
  const html = renderMarkdownToHtml(md);
  expect(html).toContain('<ul class="md-ul">');
  expect(html).toContain("<li>项 1</li>");
  expect(html).toContain("<li>项 2</li>");
  expect(html).toContain('<ol class="md-ol">');
  expect(html).toContain("<li>第一步</li>");
  expect(html).toContain("<li>第二步</li>");
});

test("renderMarkdownToHtml parses the user's specific real-world response accurately", () => {
  const md = `本次首次研究暂时无法完成，说明如下：

**当前状态**
- \`get_market_evidence\` 连续两次失败：数据源 (AKShare / Python / 网络) 连接异常。
- \`calculate_research\` 确认无任何可复用的缓存证据，计算步骤无法执行。

**因此**
- 目前不存在任何 E 编号证据，我无法对 002048.SZ 与 000300.SH 做任何价格、均线、量比或相对表现的观察结论，也不会编造数值。
- \`publish_research\` 的每条结论必须引用真实 E 编号，缺证据时发布任何信号（包括“证据不足”）都不符合发布校验，故本次不发布。`;

  const html = renderMarkdownToHtml(md);
  expect(html).toContain('<p class="md-p">本次首次研究暂时无法完成，说明如下：</p>');
  expect(html).toContain("<strong>当前状态</strong>");
  expect(html).toContain('<ul class="md-ul">');
  expect(html).toContain(
    '<li><code class="md-inline-code">get_market_evidence</code> 连续两次失败：数据源 (AKShare / Python / 网络) 连接异常。</li>',
  );
  expect(html).toContain(
    '<li><code class="md-inline-code">calculate_research</code> 确认无任何可复用的缓存证据，计算步骤无法执行。</li>',
  );
  expect(html).toContain("<strong>因此</strong>");
  expect(html).toContain(
    '<li><code class="md-inline-code">publish_research</code> 的每条结论必须引用真实 E 编号',
  );
});

test("renderMarkdownToHtml handles fenced code blocks with language and copy dataset", () => {
  const md = "```python\ndef test():\n    return 42\n```";
  const html = renderMarkdownToHtml(md);
  expect(html).toContain('<div class="code-block-wrapper">');
  expect(html).toContain('<span class="code-lang">python</span>');
  expect(html).toContain('class="copy-code-btn"');
  expect(html).toContain('data-code="def%20test()%3A%0A%20%20%20%20return%2042"');
  expect(html).toContain('<code class="language-python">def test():\n    return 42</code>');
});

test("renderMarkdownToHtml handles blockquotes", () => {
  const md = "> 这是一个引用说明\n> 跨行引用";
  const html = renderMarkdownToHtml(md);
  expect(html).toContain('<blockquote class="md-blockquote">这是一个引用说明<br />跨行引用</blockquote>');
});

test("renderMarkdownToHtml handles tables", () => {
  const md = `| 指标 | 样本值 | 基准值 |
| :--- | :---: | ---: |
| 收益率 | +12.5% | -3.2% |
| 回撤 | -8.1% | -15.4% |`;
  const html = renderMarkdownToHtml(md);
  expect(html).toContain('<div class="md-table-wrapper"><table class="md-table">');
  expect(html).toContain('>指标</th>');
  expect(html).toContain('style="text-align: center"');
  expect(html).toContain('>+12.5%</td>');
});
