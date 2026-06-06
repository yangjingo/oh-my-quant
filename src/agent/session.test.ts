/**
 * Tests for session management, token estimation, compaction, and createAgent.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { estimateTokens, estimateContextTokens, createAgent } from "./session.ts";

const TEST_DIR = join(process.cwd(), ".ohquant-test");

function setupSettings(env: Record<string, string>) {
  const dir = join(TEST_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.json"), JSON.stringify({
    version: 1,
    env,
    model: "sonnet",
    thinkingLevel: "off",
    preferences: {},
    mcp: { enabled: false },
  }), "utf-8");
  // Override OHQUANT_DIR for testing
  process.env.OHQUANT_DIR = TEST_DIR;
}

function cleanup() {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
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
        { type: "toolCall" as const, id: "1", name: "tushare_daily", arguments: { ts_code: "000001.SZ" } },
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
    setupSettings({ WHYJ_AUTH_TOKEN: "test-key-123" });
  });
  afterEach(() => cleanup());

  it("creates agent when API key is in settings.json", () => {
    const agent = createAgent();
    expect(agent).not.toBeNull();
    expect(agent.state.systemPrompt).toContain("quantitative finance analyst");
  });

  it("creates agent regardless of API key presence", () => {
    cleanup();
    setupSettings({});
    const agent = createAgent();
    // Agent is always created — getApiKey just returns undefined
    expect(agent).not.toBeNull();
  });
});
