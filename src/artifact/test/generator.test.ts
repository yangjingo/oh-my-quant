import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateArtifact } from "../src/generator.ts";
import { WHYJ_THEME } from "../../types/theme-colors.ts";
import { escapeHtml, renderArtifactTemplate } from "../src/template.ts";

const OHQ = join(process.cwd(), ".ohquant-test-artifact-gen");

function writeSessionFile(
  sessionId: string,
  entries: Record<string, unknown>[],
) {
  const dir = join(OHQ, "sessions", "--test-cwd--");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sessionId}.jsonl`);
  const header = {
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: "2026-06-22T10:00:00.000Z",
    cwd: "/test/cwd",
  };
  const lines = [JSON.stringify(header), ...entries.map((e) => JSON.stringify(e))];
  writeFileSync(path, lines.join("\n"), "utf-8");
  return path;
}

function userMsg(text: string): Record<string, unknown> {
  return {
    type: "message",
    id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
  };
}

function assistantMsg(text: string, opts?: { model?: string; provider?: string }): Record<string, unknown> {
  return {
    type: "message",
    id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      model: opts?.model ?? "deepseek-v4-pro",
      provider: opts?.provider ?? "anthropic",
      api: "anthropic-messages",
      usage: { input: 100, output: 50, totalTokens: 150 },
      stopReason: "stop",
      timestamp: Date.now(),
    },
  };
}

beforeEach(() => {
  process.env.OHQUANT_DIR = OHQ;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
  mkdirSync(OHQ, { recursive: true });
});

afterEach(() => {
  delete process.env.OHQUANT_DIR;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
});

// ── Generator tests ──

describe("generateArtifact", () => {
  it("keeps session-derived chart labels inside generated script elements", () => {
    const label = "</script><svg/onload=top.q=1>";
    const path = writeSessionFile("chart-markup", [userMsg(`${label}  ███ 50\nsafe  ███ 60`)]);
    const html = generateArtifact({ sessionPath: path })!.html;
    expect(html).toContain("Factor Performance");
    expect(html).not.toContain(label);
    expect(html).toContain("\\u003c/script>");
  });

  it("annualizes displayed returns by the actual dates and omits an undefined Sharpe", () => {
    const path = writeSessionFile("calendar-metrics", [userMsg("查看净值"), assistantMsg([
      "日期        净值    基准    沪深300",
      "2024-01-01  1.0000  1.0000  1.0000",
      "2024-07-01  1.0000  1.0000  1.0000",
      "2025-01-01  1.1000  1.0000  1.0000",
    ].join("\n"))]);
    const html = generateArtifact({ sessionPath: path })!.html;
    const annual = ((1.1 ** (365.25 / 366) - 1) * 100).toFixed(2);
    expect(html).toContain("年化收益率");
    expect(html).toContain(`+${annual}%`);
    const flatPath = writeSessionFile("flat-metrics", [userMsg("查看净值"), assistantMsg([
      "日期        净值    基准    沪深300",
      "2024-01-01  1.0000  1.0000  1.0000",
      "2024-07-01  1.0000  1.0000  1.0000",
      "2025-01-01  1.0000  1.0000  1.0000",
    ].join("\n"))]);
    expect(generateArtifact({ sessionPath: flatPath })!.html).not.toContain("<span>夏普比率</span>");
  });

  it("generates valid HTML from a session file", () => {
    const sessionId = "test-session-001";
    const path = writeSessionFile(sessionId, [
      userMsg("查看沪深300的行情"),
      assistantMsg("以下是沪深300近30个交易日的行情数据：\n\n日期         开盘    收盘    涨跌幅\n2026-06-20  3920.5  3945.2  +0.63%\n2026-06-19  3910.0  3920.5  +0.27%\n2026-06-18  3930.0  3910.0  -0.51%"),
    ]);

    const result = generateArtifact({ sessionPath: path });

    expect(result).not.toBeNull();
    expect(result!.html).toContain("<!DOCTYPE html>");
    expect(result!.html).toContain("<title>");
    expect(result!.sessionId).toBe(sessionId);
    expect(result!.messageCount).toBe(2);

    // Should contain user message text
    expect(result!.html).toContain("查看沪深300的行情");
    // Should contain assistant response
    expect(result!.html).toContain("沪深300近30个交易日");
  });

  it("returns null for non-existent file", () => {
    const result = generateArtifact({ sessionPath: "/nonexistent/path.jsonl" });
    expect(result).toBeNull();
  });

  it("returns null for invalid session file (wrong version)", () => {
    const dir = join(OHQ, "sessions", "--bad-cwd--");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "bad.jsonl");
    writeFileSync(path, JSON.stringify({ type: "session", version: 99, id: "x" }) + "\n", "utf-8");

    const result = generateArtifact({ sessionPath: path });
    expect(result).toBeNull();
  });

  it("skips non-message entries", () => {
    const sessionId = "test-session-002";
    const path = writeSessionFile(sessionId, [
      userMsg("分析科技板块"),
      { type: "compaction", id: "c1", parentId: null, timestamp: new Date().toISOString(), summary: "kept", firstKeptEntryId: "x", tokensBefore: 500 },
      { type: "thinking_level_change", id: "t1", parentId: null, timestamp: new Date().toISOString(), thinkingLevel: "high" },
      assistantMsg("科技板块分析如下..."),
    ]);

    const result = generateArtifact({ sessionPath: path });
    expect(result).not.toBeNull();
    // Only 2 messages, not 4 entries
    expect(result!.messageCount).toBe(2);
  });

  it("uses custom title when provided", () => {
    const sessionId = "test-session-003";
    const path = writeSessionFile(sessionId, [
      userMsg("hello"),
      assistantMsg("hi there"),
    ]);

    const result = generateArtifact({ sessionPath: path, title: "My Custom Title" });
    expect(result).not.toBeNull();
    expect(result!.title).toBe("My Custom Title");
    expect(result!.html).toContain("My Custom Title");
  });

  it("derives the title from the researched object and code, not the first prompt sentence", () => {
    const path = writeSessionFile("test-research-title-001", [
      userMsg("帮我看一下近期走势，并给出风险提示"),
      assistantMsg("# 中际旭创（300308）技术分析\n\n最新价格与风险指标如下。"),
    ]);

    const result = generateArtifact({ sessionPath: path });

    expect(result).not.toBeNull();
    expect(result!.title).toBe("中际旭创 (300308)");
    expect(result!.title).not.toContain("帮我看一下");
  });

  it("uses a neutral report title when no research object and code can be identified", () => {
    const path = writeSessionFile("test-research-title-002", [userMsg("你好"), assistantMsg("你好，有什么可以帮你？")]);
    const result = generateArtifact({ sessionPath: path });
    expect(result?.title).toBe("量化研究报告");
  });

  it("rejects sentence fragments when identifying the researched object", () => {
    const path = writeSessionFile("test-research-title-003", [
      userMsg("分析固态电池方向"),
      assistantMsg("成功拿到（002460）数据。现在对动量最强的（002074.SZ）继续观察。重点对象：赣锋锂业（002460.SZ）。"),
    ]);
    const result = generateArtifact({ sessionPath: path });
    expect(result?.title).toBe("赣锋锂业 (002460.SZ)");
    expect(result?.title).not.toContain("拿到");
    expect(result?.title).not.toContain("动量最强");
  });

  it("extracts model name from first assistant message", () => {
    const sessionId = "test-session-004";
    const path = writeSessionFile(sessionId, [
      userMsg("hi"),
      assistantMsg("hello", { model: "claude-sonnet-4-6", provider: "anthropic" }),
    ]);

    const result = generateArtifact({ sessionPath: path });
    expect(result).not.toBeNull();
    expect(result!.html).toContain("claude-sonnet-4-6");
  });

  it("handles displayUser role as user", () => {
    const sessionId = "test-session-005";
    const dir = join(OHQ, "sessions", "--test-cwd--");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${sessionId}.jsonl`);
    const entries = [
      JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "2026-06-22T10:00:00Z", cwd: "/t" }),
      JSON.stringify({
        type: "message", id: "m1", parentId: null, timestamp: new Date().toISOString(),
        message: { role: "displayUser", content: [{ type: "text", text: "Display user text" }], displayText: "Display user text" },
      }),
      JSON.stringify({
        type: "message", id: "m2", parentId: null, timestamp: new Date().toISOString(),
        message: { role: "assistant", content: [{ type: "text", text: "Response" }] },
      }),
    ];
    writeFileSync(path, entries.join("\n"), "utf-8");

    const result = generateArtifact({ sessionPath: path });
    expect(result).not.toBeNull();
    expect(result!.html).toContain("Display user text");
    expect(result!.messageCount).toBe(2);
  });

  it("renders risk metric cards", () => {
    const sessionId = "test-metrics-001";
    const path = writeSessionFile(sessionId, [
      userMsg("评估风险"),
      assistantMsg("风险指标如下：\n\n夏普比率: 1.85\n最大回撤: -12.3%\n年化波动率: 18.5%\nVaR (95%): -2.1%\n胜率: 52.0%"),
    ]);

    const result = generateArtifact({ sessionPath: path });
    expect(result).not.toBeNull();
    expect(result!.html).toContain("mgrid");
    expect(result!.html).toContain("mcard");
    expect(result!.html).toContain("夏普比率");
    expect(result!.html).toContain("1.85");
    expect(result!.html).toContain("mv pos");  // Sharpe > 0
    expect(result!.html).toContain("mv neg");  // Drawdown < 0
  });

  it("renders score bars in benchmark tables", () => {
    const sessionId = "test-scores-001";
    const path = writeSessionFile(sessionId, [
      userMsg("benchmark对比"),
      assistantMsg("策略评分对比：\n\n代码          收益  风险  稳健性  总分\n000300.SH    85    72    90      82.3\n000905.SH    78    65    88      77.0\n399006.SZ    92    58    70      73.3"),
    ]);

    const result = generateArtifact({ sessionPath: path });
    expect(result).not.toBeNull();
    expect(result!.html).toContain("tw");
    expect(result!.html).toContain("si");
    expect(result!.html).toContain('class="fl hi"');
    expect(result!.html).toContain("82.3");
  });

  it("renders labeled bar charts", () => {
    const sessionId = "test-bars-001";
    const path = writeSessionFile(sessionId, [
      userMsg("因子对比"),
      assistantMsg("各因子表现：\n\n动量因子    ████████░░  78.5%\n反转因子    ██████░░░░  62.0%\n波动率因子  ████░░░░░░  38.2%\nRSI因子     █████████░  91.3%"),
    ]);

    const result = generateArtifact({ sessionPath: path });
    expect(result).not.toBeNull();
    // 4 bars → ECharts horizontal bar chart
    expect(result!.html).toContain("ec-box");
    expect(result!.html).toContain("echarts");
    expect(result!.html).toContain("动量因子");
    expect(result!.html).toContain("78.5%");
  });

  it("highlights inline signed percentages", () => {
    const sessionId = "test-highlight-001";
    const path = writeSessionFile(sessionId, [
      userMsg("收益怎么样"),
      assistantMsg("今日收益 +2.35%，本月累计 -1.80%，表现优于基准 +3.12%"),
    ]);

    const result = generateArtifact({ sessionPath: path });
    expect(result).not.toBeNull();
    expect(result!.html).toContain("whyj-up");
    expect(result!.html).toContain("whyj-dn");
    expect(result!.html).toContain("+2.35%");
    expect(result!.html).toContain("-1.80%");
  });

  it("renders K-line chart for OHLC data", () => {
    const sessionId = "test-kline-001";
    const klineData = [
      "日期          开盘      最高      最低      收盘",
      "2026-06-15  3920.50  3950.30  3910.20  3945.20",
      "2026-06-16  3945.20  3970.10  3935.50  3960.80",
      "2026-06-17  3960.80  3980.50  3945.30  3955.10",
      "2026-06-18  3955.10  3965.40  3930.00  3935.60",
      "2026-06-19  3935.60  3948.20  3915.80  3925.30",
    ].join("\n");
    const path = writeSessionFile(sessionId, [
      userMsg("拉K线"),
      assistantMsg("沪深300近5日K线：\n\n" + klineData),
    ]);

    const result = generateArtifact({ sessionPath: path });
    expect(result).not.toBeNull();
    expect(result!.html).toContain("ec-box");
    expect(result!.html).toContain("echarts");
    expect(result!.html).toContain("candlestick");
    expect(result!.html).toContain("3920.5");
    expect(result!.html).toContain("kline-fallback");
    expect(result!.html).toContain("kline-kpis");
    expect(result!.html).toContain("aria-label=\"日K K-line chart\"");
    expect(result!.html).toContain("K-LINE / OHLCV");
    expect(result!.html).toContain('class="board-panel board-primary"');
    expect(result!.html.indexOf('class="board-panel board-primary"')).toBeLessThan(result!.html.indexOf('class="kline-fallback"'));
    expect(result!.html.indexOf('class="kline-fallback"')).toBeLessThan(result!.html.indexOf('class="app-main"'));
    expect(result!.html).toContain("最新价");
    expect(result!.html).toContain("MACD");
    expect(result!.html).toContain("累计收益");
    expect(result!.html).toContain("年化波动率");
    expect(result!.html).toContain("VaR (95%)");
    expect(result!.html).toContain("最大回撤");
    expect(result!.html).not.toContain("NO QUANT METRICS");
    expect(result!.html).toContain(`--up:${WHYJ_THEME.marketUp};--down:${WHYJ_THEME.marketDown}`);
    expect(result!.html).toContain(`gold='${WHYJ_THEME.gold}'`);
    expect(result!.html).toContain(`hairline='${WHYJ_THEME.hairline}'`);
  });

  it("does NOT render K-line for non-OHLC tables", () => {
    const sessionId = "test-non-ohlc-001";
    const path = writeSessionFile(sessionId, [
      userMsg("对比"),
      assistantMsg("代码          收益  风险  稳健性\n000300.SH    85    72    90\n000905.SH    78    65    88"),
    ]);

    const result = generateArtifact({ sessionPath: path });
    expect(result).not.toBeNull();
    // Score table detected as "tw", not K-line
    expect(result!.html).toContain("tw");
    expect(result!.html).not.toContain("candlestick");
  });

  it("renders a financial performance chart in the command center for NAV series", () => {
    const sessionId = "test-nav-dashboard-001";
    const path = writeSessionFile(sessionId, [
      userMsg("展示基金净值走势"),
      assistantMsg([
        "日期        净值    基准    沪深300",
        "2026-06-15  1.0000  1.0000  1.0000",
        "2026-06-16  1.0180  1.0060  1.0040",
        "2026-06-17  1.0120  1.0090  1.0010",
        "2026-06-18  1.0350  1.0110  1.0080",
      ].join("\n")),
    ]);

    const result = generateArtifact({ sessionPath: path });

    expect(result).not.toBeNull();
    expect(result!.html).toContain("RESEARCH COMMAND CENTER");
    expect(result!.html).toContain("aria-label=\"Fund performance line chart\"");
    expect(result!.html).toContain("nav-product");
    expect(result!.html).toContain("LATEST NAV");
    expect(result!.html).toContain("data-quant-dashboard=\"true\"");
    expect(result!.html).toContain("data-chart-state=\"available\"");
  });

  it("renders plain text as paragraphs when no structured pattern detected", () => {
    const sessionId = "test-plain-001";
    const path = writeSessionFile(sessionId, [
      userMsg("你好"),
      assistantMsg("你好！有什么可以帮你的？"),
    ]);

    const result = generateArtifact({ sessionPath: path });
    expect(result).not.toBeNull();
    expect(result!.html).toContain("<p>");
    // CSS class is defined in theme, check that HTML class attribute is absent
    expect(result!.html).not.toContain('class="mgrid"');
    expect(result!.html).not.toContain('class="tw"');
    // A dashboard without market data must remain quant-only and must not
    // repurpose trajectory activity as a financial chart.
    expect(result!.html).toContain("RESEARCH COMMAND CENTER");
    expect(result!.html).toContain("NO PRICE SERIES");
    expect(result!.html).toContain("NO QUANT METRICS");
    expect(result!.html).toContain("data-chart-state=\"empty\"");
    expect(result!.html).toContain("data-quant-dashboard=\"true\"");
    expect(result!.html).not.toContain("aria-label=\"Research activity chart by turn\"");
    expect(result!.html).not.toContain('class="tool-donut"');
    expect(result!.html).not.toContain("AUDIT CAPTURE");
  });
});

// ── Template tests ──

describe("renderArtifactTemplate", () => {
  it("produces valid HTML document structure", () => {
    const html = renderArtifactTemplate({
      title: "Test Artifact",
      sessionId: "abc123",
      model: "deepseek-v4-pro",
      messageCount: 3,
      createdAt: "2026-06-22T10:00:00Z",
      bodyHtml: "<p>Hello world</p>",
      dockHtml: "",
      trajectoryHtml: "",
      generatedAt: "2026-06-22T11:00:00Z",
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html lang=\"zh-CN\"");
    expect(html).toContain("<title>Test Artifact");
    expect(html).toContain("app-hdr");
    expect(html).toContain("Hello world");
    expect(html).toContain("WhyJ Quant");
    expect(html).toContain("deepseek-v4-pro");
    expect(html).toContain("3"); // messageCount
  });

  it("includes inline CSS and JS", () => {
    const html = renderArtifactTemplate({
      title: "T",
      sessionId: "x",
      messageCount: 1,
      createdAt: "2026-06-22T10:00:00Z",
      bodyHtml: "",
      dockHtml: "",
      trajectoryHtml: "",
      generatedAt: "2026-06-22T10:00:00Z",
    });

    expect(html).toContain("<style>");
    expect(html).toContain("<script>");
    expect(html).toContain("toggleTheme");
    expect(html).toContain("sortTbl");
  });

  it("escapes HTML in title", () => {
    const html = renderArtifactTemplate({
      title: "<script>alert('xss')</script>",
      sessionId: "x",
      messageCount: 1,
      createdAt: "2026-06-22T10:00:00Z",
      bodyHtml: "",
      dockHtml: "",
      trajectoryHtml: "",
      generatedAt: "2026-06-22T10:00:00Z",
    });

    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("escapeHtml", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml("<>&\"'")).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("passes through plain text", () => {
    expect(escapeHtml("Hello World")).toBe("Hello World");
  });
});
