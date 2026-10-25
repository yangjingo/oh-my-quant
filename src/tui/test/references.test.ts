import { expect, it } from "bun:test";
import { QuantTui } from "../src/tui.ts";
import { createInitialAppState } from "../../app-runtime.ts";
import { drawComposer } from "../src/chrome.ts";
import { Buffer } from "../src/buffer.ts";
import type { ComposerReferenceSuggestion } from "../../types/composer-reference.ts";

const key = (name: string, char = "") => ({ type: "key" as const, name, char, ctrl: false, shift: false, meta: false });
function fixture() {
  const tui = new QuantTui(createInitialAppState("test"));
  const internals = tui as any;
  internals.running = true;
  // Drive production input/layout without writing terminal frames in a unit test.
  internals.paint = () => internals.refreshReferenceSuggestions();
  const input = (text: string) => { internals.inputBuf = text; internals.refreshReferenceSuggestions(); };
  return { tui, internals, input };
}

it("completes @ references on Tab/Enter, preserves typed digits, and sends only after selection", async () => {
  const { tui, internals, input } = fixture(), sent: string[] = [];
  tui.onSubmit(text => sent.push(text));
  tui.setReferenceProvider(async () => [{ kind: "file", label: "文件 · 2026.md", fill: "分析 @file:2026.md " }]);
  input("分析 @2");
  internals.handleKeyAction(key("return"));
  expect(sent).toEqual([]);
  await Bun.sleep(100);
  internals.handleKeyAction(key("", "0"));
  expect(internals.inputBuf).toBe("分析 @20");
  internals.paint();
  await Bun.sleep(100);
  internals.handleKeyAction(key("tab"));
  expect(internals.inputBuf).toBe("分析 @file:2026.md ");
  internals.paint();
  internals.handleKeyAction(key("return"));
  expect(sent).toEqual(["分析 @file:2026.md"]);
  input("分析 @2"); await Bun.sleep(100);
  internals.handleKeyAction(key("return"));
  expect(sent).toHaveLength(1);
  expect(internals.inputBuf).toBe("分析 @file:2026.md ");
  input(""); internals.running = false;
});

it("rejects late autocomplete results after the query changes, including A → B → A", async () => {
  const { tui, internals, input } = fixture();
  const pending: Array<(items: ComposerReferenceSuggestion[]) => void> = [];
  tui.setReferenceProvider(() => new Promise(resolve => pending.push(resolve)));
  input("@a"); await Bun.sleep(100);
  input("@b"); await Bun.sleep(100);
  input("@a"); await Bun.sleep(100);
  pending[2]!([{ kind: "file", label: "current", fill: "@file:a " }]); await Bun.sleep(0);
  pending[0]!([{ kind: "file", label: "stale", fill: "@file:old " }]);
  pending[1]!([]); await Bun.sleep(0);
  expect(internals.currentSuggestions()[0].label).toBe("current");
  input(""); internals.running = false;
});

it("shows generic prompt hints and expands Composer for reference selection", () => {
  const { internals, input } = fixture();
  input("@"); expect(internals.currentLayout().composer.h).toBe(8);
  input(""); expect(internals.currentLayout().composer.h).toBe(5);
  const buffer = new Buffer(80, 5);
  drawComposer(buffer, { x: 0, y: 0, w: 80, h: 5 }, createInitialAppState("test"), "");
  const text = buffer.toPlain().join("\n");
  expect(text).toContain("Ask anything · @ to reference · / for commands");
  expect(text).toContain("› ▏Ask anything");
  expect(text).not.toContain("commands▏");
  const arrow = buffer.cells.find(cell => cell.ch === "›")!;
  const send = buffer.cells.find(cell => cell.ch === "↵")!;
  expect(arrow).toMatchObject({ fg: "#C99A2E", bold: true });
  expect(send).toMatchObject({ fg: "#C99A2E", bold: true });
  expect(text).not.toMatch(/\/config|\/artifact/);
  internals.running = false;
});
