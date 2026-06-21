import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JsonlSessionRepo } from "./agent/src/pi/index.ts";
import { NodeExecutionEnv } from "./agent/src/pi/node.ts";
import { loadPanelPortfolio } from "./storage/panel-portfolio.ts";
import { savePanelPortfolio } from "./storage/panel-portfolio.ts";
import { AppRuntime, createRuntimeAgent } from "./app-runtime.ts";
import { SKILLS_DIR } from "./skill/index.ts";
import { shellDisplayName } from "./tools/catalog.ts";
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
  agentFactory: ConstructorParameters<typeof AppRuntime>[4] | undefined = undefined,
) {
  const messages: UIMessage[][] = [];
  const activities: AppState["activity"][] = [];
  const statuses: AppState["composerStatus"][] = [];
  const panels: Array<{ panel: PanelSection[]; loading: boolean }> = [];
  const queues: string[][] = [];
  const localStates: Array<Pick<AppState, "activePortfolio" | "source" | "showPortfolioPanel">> = [];
  let configOpened = 0;
  let resumeOpened = 0;
  let portfolioOpened = 0;
  const runtime = new AppRuntime(
    {
      onMessages: (m) => messages.push(m),
      onActivity: (a) => activities.push(a),
      onLocalState: (s) => localStates.push(s),
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
    agentFactory,
  );
  return { runtime, messages, activities, statuses, panels, queues, localStates, get configOpened() { return configOpened; }, get resumeOpened() { return resumeOpened; }, get portfolioOpened() { return portfolioOpened; } };
}

type RuntimeAgentEvent = { type: string; [key: string]: unknown };

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

function makeFakeAgent(promptImpl: (agent: any, input: string) => Promise<void>) {
  const listeners: Array<(event: RuntimeAgentEvent) => void | Promise<void>> = [];
  const agent = {
    state: {
      isStreaming: false,
      pendingToolCalls: new Set<string>(),
      messages: [] as unknown[],
      thinkingText: "",
    },
    subscribe(listener: (event: RuntimeAgentEvent) => void | Promise<void>) {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
    async emit(event: RuntimeAgentEvent) {
      for (const listener of listeners) await listener(event);
    },
    async prompt(input: string) {
      await promptImpl(agent, input);
    },
    steer() {},
    followUp() {},
    abort() {},
    clearAllQueues() {},
    reset() {},
    waitForIdle: async () => {},
  };
  return agent;
}

describe("AppRuntime.submit", () => {
  it("builds the default runtime agent with installed project skill paths", async () => {
    const skillsDir = join(SKILLS_DIR, "__runtime-test-repo__", "llmquant-crypto");
    mkdirSync(skillsDir, { recursive: true });
    try {
      writeFileSync(join(skillsDir, "SKILL.md"), `---
name: llmquant-crypto
description: Use for crypto market analysis.
---

# LLMQuant Crypto
`, "utf-8");

      const agent = createRuntimeAgent();
      await agent.waitForIdle();

      const skills = await agent.getSkills();
      expect(skills.some((skill) => skill.name === "llmquant-crypto")).toBe(true);
    } finally {
      rmSync(join(SKILLS_DIR, "__runtime-test-repo__"), { recursive: true, force: true });
    }
  });

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

  it("drives composer queue from agent queue_update events", async () => {
    const fakeAgent = makeFakeAgent(async (agent) => {
      agent.state.isStreaming = true;
    });
    fakeAgent.followUp = async () => {
      await fakeAgent.emit({
        type: "queue_update",
        steer: [],
        followUp: [{ role: "user", content: [{ type: "text", text: "queued from harness" }], timestamp: Date.now() }],
        nextTurn: [],
      });
    };
    const h = harness(async () => [], async () => [], async () => [], () => fakeAgent as never);

    await h.runtime.bootstrap();
    (fakeAgent.state as { isStreaming: boolean }).isStreaming = true;
    await h.runtime.submit("raw text");

    expect(h.queues.at(-1)).toEqual(["queued from harness"]);
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

  it("keeps non-empty thinking content when the turn finalizes", () => {
    const h = harness();
    const runtime = h.runtime as unknown as {
      messages: UIMessage[];
      finalizeThinking: () => void;
    };
    runtime.messages = [
      { role: "user", text: "hi" },
      { role: "thinking", text: "temporary reasoning", thinkingLive: true, startedAt: Date.now() - 1000 },
      { role: "assistant", text: "hello" },
    ];

    runtime.finalizeThinking();

    expect(runtime.messages.map((m) => m.role)).toEqual(["user", "thinking", "assistant"]);
    expect(runtime.messages[1]).toMatchObject({
      role: "thinking",
      text: "temporary reasoning",
      thinkingLive: false,
    });
  });

  it("bridges agent prompt, bash tool call, and assistant output into conversation messages", async () => {
    let promptInput = "";
    const fakeAgent = makeFakeAgent(async (agent, input) => {
      promptInput = input;
      agent.state.isStreaming = true;
      await agent.emit({
        type: "message_start",
        message: { role: "displayUser", content: [{ type: "text", text: "ignored by runtime" }], displayText: "read the runtime bridge" },
      });
      await agent.emit({ type: "message_start", message: { role: "assistant", content: [] } });
      agent.state.thinkingText = "Need to inspect the file.";
      await agent.emit({
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text: "" }] },
      });
      await agent.emit({
        type: "tool_execution_start",
        toolCallId: "bash-1",
        toolName: "bash",
        args: { command: "Get-Content src/app-runtime.ts" },
      });
      await agent.emit({
        type: "tool_execution_update",
        toolCallId: "bash-1",
        toolName: "bash",
        args: { command: "Get-Content src/app-runtime.ts" },
        partialResult: textResult("reading app-runtime"),
      });
      await agent.emit({
        type: "tool_execution_end",
        toolCallId: "bash-1",
        toolName: "bash",
        result: textResult("read app-runtime successfully"),
        isError: false,
      });
      await agent.emit({
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text: "I read the runtime bridge." }] },
      });
      await agent.emit({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "I read the runtime bridge." }] },
      });
      agent.state.isStreaming = false;
      await agent.emit({ type: "agent_end", messages: [] });
    });
    const h = harness(async () => [], async () => [], async () => [], () => fakeAgent as never);

    await h.runtime.bootstrap();
    await h.runtime.submit("read the runtime bridge");

    expect(promptInput).toContain("read the runtime bridge");
    const latest = h.messages.at(-1) ?? [];
    expect(latest).toEqual([
      { role: "user", text: "read the runtime bridge" },
      expect.objectContaining({
        role: "thinking",
        text: "Need to inspect the file.",
        thinkingLive: false,
      }),
      { role: "assistant", text: "I read the runtime bridge." },
      expect.objectContaining({
        role: "tool",
        tool: expect.objectContaining({
          name: "bash",
          label: `${shellDisplayName()}.Read · Get-Content src/app-runtime.ts`,
          args: "Get-Content src/app-runtime.ts",
          status: "done",
          result: "read app-runtime successfully",
        }),
      }),
    ]);
    expect(h.activities).toContain("thinking");
    expect(h.activities).toContain("running tool");
    expect(h.activities.at(-1)).toBe("ready");
  });

  it("bridges agent quant tool errors into polite conversation output", async () => {
    const fakeAgent = makeFakeAgent(async (agent) => {
      agent.state.isStreaming = true;
      await agent.emit({
        type: "message_start",
        message: { role: "displayUser", content: [{ type: "text", text: "" }], displayText: "check 000300 risk" },
      });
      await agent.emit({ type: "message_start", message: { role: "assistant", content: [] } });
      await agent.emit({
        type: "tool_execution_start",
        toolCallId: "risk-1",
        toolName: "check_risk",
        args: { symbol: "000300.SH" },
      });
      await agent.emit({
        type: "tool_execution_end",
        toolCallId: "risk-1",
        toolName: "check_risk",
        result: textResult("No cached data for this symbol"),
        isError: true,
      });
      await agent.emit({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "I could not compute risk from cache." }] },
      });
      agent.state.isStreaming = false;
      await agent.emit({ type: "agent_end", messages: [] });
    });
    const h = harness(async () => [], async () => [], async () => [], () => fakeAgent as never);

    await h.runtime.bootstrap();
    await h.runtime.submit("check 000300 risk");

    const latest = h.messages.at(-1) ?? [];
    expect(latest).toEqual([
      { role: "user", text: "check 000300 risk" },
      { role: "assistant", text: "I could not compute risk from cache." },
      expect.objectContaining({
        role: "tool",
        tool: expect.objectContaining({
          name: "check_risk",
          label: "Quant.Risk · 000300.SH",
          args: "000300.SH",
          status: "error",
          result: "No cached data for this symbol",
        }),
      }),
    ]);
    expect(h.activities).toContain("running tool");
    expect(h.activities.at(-1)).toBe("ready");
  });

  it("updates completed write tool labels to an edit summary", async () => {
    const fakeAgent = makeFakeAgent(async (agent) => {
      agent.state.isStreaming = true;
      await agent.emit({
        type: "message_start",
        message: { role: "displayUser", content: [{ type: "text", text: "" }], displayText: "update the catalog" },
      });
      await agent.emit({ type: "message_start", message: { role: "assistant", content: [] } });
      await agent.emit({
        type: "tool_execution_start",
        toolCallId: "bash-write-1",
        toolName: "bash",
        args: { command: "Set-Content src/tools/catalog.ts value" },
      });
      await agent.emit({
        type: "tool_execution_end",
        toolCallId: "bash-write-1",
        toolName: "bash",
        result: textResult("@@ -1,2 +1,2 @@\n-old value\n+new value"),
        isError: false,
      });
      await agent.emit({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Updated catalog." }] },
      });
      agent.state.isStreaming = false;
      await agent.emit({ type: "agent_end", messages: [] });
    });
    const h = harness(async () => [], async () => [], async () => [], () => fakeAgent as never);

    await h.runtime.bootstrap();
    await h.runtime.submit("update the catalog");

    const latest = h.messages.at(-1) ?? [];
    const tool = latest.find((message) => message.role === "tool");
    expect(tool).toEqual(expect.objectContaining({
      role: "tool",
      tool: expect.objectContaining({
        label: "Edited src/tools/catalog.ts (+1 -1)",
        args: "Set-Content src/tools/catalog.ts value",
        status: "done",
      }),
    }));
  });

  it("adds a specific hint below agent API endpoint errors", async () => {
    const fakeAgent = makeFakeAgent(async () => {
      throw new Error("fetch failed: connect ECONNREFUSED 127.0.0.1:11434");
    });
    const h = harness(async () => [], async () => [], async () => [], () => fakeAgent as never);

    await h.runtime.bootstrap();
    await h.runtime.submit("hello");

    const latest = h.messages.at(-1) ?? [];
    expect(latest.at(-1)).toEqual({
      role: "error",
      text: expect.stringContaining("Hint: Agent API endpoint is unreachable."),
    });
  });

  it("clears active animation as soon as assistant output ends", async () => {
    const fakeAgent = makeFakeAgent(async (agent) => {
      agent.state.isStreaming = true;
      await agent.emit({
        type: "message_start",
        message: { role: "displayUser", content: [{ type: "text", text: "" }], displayText: "finish without agent_end" },
      });
      await agent.emit({ type: "message_start", message: { role: "assistant", content: [] } });
      agent.state.thinkingText = "Need to answer directly.";
      await agent.emit({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
      });
    });
    const h = harness(async () => [], async () => [], async () => [], () => fakeAgent as never);

    await h.runtime.bootstrap();
    await h.runtime.submit("finish without agent_end");

    expect(h.messages.at(-1)).toEqual([
      { role: "user", text: "finish without agent_end" },
      expect.objectContaining({ role: "thinking", text: "Need to answer directly.", thinkingLive: false }),
      { role: "assistant", text: "Done." },
    ]);
    expect(h.activities).toContain("thinking");
    expect(h.activities.at(-1)).toBe("ready");
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
    await h.runtime.submit("/help");
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

  it("resumes a real stored JSONL session through the default runtime agent", async () => {
    const sessionsRoot = join(OHQ, "sessions");
    const env = new NodeExecutionEnv({ cwd: process.cwd() });
    const repo = new JsonlSessionRepo({ fs: env, sessionsRoot });

    const older = await repo.create({ cwd: process.cwd() });
    const olderMeta = await older.getMetadata();
    await older.appendMessage({
      role: "user",
      content: [{ type: "text", text: "older session question" }],
      timestamp: Date.now(),
    } as any);
    await older.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "older session answer" }],
      provider: "openai",
      model: "openai/gpt-5.5",
      api: "responses",
      usage: {
        input: 10,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 20,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "end_turn",
      timestamp: Date.now(),
    } as any);

    await new Promise((resolve) => setTimeout(resolve, 25));

    const newer = await repo.create({ cwd: process.cwd() });
    await newer.appendMessage({
      role: "user",
      content: [{ type: "text", text: "newer session question" }],
      timestamp: Date.now(),
    } as any);
    await newer.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "newer session answer" }],
      provider: "openai",
      model: "openai/gpt-5.5",
      api: "responses",
      usage: {
        input: 10,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 20,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "end_turn",
      timestamp: Date.now(),
    } as any);

    const h = harness();
    await h.runtime.bootstrap();
    await h.runtime.submit(`/resume ${olderMeta.id}`);

    expect(h.messages.at(-1)).toEqual([
      { role: "user", text: "older session question" },
      { role: "assistant", text: "older session answer" },
      expect.objectContaining({
        role: "assistant",
        text: expect.stringContaining(`id: ${olderMeta.id}`),
      }),
    ]);
  });

  it("syncs compacted session messages into conversation", async () => {
    const h = harness();
    const agent = {
      state: {
        isStreaming: false,
        messages: [
          { role: "user", content: "old question" },
          { role: "assistant", content: "kept summary" },
        ] as Array<{ role: string; content: string }>,
        pendingToolCalls: new Set<string>(),
      },
      compact: async () => {
        agent.state.messages = [
          { role: "user", content: "new compacted context" },
          { role: "assistant", content: "summary after compact" },
        ];
        return { summary: "summary after compact", firstKeptEntryId: "e2", tokensBefore: 42 };
      },
      waitForIdle: async () => {},
    };
    (h.runtime as unknown as { agent: object }).agent = agent;
    await h.runtime.submit("/compact keep portfolio facts");
    expect(h.messages.at(-1)).toEqual([
      { role: "user", text: "new compacted context" },
      { role: "assistant", text: "summary after compact" },
      expect.objectContaining({ role: "assistant", text: expect.stringContaining("Compacted") }),
    ]);
  });

  it("waits for active agent turns before compacting", async () => {
    const h = harness();
    const waitForIdle = mock(async () => {});
    const compact = mock(async () => ({ summary: "summary after idle", firstKeptEntryId: "e2", tokensBefore: 42 }));
    const agent = {
      state: {
        isStreaming: true,
        messages: [] as Array<{ role: string; content: string }>,
        pendingToolCalls: new Set<string>(),
      },
      waitForIdle,
      compact,
    };
    (h.runtime as unknown as { agent: object }).agent = agent;

    await h.runtime.submit("/compact");

    expect(waitForIdle).toHaveBeenCalled();
    expect(compact).toHaveBeenCalledWith(undefined);
    expect(h.activities).toContain("compacting");
    expect(h.messages.at(-1)?.at(-1)).toEqual(expect.objectContaining({
      role: "assistant",
      text: expect.stringContaining("Compacted"),
    }));
  });

  it("shows compacting status while the slash command is running", async () => {
    const h = harness();
    let release = () => {};
    const compact = mock(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { summary: "summary after compact", firstKeptEntryId: "e2", tokensBefore: 42 };
    });
    const agent = {
      state: {
        isStreaming: false,
        messages: [] as Array<{ role: string; content: string }>,
        pendingToolCalls: new Set<string>(),
      },
      waitForIdle: mock(async () => {}),
      compact,
    };
    (h.runtime as unknown as { agent: object }).agent = agent;

    const submitPromise = h.runtime.submit("/compact keep quant context");
    await Promise.resolve();

    expect(h.activities).toContain("compacting");
    expect(h.statuses.at(-1)).toEqual({
      kind: "info",
      text: "Compacting the current session context...",
    });

    release();
    await submitPromise;
  });

  it("shows nothing-to-compact as an info status", async () => {
    const h = harness();
    const agent = {
      state: {
        isStreaming: false,
        messages: [] as Array<{ role: string; content: string }>,
        pendingToolCalls: new Set<string>(),
      },
      waitForIdle: mock(async () => {}),
      compact: mock(async () => {
        throw new Error("Nothing to compact");
      }),
    };
    (h.runtime as unknown as { agent: object }).agent = agent;

    await h.runtime.submit("/compact");

    expect(h.statuses.at(-1)).toEqual({
      kind: "info",
      text: "Nothing to compact. The current session is already within the compaction window.",
    });
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

  it("selects local portfolio storage and refreshes overview state", async () => {
    mkdirSync(join(OHQ, "portfolio"), { recursive: true });
    await Bun.write(join(OHQ, "portfolio", "holdings_alpha.json"), JSON.stringify({
      name: "Alpha组合",
      updated: "2026-06-01",
      funds: [{ code: "510300", name: "沪深300ETF" }],
    }, null, 2));
    const h = harness(
      async () => [],
      async () => [],
      async (entries) => entries.map((entry) => ({ code: entry.code, name: entry.name, price: 1, pct: 0 })),
    );
    await h.runtime.submit("/portfolio use Alpha组合");
    expect(h.localStates.at(-1)?.activePortfolio).toBe("Alpha组合");
    expect(loadPanelPortfolio().symbols.map((item) => item.code)).toEqual(["510300"]);
    const latestPanel = h.panels.at(-1)?.panel ?? [];
    expect(latestPanel.some((section) => section.title === "Alpha组合")).toBe(true);
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
