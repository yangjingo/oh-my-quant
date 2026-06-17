import { buildCommandHelpText } from "../catalog.ts";
import type { CommandContext, CommandHandler, CommandResult } from "../types.ts";

function mark(ok: boolean): string {
  return ok ? "✓" : "○";
}

export const helpHandler: CommandHandler = async (_flags, _positional, ctx) => {
  if (ctx.openHelp) {
    return { success: true, message: "", effects: [{ type: "openHelp" }] };
  }
  return { success: true, message: buildCommandHelpText() };
};

export const clearHandler: CommandHandler = async () => ({
  success: true,
  message: "",
  renderAs: "text",
  effects: [{ type: "clearConversation" }, { type: "resetAgent" }],
});

export const compactHandler: CommandHandler = async (_flags, positional, ctx) => {
  const agent = ctx.agentSession;
  if (!agent) {
    return { success: false, message: "Agent session is not initialized yet." };
  }
  const customInstructions = positional.join(" ").trim() || undefined;
  let result: Awaited<ReturnType<typeof agent.compact>>;
  try {
    await agent.waitForIdle();
    result = await agent.compact(customInstructions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Nothing to compact")) {
      return {
        success: true,
        message: "Nothing to compact. The current session is already within the compaction window.",
      };
    }
    if (message.includes("requires idle harness") || message.includes("AgentHarness is busy")) {
      return {
        success: false,
        message: "Agent is still finalizing the current turn. Try /compact again after the tool/result output settles.",
      };
    }
    throw error;
  }
  return {
    success: true,
    message: [
      "Compacted",
      `first kept    ${result.firstKeptEntryId}`,
      `tokens before ${result.tokensBefore}`,
      "",
      result.summary,
    ].join("\n"),
    effects: [{ type: "compactSession" }, { type: "sessionChanged" }],
  };
};

export const configHandler: CommandHandler = async (_flags, _positional, ctx) => {
  if (ctx.openConfig) {
    return { success: true, message: "", effects: [{ type: "openConfig" }] };
  }
  const { loadSettings, SETTINGS_PATH } = await import("../../storage/index.ts");
  const { listLocalPortfolios } = await import("../../storage/local-portfolios.ts");
  const cfg = loadSettings();
  const env = cfg.env || {};
  const has = (k: string) => !!(env as Record<string, string | undefined>)[k];
  const activeFile = cfg.preferences.currentPortfolioFile;
  const activeName = listLocalPortfolios().find((item) => item.fileName === activeFile)?.name || activeFile;
  return {
    success: true,
    message: [
      "Config",
      `  Model ${cfg.model}  ·  Thinking ${cfg.thinkingLevel}  ·  Insight ${cfg.insightEnabled ? "on" : "off"}`,
      `  Active portfolio  ${activeName}`,
      `  Providers  ${mark(has("DEEPSEEK_API_KEY"))} DeepSeek  ${mark(has("ZAI_API_KEY"))} ZAI  ${mark(has("MOONSHOT_API_KEY"))} Moonshot  ${mark(has("MINIMAX_CN_API_KEY"))} MiniMax`,
      `  Data       ${mark(has("TUSHARE_TOKEN"))} Tushare  ${mark(has("FINANCIAL_DATASETS_KEY"))} Financial Datasets  ${mark(has("LLMQUANT_API_KEY"))} LLMQuant`,
      `  Path       ${SETTINGS_PATH}`,
      "  Ctrl+P opens the settings panel",
    ].join("\n"),
  };
};

export const portfolioHandler: CommandHandler = async (_flags, positional, ctx) => {
  if (positional.length === 0 && ctx.openPortfolio) {
    return { success: true, message: "", effects: [{ type: "openPortfolio" }] };
  }
  if (positional[0] === "use" || positional[0] === "select") {
    const identifier = positional.slice(1).join(" ").trim();
    if (!identifier) return { success: false, message: "Use /portfolio use <name|file|index>" };
    const { loadSettings, saveSettings } = await import("../../storage/index.ts");
    const { syncPanelPortfolioFromLocalPortfolio } = await import("../../storage/portfolio.ts");
    const synced = syncPanelPortfolioFromLocalPortfolio(identifier);
    if (!synced) return { success: false, message: `Local portfolio not found: ${identifier}` };
    const cfg = loadSettings();
    cfg.preferences.currentPortfolioFile = synced.portfolio.fileName;
    saveSettings(cfg);
    return {
      success: true,
      message: [
        "Portfolio selected",
        `  name     ${synced.portfolio.name}`,
        `  file     ${synced.portfolio.fileName}`,
        `  symbols  ${synced.symbols.length}`,
      ].join("\n"),
      effects: [{ type: "portfolioChanged" }],
    };
  }
  if (positional.length > 0) {
    return {
      success: false,
      message: "Portfolio panel is read-only. Use /portfolio use <name|file|index> to switch local portfolios.",
    };
  }
  const { listLocalPortfolios } = await import("../../storage/local-portfolios.ts");
  const portfolios = listLocalPortfolios();
  if (portfolios.length === 0) {
    return { success: true, message: "No local portfolio files found." };
  }
  const lines = portfolios.map((portfolio, index) =>
    `  ${index + 1}. ${portfolio.name}  ·  ${portfolio.count} funds  ·  ${portfolio.updated || "-"}`,
  );
  return {
    success: true,
    message: ["Local portfolios", ...lines].join("\n"),
  };
};

export const marketHandler: CommandHandler = async (_flags, positional) => {
  const action = positional[0] || "refresh";
  if (action !== "refresh") {
    return { success: false, message: "Use /market" };
  }
  return { success: true, message: "Overview refreshed." };
};

export const resumeHandler: CommandHandler = async (_flags, positional, ctx) => {
  const action = positional[0]?.trim();
  if (!action) {
    if (ctx.openResume) {
      return { success: true, message: "", effects: [{ type: "openResume" }] };
    }
  }

  const agent = ctx.agentSession;
  if (!agent) {
    return { success: false, message: "Agent session is not initialized yet." };
  }

  if (!action) {
    const sessions = await agent.listSessions();
    const current = await agent.getSessionMetadata();
    const lines = sessions.slice(0, 10).map((session, index) => {
      const active = current?.id === session.id ? "*" : " ";
      return `${active}${index + 1}. ${session.id}  ${session.createdAt}  ${session.path}`;
    });
    return {
      success: true,
      message: lines.length > 0
        ? ["Saved sessions", ...lines, "Use /resume <sessionId> to switch sessions"].join("\n")
        : "No saved sessions found.",
    };
  }

  const metadata = await agent.resumeSession(action);
  return {
    success: true,
    message: [
      "Resumed",
      `id: ${metadata.id}`,
      `created: ${metadata.createdAt}`,
      `cwd: ${metadata.cwd}`,
      `file: ${metadata.path}`,
    ].join("\n"),
    effects: [{ type: "sessionChanged" }],
  };
};

export const sessionHandler: CommandHandler = async (_flags, _positional, ctx) => {
  if (ctx.openSession) {
    return { success: true, message: "", effects: [{ type: "openSession" }] };
  }
  const agent = ctx.agentSession;
  if (!agent) {
    return { success: false, message: "Agent session is not initialized yet." };
  }
  const [metadata, usage] = await Promise.all([
    agent.getSessionMetadata(),
    Promise.resolve(agent.getContextUsage()),
  ]);
  if (!metadata) {
    return { success: false, message: "No active session metadata available." };
  }
  return {
    success: true,
    message: [
      "Session",
      `  id          ${metadata.id}`,
      `  created     ${metadata.createdAt}`,
      `  cwd         ${metadata.cwd}`,
      `  file        ${metadata.path}`,
      usage
        ? `  context     ${usage.tokens}/${usage.contextWindow} tokens${usage.percent !== null ? `  (${usage.percent.toFixed(1)}%)` : ""}`
        : "  context     unavailable",
    ].join("\n"),
  };
};
export const exitHandler = (): CommandResult => ({ success: true, message: "Goodbye." });
