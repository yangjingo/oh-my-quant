import { describe, expect, it } from "bun:test";
import { Buffer, sanitizeTerminalText, wrap } from "../src/buffer.ts";
import { conversationMaxScrollUp, drawConversation, drawPortfolio, layout, overviewMaxScrollTop } from "../src/render.ts";
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
      expect(panelText).toBe(" ".repeat(L.portfolio.w));
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
});
