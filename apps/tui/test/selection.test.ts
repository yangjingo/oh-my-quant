import { describe, expect, it } from "bun:test";
import {
  conversationPointFromScreen,
  conversationPointFromScreenClamped,
  extractConversationSelection,
  isConversationCellSelected,
  type ConversationView,
} from "../src/selection.ts";

const view: ConversationView = {
  inner: { x: 2, y: 4, w: 20, h: 3 },
  clipEnd: 80,
  startLineIdx: 0,
  lines: [{ text: "hello world" }, { text: "line two" }, { text: "third" }],
};

describe("conversationPointFromScreen", () => {
  it("maps screen coords to line/col", () => {
    expect(conversationPointFromScreen(2, 4, view)).toEqual({ lineIdx: 0, col: 0 });
    expect(conversationPointFromScreen(7, 5, view)).toEqual({ lineIdx: 1, col: 5 });
  });

  it("returns null outside inner panel", () => {
    expect(conversationPointFromScreen(1, 4, view)).toBeNull();
    expect(conversationPointFromScreen(2, 7, view)).toBeNull();
  });

  it("respects bottom-anchored top padding", () => {
    const bottomAnchored: ConversationView = {
      inner: { x: 2, y: 4, w: 20, h: 6 },
      clipEnd: 80,
      startLineIdx: 0,
      topPadding: 3,
      visibleH: 6,
      lines: [{ text: "latest" }, { text: "" }],
    };

    expect(conversationPointFromScreen(2, 4, bottomAnchored)).toBeNull();
    expect(conversationPointFromScreen(2, 7, bottomAnchored)).toEqual({ lineIdx: 0, col: 0 });
  });

  it("clamps drag coords to panel edges", () => {
    expect(conversationPointFromScreenClamped(0, 4, view)).toEqual({ lineIdx: 0, col: 0 });
    expect(conversationPointFromScreenClamped(30, 5, view)).toEqual({ lineIdx: 1, col: 8 });
  });
});

describe("extractConversationSelection", () => {
  it("extracts single-line slice", () => {
    const text = extractConversationSelection(view, {
      anchor: { lineIdx: 0, col: 0 },
      cursor: { lineIdx: 0, col: 5 },
    });
    expect(text).toBe("hello");
  });

  it("extracts multi-line range", () => {
    const text = extractConversationSelection(view, {
      anchor: { lineIdx: 0, col: 6 },
      cursor: { lineIdx: 2, col: 3 },
    });
    expect(text).toBe("world\nline two\nthi");
  });
});

describe("isConversationCellSelected", () => {
  it("highlights normalized range", () => {
    const sel = { anchor: { lineIdx: 1, col: 2 }, cursor: { lineIdx: 0, col: 4 } };
    expect(isConversationCellSelected(0, 4, sel)).toBe(true);
    expect(isConversationCellSelected(1, 1, sel)).toBe(true);
    expect(isConversationCellSelected(0, 3, sel)).toBe(false);
  });
});
