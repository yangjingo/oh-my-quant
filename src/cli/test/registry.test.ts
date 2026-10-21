import { describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { buildCommandHelpText, COMMAND_CATALOG } from "../catalog.ts";
import { executeCommand, isLocalSlashCommand, parseCommand } from "../registry.ts";

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
    const cmd = parseCommand("/portfolio --force");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("portfolio");
    expect(cmd!.flags.force).toBe(true);
  });

  it("parses command with numeric flag", () => {
    const cmd = parseCommand("/portfolio use --index 2 --limit 60");
    expect(cmd).not.toBeNull();
    expect(cmd!.flags.index).toBe("2");
    expect(cmd!.flags.limit).toBe("60");
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

  it("parses /doctor", () => {
    const cmd = parseCommand("/doctor");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("doctor");
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

  it("does not expose quant tools as slash commands", async () => {
    for (const command of ["/factor list", "/backtest run --symbol 000001.SZ", "/risk check --symbol 000001.SZ", "/benchmark dashboard"]) {
      const result = await executeCommand(parseCommand(command)!);
      expect(result.success).toBe(false);
      expect(result.message).toContain("Unknown");
    }
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

  it("waits for the agent before compacting while active", async () => {
    const waitForIdle = mock(async () => {});
    const compact = mock(async () => ({
      summary: "Compacted after idle",
      firstKeptEntryId: "e3",
      tokensBefore: 2345,
    }));
    const result = await executeCommand(parseCommand("/compact")!, {
      agentSession: {
        state: {
          systemPrompt: "",
          model: { id: "openai/gpt-5.5", name: "gpt-5.5", api: "responses", provider: "openai", baseUrl: "", reasoning: false, input: [], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 8_000 },
          thinkingLevel: "off",
          tools: [],
          messages: [],
          isStreaming: true,
          thinkingText: "",
          pendingToolCalls: new Set<string>(),
        },
        subscribe: mock(() => () => {}),
        prompt: mock(async () => {}),
        waitForIdle,
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
    expect(waitForIdle).toHaveBeenCalled();
    expect(compact).toHaveBeenCalledWith(undefined);
    expect(result.message).toContain("Compacted");
  });

  it("treats nothing-to-compact as a non-error status", async () => {
    const compact = mock(async () => {
      throw new Error("Nothing to compact");
    });
    const result = await executeCommand(parseCommand("/compact")!, {
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
    expect(result.message).toContain("Nothing to compact");
  });

  it("returns openConfig effect when callback provided", async () => {
    const result = await executeCommand(parseCommand("/config")!, {
      openConfig: () => {},
    });
    expect(result.success).toBe(true);
    expect(result.effects).toEqual([{ type: "openConfig" }]);
  });

  it("runs doctor as a local slash command", async () => {
    const previous = process.env.WHYJ_DOCTOR_SKIP_NETWORK;
    const previousPython = process.env.WHYJ_PYTHON;
    process.env.WHYJ_DOCTOR_SKIP_NETWORK = "1";
    process.env.WHYJ_PYTHON = "whyj-intentionally-missing-registry-python";
    let result: Awaited<ReturnType<typeof executeCommand>>;
    try {
      result = await executeCommand(parseCommand("/doctor")!);
    } finally {
      if (previous === undefined) delete process.env.WHYJ_DOCTOR_SKIP_NETWORK;
      else process.env.WHYJ_DOCTOR_SKIP_NETWORK = previous;
      if (previousPython === undefined) delete process.env.WHYJ_PYTHON;
      else process.env.WHYJ_PYTHON = previousPython;
    }
    expect(result.success).toBe(true);
    expect(result.message).toContain("whyj doctor");
    expect(result.message).toContain("Credentials");
    expect(result.message).toContain("value");
    expect(result.data).toEqual(expect.objectContaining({
      ready: true,
      auth: expect.any(Object),
      config: expect.any(Object),
      hints: expect.any(Array),
    }));
  });

  it("treats resume, compact, and doctor as local commands", () => {
    expect(isLocalSlashCommand("resume")).toBe(true);
    expect(isLocalSlashCommand("compact")).toBe(true);
    expect(isLocalSlashCommand("portfolio")).toBe(true);
    expect(isLocalSlashCommand("doctor")).toBe(true);
  });

  it("normalizes /session to /resume for backward compatibility", () => {
    const cmd = parseCommand("/session");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("resume");
    expect(cmd!.raw).toBe("/session");
  });
});

describe("catalog", () => {
  it("keeps one descriptive entry for every public slash command", () => {
    expect(COMMAND_CATALOG).toEqual([
      { name: "/compact", desc: "Compact research session context" },
      { name: "/resume", desc: "Resume saved research sessions" },
      { name: "/portfolio", desc: "Manage observation portfolios" },
      { name: "/config", desc: "Configure models and research data" },
      { name: "/doctor", desc: "Check model and market data readiness" },
      { name: "/skill", desc: "Download, load, and run skills" },
      { name: "/mcp", desc: "Choose and manage MCP presets for Pi" },
      { name: "/help", desc: "Browse commands and shortcuts" },
      { name: "/clear", desc: "Reset the current research session" },
      { name: "/artifact", desc: "Browse and restore research reports" },
      { name: "/exit", desc: "Exit WhyJ Quant" },
    ]);
    for (const entry of COMMAND_CATALOG) {
      expect(Object.keys(entry).sort()).toEqual(["desc", "name"]);
      expect(entry.desc.length).toBeGreaterThanOrEqual(15);
      expect(entry.desc.length).toBeLessThanOrEqual(40);
      expect(entry.desc).toMatch(/^[A-Z]/);
      expect(entry.desc.endsWith(".")).toBe(false);
    }
  });

  it("renders compact command help text", () => {
    const help = buildCommandHelpText();
    expect(help).toContain("Commands");
    expect(help).toContain("/config");
    expect(help).toContain("/doctor");
    expect(help).toContain("Browse and restore research reports");
    expect(help).not.toContain("/factor");
    expect(help).not.toContain("/backtest");
    expect(help).not.toContain("/risk");
    expect(help).not.toContain("/benchmark");
    expect(help).toContain("No / prefix");
    expect(help).not.toContain("Commands:");
  });

  it("keeps portfolio as a single catalog entry", () => {
    const portfolio = COMMAND_CATALOG.find((entry) => entry.name === "/portfolio");
    expect(portfolio).toEqual({ name: "/portfolio", desc: "Manage observation portfolios" });
  });

  it("keeps resume as a single catalog entry", () => {
    const resume = COMMAND_CATALOG.find((entry) => entry.name === "/resume");
    expect(resume).toEqual({ name: "/resume", desc: "Resume saved research sessions" });
  });

  it("keeps artifact as a single panel entry", () => {
    const artifact = COMMAND_CATALOG.find((entry) => entry.name === "/artifact");
    expect(artifact).toEqual({ name: "/artifact", desc: "Browse and restore research reports" });
  });

  it("does not list /session in the public slash catalog", () => {
    expect(COMMAND_CATALOG.some((entry) => entry.name === "/session")).toBe(false);
  });

  it("lists doctor in the public slash catalog", () => {
    expect(COMMAND_CATALOG.some((entry) => entry.name === "/doctor")).toBe(true);
  });

  it("keeps the user-facing command references aligned with the catalog", () => {
    const readme = readFileSync("README.md", "utf8");
    const manual = readFileSync("docs/quant-harness/product-guide.md", "utf8");
    const advertisedCommands = [...readme.matchAll(/`(\/[a-z-]+)`/g)].map(match => match[1]!);
    expect(advertisedCommands.length).toBeGreaterThan(0);
    for (const command of advertisedCommands) {
      expect(COMMAND_CATALOG.some(entry => entry.name === command)).toBe(true);
    }
    expect(readme).toContain("(./docs/quant-harness/product-guide.md#commands)");
    for (const entry of COMMAND_CATALOG) {
      expect(manual).toContain(`\`${entry.name}\``);
      expect(manual).toContain(entry.desc);
    }

    expect(manual).toContain("`/artifact` 不接受参数或子命令");
    expect(manual).toContain("只能在 `/config` 中开启 `Auto Artifacts`");
    expect(manual).toContain("`/session` 仅作为旧输入兼容别名");
  });
});
