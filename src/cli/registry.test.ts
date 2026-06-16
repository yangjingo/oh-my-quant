import { describe, expect, it, mock } from "bun:test";
import { buildCommandHelpText, COMMAND_CATALOG } from "./catalog.ts";
import { executeCommand, isLocalSlashCommand, parseCommand } from "./registry.ts";

describe("parseCommand", () => {
  it("returns null for non-command input", () => {
    expect(parseCommand("hello world")).toBeNull();
    expect(parseCommand("analyze AAPL")).toBeNull();
  });

  it("returns null for bare slash", () => {
    expect(parseCommand("/")).toBeNull();
    expect(parseCommand(" / ")).toBeNull();
  });

  it("parses simple command", () => {
    const cmd = parseCommand("/help");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("help");
    expect(cmd!.raw).toBe("/help");
  });

  it("parses boolean flags", () => {
    const cmd = parseCommand("/benchmark --force");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("benchmark");
    expect(cmd!.flags.force).toBe(true);
  });

  it("parses command with numeric flag", () => {
    const cmd = parseCommand("/backtest run --symbol 000001.SZ --fast 20 --slow 60");
    expect(cmd).not.toBeNull();
    expect(cmd!.flags.fast).toBe("20");
    expect(cmd!.flags.slow).toBe("60");
  });

  it("parses /exit", () => {
    const cmd = parseCommand("/exit");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("exit");
  });

  it("parses /clear", () => {
    const cmd = parseCommand("/clear");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("clear");
  });

  it("parses /compact", () => {
    const cmd = parseCommand("/compact focus on signals");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("compact");
    expect(cmd!.positional).toEqual(["focus", "on", "signals"]);
  });

  it("ignores leading whitespace", () => {
    const cmd = parseCommand("  /help  ");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("help");
  });
});

describe("executeCommand", () => {
  it("returns help text from catalog", async () => {
    const result = await executeCommand(parseCommand("/help")!);
    expect(result.success).toBe(true);
    expect(result.message).toBe(buildCommandHelpText());
  });

  it("returns clear effects", async () => {
    const result = await executeCommand(parseCommand("/clear")!);
    expect(result.effects).toEqual([{ type: "clearConversation" }, { type: "resetAgent" }]);
  });

  it("routes compact to the agent session when available", async () => {
    const compact = mock(async () => ({
      summary: "Compacted summary",
      firstKeptEntryId: "e2",
      tokensBefore: 1234,
    }));
    const result = await executeCommand(parseCommand("/compact focus on signals")!, {
      agentSession: {
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
        compact,
        navigateTree: mock(async () => ({ cancelled: false })),
        getContextUsage: mock(() => ({ tokens: 1200, contextWindow: 200_000, percent: 0.6 })),
        getSessionMetadata: mock(async () => null),
        getSessionEntries: mock(async () => []),
        getSessionBranch: mock(async () => []),
        getLeafId: mock(async () => null),
        listSessions: mock(async () => []),
        resumeSession: mock(async () => ({ id: "s1", createdAt: "2026-06-10T00:00:00.000Z", cwd: "C:/tmp", path: "C:/tmp/s1.jsonl" })),
        getSkills: mock(async () => []),
        abort: mock(() => {}),
        clearAllQueues: mock(() => {}),
        reset: mock(() => {}),
      },
    });
    expect(result.success).toBe(true);
    expect(compact).toHaveBeenCalledWith("focus on signals");
    expect(result.message).toContain("Compacted");
  });

  it("returns openConfig effect when callback provided", async () => {
    const result = await executeCommand(parseCommand("/config")!, {
      openConfig: () => {},
    });
    expect(result.success).toBe(true);
    expect(result.effects).toEqual([{ type: "openConfig" }]);
  });

  it("treats resume and compact as local commands", () => {
    expect(isLocalSlashCommand("resume")).toBe(true);
    expect(isLocalSlashCommand("compact")).toBe(true);
    expect(isLocalSlashCommand("portfolio")).toBe(true);
  });
});

describe("catalog", () => {
  it("renders compact command help text", () => {
    const help = buildCommandHelpText();
    expect(help).toContain("Commands");
    expect(help).toContain("/config");
    expect(help).toContain("No / prefix");
    expect(help).not.toContain("Commands:");
  });

  it("lists portfolio management commands", () => {
    const portfolio = COMMAND_CATALOG.find((entry) => entry.name === "/portfolio");
    expect(portfolio?.subcommands).toBeUndefined();
  });

  it("keeps resume as a direct command without subcommands", () => {
    const resume = COMMAND_CATALOG.find((entry) => entry.name === "/resume");
    expect(resume?.subcommands).toBeUndefined();
  });
});
