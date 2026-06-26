import { describe, expect, it } from "bun:test";
import { Buffer, sanitizeTerminalText, strWidth, wrap } from "../src/buffer.ts";
import { capSections, conversationMaxScrollUp, drawComposer, drawConversation, drawPortfolio, drawStatus, layout, overviewMaxScrollTop, buildOverviewView, buildConversationView } from "../src/render.ts";
import { buildConversationLines } from "../src/render-lines.ts";
import { extractConversationSelection } from "../src/selection.ts";
import { shellDisplayName } from "../../tools/catalog.ts";
import { GOLD, MARKET_DOWN, MARKET_UP, NEGATIVE, POSITIVE, S } from "../src/styles.ts";
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

  it("gives composer enough height for five slash suggestion rows in compact mode", () => {
    const L = layout(120, 32);
    expect(L.composer.h).toBe(8);
  });
});

describe("text safety", () => {
  it("sanitizes control sequences and hard-wraps long tokens", () => {
    expect(sanitizeTerminalText("ok\x1b[31m red")).toBe("ok red");
    expect(sanitizeTerminalText("model deepseek-v4-pro[1m]")).toBe("model deepseek-v4-pro");
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
  it("uses analyzing as the conversation panel title", () => {
    const buf = new Buffer(100, 24);
    const L = layout(100, 24);

    drawConversation(buf, L.conversation, [{ role: "assistant", text: "Done" }], "ready", L.mainPane);

    const topRow = buf.toPlain()[L.mainPane.y];
    expect(topRow).toContain("◉ Analyzing");
    expect(topRow).not.toContain("◉ Conversation");
  });

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

  it("anchors short conversation output to the bottom of the panel", () => {
    const buf = new Buffer(100, 24);
    const L = layout(100, 24);
    const msgs: UIMessage[] = [{ role: "assistant", text: "bottom anchored output" }];

    drawConversation(buf, L.conversation, msgs, "ready", L.mainPane);

    const rows = buf.toPlain();
    const outputRow = rows.findIndex((row) => row.includes("bottom anchored output"));
    expect(outputRow).toBe(L.conversation.y + L.conversation.h - 3);
  });

  it("renders active thinking in gray while streaming", () => {
    const buf = new Buffer(100, 24);
    const L = layout(100, 24);
    const msgs: UIMessage[] = [
      { role: "thinking", text: "Need to inspect source quality first.", thinkingLive: true },
      { role: "assistant", text: "The data source is ready." },
    ];

    drawConversation(buf, L.conversation, msgs, "ready", L.mainPane);

    const rows = buf.toPlain();
    const y = rows.findIndex((row) => row.includes("Need to inspect source quality first."));
    expect(y).toBeGreaterThanOrEqual(0);
    expect(rows.join("\n")).not.toContain("✻ Thinking");
    expect(rows.some((row) => row.includes("The data source is ready."))).toBe(true);

    const x = rows[y].indexOf("Need");
    const cell = buf.cells[y * buf.w + x];
    expect(cell.fg).toBe("#7F807D");
    expect(cell.dim).toBe(true);
  });

  it("keeps finalized thinking content without a polite heading", () => {
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
    expect(rows.join("\n")).not.toContain("✻ Thinking");
    expect(rows.some((row) => row.includes("The data source is ready."))).toBe(true);

    const x = rows[y].indexOf("Need");
    const cell = buf.cells[y * buf.w + x];
    expect(cell.fg).toBe("#7F807D");
    expect(cell.dim).toBe(true);
  });

  it("renders active thinking status and tips on separate bottom lines", () => {
    const buf = new Buffer(100, 24);
    const L = layout(100, 24);
    const msgs: UIMessage[] = [
      { role: "thinking", text: "Reviewing market data before answering.", thinkingLive: true, startedAt: Date.now() - 10_000 },
    ];

    drawConversation(buf, L.conversation, msgs, "thinking", L.mainPane);

    const rows = buf.toPlain();
    const statusRow = L.conversation.y + L.conversation.h - 3;
    const tipRow = L.conversation.y + L.conversation.h - 2;
    expect(rows.some((row) => row.includes("Reviewing market data before answering."))).toBe(true);
    expect(rows[statusRow]).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Thinking\.\.\. \(1\d?s · \d+ tokens\)/);
    expect(rows[tipRow]).toContain("Tip:");
    expect(rows[tipRow]).not.toContain("Reviewing market data before answering.");

    const statusX = rows[statusRow].indexOf("Thinking");
    const statusCell = buf.cells[statusRow * buf.w + statusX];
    expect(statusCell.bold).toBe(true);
    expect(statusCell.fg).not.toBe("#8A8A8A");
  });

  it("renders compacting status with the same animated banner treatment", () => {
    const buf = new Buffer(100, 24);
    const L = layout(100, 24);
    const msgs: UIMessage[] = [
      { role: "assistant", text: "Compacted summary preview" },
    ];

    drawConversation(buf, L.conversation, msgs, "compacting", L.mainPane);

    const rows = buf.toPlain();
    const statusRow = L.conversation.y + L.conversation.h - 3;
    expect(rows[statusRow]).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Compacting\.\.\. \(\d+ tokens\)/);

    const statusX = rows[statusRow].indexOf("Compacting");
    const statusCell = buf.cells[statusRow * buf.w + statusX];
    expect(statusCell.bold).toBe(true);
    expect(statusCell.fg).not.toBe("#8A8A8A");
  });

  it("renders compact receipt tables and retention map with fintech semantic colors", () => {
    const L = layout(120, 32);
    const msgs: UIMessage[] = [
      {
        role: "assistant",
        text: [
          "Compacted",
          "",
          "metric           value             note",
          "---------------  ----------------  ----------------------",
          "retained fields  4/4               quant summary coverage",
          "",
          "quant context kept",
          "",
          "field         status  detail",
          "------------  ------  ------------------------------------------------------------------------",
          "scope         kept    symbols: 510300.SH, 510500.SH; benchmark: 000300.SH",
          "",
          "retention map",
          "",
          "retained      ████████  4/4",
          "scope         ████████  kept",
        ].join("\n"),
      },
    ];

    const view = buildConversationView(msgs, L.conversation, 0, L.mainPane);
    const keptLine = view.lines.find((line) => line.text.includes("scope") && line.text.includes("kept"));

    expect(keptLine?.segments?.some((seg) => seg.text.includes("kept") && seg.style?.fg === POSITIVE)).toBe(true);
    expect(view.lines.some((line) => line.segments?.some((seg) => seg.text.includes("█") && seg.style?.fg === GOLD))).toBe(true);
  });

  it("quotes the original error in the active bottom tip", () => {
    const buf = new Buffer(100, 24);
    const L = layout(100, 24);
    const msgs: UIMessage[] = [
      { role: "error", text: "Fetch failed:\nupstream timeout from tushare" },
      { role: "thinking", text: "Recovering with fallback source.", thinkingLive: true },
    ];

    drawConversation(buf, L.conversation, msgs, "thinking", L.mainPane);

    const rows = buf.toPlain();
    const tipRow = L.conversation.y + L.conversation.h - 2;
    expect(rows[tipRow]).toContain("Tip: Error: Fetch failed: upstream timeout from tushare");
  });

  it("quotes the original tool error result in the active bottom tip", () => {
    const buf = new Buffer(100, 24);
    const L = layout(100, 24);
    const msgs: UIMessage[] = [
      {
        role: "tool",
        tool: {
          name: "fetch_bars",
          label: "AKShare · Daily Bars",
          status: "error",
          startedAt: Date.now() - 1000,
          result: "HTTP 502 from akshare gateway",
        },
      },
      { role: "thinking", text: "Trying another provider.", thinkingLive: true },
    ];

    drawConversation(buf, L.conversation, msgs, "running tool", L.mainPane);

    const rows = buf.toPlain();
    const tipRow = L.conversation.y + L.conversation.h - 2;
    expect(rows[tipRow]).toContain("Tip: Error: HTTP 502 from akshare gateway");
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
    expect(text).toContain("● AKShare · Daily Bars");
    expect(text).toContain("⎿ Downloaded 2 rows from AKShare");
    expect(text).toContain("Downloaded 2 rows from AKShare");
    expect(text).not.toContain("fetch_bars");
  });

  it("does not show elapsed time on running tool calls", () => {
    const buf = new Buffer(100, 24);
    const L = layout(100, 24);
    const msgs: UIMessage[] = [{
      role: "tool",
      tool: {
        name: "akshare_fund_nav",
        label: "Tool.akshare.fund.nav · 270042",
        args: "270042",
        status: "running",
        startedAt: Date.now() - 10_000,
      },
    }];

    drawConversation(buf, L.conversation, msgs, "running tool", L.mainPane);

    const text = buf.toPlain().join("\n");
    expect(text).toContain("● Tool.akshare.fund.nav · 270042");
    expect(text).not.toMatch(/\b\d+:\d{2}\b/);
    expect(text).not.toMatch(/\b\d+s\b/);
  });

  it("renders skill calls like tool calls with a SKILL namespace and running ellipsis", () => {
    const buf = new Buffer(100, 24);
    const L = layout(100, 24);
    const msgs: UIMessage[] = [{
      role: "skill",
      skill: {
        name: "llmquant-macro",
        label: "SKILL.llmquant-macro",
        status: "running",
        startedAt: Date.now() - 1200,
      },
    }];

    drawConversation(buf, L.conversation, msgs, "running tool", L.mainPane);

    const text = buf.toPlain().join("\n");
    expect(text).toContain("● SKILL.llmquant-macro ...");
    expect(text).not.toContain("⚡ skill:llmquant-macro");
  });

  it("renders bash and quant tool calls with pi-style namespaces", () => {
    const shell = shellDisplayName();
    const buf = new Buffer(100, 24);
    const L = layout(100, 24);
    const msgs: UIMessage[] = [
      {
        role: "tool",
        tool: {
          name: "bash",
          label: `${shell}.Read · Get-Content src/tools/catalog.ts`,
          args: "Get-Content src/tools/catalog.ts",
          status: "done",
          startedAt: Date.now() - 1000,
        },
      },
      {
        role: "tool",
        tool: {
          name: "bash",
          label: `${shell}.Write · Set-Content out.txt value`,
          args: "Set-Content out.txt value",
          status: "done",
          startedAt: Date.now() - 1000,
        },
      },
      {
        role: "tool",
        tool: {
          name: "bash",
          label: `${shell}.Update · Get-Content a.ts | Set-Content b.ts`,
          args: "Get-Content a.ts | Set-Content b.ts",
          status: "done",
          startedAt: Date.now() - 1000,
        },
      },
      {
        role: "tool",
        tool: {
          name: "bash",
          label: `${shell}.Shell · node script.js`,
          args: "node script.js",
          status: "done",
          startedAt: Date.now() - 1000,
        },
      },
      {
        role: "tool",
        tool: {
          name: "check_risk",
          label: "Quant.Risk · 000300.SH",
          args: "000300.SH",
          status: "done",
          startedAt: Date.now() - 1000,
        },
      },
    ];

    drawConversation(buf, L.conversation, msgs, "ready", L.mainPane);

    const text = buf.toPlain().join("\n");
    expect(text).toContain(`● ${shell}.Read · Get-Content src/tools/catalog.ts`);
    expect(text).toContain(`● ${shell}.Write · Set-Content out.txt value`);
    expect(text).toContain(`● ${shell}.Update · Get-Content a.ts | Set-Content b.ts`);
    expect(text).toContain(`● ${shell}.Shell · node script.js`);
    expect(text).toContain("● Quant.Risk · 000300.SH");
    expect(text).not.toContain("Bash / bash");
    expect(text).not.toContain("Quant / risk");
  });

  it("renders diff-like tool result previews with added and removed line styles", () => {
    const shell = shellDisplayName();
    const buf = new Buffer(100, 24);
    const L = layout(100, 24);
    const msgs: UIMessage[] = [{
      role: "tool",
      tool: {
        name: "bash",
        label: `${shell}.Update · git diff -- src/app-runtime.ts`,
        args: "git diff -- src/app-runtime.ts",
        status: "done",
        startedAt: Date.now() - 1000,
        result: "@@ -1,2 +1,2 @@\n-old value\n+new value\n context",
      },
    }];

    drawConversation(buf, L.conversation, msgs, "ready", L.mainPane);

    const rows = buf.toPlain();
    const removedY = rows.findIndex((row) => row.includes("-old value"));
    const addedY = rows.findIndex((row) => row.includes("+new value"));
    expect(removedY).toBeGreaterThanOrEqual(0);
    expect(addedY).toBeGreaterThanOrEqual(0);
    const removedX = rows[removedY].indexOf("-old value");
    const addedX = rows[addedY].indexOf("+new value");
    expect(buf.cells[removedY * buf.w + removedX].fg).toBe("#E5494D");
    expect(buf.cells[addedY * buf.w + addedX].fg).toBe("#1E9F4D");
  });

  it("truncates long tool result previews after three lines", () => {
    const buf = new Buffer(100, 24);
    const L = layout(100, 24);
    const msgs: UIMessage[] = [{
      role: "tool",
      tool: {
        name: "bash",
        label: "PowerShell.Read · preview",
        args: "preview",
        status: "done",
        startedAt: Date.now() - 1000,
        result: "line1\nline2\nline3\nline4\nline5",
      },
    }];

    drawConversation(buf, L.conversation, msgs, "ready", L.mainPane);

    const text = buf.toPlain().join("\n");
    expect(text).toContain("line1");
    expect(text).toContain("line2");
    expect(text).toContain("line3");
    expect(text).toContain("... 2 more lines");
    expect(text).not.toContain("line4");
    expect(text).not.toContain("line5");
  });

  it("keeps deterministic chart blocks visible in tool result previews", () => {
    const lines = buildConversationLines([
      {
        role: "tool",
        tool: {
          name: "fetch_bars",
          label: "AKShare · Daily Bars",
          args: "000300.SH",
          status: "done",
          startedAt: Date.now() - 1000,
          result: [
            "Downloaded  000300.SH",
            "⌁ Close     ▁▂▃▄▅▆▇█  10.70  +2.30%",
            "▥ Volume    ▁▂▃▄▅▆▇█  1.20M",
            "┃ K-line",
            "2026-01-02  ▲  O=10.00 H=10.80 L=9.90 C=10.70  +2.30%",
            "2026-01-03  ▼  O=10.70 H=10.90 L=10.10 C=10.20  -1.50%",
            "Source      akshare",
            "Bars        120",
          ].join("\n"),
        },
      },
    ] as UIMessage[], 96);

    expect(lines.some((line) => line.text.includes("2026-01-03"))).toBe(true);
    expect(lines.some((line) => line.segments?.some((seg) => seg.text.includes("▁▂▃") && seg.style?.fg === GOLD))).toBe(true);
    expect(lines.some((line) => line.segments?.some((seg) => seg.text.includes("▥") && seg.style?.fg === GOLD))).toBe(true);
    expect(lines.some((line) => line.segments?.some((seg) => seg.text.includes("▲") && seg.style?.fg === MARKET_UP))).toBe(true);
    expect(lines.some((line) => line.segments?.some((seg) => seg.text.includes("▼") && seg.style?.fg === MARKET_DOWN))).toBe(true);
    expect(lines.some((line) => line.segments?.some((seg) => seg.text.includes("+2.30%") && seg.style?.fg === MARKET_UP))).toBe(true);
    expect(lines.some((line) => line.segments?.some((seg) => seg.text.includes("-1.50%") && seg.style?.fg === MARKET_DOWN))).toBe(true);
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
    source: "llmquant-data",
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

  it("renders slash suggestions below the input inside composer, not above it", () => {
    const buf = new Buffer(120, 32);
    const L = layout(120, 32);

    drawComposer(buf, L.composer, base, "/re", [
      { label: "/resume  Resume", fill: "/resume" },
      { label: "/reset  Reset", fill: "/reset" },
      { label: "/retry  Retry", fill: "/retry" },
    ], 0, L.conversation);

    const rows = buf.toPlain();
    const composerTop = L.composer.y;
    const composerBottom = L.composer.y + L.composer.h - 1;
    const activeRow = rows.findIndex((row) => row.includes("> /resume  Resume"));

    expect(activeRow).toBeGreaterThan(composerTop);
    expect(activeRow).toBeLessThanOrEqual(composerBottom);

    const rowsAboveComposer = rows.slice(0, composerTop).join("\n");
    expect(rows.join("\n")).not.toContain("/ Commands (1/3)");
    expect(rowsAboveComposer).not.toContain("/resume  Resume");
  });

  it("renders a single slash suggestion compactly without a nested box", () => {
    const buf = new Buffer(120, 32);
    const L = layout(120, 32);

    drawComposer(buf, L.composer, base, "/he", [
      { label: "/help  Show commands and hotkeys", fill: "/help" },
    ], 0, L.conversation);

    const text = buf.toPlain().join("\n");
    expect(text).toContain("> /help  Show commands and hotkeys");
    expect(text).not.toContain("/ Commands");
    expect(text).not.toContain("▶ /help  Help");
  });
});

describe("render lines", () => {
  it("defines semantic structured-render style tokens for future themes", () => {
    expect(S.tableHeader.fg).toBe(GOLD);
    expect(S.tablePositive.fg).toBe(POSITIVE);
    expect(S.tableNegative.fg).toBe(NEGATIVE);
    expect(S.tableGain.fg).toBe(MARKET_UP);
    expect(S.tableLoss.fg).toBe(MARKET_DOWN);
    expect(S.chartLine.fg).toBe(GOLD);
    expect(S.chartUp.fg).toBe(MARKET_UP);
    expect(S.chartDown.fg).toBe(MARKET_DOWN);
  });

  it("formats doctor reports with semantic credential colors", () => {
    const lines = buildConversationLines([
      {
        role: "assistant",
        text: [
          "WhyJ Doctor",
          "",
          "item           value",
          "-------------  ----------------",
          "command        whyj doctor",
          "status         ready",
          "model          deepseek-v4-pro[1m]",
          "base url       https://api.deepseek.com/anthropic",
          "",
          "Credentials",
          "",
          "key                   status   source   value",
          "--------------------  -------  -------  ------------------",
          "WHYJ_QUANT_AUTH_TOKEN       OK       env      sk-t...1234 · fp:abcd1234",
          "WHYJ_QUANT_API_KEY          Missing  missing  -",
        ].join("\n"),
      },
    ] as UIMessage[], 80);

    expect(lines.some((line) => line.text.includes("WhyJ Doctor"))).toBe(true);
    expect(lines.some((line) => line.text.includes("deepseek-v4-pro[1m]"))).toBe(false);
    expect(lines.some((line) => line.segments?.some((seg) => seg.text === "OK" && seg.style?.fg === POSITIVE))).toBe(true);
    expect(lines.some((line) => line.segments?.some((seg) => seg.text === "Missing" && seg.style?.fg === NEGATIVE))).toBe(true);
    expect(lines.some((line) => line.text.includes("sk-t...1234 · fp:abcd1234"))).toBe(true);
  });

  it("formats compact receipts and tool previews through the shared line renderer", () => {
    const lines = buildConversationLines([
      { role: "assistant", text: "Compacted\nmetric  value  note\nturns  12  kept\nretention map\nfacts  ███░  kept" },
      { role: "tool", tool: { name: "bash", args: "git diff", label: "bash git diff", status: "done", startedAt: Date.now(), result: "+ added line\n- removed line" } },
    ] as UIMessage[], 48);

    expect(lines.some((line) => line.text.includes("Compacted"))).toBe(true);
    expect(lines.some((line) => line.text.includes("retention map"))).toBe(true);
    expect(lines.some((line) => line.text.includes("bash git diff"))).toBe(true);
    expect(lines.some((line) => line.text.includes("added line"))).toBe(true);
    expect(lines.some((line) => line.text.includes("removed line"))).toBe(true);
  });

  it("formats generic tables with stable tabular alignment and semantic colors", () => {
    const lines = buildConversationLines([
      {
        role: "assistant",
        text: [
          "| metric | value | note |",
          "| --- | --- | --- |",
          "| CAGR | +12.30% | strong |",
          "| Max DD | -8.20% | breach |",
        ].join("\n"),
      },
    ] as UIMessage[], 80);

    const cagr = lines.find((line) => line.text.includes("CAGR"));
    const drawdown = lines.find((line) => line.text.includes("Max DD"));
    const header = lines.find((line) => line.text.includes("metric") && line.text.includes("value"));
    const rules = lines.filter((line) => line.text.includes("─"));

    expect(lines.every((line) => !line.text.includes("|"))).toBe(true);
    expect(rules.length).toBe(3);
    expect(header?.text.indexOf("value")).toBe(cagr?.text.indexOf("+12.30%"));
    expect(cagr?.text.indexOf("+12.30%")).toBe(drawdown?.text.indexOf("-8.20%"));
    expect(cagr?.segments?.some((seg) => seg.text.includes("+12.30%") && seg.style?.fg === MARKET_UP)).toBe(true);
    expect(drawdown?.segments?.some((seg) => seg.text.includes("-8.20%") && seg.style?.fg === MARKET_DOWN)).toBe(true);
  });

  it("absorbs standalone table header dividers into full-width three-line tables", () => {
    const lines = buildConversationLines([
      {
        role: "assistant",
        text: [
          "code       name                         price  change  bars  range",
          "  ----------------------------------------------------------------",
          "562590.SH  Semiconductor Equipment ETF  1.62   -0.35%  543   2023-10 -> 2025-12",
          "159842.SZ  Semiconductor Materials ETF  1.15   -0.48%  1170  2021-03 -> 2025-12",
        ].join("\n"),
      },
    ] as UIMessage[], 120);

    const rules = lines.filter((line) => line.text.includes("\u2500"));
    const header = lines.find((line) => line.text.includes("code") && line.text.includes("change"));
    const firstData = lines.find((line) => line.text.includes("562590.SH"));

    expect(lines.some((line) => line.text.includes("----------------------------------------------------------------"))).toBe(false);
    expect(rules.length).toBe(3);
    expect(header).toBeTruthy();
    expect(firstData).toBeTruthy();
    expect(rules.every((rule) => firstData && strWidth(rule.text) === strWidth(firstData.text))).toBe(true);
  });

  it("does not bold the first aligned data row without an explicit header divider", () => {
    const lines = buildConversationLines([
      {
        role: "assistant",
        text: [
          "AAPL  Apple Inc.      +1.20%",
          "MSFT  Microsoft Corp  -0.80%",
        ].join("\n"),
      },
    ] as UIMessage[], 80);

    const firstData = lines.find((line) => line.text.includes("AAPL"));

    expect(firstData?.segments?.some((seg) => seg.text.includes("AAPL") && seg.style?.bold)).toBe(false);
    expect(firstData?.segments?.some((seg) => seg.text.includes("+1.20%") && seg.style?.fg === MARKET_UP)).toBe(true);
  });

  it("colors sparkline and K-line chart-style blocks", () => {
    const lines = buildConversationLines([
      {
        role: "assistant",
        text: [
          "⌁ Line chart",
          "close  ▁▂▃▄▅▆▇█  +4.20%",
          "",
          "┃ K-line",
          "2026-01-02  ▲  O=10.00 H=10.80 L=9.90 C=10.70  +2.30%",
          "2026-01-03  ▼  O=10.70 H=10.90 L=10.10 C=10.20  -1.50%",
        ].join("\n"),
      },
    ] as UIMessage[], 96);

    expect(lines.some((line) => line.segments?.some((seg) => seg.text.includes("Line chart") && seg.style?.fg === GOLD))).toBe(true);
    expect(lines.some((line) => line.segments?.some((seg) => seg.text.includes("⌁") && seg.style?.fg === GOLD))).toBe(true);
    expect(lines.some((line) => line.segments?.some((seg) => seg.text.includes("▁▂▃") && seg.style?.fg === GOLD))).toBe(true);
    expect(lines.some((line) => line.segments?.some((seg) => seg.text.includes("▲") && seg.style?.fg === MARKET_UP))).toBe(true);
    expect(lines.some((line) => line.segments?.some((seg) => seg.text.includes("▼") && seg.style?.fg === MARKET_DOWN))).toBe(true);
    expect(lines.some((line) => line.segments?.some((seg) => seg.text.includes("+2.30%") && seg.style?.fg === MARKET_UP))).toBe(true);
    expect(lines.some((line) => line.segments?.some((seg) => seg.text.includes("-1.50%") && seg.style?.fg === MARKET_DOWN))).toBe(true);
  });

  it("colors quant figure icon blocks for benchmark and bar comparisons", () => {
    const lines = buildConversationLines([
      {
        role: "assistant",
        text: [
          "⌁ Trend",
          "EQ  ▁▂▃▄▅▆▇█  +12.30%  +1.20%",
          "BM  ▁▂▃▄▅▅▆▇  +8.10%   +0.70%",
          "α   ▁▁▂▃▄▆▇█  +4.20%   +0.50%",
          "",
          "▥ Exposure",
          "Tech     ███████░░░  34.0%  +2.0%",
          "Finance  ████░░░░░░  18.0%  -1.1%",
          "DD       ▁▃▅█▅▃▁     -8.20%",
        ].join("\n"),
      },
    ] as UIMessage[], 96);

    expect(lines.some((line) => line.segments?.some((seg) => seg.text.includes("⌁") && seg.style?.fg === GOLD))).toBe(true);
    expect(lines.some((line) => line.segments?.some((seg) => seg.text === "EQ" && seg.style?.fg === GOLD))).toBe(true);
    expect(lines.some((line) => line.segments?.some((seg) => seg.text === "BM" && seg.style?.fg === S.chartMuted.fg))).toBe(true);
    expect(lines.some((line) => line.segments?.some((seg) => seg.text === "α" && seg.style?.fg === GOLD))).toBe(true);
    expect(lines.some((line) => line.segments?.some((seg) => seg.text.includes("▥") && seg.style?.fg === GOLD))).toBe(true);
    expect(lines.some((line) => line.segments?.some((seg) => seg.text.includes("████") && seg.style?.fg === GOLD))).toBe(true);
    expect(lines.some((line) => line.segments?.some((seg) => seg.text.includes("+12.30%") && seg.style?.fg === MARKET_UP))).toBe(true);
    expect(lines.some((line) => line.segments?.some((seg) => seg.text.includes("-8.20%") && seg.style?.fg === MARKET_DOWN))).toBe(true);
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
      source: "financial-datasets",
      showPortfolioPanel: true,
    });

    const statusLine = buf.toPlain()[3];
    expect(statusLine).toContain("openai/gpt-5.5");
    expect(statusLine).toContain("financial-datasets");
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
    expect(rows.some(r => r.includes("Refreshing"))).toBe(true);
  });

  it("shows compacting as a bottom status banner for an empty conversation", () => {
    const buf = new Buffer(100, 24);
    const L = layout(100, 24);

    drawConversation(buf, L.conversation, [], "compacting", L.mainPane);

    const rows = buf.toPlain();
    const statusRow = L.conversation.y + L.conversation.h - 3;
    const tipRow = L.conversation.y + L.conversation.h - 2;
    expect(rows[statusRow]).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Compacting\.\.\. \(0 tokens\)/);
    expect(rows[tipRow]).toContain("Tip:");
    expect(rows.join("\n")).not.toContain("WhyJ is compacting");
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
