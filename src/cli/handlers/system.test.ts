import { describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPanelPortfolio } from "../../storage/panel-portfolio.ts";
import { loadSettings } from "../../storage/index.ts";
import { compactHandler, configHandler, portfolioHandler, resumeHandler, sessionHandler } from "./system.ts";
import { skillHandler } from "../../skill/handler.ts";
import type { QuantAgentSession } from "../../agent/src/session.ts";

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
      thinkingText: "",
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
    listSessions: mock(async () => [
      { id: "s1", createdAt: "2026-06-10T00:00:00.000Z", cwd: "C:/tmp", path: "C:/tmp/s1.jsonl" },
      { id: "s0", createdAt: "2026-06-09T00:00:00.000Z", cwd: "C:/tmp", path: "C:/tmp/s0.jsonl" },
    ]),
    resumeSession: mock(async (sessionId: string) => ({ id: sessionId, createdAt: "2026-06-09T00:00:00.000Z", cwd: "C:/tmp", path: `C:/tmp/${sessionId}.jsonl` })),
    getSkills: mock(async () => []),
    abort: mock(() => {}),
    clearAllQueues: mock(() => {}),
    reset: mock(() => {}),
    ...overrides,
  };
}

describe("resumeHandler", () => {
  it("returns error when no agent session is available", async () => {
    const result = await resumeHandler({}, [], {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("not initialized");
  });

  it("lists saved sessions by default", async () => {
    const result = await resumeHandler({}, [], { agentSession: mockAgent() });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Saved sessions");
    expect(result.message).toContain("Use /resume <sessionId> to switch sessions");
    expect(result.message).toContain("s1");
  });

  it("opens the resume panel in TUI for bare resume", async () => {
    const result = await resumeHandler({}, [], {
      openResume: () => {},
      agentSession: mockAgent(),
    });
    expect(result.success).toBe(true);
    expect(result.effects).toEqual([{ type: "openResume" }]);
  });

  it("treats legacy subcommands as session ids now", async () => {
    const resumeSession = mock(async (sessionId: string) => ({ id: sessionId, createdAt: "2026-06-09T00:00:00.000Z", cwd: "C:/tmp", path: `C:/tmp/${sessionId}.jsonl` }));
    const result = await resumeHandler({}, ["list"], {
      agentSession: mockAgent({ resumeSession }),
    });
    expect(result.success).toBe(true);
    expect(resumeSession).toHaveBeenCalledWith("list");
    expect(result.message).toContain("id: list");
  });

  it("resumes a target session through the harness facade", async () => {
    const resumeSession = mock(async (sessionId: string) => ({ id: sessionId, createdAt: "2026-06-09T00:00:00.000Z", cwd: "C:/tmp", path: `C:/tmp/${sessionId}.jsonl` }));
    const result = await resumeHandler({}, ["s0"], {
      agentSession: mockAgent({ resumeSession }),
    });
    expect(result.success).toBe(true);
    expect(resumeSession).toHaveBeenCalledWith("s0");
    expect(result.message).toContain("Resumed");
    expect(result.message).toContain("id: s0");
  });
});

describe("compactHandler", () => {
  it("renders a quant-aware compact receipt from the summary", async () => {
    const result = await compactHandler({}, ["focus", "on", "signals"], {
      agentSession: mockAgent({
        compact: mock(async () => ({
          firstKeptEntryId: "e9",
          tokensBefore: 54321,
          summary: [
            "## Goal",
            "研究沪深300ETF与中证500ETF的轮动策略",
            "",
            "## Constraints & Preferences",
            "- Prefer compact plain-text tables for rankings and risk dashboards",
            "",
            "## Progress",
            "### Done",
            "- [x] Pulled daily bars and benchmark snapshots",
            "",
            "### In Progress",
            "- [ ] Validate regime filter",
            "",
            "## Key Decisions",
            '- **Risk control**: Keep max drawdown under 15% and track Sharpe/CVaR',
            "",
            "## Next Steps",
            "1. Test 60-day lookback with monthly rebalance on 510300.SH and 510500.SH",
            "",
            "## Critical Context",
            "- symbols: 510300.SH, 510500.SH; benchmark: 000300.SH",
            "- date range: 2024-01-01 to 2026-06-01; timeframe: daily",
            "- strategy params: 60-day lookback, monthly rebalance, max drawdown 15%",
            "- open hypothesis: regime filter may reduce drawdown without hurting CAGR",
          ].join("\n"),
        })),
      }),
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("Compacted");
    expect(result.message).toContain("metric");
    expect(result.message).toContain("retained fields");
    expect(result.message).toContain("focus            focus on signals");
    expect(result.message).toContain("quant context kept");
    expect(result.message).toContain("field         status  detail");
    expect(result.message).toContain("scope         kept");
    expect(result.message).toContain("dates/window  kept");
    expect(result.message).toContain("params/risk   kept");
    expect(result.message).toContain("open threads  kept");
    expect(result.message).toContain("retention map");
    expect(result.message).toContain("retained      ████████  4/4");
  });
});

describe("sessionHandler", () => {
  it("returns error when no agent session is available", async () => {
    const result = await sessionHandler({}, [], {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("not initialized");
  });

  it("renders current session metadata and context usage", async () => {
    const result = await sessionHandler({}, [], { agentSession: mockAgent() });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Session");
    expect(result.message).toContain("id          s1");
    expect(result.message).toContain("context     1200/200000");
  });
});

describe("portfolioHandler", () => {
  it("opens the portfolio panel in TUI for bare portfolio", async () => {
    const result = await portfolioHandler({}, [], { openPortfolio: () => {} });
    expect(result.success).toBe(true);
    expect(result.effects).toEqual([{ type: "openPortfolio" }]);
  });

  it("lists local portfolio files outside TUI", async () => {
    await withTempOhq(async () => {
      mkdirSync(join(OHQ, "portfolio"), { recursive: true });
      await Bun.write(join(OHQ, "portfolio", "holdings_v2_kc50.json"), JSON.stringify({
        name: "科创50宽基",
        updated: "2026-05-30T00:00:00+08:00",
        funds: [{ code: "011613", name: "华夏科创50ETF联接C" }],
      }, null, 2));
      const list = await portfolioHandler({}, [], {});
      expect(list.success).toBe(true);
      expect(list.message).toContain("Local portfolios");
      expect(list.message).toContain("科创50宽基");
      expect(list.message).not.toContain("holdings_v2_kc50.json");
    });
  });

  it("renders a compact config summary outside TUI", async () => {
    await withTempOhq(async () => {
      mkdirSync(join(OHQ, "portfolio"), { recursive: true });
      await Bun.write(join(OHQ, "portfolio", "holdings.json"), JSON.stringify({
        name: "当前主组合",
        updated: "2026-05-30T00:00:00+08:00",
        funds: [{ code: "011613", name: "华夏科创50ETF联接C" }],
      }, null, 2));
      const result = await configHandler({}, [], {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("Config");
      expect(result.message).toContain("Active portfolio  当前主组合");
      expect(result.message).toContain("Ctrl+P opens the settings panel");
      expect(result.message).not.toContain("────────────────");
    });
  });

  it("rejects legacy portfolio edit subcommands", async () => {
    const result = await portfolioHandler({}, ["add"], {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("/portfolio use");
  });

  it("selects a local portfolio and syncs panel portfolio storage", async () => {
    await withTempOhq(async () => {
      mkdirSync(join(OHQ, "portfolio"), { recursive: true });
      await Bun.write(join(OHQ, "portfolio", "holdings_kc50.json"), JSON.stringify({
        name: "科创50宽基",
        updated: "2026-05-30T00:00:00+08:00",
        funds: [
          { code: "588000", name: "科创50ETF" },
          { code: "011613", name: "华夏科创50ETF联接C" },
        ],
      }, null, 2));
      const result = await portfolioHandler({}, ["use", "科创50宽基"], {});
      expect(result.success).toBe(true);
      expect(result.effects).toEqual([{ type: "portfolioChanged" }]);
      expect(loadSettings().preferences.currentPortfolioFile).toBe("holdings_kc50.json");
      const panel = loadPanelPortfolio();
      expect(panel.symbols.map((item) => item.code)).toEqual(["588000", "011613"]);
      expect(panel.groups[0]?.name).toBe("科创50宽基");
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
    expect(result.message).toContain("Location");
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
