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

export const hotkeysHandler: CommandHandler = async (_flags, _positional, ctx) => {
  if (ctx.openHotkeys) {
    return { success: true, message: "", effects: [{ type: "openHotkeys" }] };
  }
  return {
    success: true,
    message: [
      "Hotkeys",
      "  Ctrl+P     Open settings",
      "  Enter      Submit input",
      "  Tab        Accept slash suggestion",
      "  Esc        Clear input / close panel",
      "  Ctrl+C     Clear input or quit",
      "  PgUp/Down  Scroll conversation",
      "  Shift+PgUp/PgDown  Scroll overview",
    ].join("\n"),
  };
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
  const result = await agent.compact(customInstructions);
  return {
    success: true,
    message: [
      "Compacted",
      `first kept    ${result.firstKeptEntryId}`,
      `tokens before ${result.tokensBefore}`,
      "",
      result.summary,
    ].join("\n"),
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
  if (positional.length > 0) {
    return {
      success: false,
      message: "Portfolio panel is read-only. Ask the agent to read/write local portfolio files instead.",
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
