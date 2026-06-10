import { describe, expect, it, mock } from "bun:test";
import { buildCommandHelpText, COMMAND_CATALOG } from "./catalog.ts";
import { executeCommand, isLocalSlashCommand, parseCommand } from "./registry.ts";

describe("parseCommand", () => {
  it("returns null for non-command input", () => {
    expect(parseCommand("hello world")).toBeNull();
    expect(parseCommand("analyze AAPL")).toBeNull();
  });

  it("parses simple command", () => {
    const cmd = parseCommand("/help");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("help");
    expect(cmd!.raw).toBe("/help");
  });

  it("parses command with flags", () => {
    const cmd = parseCommand("/data download --symbol 000001.SZ --market A");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("data");
    expect(cmd!.flags).toEqual({ symbol: "000001.SZ", market: "A" });
    expect(cmd!.positional).toEqual(["download"]);
  });

  it("parses short flags", () => {
    const cmd = parseCommand("/claw -c 000001.SZ -m A");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("claw");
    expect(cmd!.flags).toEqual({ c: "000001.SZ", m: "A" });
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

  it("parses /quit as exit", () => {
    const cmd = parseCommand("/quit");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("quit");
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

  it("parses explicit skill commands", () => {
    const cmd = parseCommand("/skill:whyj-quant summarize the benchmark");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("skill:whyj-quant");
    expect(cmd!.positional).toEqual(["summarize", "the", "benchmark"]);
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
        getSkills: mock(async () => []),
        abort: mock(() => {}),
        clearAllQueues: mock(() => {}),
        reset: mock(() => {}),
      },
    });
    expect(result.success).toBe(true);
    expect(compact).toHaveBeenCalledWith("focus on signals");
    expect(result.message).toContain("Session compacted.");
  });

  it("returns openConfig effect when callback provided", async () => {
    const result = await executeCommand(parseCommand("/config")!, {
      openConfig: () => {},
    });
    expect(result.success).toBe(true);
    expect(result.effects).toEqual([{ type: "openConfig" }]);
  });

  it("routes setup to credential help instead of opening the panel", async () => {
    const result = await executeCommand(parseCommand("/setup")!, {
      openConfig: () => {},
    });
    expect(result.success).toBe(true);
    expect(result.effects).toBeUndefined();
    expect(result.message).toContain("Setup");
    expect(result.message).toContain("/setup whyj <token>");
  });

  it("routes /skill:name to explicit harness skill invocation", async () => {
    const skill = mock(async () => {});
    const result = await executeCommand(parseCommand("/skill:whyj-quant focus on portfolio review")!, {
      agentSession: {
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
        skill,
        compact: mock(async () => ({ summary: "", firstKeptEntryId: "e1", tokensBefore: 0 })),
        navigateTree: mock(async () => ({ cancelled: false })),
        getContextUsage: mock(() => ({ tokens: 0, contextWindow: 1, percent: 0 })),
        getSessionMetadata: mock(async () => null),
        getSessionEntries: mock(async () => []),
        getSessionBranch: mock(async () => []),
        getLeafId: mock(async () => null),
        getSkills: mock(async () => []),
        abort: mock(() => {}),
        clearAllQueues: mock(() => {}),
        reset: mock(() => {}),
      },
    });
    expect(result.success).toBe(true);
    expect(skill).toHaveBeenCalledWith("whyj-quant", "focus on portfolio review");
  });

  it("treats session and compact as local commands", () => {
    expect(isLocalSlashCommand("session")).toBe(true);
    expect(isLocalSlashCommand("compact")).toBe(true);
    expect(isLocalSlashCommand("skill")).toBe(true);
    expect(isLocalSlashCommand("portfolio")).toBe(true);
    expect(isLocalSlashCommand("panel")).toBe(true);
  });
});

describe("catalog", () => {
  it("lists subcommands for workflow commands", () => {
    const data = COMMAND_CATALOG.find((entry) => entry.name === "/data");
    expect(data?.subcommands).toContain("download");
    expect(data?.subcommands).toContain("info");
  });

  it("lists portfolio management commands", () => {
    const portfolio = COMMAND_CATALOG.find((entry) => entry.name === "/portfolio");
    const panel = COMMAND_CATALOG.find((entry) => entry.name === "/panel");
    expect(portfolio?.subcommands).toEqual(["add", "list", "remove"]);
    expect(panel?.compatibility).toBe(true);
  });
});
