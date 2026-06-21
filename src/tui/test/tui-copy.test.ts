import { describe, expect, it } from "bun:test";
import { resolveCopyText } from "../src/tui-copy.ts";
import type { ConversationView } from "../src/selection.ts";
import type { UIMessage } from "../src/types.ts";

const view: ConversationView = {
  inner: { x: 0, y: 0, w: 20, h: 3 },
  clipEnd: 20,
  startLineIdx: 0,
  lines: [{ text: "alpha beta" }, { text: "gamma" }, { text: "delta" }],
};

describe("tui copy helpers", () => {
  it("returns selected text when a selection exists", () => {
    const text = resolveCopyText("conversation", view, {
      anchor: { lineIdx: 0, col: 6 },
      cursor: { lineIdx: 1, col: 5 },
    }, []);

    expect(text).toBe("beta\ngamma");
  });

  it("falls back to the last assistant message for conversation copy", () => {
    const messages: UIMessage[] = [
      { role: "user", text: "question" },
      { role: "assistant", text: "first answer" },
      { role: "assistant", text: "latest answer" },
    ];

    expect(resolveCopyText("conversation", view, null, messages)).toBe("latest answer");
  });

  it("does not invent fallback text for the overview panel", () => {
    const messages: UIMessage[] = [{ role: "assistant", text: "latest answer" }];
    expect(resolveCopyText("overview", view, null, messages)).toBe("");
  });
});
