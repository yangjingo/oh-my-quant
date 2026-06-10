import { describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configHandler, portfolioHandler, sessionHandler, setupHandler } from "./system.ts";
import { skillHandler } from "./skill.ts";
import type { QuantAgentSession } from "../../agent/session.ts";

const OHQ = join(tmpdir(), `whyj-portfolio-handler-${Date.now()}`);

function withTempOhq<T>(fn: () => Promise<T> | T): Promise<T> | T {
  const prev = process.env.OHQUANT_DIR;
  process.env.OHQUANT_DIR = OHQ;
  mkdirSync(OHQ, { recursive: true });
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.finally(() => {
        process.env.OHQUANT_DIR = prev;
        rmSync(OHQ, { recursive: true, force: true });
      });
    }
    process.env.OHQUANT_DIR = prev;
    rmSync(OHQ, { recursive: true, force: true });
    return result;
  } catch (err) {
    process.env.OHQUANT_DIR = prev;
    rmSync(OHQ, { recursive: true, force: true });
    throw err;
  }
}

function mockAgent(overrides: Partial<QuantAgentSession> = {}): QuantAgentSession {
  return {
    state: {
      systemPrompt: "",
      model: { id: "openai/gpt-5.5", name: "gpt-5.5", api: "responses", provider: "openai", baseUrl: "", reasoning: false, input: [], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 8_000 },
      thinkingLevel: "off",
      tools: [],
      messages: [],
      isStreaming: false,
      pendingToolCalls: new Set<string>(),
    },
    subscribe: mock(() => () => {}),
    prompt: mock(async () => {}),
    waitForIdle: mock(async () => {}),
    steer: mock(async () => {}),
    followUp: mock(async () => {}),
    skill: mock(async () => {}),
    compact: mock(async () => ({
      summary: "Compacted summary",
      firstKeptEntryId: "e2",
      tokensBefore: 1234,
    })),
    navigateTree: mock(async () => ({ cancelled: false })),
    getContextUsage: mock(() => ({ tokens: 1200, contextWindow: 200_000, percent: 0.6 })),
    getSessionMetadata: mock(async () => ({ id: "s1", createdAt: "2026-06-10T00:00:00.000Z", cwd: "C:/tmp", path: "C:/tmp/s1.jsonl" })),
    getSessionEntries: mock(async () => [{ id: "e1", parentId: null, timestamp: "2026-06-10T00:00:00.000Z", type: "message", message: { role: "user", content: "hi", timestamp: 0 } } as any]),
    getSessionBranch: mock(async () => []),
    getLeafId: mock(async () => "e1"),
    getSkills: mock(async () => []),
    abort: mock(() => {}),
    clearAllQueues: mock(() => {}),
    reset: mock(() => {}),
    ...overrides,
  };
}

describe("sessionHandler", () => {
  it("returns error when no agent session is available", async () => {
    const result = await sessionHandler({}, [], {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("not initialized");
  });

  it("shows session info by default", async () => {
    const result = await sessionHandler({}, [], { agentSession: mockAgent() });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Session");
    expect(result.message).toContain("entries: 1");
    expect(result.message).toContain("leaf: e1");
  });

  it("runs compaction through the harness facade", async () => {
    const compact = mock(async () => ({
      summary: "Compacted summary",
      firstKeptEntryId: "e2",
      tokensBefore: 1234,
    }));
    const result = await sessionHandler({}, ["compact", "focus", "on", "signals"], {
      agentSession: mockAgent({ compact }),
    });
    expect(result.success).toBe(true);
    expect(compact).toHaveBeenCalledWith("focus on signals");
    expect(result.message).toContain("Session compacted.");
    expect(result.message).toContain("Compacted summary");
  });

  it("returns reset effects", async () => {
    const result = await sessionHandler({}, ["reset"], { agentSession: mockAgent() });
    expect(result.success).toBe(true);
    expect(result.effects).toEqual([{ type: "clearConversation" }, { type: "resetAgent" }]);
  });

  it("lists recent session entries", async () => {
    const result = await sessionHandler({}, ["entries"], { agentSession: mockAgent() });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Recent session entries");
    expect(result.message).toContain("e1");
  });

  it("navigates to a target entry through the harness facade", async () => {
    const navigateTree = mock(async () => ({ cancelled: false, editorText: "analyze 000001.SZ" }));
    const result = await sessionHandler({}, ["goto", "e1"], {
      agentSession: mockAgent({ navigateTree }),
    });
    expect(result.success).toBe(true);
    expect(navigateTree).toHaveBeenCalledWith("e1");
    expect(result.message).toContain("Moved session leaf to e1.");
  });
});

describe("portfolioHandler", () => {
  it("adds, lists, and removes panel portfolio symbols", async () => {
    await withTempOhq(async () => {
      const add = await portfolioHandler({ code: "510300.SH", name: "沪深300ETF" }, ["add"], {});
      expect(add.success).toBe(true);
      expect(add.message).toContain("Added");

      const list = await portfolioHandler({}, ["list"], {});
      expect(list.success).toBe(true);
      expect(list.message).toContain("Panel portfolio (1)");
      expect(list.message).toContain("510300.SH");

      const remove = await portfolioHandler({ code: "510300.SH" }, ["remove"], {});
      expect(remove.success).toBe(true);
      expect(remove.message).toContain("Removed");
    });
  });

  it("rejects duplicate add requests", async () => {
    await withTempOhq(async () => {
      await portfolioHandler({ code: "510300.SH", name: "沪深300ETF" }, ["add"], {});
      const dup = await portfolioHandler({ code: "510300.SH", name: "沪深300ETF" }, ["add"], {});
      expect(dup.success).toBe(false);
      expect(dup.message).toContain("already in panel portfolio");
    });
  });
});

describe("setupHandler", () => {
  it("shows credential setup help", async () => {
    await withTempOhq(async () => {
      const result = await setupHandler({}, [], {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("/setup whyj <token>");
      expect(result.message).toContain("Settings file:");
    });
  });

  it("saves a WhyJ auth token into settings", async () => {
    await withTempOhq(async () => {
      const result = await setupHandler({}, ["whyj", "test-key-123"], {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("Saved WHYJ_AUTH_TOKEN");

      const status = await configHandler({}, [], {});
      expect(status.message).toContain("Auth token                  [✓]");
    });
  });
});

describe("skillHandler", () => {
  it("lists discovered skills from the active agent session", async () => {
    const result = await skillHandler({}, [], {
      agentSession: mockAgent({
        getSkills: mock(async () => [{
          name: "whyj-quant",
          description: "Quant workflow shortcuts.",
          content: "# whyj-quant",
          filePath: "C:/Users/yangjing/.codex/skills/whyj-quant/SKILL.md",
          scope: "user" as const,
          source: "codex" as const,
          sourcePath: "C:/Users/yangjing/.codex/skills",
        }]),
      }),
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("whyj-quant");
    expect(result.message).toContain("user/codex");
  });

  it("returns detailed skill info", async () => {
    const result = await skillHandler({}, ["info", "whyj-quant"], {
      agentSession: mockAgent({
        getSkills: mock(async () => [{
          name: "whyj-quant",
          description: "Quant workflow shortcuts.",
          content: "# whyj-quant",
          filePath: "C:/Users/yangjing/.codex/skills/whyj-quant/SKILL.md",
          scope: "user" as const,
          source: "codex" as const,
          sourcePath: "C:/Users/yangjing/.codex/skills",
        }]),
      }),
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Location:");
    expect(result.message).toContain("explicit");
  });

  it("invokes a discovered skill through the harness facade", async () => {
    const skill = mock(async () => {});
    const result = await skillHandler({}, ["run", "whyj-quant", "review", "the", "holdings"], {
      agentSession: mockAgent({ skill }),
    });
    expect(result.success).toBe(true);
    expect(skill).toHaveBeenCalledWith("whyj-quant", "review the holdings");
  });
});
