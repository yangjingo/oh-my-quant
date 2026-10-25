import { expect, it } from "bun:test";
import { buildConversationLines } from "../src/render-lines.ts";
import { buildConversationView, layout } from "../src/render.ts";
import { extractConversationSelection } from "../src/selection.ts";
import type { UIMessage } from "../../../src/types/ui.ts";

it("shows streamed text changes on the same message object", () => {
  const message: UIMessage = { role: "assistant", text: "before" };
  expect(buildConversationLines([message], 80).map(line => line.text)).toEqual(["▏ before", ""]);
  message.text = "after";
  expect(buildConversationLines([message], 80).map(line => line.text)).toEqual(["▏ after", ""]);
});

it("shows changed tool labels, results and failure state", () => {
  const message: UIMessage = { role: "tool", tool: { name: "compute_factor", label: "First", status: "running", startedAt: 0 } };
  expect(buildConversationLines([message], 80).map(line => line.text)).toContain("● First");
  message.tool!.label = "Updated";
  message.tool!.status = "error";
  message.tool!.result = "Provider unavailable";
  const lines = buildConversationLines([message], 80).map(line => line.text);
  expect(lines).toContain("✗ Updated");
  expect(lines.join("\n")).toContain("Provider unavailable");
});

it("removes the running skill suffix when the same skill finishes", () => {
  const message: UIMessage = { role: "skill", skill: { name: "stock-evaluator", label: "Research", status: "running", startedAt: 0 } };
  expect(buildConversationLines([message], 80).map(line => line.text)).toContain("● Research ...");
  message.skill!.status = "done";
  expect(buildConversationLines([message], 80).map(line => line.text)).toContain("● Research");
});

it("reflows the complete conversation when the viewport width changes", () => {
  const messages: UIMessage[] = [{ role: "assistant", text: "abcdefghijklmnopqrstuvwxyz" }];
  expect(buildConversationLines(messages, 12).map(line => line.text)).toEqual(["▏ abcdefghij", "▏ klmnopqrst", "▏ uvwxyz", ""]);
  expect(buildConversationLines(messages, 80).map(line => line.text)).toEqual(["▏ abcdefghijklmnopqrstuvwxyz", ""]);
});

it("retains old messages for selection copy and respects history replacement", () => {
  const messages: UIMessage[] = [{ role: "assistant", text: "old result" }, { role: "assistant", text: "new result" }];
  const L = layout(80, 24, false);
  const view = buildConversationView(messages, L.conversation, 0, L.mainPane);
  const copied = extractConversationSelection(view, { anchor: { lineIdx: 0, col: 0 }, cursor: { lineIdx: view.lines.length - 1, col: 999 } });
  expect(copied).toContain("old result");
  expect(copied).toContain("new result");
  expect(buildConversationLines(messages.slice(1), 80).map(line => line.text)).toEqual(["▏ new result", ""]);
  expect(buildConversationLines([], 80)).toEqual([]);
});

it("does not retain caller edits to returned render lines", () => {
  const message: UIMessage = { role: "assistant", text: "original" };
  const first = buildConversationLines([message], 80);
  first[0]!.text = "caller edit";
  first[0]!.segments![1]!.text = "caller edit";
  expect(buildConversationLines([message], 80).map(line => line.text)).toEqual(["▏ original", ""]);
});
