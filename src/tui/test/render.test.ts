import { describe, expect, it } from "bun:test";
import { Buffer, sanitizeTerminalText, wrap } from "../src/buffer.ts";
import { capSections, conversationMaxScrollUp, drawComposer, drawConversation, drawPortfolio, drawStatus, layout, overviewMaxScrollTop, buildOverviewView } from "../src/render.ts";
import { extractConversationSelection } from "../src/selection.ts";
import type { AppState } from "../src/types.ts";
import type { PanelSection, UIMessage } from "../src/types.ts";

describe("layout", () => {
  it("hides overview dock on narrow terminals", () => {
    const L = layout(77, 32);
    expect(L.showPanel).toBe(false);
    expect(L.mainPane.w).toBe(77);
  });

  it("reserves right dock on wide terminals", () => {
    const L = layout(120, 32);
    expect(L.showPanel).toBe(true);
    expect(L.portfolio.x).toBe(L.mainPane.w);
    expect(L.mainPane.w + L.portfolio.w).toBe(120);
  });
});

describe("text safety", () => {
  it("sanitizes control sequences and hard-wraps long tokens", () => {
    expect(sanitizeTerminalText("ok\x1b[31m red")).toBe("ok red");
    expect(wrap("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("clips buffer text at an absolute x boundary", () => {
    const buf = new Buffer(8, 1);
    buf.text(0, 0, "abcdef", {}, Infinity, 3);
    expect(buf.toPlain()[0]).toBe("abc     ");
  });
});

describe("scroll bounds", () => {
  it("computes conversation scroll from wrapped lines", () => {
    const msgs: UIMessage[] = [{ role: "assistant", text: "one two three four five six" }];
    expect(conversationMaxScrollUp(msgs, 6, 2)).toBeGreaterThan(0);
  });

  it("computes overview scroll from all sections", () => {
    const sections: PanelSection[] = [
      { kind: "quotes", title: "Watchlist", rows: [{ code: "A", name: "Alpha", price: 1, pct: 0 }, { code: "B", name: "Beta", price: 2, pct: 1 }] },
      { kind: "keyvalue", title: "Sources", rows: [{ label: "tushare", value: "today" }] },
    ];
    expect(overviewMaxScrollTop(sections, 3)).toBeGreaterThan(0);
  });

  it("builds overview view lines for selection copy", () => {
    const sections: PanelSection[] = [
      { kind: "quotes", title: "Watchlist", rows: [{ code: "000001.SZ", name: "Ping An", price: 10.5, pct: 1.2 }] },
    ];
    const L = layout(120, 32);
    const view = buildOverviewView(sections, L.portfolio, 0);
    expect(view.lines.some((l) => l.text.includes("Watchlist"))).toBe(true);
    expect(view.lines.some((l) => l.text.includes("000001"))).toBe(true);
    expect(view.lines.some((l) => l.text.includes("+1.20%") || l.text.includes("1.20%"))).toBe(true);
    const text = extractConversationSelection(view, {
      anchor: { lineIdx: 0, col: 0 },
      cursor: { lineIdx: view.lines.length - 1, col: 999 },
    });
    expect(text).toContain("000001");
  });
});

describe("capSections", () => {
  const h: PanelSection = { kind: "holdings", title: "P", rows: [] };
  const mk = (n: number): PanelSection => ({
    ...h,
    rows: Array.from({ length: n }, (_, i) => ({ code: `${i}`, name: `F${i}`, price: 1, pct: 0 })),
  });

  it("caps holdings rows to max", () => {
    const s = [mk(15)];
    const capped = capSections(s, 10);
    expect(capped.length).toBe(1);
    expect(capped[0].rows.length).toBe(10);
  });

  it("spreads cap across multiple sections", () => {
    const s = [mk(6), mk(8)];
    const capped = capSections(s, 10);
    expect(capped.length).toBe(2);
    expect(capped[0].rows.length).toBe(6);
    expect(capped[1].rows.length).toBe(4);
  });

  it("drops sections with 0 rows after capping", () => {
    const s = [mk(12), mk(3)];
    const capped = capSections(s, 10);
    expect(capped.length).toBe(1);
    expect(capped[0].rows.length).toBe(10);
  });

  it("does not cap keyvalue or quotes sections", () => {
    const kv: PanelSection = { kind: "keyvalue", title: "K", rows: [{ label: "a", value: "1" }, { label: "b", value: "2" }] };
    const q: PanelSection = { kind: "quotes", title: "Market", rows: [{ code: "000001.SH", name: "上证", price: 3300, pct: 0.5 }] };
    const s = [mk(3), q, kv];
    const capped = capSections(s, 2);
    expect(capped.length).toBe(3);
    expect(capped[0].rows.length).toBe(2); // holdings capped
    expect(capped[1].rows.length).toBe(1); // quotes untouched
    expect(capped[2].rows.length).toBe(2); // keyvalue untouched
  });

  it("returns empty when max is 0", () => {
    const s = [mk(5)];
    const capped = capSections(s, 0);
    expect(capped.length).toBe(0);
  });

  it("market quotes always visible even when holdings exceed cap", () => {
    const market: PanelSection = { kind: "quotes", title: "Market", rows: [
      { code: "000001.SH", name: "上证指数", price: 3300, pct: 0.5 },
      { code: "399001.SZ", name: "深证成指", price: 10800, pct: -0.3 },
    ] };
    const source: PanelSection = { kind: "keyvalue", title: "Source", rows: [{ label: "来源", value: "AKShare" }] };
    const sections: PanelSection[] = [mk(25), market, source];
    const capped = capSections(sections, 10);
    expect(capped.length).toBe(3);
    expect(capped[0].kind).toBe("holdings");
    expect(capped[0].rows.length).toBe(10); // capped
    expect(capped[1].kind).toBe("quotes");
    expect(capped[1].rows.length).toBe(2);  // market always full
    expect(capped[2].kind).toBe("keyvalue");
    expect(capped[2].rows.length).toBe(1);  // source always full
  });

  it("group sections are capped but market is not", () => {
    const group: PanelSection = { kind: "group", groupId: "g1", title: "科技", rows: Array.from({ length: 15 }, (_, i) => ({ code: `${i}`, name: `F${i}`, price: 1, pct: 0 })), collapsed: false };
    const market: PanelSection = { kind: "quotes", title: "Market", rows: [{ code: "000001.SH", name: "上证指数", price: 3300, pct: 0.5 }] };
    const capped = capSections([group, market], 8);
    expect(capped.length).toBe(2);
    expect(capped[0].rows.length).toBe(8); // group capped
    expect(capped[1].rows.length).toBe(1); // market always full
  });
});

describe("panel isolation", () => {
  it("conversation does not write into overview columns", () => {
    const buf = new Buffer(100, 24);
    const L = layout(100, 24);
    const msgs: UIMessage[] = [
      { role: "user", text: "x".repeat(120) },
      { role: "thinking", text: "y".repeat(200), thinkingLive: true },
      { role: "assistant", text: "z".repeat(200) },
    ];
    drawConversation(buf, L.conversation, msgs, "thinking", L.mainPane);

    const rows = buf.toPlain();
    for (let y = L.portfolio.y; y < L.portfolio.y + L.portfolio.h; y++) {
      const panelText = rows[y].slice(L.portfolio.x, L.portfolio.x + L.portfolio.w);
      expect(panelText.trim()).toBe("");
    }
  });

  it("clears overview area after long thinking output", () => {
    const buf = new Buffer(100, 24);
    const L = layout(100, 24);
    const msgs: UIMessage[] = [{ role: "thinking", text: "x".repeat(200) }];
    drawConversation(buf, L.conversation, msgs, "thinking", L.mainPane);
    drawPortfolio(buf, L.portfolio, [], false);

    const rows = buf.toPlain();
    for (let y = L.portfolio.y; y < L.portfolio.y + L.portfolio.h; y++) {
      const panelText = rows[y].slice(L.portfolio.x);
      expect(panelText).not.toContain("xxxxxxxx");
    }
  });

  it("streams thinking text same as assistant, in gray", () => {
    const buf = new Buffer(100, 24);
    const L = layout(100, 24);
    const msgs: UIMessage[] = [{ role: "thinking", text: "让我分析一下这个数据..." }];
    drawConversation(buf, L.conversation, msgs, "ready", L.mainPane);
    const rows = buf.toPlain().map(r => r.slice(L.conversation.x, L.conversation.x + L.conversation.w));
    expect(rows.some(r => r.includes("让我分析一下这个数据"))).toBe(true);
  });

  it("keeps finalized thinking visible in gray instead of collapsing it", () => {
    const buf = new Buffer(100, 24);
    const L = layout(100, 24);
    const msgs: UIMessage[] = [
      { role: "thinking", text: "Need to inspect source quality first.", thinkingLive: false },
      { role: "assistant", text: "The data source is ready." },
    ];

    drawConversation(buf, L.conversation, msgs, "ready", L.mainPane);

    const rows = buf.toPlain();
    const y = rows.findIndex((row) => row.includes("Need to inspect source quality first."));
    expect(y).toBeGreaterThanOrEqual(0);
    expect(rows.some((row) => row.includes("The data source is ready."))).toBe(true);

    const x = rows[y].indexOf("Need");
    const cell = buf.cells[y * buf.w + x];
    expect(cell.fg).toBe("#C8C8C8");
  });

  it("renders tool calls with a polite label, status, and result preview", () => {
    const buf = new Buffer(100, 24);
    const L = layout(100, 24);
    const msgs: UIMessage[] = [{
      role: "tool",
      tool: {
        name: "fetch_bars",
        label: "AKShare · Daily Bars",
        args: "000300.SH",
        status: "done",
        startedAt: Date.now() - 1200,
        result: "Downloaded 2 rows from AKShare",
      },
    }];

    drawConversation(buf, L.conversation, msgs, "ready", L.mainPane);

    const text = buf.toPlain().join("\n");
    expect(text).toContain("✓ AKShare · Daily Bars");
    expect(text).toContain("Downloaded 2 rows from AKShare");
    expect(text).not.toContain("fetch_bars");
  });

  it("shows portfolio fund count and scroll position in the overview title", () => {
    const buf = new Buffer(120, 24);
    const L = layout(120, 24);
    const sections: PanelSection[] = [
      {
        kind: "holdings",
        title: "Portfolio",
        rows: Array.from({ length: 12 }, (_, i) => ({
          code: `0000${i + 1}`,
          name: `基金${i + 1}`,
          price: 1 + i,
          pct: i - 2,
        })),
      },
      {
        kind: "keyvalue",
        title: "Source",
        rows: [{ label: "status", value: "ok" }],
      },
    ];

    drawPortfolio(buf, L.portfolio, sections, false, 2);
    const rows = buf.toPlain();
    expect(rows.some((row) => row.includes("◫ Overview"))).toBe(true);
    expect(rows.some((row) => row.includes("scroll 3/"))).toBe(true);
  });
});

describe("drawComposer queue", () => {
  const base: AppState = {
    model: "test",
    modelLabel: "test",
    version: "0",
    user: "u",
    activity: "ready",
    cost: 0,
    cacheHit: 0,
    messages: [],
    panel: [],
    panelLoading: false,
    input: "",
    composerQueue: [],
    composerStatus: null,
    activePortfolio: "holdings.json",
    aShareSource: "akshare",
    globalSource: "llmquant-data",
    showPortfolioPanel: true,
  };

  it("keeps input above queued lines", () => {
    const buf = new Buffer(120, 32);
    const L = layout(120, 32);
    drawComposer(buf, L.composer, {
      ...base,
      composerQueue: ["查看你缓存队列", "second message"],
    }, "11");

    const rows = buf.toPlain();
    const innerStart = L.composer.y + 1;
    const inputLine = rows[innerStart] ?? "";
    const queueLine = rows[innerStart + 1] ?? "";
    expect(inputLine).toContain("11");
    expect(queueLine).toContain("[1]");
    expect(queueLine).toContain("查看你缓存队列");
  });
});

describe("drawStatus", () => {
  it("renders the active model, data sources, and portfolio", () => {
    const buf = new Buffer(140, 4);
    drawStatus(buf, 3, 140, {
      model: "openai/gpt-5.5",
      modelLabel: "gpt-5.5",
      version: "0",
      user: "u",
      activity: "ready",
      cost: 0,
      cacheHit: 0,
      messages: [],
      panel: [],
      panelLoading: false,
      input: "",
      composerQueue: [],
      composerStatus: null,
      activePortfolio: "core.json",
      aShareSource: "tushare",
      globalSource: "financial-datasets",
      showPortfolioPanel: true,
    });

    const statusLine = buf.toPlain()[3];
    expect(statusLine).toContain("openai/gpt-5.5");
    expect(statusLine).toContain("tushare");
    expect(statusLine).toContain("core.json");
  });
});

describe("portfolio display", () => {
  const holding = (code: string, name: string, pct: number) => ({ code, name, price: 1.5, pct });

  it("renders overview row as code + name + pct on single line", () => {
    const buf = new Buffer(120, 32);
    const L = layout(120, 32);
    const sections: PanelSection[] = [
      { kind: "holdings", title: "Default", rows: [holding("000001", "沪深300ETF", 2.35), holding("000002", "中证500ETF", -1.27)] },
    ];
    drawPortfolio(buf, L.portfolio, sections, false);
    const rows = buf.toPlain().map(r => r.slice(L.portfolio.x));
    // Row should contain code, name, and pct
    expect(rows.some(r => r.includes("000001") && r.includes("沪深300ETF") && r.includes("+2.35%"))).toBe(true);
    expect(rows.some(r => r.includes("000002") && r.includes("中证500ETF") && r.includes("-1.27%"))).toBe(true);
  });

  it("code is aligned with 8-char padding", () => {
    const buf = new Buffer(120, 32);
    const L = layout(120, 32);
    const sections: PanelSection[] = [
      { kind: "holdings", title: "P", rows: [holding("000001", "Test", 0)] },
    ];
    drawPortfolio(buf, L.portfolio, sections, false);
    const rows = buf.toPlain().map(r => r.slice(L.portfolio.x));
    const row = rows.find(r => r.includes("000001") && r.includes("Test"));
    expect(row).toBeDefined();
    // Code section: 6-digit code + 2 spaces = 8 chars
    const codeIdx = row!.indexOf("000001");
    const codeEnd = codeIdx + 8;
    expect(row!.slice(codeIdx, codeEnd)).toMatch(/000001\s{2}/);
  });

  it("shows group header with fold indicator", () => {
    const buf = new Buffer(120, 32);
    const L = layout(120, 32);
    const sections: PanelSection[] = [
      { kind: "group", groupId: "g1", title: "科技组", rows: [holding("000001", "科技ETF", 3.1)], collapsed: false },
    ];
    drawPortfolio(buf, L.portfolio, sections, false);
    const rows = buf.toPlain().map(r => r.slice(L.portfolio.x));
    expect(rows.some(r => r.includes("▼ 科技组"))).toBe(true);
  });

  it("shows collapsed group with expand indicator", () => {
    const buf = new Buffer(120, 32);
    const L = layout(120, 32);
    const sections: PanelSection[] = [
      { kind: "group", groupId: "g1", title: "消费组", rows: [holding("000002", "消费ETF", -0.5)], collapsed: true },
    ];
    drawPortfolio(buf, L.portfolio, sections, false);
    const rows = buf.toPlain().map(r => r.slice(L.portfolio.x));
    expect(rows.some(r => r.includes("▶ 消费组"))).toBe(true);
    expect(rows.every(r => !r.includes("消费ETF"))).toBe(true);
  });

  it("shows keyvalue section with label and value", () => {
    const buf = new Buffer(120, 32);
    const L = layout(120, 32);
    const sections: PanelSection[] = [
      { kind: "keyvalue", title: "Source", rows: [{ label: "data", value: "AKShare" }] },
    ];
    drawPortfolio(buf, L.portfolio, sections, false);
    const rows = buf.toPlain().map(r => r.slice(L.portfolio.x));
    expect(rows.some(r => r.includes("Source"))).toBe(true);
    expect(rows.some(r => r.includes("data") && r.includes("AKShare"))).toBe(true);
  });

  it("shows quotes section with market data", () => {
    const buf = new Buffer(120, 32);
    const L = layout(120, 32);
    const sections: PanelSection[] = [
      { kind: "quotes", title: "Market", rows: [{ code: "000001.SH", name: "上证指数", price: 3300, pct: 0.5 }] },
    ];
    drawPortfolio(buf, L.portfolio, sections, false);
    const rows = buf.toPlain().map(r => r.slice(L.portfolio.x));
    expect(rows.some(r => r.includes("Market"))).toBe(true);
    expect(rows.some(r => r.includes("000001") && r.includes("上证指数"))).toBe(true);
  });

  it("reports scroll position via overviewMaxScrollTop", () => {
    const rows = Array.from({ length: 30 }, (_, i) => holding(`${i}`, `Fund${i}`, i - 15));
    const sections: PanelSection[] = [{ kind: "holdings", title: "All", rows }];
    const maxScroll = overviewMaxScrollTop(sections, 10);
    expect(maxScroll).toBeGreaterThan(0);
  });

  it("shows loading spinner when loading and empty", () => {
    const buf = new Buffer(120, 32);
    const L = layout(120, 32);
    drawPortfolio(buf, L.portfolio, [], true);
    const rows = buf.toPlain().map(r => r.slice(L.portfolio.x));
    expect(rows.some(r => r.includes("Waiting for market data"))).toBe(true);
  });

  it("shows title when sections present", () => {
    const buf = new Buffer(120, 32);
    const L = layout(120, 32);
    const sections: PanelSection[] = [
      { kind: "keyvalue", title: "Source", rows: [{ label: "status", value: "ok" }] },
    ];
    drawPortfolio(buf, L.portfolio, sections, false);
    const rows = buf.toPlain().map(r => r.slice(L.portfolio.x));
    expect(rows.some(r => r.includes("Overview"))).toBe(true);
  });

  it("renders section header with gold divider", () => {
    const buf = new Buffer(120, 32);
    const L = layout(120, 32);
    const sections: PanelSection[] = [
      { kind: "quotes", title: "Market", rows: [] },
    ];
    drawPortfolio(buf, L.portfolio, sections, false);
    const rows = buf.toPlain().map(r => r.slice(L.portfolio.x));
    expect(rows.some(r => r.includes("Market"))).toBe(true);
  });
});
