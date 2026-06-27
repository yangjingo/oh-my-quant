/**
 * Tests for session management, token estimation, compaction, and createAgent.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { estimateTokens, estimateContextTokens, createAgent, resolveModelId, updateSessionCtx } from "../src/session.ts";
import { JsonlSessionRepo } from "../src/pi/index.ts";
import { NodeExecutionEnv } from "../src/pi/node.ts";

let TEST_DIR = "";
let TEST_SESSIONS_DIR = "";
let TEST_SKILLS_DIR = "";

function setupSettings(env: Record<string, string>, model = "gpt-5.5") {
  TEST_DIR = mkdtempSync(join(tmpdir(), "ohq-agent-"));
  TEST_SESSIONS_DIR = join(TEST_DIR, "sessions");
  TEST_SKILLS_DIR = join(TEST_DIR, "skills");
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_SKILLS_DIR, "whyj-quant"), { recursive: true });
  writeFileSync(join(TEST_SKILLS_DIR, "whyj-quant", "SKILL.md"), `---
name: whyj-quant
description: Use for quant workflow orchestration and benchmark interpretation.
---

# WhyJ Quant Skill

Inspect benchmark output and propose next analysis steps.
`, "utf-8");
  writeFileSync(join(TEST_DIR, "settings.json"), JSON.stringify({
    version: 1,
    env,
    model,
    thinkingLevel: "off",
    permissions: {},
    preferences: {
      defaultMarket: "A",
      defaultBenchmark: "000300.SH",
      defaultCash: 100_000,
      defaultFast: 20,
      defaultSlow: 60,
      currentPortfolioFile: "holdings.json",
    },
  }), "utf-8");
  process.env.OHQUANT_DIR = TEST_DIR;
}

function cleanup() {
  if (TEST_DIR) {
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  }
  TEST_DIR = "";
  TEST_SESSIONS_DIR = "";
  TEST_SKILLS_DIR = "";
  delete process.env.OHQUANT_DIR;
}

describe("estimateTokens", () => {
  it("estimates user message tokens", () => {
    const tokens = estimateTokens({ role: "user", content: "hello world", timestamp: 0 } as any);
    expect(tokens).toBeGreaterThan(0);
  });

  it("estimates user string content", () => {
    const msg = { role: "user" as const, content: "hello world", timestamp: 0 };
    expect(estimateTokens(msg as any)).toBe(3); // 11 chars / 4 = 2.75 → 3
  });

  it("estimates user text block content", () => {
    const msg = { role: "user" as const, content: [{ type: "text" as const, text: "hello world" }], timestamp: 0 };
    expect(estimateTokens(msg as any)).toBe(3);
  });

  it("estimates assistant message with text", () => {
    const msg = {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "Hello, here is the analysis." }],
      timestamp: 0,
    };
    expect(estimateTokens(msg as any)).toBeGreaterThan(0);
  });

  it("estimates assistant message with thinking", () => {
    const msg = {
      role: "assistant" as const,
      content: [
        { type: "thinking" as const, thinking: "Let me analyze this stock..." },
        { type: "text" as const, text: "Result" },
      ],
      timestamp: 0,
    };
    const tokens = estimateTokens(msg as any);
    expect(tokens).toBeGreaterThan(3);
  });

  it("estimates assistant message with tool calls", () => {
    const msg = {
      role: "assistant" as const,
      content: [
        { type: "toolCall" as const, id: "1", name: "fetch_bars", arguments: { symbol: "000001.SZ" } },
      ],
      timestamp: 0,
    };
    expect(estimateTokens(msg as any)).toBeGreaterThan(0);
  });

  it("estimates toolResult message", () => {
    const msg = {
      role: "toolResult" as const,
      toolCallId: "1",
      content: [{ type: "text" as const, text: "Downloaded 500 bars for 000001.SZ" }],
      timestamp: 0,
    };
    expect(estimateTokens(msg as any)).toBeGreaterThan(0);
  });

  it("returns 0 for unknown role", () => {
    const msg = { role: "unknown" as any, content: "test", timestamp: 0 };
    expect(estimateTokens(msg as any)).toBe(0);
  });
});

describe("resolveModelId", () => {
  it("preserves the raw env model value", () => {
    expect(resolveModelId("sonnet", { WHYJ_DEFAULT_SONNET_MODEL: "deepseek-v4-pro[1m]" })).toBe("deepseek-v4-pro[1m]");
  });
});

describe("estimateContextTokens", () => {
  it("sums tokens across all messages", () => {
    const messages = [
      { role: "user" as const, content: "hello", timestamp: 0 },
      { role: "user" as const, content: "world", timestamp: 0 },
    ];
    expect(estimateContextTokens(messages as any)).toBe(4); // 2 + 2
  });

  it("returns 0 for empty array", () => {
    expect(estimateContextTokens([])).toBe(0);
  });
});

describe("createAgent", () => {
  beforeEach(() => {
    setupSettings({ WHYJ_QUANT_AUTH_TOKEN: "test-key-123" });
  });
  afterEach(() => cleanup());

  it("creates agent when API key is in settings.json", async () => {
    const agent = createAgent({
      cwd: TEST_DIR,
      sessionsRoot: TEST_SESSIONS_DIR,
      settings: {
        env: { WHYJ_QUANT_AUTH_TOKEN: "test-key-123" },
        model: "gpt-5.5",
        thinkingLevel: "off",
      },
      skillPaths: [TEST_SKILLS_DIR],
    });
    await agent.waitForIdle();
    expect(agent).not.toBeNull();
    expect(agent.state.systemPrompt).toContain("quantitative finance analyst");
    expect(agent.state.model.id).toBe("openai/gpt-5.5");
    expect(agent.state.systemPrompt).toContain("<available_skills>");
  });

  it("creates agent regardless of API key presence", async () => {
    const agent = createAgent({
      cwd: TEST_DIR,
      sessionsRoot: TEST_SESSIONS_DIR,
      settings: {
        env: {},
        model: "gpt-5.5",
        thinkingLevel: "off",
      },
      skillPaths: [TEST_SKILLS_DIR],
    });
    expect(agent).not.toBeNull();
    expect(agent.state.model.id).toBe("openai/gpt-5.5");
  });

  it("routes sonnet to the anthropic provider when baseUrl is anthropic-compatible", async () => {
    cleanup();
    setupSettings({
      WHYJ_QUANT_API_KEY: "test-key-123",
      WHYJ_QUANT_BASE_URL: "https://api.deepseek.com/anthropic",
    }, "sonnet");

    const agent = createAgent({
      cwd: TEST_DIR,
      sessionsRoot: TEST_SESSIONS_DIR,
      settings: {
        env: {
          WHYJ_QUANT_API_KEY: "test-key-123",
          WHYJ_QUANT_BASE_URL: "https://api.deepseek.com/anthropic",
        },
        model: "sonnet",
        thinkingLevel: "off",
      },
      skillPaths: [TEST_SKILLS_DIR],
    });
    await agent.waitForIdle();

    expect(agent.state.model.id).toBe("deepseek-v4-pro");
    expect(agent.state.model.provider).toBe("anthropic");
    expect(agent.state.model.api).toBe("anthropic-messages");
    expect(agent.state.model.baseUrl).toBe("https://api.deepseek.com/anthropic");
  });

  it("accepts annotated deepseek model ids on anthropic-compatible endpoints", async () => {
    cleanup();
    setupSettings({
      WHYJ_QUANT_API_KEY: "test-key-123",
      WHYJ_QUANT_BASE_URL: "https://api.deepseek.com/anthropic",
      WHYJ_DEFAULT_SONNET_MODEL: "deepseek-v4-pro[1m]",
    }, "sonnet");

    const agent = createAgent({
      cwd: TEST_DIR,
      sessionsRoot: TEST_SESSIONS_DIR,
      settings: {
        env: {
          WHYJ_QUANT_API_KEY: "test-key-123",
          WHYJ_QUANT_BASE_URL: "https://api.deepseek.com/anthropic",
          WHYJ_DEFAULT_SONNET_MODEL: "deepseek-v4-pro[1m]",
        },
        model: "sonnet",
        thinkingLevel: "off",
      },
      skillPaths: [TEST_SKILLS_DIR],
    });
    await agent.waitForIdle();

    expect(agent.state.model.id).toBe("deepseek-v4-pro[1m]");
    expect(agent.state.model.provider).toBe("anthropic");
    expect(agent.state.model.api).toBe("anthropic-messages");
  });

  it("routes claude model ids to the anthropic provider", async () => {
    cleanup();
    setupSettings({
      WHYJ_QUANT_API_KEY: "test-key-123",
      WHYJ_QUANT_BASE_URL: "https://api.anthropic.com",
    }, "claude-opus-4-6");

    const agent = createAgent({
      cwd: TEST_DIR,
      sessionsRoot: TEST_SESSIONS_DIR,
      settings: {
        env: {
          WHYJ_QUANT_API_KEY: "test-key-123",
          WHYJ_QUANT_BASE_URL: "https://api.anthropic.com",
        },
        model: "claude-opus-4-6",
        thinkingLevel: "off",
      },
      skillPaths: [TEST_SKILLS_DIR],
    });
    await agent.waitForIdle();

    expect(agent.state.model.id).toBe("claude-opus-4-6");
    expect(agent.state.model.provider).toBe("anthropic");
    expect(agent.state.model.api).toBe("anthropic-messages");
    expect(agent.state.model.baseUrl).toBe("https://api.anthropic.com");
  });

  [
    ["glm-5", "https://open.bigmodel.cn/api/anthropic"],
    ["glm-5.2", "https://open.bigmodel.cn/api/anthropic"],
    ["glm-5.1", "https://open.bigmodel.cn/api/anthropic"],
    ["glm-5.2[1m]", "https://open.bigmodel.cn/api/anthropic"],
    ["MiniMax-M2.7", "https://api.minimaxi.com/anthropic"],
  ].forEach(([modelId, baseUrl]) => {
    it(`routes ${modelId} through the anthropic provider on Anthropic-compatible endpoints`, async () => {
      cleanup();
      setupSettings({
        WHYJ_QUANT_API_KEY: "test-key-123",
        WHYJ_QUANT_BASE_URL: baseUrl,
        WHYJ_DEFAULT_SONNET_MODEL: modelId,
      }, "sonnet");

      const agent = createAgent({
        cwd: TEST_DIR,
        sessionsRoot: TEST_SESSIONS_DIR,
        settings: {
          env: {
            WHYJ_QUANT_API_KEY: "test-key-123",
            WHYJ_QUANT_BASE_URL: baseUrl,
            WHYJ_DEFAULT_SONNET_MODEL: modelId,
          },
          model: "sonnet",
          thinkingLevel: "off",
        },
        skillPaths: [TEST_SKILLS_DIR],
      });
      await agent.waitForIdle();

      expect(agent.state.model.id).toBe(modelId);
      expect(agent.state.model.provider).toBe("anthropic");
      expect(agent.state.model.api).toBe("anthropic-messages");
      expect(agent.state.model.baseUrl).toBe(baseUrl);
    });
  });

  [
    ["glm-5", "https://open.bigmodel.cn/api/v1", "zai"],
    ["glm-5.2", "https://open.bigmodel.cn/api/v1", "zai"],
    ["glm-5.1", "https://open.bigmodel.cn/api/v1", "zai"],
    ["glm-5.2[1m]", "https://open.bigmodel.cn/api/v1", "zai"],
    ["MiniMax-M2.7", "https://api.minimaxi.com/v1", "minimax"],
  ].forEach(([modelId, baseUrl, provider]) => {
    it(`routes ${modelId} through the ${provider} openai-completions path on OpenAI-style endpoints`, async () => {
      cleanup();
      setupSettings({
        WHYJ_QUANT_API_KEY: "test-key-123",
        WHYJ_QUANT_BASE_URL: baseUrl,
        WHYJ_DEFAULT_SONNET_MODEL: modelId,
      }, "sonnet");

      const agent = createAgent({
        cwd: TEST_DIR,
        sessionsRoot: TEST_SESSIONS_DIR,
        settings: {
          env: {
            WHYJ_QUANT_API_KEY: "test-key-123",
            WHYJ_QUANT_BASE_URL: baseUrl,
            WHYJ_DEFAULT_SONNET_MODEL: modelId,
          },
          model: "sonnet",
          thinkingLevel: "off",
        },
        skillPaths: [TEST_SKILLS_DIR],
      });
      await agent.waitForIdle();

      expect(agent.state.model.id).toBe(modelId);
      expect(agent.state.model.provider).toBe(provider);
      expect(agent.state.model.api).toBe("openai-completions");
      expect(agent.state.model.baseUrl).toBe(baseUrl);
    });
  });

  it("keeps OpenAI-style model routing on the OpenAI-compatible path", async () => {
    cleanup();
    setupSettings({
      WHYJ_QUANT_API_KEY: "test-key-123",
    }, "gpt-5.5");

    const agent = createAgent({
      cwd: TEST_DIR,
      sessionsRoot: TEST_SESSIONS_DIR,
      settings: {
        env: {
          WHYJ_QUANT_API_KEY: "test-key-123",
        },
        model: "gpt-5.5",
        thinkingLevel: "off",
      },
      skillPaths: [TEST_SKILLS_DIR],
    });
    await agent.waitForIdle();

    expect(agent.state.model.id).toBe("openai/gpt-5.5");
    expect(agent.state.model.provider).toBe("openrouter");
    expect(agent.state.model.api).toBe("openai-completions");
  });

  it("creates a persisted JSONL session tree file and exposes metadata", async () => {
    const agent = createAgent({
      cwd: TEST_DIR,
      sessionsRoot: TEST_SESSIONS_DIR,
      settings: {
        env: {},
        model: "gpt-5.5",
        thinkingLevel: "off",
      },
      skillPaths: [TEST_SKILLS_DIR],
    });
    await agent.waitForIdle();

    const metadata = await agent.getSessionMetadata();
    expect(metadata).not.toBeNull();
    expect(metadata?.cwd).toBe(TEST_DIR);
    expect(metadata?.path.endsWith(".jsonl")).toBe(true);
    expect(existsSync(metadata!.path)).toBe(true);
    const fileName = basename(metadata!.path);
    expect(fileName).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/);
    expect(fileName.endsWith(`_${metadata!.id}.jsonl`)).toBe(true);

    const file = readFileSync(metadata!.path, "utf-8");
    expect(file.split("\n")[0]).toContain("\"type\":\"session\"");
    expect(await agent.getSessionEntries()).toEqual([]);
    expect(await agent.getLeafId()).toBeNull();
  });

  it("creates a new JSONL session for each agent startup instead of reopening the latest session", async () => {
    const first = createAgent({
      cwd: TEST_DIR,
      sessionsRoot: TEST_SESSIONS_DIR,
      settings: {
        env: {},
        model: "gpt-5.5",
        thinkingLevel: "off",
      },
      skillPaths: [TEST_SKILLS_DIR],
    });
    await first.waitForIdle();
    const firstMeta = await first.getSessionMetadata();

    const second = createAgent({
      cwd: TEST_DIR,
      sessionsRoot: TEST_SESSIONS_DIR,
      settings: {
        env: {},
        model: "gpt-5.5",
        thinkingLevel: "off",
      },
      skillPaths: [TEST_SKILLS_DIR],
    });
    await second.waitForIdle();
    const secondMeta = await second.getSessionMetadata();

    expect(firstMeta).not.toBeNull();
    expect(secondMeta).not.toBeNull();
    expect(secondMeta!.id).not.toBe(firstMeta!.id);
    expect(secondMeta!.path).not.toBe(firstMeta!.path);
    expect(existsSync(firstMeta!.path)).toBe(true);
    expect(existsSync(secondMeta!.path)).toBe(true);
    expect(second.state.messages).toEqual([]);

    const sessions = await second.listSessions();
    expect(sessions.map((session) => session.id)).toEqual(expect.arrayContaining([firstMeta!.id, secondMeta!.id]));
  });

  it("reports context usage from the harness-backed transcript", async () => {
    const agent = createAgent({
      cwd: TEST_DIR,
      sessionsRoot: TEST_SESSIONS_DIR,
      settings: {
        env: {},
        model: "gpt-5.5",
        thinkingLevel: "off",
      },
      skillPaths: [TEST_SKILLS_DIR],
    });
    await agent.waitForIdle();

    const usage = agent.getContextUsage();
    expect(usage).toBeDefined();
    expect(usage?.tokens).toBe(0);
    expect((usage?.contextWindow ?? 0) > 0).toBe(true);
  });

  it("surfaces tree-navigation errors from the harness facade", async () => {
    const agent = createAgent({
      cwd: TEST_DIR,
      sessionsRoot: TEST_SESSIONS_DIR,
      settings: {
        env: {},
        model: "gpt-5.5",
        thinkingLevel: "off",
      },
      skillPaths: [TEST_SKILLS_DIR],
    });
    await agent.waitForIdle();

    await expect(agent.navigateTree("missing-entry")).rejects.toThrow("not found");
  });

  it("starts fresh, then resumes an existing pi session tree and refreshes state after navigateTree", async () => {
    const cwd = join(TEST_DIR, "workspace");
    mkdirSync(cwd, { recursive: true });
    const env = new NodeExecutionEnv({ cwd });
    const repo = new JsonlSessionRepo({ fs: env, sessionsRoot: TEST_SESSIONS_DIR });
    const seeded = await repo.create({ cwd });
    const seededMeta = await seeded.getMetadata();

    const firstUserId = await seeded.appendMessage({
      role: "user",
      content: [{ type: "text", text: "analyze 000001.SZ momentum" }],
      timestamp: Date.now(),
    } as any);
    await seeded.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Momentum looks positive." }],
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
    await seeded.appendMessage({
      role: "user",
      content: [{ type: "text", text: "now summarize the risks" }],
      timestamp: Date.now(),
    } as any);

    const agent = createAgent({
      cwd,
      sessionsRoot: TEST_SESSIONS_DIR,
      settings: {
        env: {},
        model: "gpt-5.5",
        thinkingLevel: "off",
      },
      skillPaths: [TEST_SKILLS_DIR],
    });
    await agent.waitForIdle();

    const freshMeta = await agent.getSessionMetadata();
    expect(freshMeta?.id).not.toBe(seededMeta.id);
    expect(agent.state.messages).toHaveLength(0);
    expect(await agent.getSessionEntries()).toEqual([]);

    await agent.resumeSession(seededMeta.id);

    expect(agent.state.messages).toHaveLength(3);
    expect((await agent.getSessionEntries()).length).toBe(3);

    const result = await agent.navigateTree(firstUserId);
    expect(result.cancelled).toBe(false);
    expect(result.editorText).toBe("analyze 000001.SZ momentum");
    expect(await agent.getLeafId()).toBeNull();
    expect(agent.state.messages).toEqual([]);
  });

  it("loads discovered skills and exposes them through the facade", async () => {
    const agent = createAgent({
      cwd: TEST_DIR,
      sessionsRoot: TEST_SESSIONS_DIR,
      settings: {
        env: {},
        model: "gpt-5.5",
        thinkingLevel: "off",
      },
      skillPaths: [TEST_SKILLS_DIR],
    });
    await agent.waitForIdle();

    const skills = await agent.getSkills();
    expect(skills.some((skill) => skill.name === "whyj-quant")).toBe(true);
    expect(skills[0]?.filePath).toContain("SKILL.md");
  });

  it("injects lightweight render guidance into prompt/followUp/skill assembly", async () => {
    const agent = createAgent({
      cwd: TEST_DIR,
      sessionsRoot: TEST_SESSIONS_DIR,
      settings: {
        env: {},
        model: "gpt-5.5",
        thinkingLevel: "off",
      },
      skillPaths: [TEST_SKILLS_DIR],
    }) as any;
    await agent.waitForIdle();

    const captured: Record<string, string> = {};
    agent.harness = {
      prompt: async (text: string) => { captured.prompt = text; },
      followUp: async (text: string) => { captured.followUp = text; },
      skill: async (name: string, text?: string, options?: { displayText?: string }) => {
        captured.skillName = name;
        captured.skill = text ?? "";
        captured.skillDisplayText = options?.displayText ?? "";
      },
    };
    agent.ready = Promise.resolve();

    await agent.prompt("compare top 5 holdings and show a table");
    updateSessionCtx({
      recentToolState: {
        toolName: "check_risk",
        resultShape: "risk_metrics",
      },
    });
    await agent.followUp({
      role: "user",
      content: [{ type: "text", text: "继续，展开讲一下" }],
      timestamp: Date.now(),
    } as any);
    await agent.skill("whyj-quant", "focus on benchmark drift");

    expect(captured.prompt).toContain("<!-- render guidance -->");
    expect(captured.prompt).toContain("compact aligned three-line plain-text table or chart-style block");
    expect(captured.followUp).toContain("<!-- render guidance -->");
    expect(captured.followUp).toContain("chart-style block");
    expect(captured.followUp).toContain("preserve VaR/CVaR and drawdown lines explicitly");
    expect(captured.followUp).toContain("recent_tool_state:");
    expect(captured.followUp).toContain("result_shape: risk_metrics");
    expect(captured.skillName).toBe("whyj-quant");
    expect(captured.skill).toContain("focus on benchmark drift");
    expect(captured.skill).toContain("structured rows visible");
    expect(captured.skillDisplayText).toBe("SKILL.whyj-quant");
  });

  it("stores last result shape from structured tool-result details", async () => {
    const agent = createAgent({
      cwd: TEST_DIR,
      sessionsRoot: TEST_SESSIONS_DIR,
      settings: {
        env: {},
        model: "gpt-5.5",
        thinkingLevel: "off",
      },
      skillPaths: [TEST_SKILLS_DIR],
    }) as any;
    await agent.waitForIdle();

    agent.reduceState({
      type: "tool_execution_end",
      toolCallId: "dash-1",
      toolName: "show_dashboard",
      result: {
        content: [{ type: "text", text: "Dashboard  3 evaluations" }],
        details: { summary: { totalEvals: 3, bestStrategy: "alpha" } },
      },
      isError: false,
    });

    const followCaptured: Record<string, string> = {};
    agent.harness = {
      followUp: async (text: string) => { followCaptured.text = text; },
    };
    agent.ready = Promise.resolve();

    await agent.followUp({
      role: "user",
      content: [{ type: "text", text: "继续" }],
      timestamp: Date.now(),
    } as any);

    expect(followCaptured.text).toContain("recent_tool_state:");
    expect(followCaptured.text).toContain("tool: show_dashboard");
    expect(followCaptured.text).toContain("result_shape: dashboard_ranking");
    expect(followCaptured.text).toContain("preserve ranking rows and scores instead of summarizing only the top name");
  });
});
