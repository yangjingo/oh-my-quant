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
  let resumeOpened = 0;
  let portfolioOpened = 0;
  const runtime = new AppRuntime(
    {
      onMessages: (m) => messages.push(m),
      onActivity: (a) => activities.push(a),
      onComposerStatus: (s) => statuses.push(s),
      onComposerQueue: (q) => queues.push(q),
      onConfigRequest: () => { configOpened++; },
      onResumeRequest: () => { resumeOpened++; },
      onPortfolioRequest: () => { portfolioOpened++; },
      onPanel: (panel, loading = false) => panels.push({ panel, loading }),
    },
    quoteFetcher,
    symbolProvider,
    holdingFetcher,
  );
  return { runtime, messages, activities, statuses, panels, queues, get configOpened() { return configOpened; }, get resumeOpened() { return resumeOpened; }, get portfolioOpened() { return portfolioOpened; } };
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
    expect(h.messages.at(-1)?.at(-1)).toEqual(expect.objectContaining({
      role: "assistant",
      text: expect.stringContaining("Commands"),
    }));
    expect(h.statuses.at(-1)).toBeNull();
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

  it("syncs resumed session messages into conversation", async () => {
    const h = harness();
    const agent = {
      state: {
        isStreaming: false,
        messages: [] as Array<{ role: string; content: string }>,
      },
      resumeSession: async (sessionId: string) => {
        agent.state.messages = [
          { role: "user", content: "resume me" },
          { role: "assistant", content: `session ${sessionId} restored` },
        ];
        return { id: sessionId, createdAt: "2026-06-09T00:00:00.000Z", cwd: "C:/tmp", path: `C:/tmp/${sessionId}.jsonl` };
      },
    };
    (h.runtime as unknown as { agent: object }).agent = agent;
    await h.runtime.submit("/resume s0");
    expect(h.messages.at(-1)).toEqual([
      { role: "user", text: "resume me" },
      { role: "assistant", text: "session s0 restored" },
      expect.objectContaining({
        role: "assistant",
        text: expect.stringContaining("Resumed\n"),
      }),
    ]);
    expect(h.messages.at(-1)?.[1]).toEqual(expect.objectContaining({
      role: "assistant",
      text: "session s0 restored",
    }));
    expect(h.statuses.at(-1)).toBeNull();
  });

  it("opens resume panel for bare resume command before agent initialization", async () => {
    const h = harness();
    expect(await h.runtime.submit("/resume")).toBe("continue");
    expect(h.resumeOpened).toBe(1);
    expect(h.activities.at(-1)).toBe("ready");
  });

  it("opens portfolio panel for bare portfolio command before agent initialization", async () => {
    const h = harness();
    expect(await h.runtime.submit("/portfolio")).toBe("continue");
    expect(h.portfolioOpened).toBe(1);
    expect(h.activities.at(-1)).toBe("ready");
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
});

