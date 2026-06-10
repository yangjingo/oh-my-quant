import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { savePanelPortfolio } from "./storage/panel-portfolio.ts";
import { AppRuntime } from "./app-runtime.ts";
import type { AppState, PanelSection, UIMessage } from "./tui/src/types.ts";

const OHQ = join(process.cwd(), ".ohquant-test-app-runtime");

beforeEach(() => {
  process.env.OHQUANT_DIR = OHQ;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
  mkdirSync(OHQ, { recursive: true });
  savePanelPortfolio({
    updated: "",
    symbols: [{ code: "510300.SH", name: "沪深300ETF", added: "2026-06-10" }],
    groups: [],
  });
});

afterEach(() => {
  delete process.env.OHQUANT_DIR;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
});

function harness(
  quoteFetcher: ConstructorParameters<typeof AppRuntime>[1] = async () => [],
  symbolProvider: ConstructorParameters<typeof AppRuntime>[2] = async () => [],
  holdingFetcher: ConstructorParameters<typeof AppRuntime>[3] = async () => [],
) {
  const messages: UIMessage[][] = [];
  const activities: AppState["activity"][] = [];
  const statuses: AppState["composerStatus"][] = [];
  const panels: Array<{ panel: PanelSection[]; loading: boolean }> = [];
  const queues: string[][] = [];
  let configOpened = 0;
  const runtime = new AppRuntime(
    {
      onMessages: (m) => messages.push(m),
      onActivity: (a) => activities.push(a),
      onComposerStatus: (s) => statuses.push(s),
      onComposerQueue: (q) => queues.push(q),
      onConfigRequest: () => { configOpened++; },
      onPanel: (panel, loading = false) => panels.push({ panel, loading }),
    },
    quoteFetcher,
    symbolProvider,
    holdingFetcher,
  );
  return { runtime, messages, activities, statuses, panels, queues, get configOpened() { return configOpened; } };
}

describe("AppRuntime.submit", () => {
  it("returns exit for exit commands", async () => {
    const h = harness();
    expect(await h.runtime.submit("/exit")).toBe("exit");
    expect(await h.runtime.submit("/quit")).toBe("exit");
  });

  it("handles help and config locally without agent initialization", async () => {
    const h = harness();
    expect(await h.runtime.submit("/help")).toBe("continue");
    expect(h.statuses.at(-1)?.text).toContain("Commands:");
    expect(h.activities.at(-1)).toBe("ready");

    expect(await h.runtime.submit("/config")).toBe("continue");
    expect(h.configOpened).toBe(1);
    expect(h.activities.at(-1)).toBe("ready");
  });

  it("clears messages locally", async () => {
    const h = harness();
    await h.runtime.submit("hello");
    expect(h.queues.at(-1)).toEqual(["hello"]);
    expect(h.messages.at(-1)).toBeUndefined();

    await h.runtime.submit("/clear");
    expect(h.messages.at(-1)).toEqual([]);
    expect(h.queues.at(-1)).toEqual([]);
    expect(h.statuses.at(-1)).toBeNull();
    expect(h.activities.at(-1)).toBe("ready");
  });

  it("reports initializing error for natural language before init", async () => {
    const h = harness();
    await h.runtime.submit("analyze AAPL");
    expect(h.messages[0]).toBeUndefined();
    expect(h.queues.at(-1)).toEqual(["analyze AAPL"]);
    expect(h.statuses.at(-1)).toEqual({ kind: "error", text: "Initializing... please wait a moment." });
    expect(h.activities).toContain("thinking");
    expect(h.activities.at(-1)).toBe("ready");
  });

  it("executes unknown slash command through deterministic command path", async () => {
    const h = harness();
    await h.runtime.submit("/does-not-exist");
    expect(h.statuses.at(-1)).toEqual({ kind: "error", text: "Unknown /does-not-exist. Try /help" });
    expect(h.activities.at(-1)).toBe("ready");
    expect(h.panels[0]).toMatchObject({ loading: true });
    const latestPanel = h.panels.at(-1)?.panel ?? [];
    expect(latestPanel[0]).toMatchObject({ kind: "group", title: "Default" });
    expect(latestPanel.some((section) => section.title === "Market")).toBe(true);
  });

  it("keeps one thinking block and streams assistant separately", () => {
    const h = harness();
    const runtime = h.runtime as unknown as {
      messages: UIMessage[];
      upsertThinkingMessage: (text: string) => void;
    };
    runtime.messages = [
      { role: "user", text: "hi" },
      { role: "thinking", text: "", thinkingLive: true },
      { role: "assistant", text: "" },
    ];
    runtime.upsertThinkingMessage("Let me greet the user.");
    runtime.upsertThinkingMessage("Let me greet the user in Chinese.");
    expect(runtime.messages.filter((m) => m.role === "thinking")).toHaveLength(1);
    expect(runtime.messages[1]?.text).toBe("Let me greet the user in Chinese.");
    expect(runtime.messages[2]?.role).toBe("assistant");
  });

  it("refreshes overview panel after successful command result", async () => {
    const marketSeen: string[][] = [];
    const portfolioSeen: string[][] = [];
    const h = harness(
      async (entries, _meta) => {
        marketSeen.push(entries.map((entry) => entry.code));
        return [{ code: "000001", name: "上证指数", price: 3000, pct: 1 }];
      },
      async () => [{ code: "510300.SH", name: "沪深300ETF" }],
      async (entries, _meta) => {
        portfolioSeen.push(entries.map((entry) => entry.code));
        return [{ code: "510300", name: "沪深300ETF", price: 4.2, pct: -0.5 }];
      },
    );
    await h.runtime.submit("/factor list");
    expect(marketSeen[0]).toContain("000300.SH");
    expect(portfolioSeen[0]).toEqual(["510300.SH"]);
    expect(h.panels[0]).toMatchObject({ loading: true });
    expect(h.panels.at(-1)?.loading).toBe(false);
    const latestPanel = h.panels.at(-1)?.panel ?? [];
    expect(latestPanel[0]).toMatchObject({ kind: "group", title: "Default" });
    expect(latestPanel.some((section) => section.title === "Market")).toBe(true);
    expect(latestPanel.some((section) => section.title === "Source")).toBe(true);
  });

  it("refreshes overview panel for /market without thinking activity", async () => {
    const marketSeen: string[][] = [];
    const h = harness(async (entries) => {
      marketSeen.push(entries.map((entry) => entry.code));
      return [{ code: "000001", name: "上证指数", price: 3000, pct: 1 }];
    });
    await h.runtime.submit("/market");
    expect(marketSeen.length).toBeGreaterThan(0);
    expect(h.activities).not.toContain("thinking");
    expect(h.statuses.at(-1)).toEqual({ kind: "info", text: "Overview refreshed." });
    expect(h.panels.at(-1)?.loading).toBe(false);
    const latestPanel = h.panels.at(-1)?.panel ?? [];
    expect(latestPanel[0]).toMatchObject({ kind: "group", title: "Default" });
    expect(latestPanel.some((section) => section.title === "Market")).toBe(true);
  });

  it("refreshes overview panel after /clear", async () => {
    const marketSeen: string[][] = [];
    const h = harness(async (entries) => {
      marketSeen.push(entries.map((entry) => entry.code));
      return [];
    });
    await h.runtime.submit("hello");
    const panelsBefore = h.panels.length;
    await h.runtime.submit("/clear");
    expect(h.messages.at(-1)).toEqual([]);
    expect(h.panels.length).toBeGreaterThan(panelsBefore);
    expect(marketSeen.length).toBeGreaterThan(0);
  });

  it("pushes conversation insight into the overview panel when dialogue matches risk keywords", () => {
    const h = harness();
    const runtime = h.runtime as unknown as {
      overviewReady: boolean;
      marketSections: PanelSection[];
      messages: UIMessage[];
      emitMessages: () => void;
    };
    runtime.overviewReady = true;
    runtime.marketSections = [{ kind: "keyvalue", title: "Market", rows: [{ label: "data", value: "ok" }] }];
    runtime.messages = [
      { role: "user", text: "I need to manage drawdown and position sizing." },
      { role: "assistant", text: "Keep the size small and respect risk limits." },
    ];
    runtime.emitMessages();

    const latestPanel = h.panels.at(-1)?.panel ?? [];
    expect(latestPanel.some((section) => section.title === "Insight")).toBe(true);
  });

  it("skips the insight panel when the setting is disabled", () => {
    const h = harness();
    const runtime = h.runtime as unknown as {
      overviewReady: boolean;
      marketSections: PanelSection[];
      messages: UIMessage[];
      insightEnabled: boolean;
      emitMessages: () => void;
    };
    runtime.overviewReady = true;
    runtime.marketSections = [{ kind: "keyvalue", title: "Market", rows: [{ label: "data", value: "ok" }] }];
    runtime.insightEnabled = false;
    runtime.messages = [
      { role: "user", text: "I need to manage drawdown and position sizing." },
      { role: "assistant", text: "Keep the size small and respect risk limits." },
    ];
    runtime.emitMessages();

    const latestPanel = h.panels.at(-1)?.panel ?? [];
    expect(latestPanel.some((section) => section.title === "Insight")).toBe(false);
  });
});
