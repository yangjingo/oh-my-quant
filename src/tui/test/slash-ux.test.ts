/**
 * UX simulation tests for slash command interaction.
 * Directly exercises handleKeyAction to verify auto-complete / submit behavior.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { QuantTui } from "../src/tui.ts";
import { savePanelPortfolio } from "../../storage/panel-portfolio.ts";
import type { AppState } from "../src/types.ts";

const OHQ = join(process.cwd(), ".ohquant-test-slash-ux");

function keyAction(name: string, char = "", mods: { shift?: boolean; ctrl?: boolean; meta?: boolean } = {}): { type: "key"; name: string; shift: boolean; ctrl: boolean; meta: boolean; char?: string } {
  return { type: "key", name, shift: mods.shift ?? false, ctrl: mods.ctrl ?? false, meta: mods.meta ?? false, char };
}

function baseState(): AppState {
  return {
    model: "deepseek/deepseek-chat",
    modelLabel: "deepseek",
    version: "test",
    user: "test",
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
}

describe("slash command UX simulation", () => {
  let tui: QuantTui;
  let submitted: string | null = null;

  beforeEach(() => {
    process.env.OHQUANT_DIR = OHQ;
    if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
    mkdirSync(OHQ, { recursive: true });
    savePanelPortfolio({ updated: "", symbols: [], groups: [] });
    const st = baseState();
    tui = new QuantTui(st);
    (tui as any).running = true;
    submitted = null;
    tui.onSubmit((text: string) => { submitted = text; });
  });

  afterEach(() => {
    delete process.env.OHQUANT_DIR;
    if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
    if ((tui as any).running) tui.stop();
  });

  function type(chars: string) {
    for (const ch of chars) {
      (tui as any).handleKeyAction(keyAction("", ch));
    }
  }

  function pressEnter() {
    (tui as any).handleKeyAction(keyAction("return"));
  }

  function pressTab() {
    (tui as any).handleKeyAction(keyAction("tab"));
  }

  function getInput(): string {
    return (tui as any).inputBuf as string;
  }

  function getSuggestions(): { label: string; fill: string }[] {
    return (tui as any).currentSuggestions();
  }

  it("auto-completes / to first suggestion on Enter", () => {
    type("/");
    expect(getInput()).toBe("/");
    const before = getSuggestions();
    expect(before.length).toBeGreaterThan(0);

    pressEnter();
    // Should auto-complete, not submit
    expect(submitted).toBeNull();
    expect(getInput()).not.toBe("/");
    expect(getInput()).toContain("/");
  });

  it("auto-completes /r to first matching command on Enter", () => {
    type("/r");
    expect(getInput()).toBe("/r");

    pressEnter();
    expect(submitted).toBeNull();
    // First match in catalog order is /resume.
    const result = getInput();
    expect(result.startsWith("/r")).toBe(true);
    expect(result.length).toBeGreaterThan(2);
  });

  it("submits full command on Enter when exact slash matches", () => {
    type("/resume");
    pressEnter();
    expect(submitted).toBe("/resume");
  });

  it("supports PI-style settings alias", () => {
    type("/settings");
    pressEnter();
    expect(submitted).toBe("/settings");
  });

  it("supports PI-style session commands", () => {
    type("/session");
    pressEnter();
    expect(submitted).toBe("/session");
  });

  it("submits directly when no suggestions exist", () => {
    type("hello world");
    pressEnter();
    expect(submitted).toBe("hello world");
  });

  it("Tab auto-completes without submitting", () => {
    type("/r");
    pressTab();
    expect(submitted).toBeNull();
    expect(getInput().startsWith("/r")).toBe(true);
    expect(getInput().length).toBeGreaterThan(2);
  });

  it("auto-completes bare / then submits on second Enter", () => {
    type("/");
    pressEnter();
    expect(submitted).toBeNull();
    // Second Enter: now input matches fill → submits
    pressEnter();
    expect(submitted).not.toBeNull();
    expect(submitted!.startsWith("/")).toBe(true);
  });

  it("filters suggestions as user types more characters", () => {
    type("/");
    const allSuggestions = getSuggestions();
    expect(allSuggestions.length).toBeGreaterThan(5);

    type("res");
    const filtered = getSuggestions();
    expect(filtered.length).toBeLessThan(allSuggestions.length);
    expect(filtered.every(s => s.label.toLowerCase().includes("resume") || s.fill.includes("resume"))).toBe(true);
  });

  it("up/down arrow navigates suggestion index", () => {
    type("/");
    const idx = (tui as any).suggestionIdx as number;
    expect(idx).toBe(0);

    // Press down
    (tui as any).handleKeyAction(keyAction("down"));
    expect((tui as any).suggestionIdx).toBe(1);

    // Press up
    (tui as any).handleKeyAction(keyAction("up"));
    expect((tui as any).suggestionIdx).toBe(0);

    // Wrap around with up
    (tui as any).handleKeyAction(keyAction("up"));
    const max = getSuggestions().length - 1;
    expect((tui as any).suggestionIdx).toBe(max);
  });

  it("clears input and suggestions after submit", () => {
    type("/resume");
    pressEnter();
    expect(submitted).toBe("/resume");
    expect(getInput()).toBe("");
    expect(getSuggestions()).toEqual([]);
  });

  it("escape clears input and resets suggestion index", () => {
    type("/s");
    expect(getInput()).toBe("/s");
    (tui as any).handleKeyAction(keyAction("escape"));
    expect(getInput()).toBe("");
    expect((tui as any).suggestionIdx).toBe(0);
  });

  it("backspace removes last character and resets suggestionIdx", () => {
    type("/set");
    expect(getInput()).toBe("/set");
    (tui as any).handleKeyAction(keyAction("backspace"));
    expect(getInput()).toBe("/se");
    expect((tui as any).suggestionIdx).toBe(0);
  });

  it("backspace on empty input does nothing", () => {
    (tui as any).handleKeyAction(keyAction("backspace"));
    expect(getInput()).toBe("");
  });

  it("history up/down navigates when no suggestions", () => {
    // Submit to populate history
    type("first message");
    pressEnter();
    expect(submitted).toBe("first message");
    // After submit, input is cleared
    expect(getInput()).toBe("");

    // Up should recall from history
    (tui as any).handleKeyAction(keyAction("up"));
    expect(getInput()).toBe("first message");
  });

  it("up/down with suggestions navigates suggestions, not history", () => {
    type("/");
    const suggestionCount = getSuggestions().length;

    (tui as any).handleKeyAction(keyAction("down"));
    expect((tui as any).suggestionIdx).toBe(1);

    (tui as any).handleKeyAction(keyAction("up"));
    expect((tui as any).suggestionIdx).toBe(0);

    // Wrap down
    for (let i = 0; i < suggestionCount; i++) {
      (tui as any).handleKeyAction(keyAction("down"));
    }
    expect((tui as any).suggestionIdx).toBe(0);
  });

  it("number keys 1-9 quick-select suggestion", () => {
    type("/");
    const first = getSuggestions()[0];
    // Number 1 fills the first suggestion's fill text
    (tui as any).handleKeyAction({ type: "key", name: "", shift: false, ctrl: false, meta: false, char: "1" });
    expect(getInput()).toBe(first.fill);
  });

  it("ctrl+p opens config panel", () => {
    (tui as any).handleKeyAction(keyAction("p", "", { ctrl: true }));
    expect((tui as any).panel.isOpen()).toBe(true);
  });

  it("panel intercepts keys when open", () => {
    (tui as any).panel.open();
    const inputBefore = getInput();
    type("x");
    // Input should not change while panel is open
    expect(getInput()).toBe(inputBefore);
  });

  it("panel close via escape returns focus to composer", () => {
    (tui as any).panel.open();
    (tui as any).panel.close();
    type("/");
    expect(getInput()).toBe("/");
  });
});
