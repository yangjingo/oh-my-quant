import { buildCommandHelpText } from "../catalog.ts";
import type { CommandContext, CommandHandler, CommandResult } from "../types.ts";

export const helpHandler: CommandHandler = async () => ({
  success: true,
  message: buildCommandHelpText(),
});

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
      "Session compacted.",
      `first_kept_entry: ${result.firstKeptEntryId}`,
      `tokens_before: ${result.tokensBefore}`,
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
  const cfg = loadSettings();
  const keys = cfg.env || {};
  const icon = (k: string) => (keys as Record<string, string | undefined>)[k] ? "✓" : "○";
  return {
    success: true,
    message: [
      `WhyJ Quant Config`,
      `────────────────────────────────────────────`,
      ``, `  1. Auth token                  [${icon("WHYJ_AUTH_TOKEN")}]`,
      ``, `  2. Tushare token              [${icon("TUSHARE_TOKEN")}]`,
      ``, `  3. Financial Datasets key     [${icon("FINANCIAL_DATASETS_KEY")}]`,
      ``, `  4. LLMQuant key               [${icon("LLMQUANT_API_KEY")}]`,
      ``, `  5. Model                      [${cfg.model}]`,
      ``, `  6. Thinking depth             [${cfg.thinkingLevel}]`,
      ``, `  7. Insight                    [${cfg.insightEnabled ? "on" : "off"}]`,
      ``, `────────────────────────────────────────────`,
      `ConfigPanel (Ctrl+P): model / thinking / insight / overview symbols`,
      `Setup keys: /setup`,
      `Settings file: ${SETTINGS_PATH}`,
    ].join("\n"),
  };
};

const SETUP_KEY_MAP: Record<string, string> = {
  auth: "WHYJ_AUTH_TOKEN",
  whyj: "WHYJ_AUTH_TOKEN",
  tushare: "TUSHARE_TOKEN",
  fd: "FINANCIAL_DATASETS_KEY",
  financial: "FINANCIAL_DATASETS_KEY",
  llmquant: "LLMQUANT_API_KEY",
};

export const setupHandler: CommandHandler = async (_flags, positional) => {
  const { loadSettings, saveSettings, SETTINGS_PATH } = await import("../../storage/index.ts");
  const cfg = loadSettings();
  const keys = cfg.env || {};
  const icon = (k: string) => (keys as Record<string, string | undefined>)[k] ? "✓" : "○";
  const target = positional[0]?.toLowerCase();

  if (!target) {
    return {
      success: true,
      message: [
        "Setup",
        "────────────────────────────────────────────",
        `whyj       ${icon("WHYJ_AUTH_TOKEN")}  /setup whyj <token>`,
        `tushare    ${icon("TUSHARE_TOKEN")}  /setup tushare <token>`,
        `fd         ${icon("FINANCIAL_DATASETS_KEY")}  /setup fd <token>`,
        `llmquant   ${icon("LLMQUANT_API_KEY")}  /setup llmquant <token>`,
        "",
        `Settings file: ${SETTINGS_PATH}`,
      ].join("\n"),
    };
  }

  const envKey = SETUP_KEY_MAP[target];
  if (!envKey) {
    return { success: false, message: "Usage: /setup | /setup whyj <token> | /setup tushare <token> | /setup fd <token> | /setup llmquant <token>" };
  }

  const value = positional.slice(1).join(" ").trim();
  if (!value) {
    return {
      success: true,
      message: `${envKey}: ${(keys as Record<string, string | undefined>)[envKey] ? "configured" : "not set"}\nUsage: /setup ${target} <token>`,
    };
  }

  cfg.env = { ...cfg.env, [envKey]: value };
  saveSettings(cfg);
  return {
    success: true,
    message: `Saved ${envKey} to ${SETTINGS_PATH}.`,
  };
};

export const portfolioHandler: CommandHandler = async (flags, positional, _ctx) => {
  const { loadPanelPortfolio, savePanelPortfolio } = await import("../../storage/panel-portfolio.ts");
  const panel = loadPanelPortfolio();
  const action = positional[0] || "list";

  if (action === "add") {
    const code = String(flags.code || flags.symbol || flags.c || positional[1] || "");
    if (!code) return { success: false, message: "Usage: /portfolio add 510300.SH --name 沪深300ETF" };
    if (panel.symbols.some((entry) => entry.code === code)) {
      return { success: false, message: `${code} already in panel portfolio.` };
    }
    const name = flags.name ? String(flags.name) : code;
    panel.symbols.push({ code, name, added: new Date().toISOString().slice(0, 10) });
    savePanelPortfolio(panel);
    return { success: true, message: `Added ${name} (${code}) to panel portfolio.` };
  }

  if (action === "remove") {
    const code = String(flags.code || flags.symbol || flags.c || positional[1] || "");
    if (!code) return { success: false, message: "Usage: /portfolio remove 510300.SH" };
    const before = panel.symbols.length;
    panel.symbols = panel.symbols.filter((entry) => entry.code !== code);
    if (panel.symbols.length === before) return { success: false, message: `${code} not in panel portfolio.` };
    savePanelPortfolio(panel);
    return { success: true, message: `Removed ${code} from panel portfolio.` };
  }

  if (action !== "list") {
    return { success: false, message: "Usage: /portfolio add CODE [--name NAME] | /portfolio list | /portfolio remove CODE" };
  }

  if (panel.symbols.length === 0) {
    return {
      success: true,
      message: "Panel portfolio empty. Use /portfolio add CODE [--name NAME] or open Ctrl+P.",
    };
  }

  const lines = panel.symbols.map(
    (entry, i) => `  ${i + 1}. ${entry.code.padEnd(14)} ${entry.name.padEnd(16)}  (${entry.added})`,
  );
  return {
    success: true,
    message: [`Panel portfolio (${panel.symbols.length}) · .ohquant/panel-portfolio.json`, ...lines].join("\n"),
  };
};

export const mcpHandler: CommandHandler = async (_flags, positional) => {
  const { connectAll, getConnectedServers } = await import("../../source/mcp-client.ts");
  if (positional[0] === "connect") {
    await connectAll();
    const s = getConnectedServers();
    return { success: true, message: s.length > 0 ? `Connected: ${s.join(", ")}` : "No servers connected. Set keys via /config." };
  }
  const s = getConnectedServers();
  return { success: true, message: s.length > 0 ? `MCP: ${s.join(", ")}` : "No MCP connections. Use /mcp → Connect all servers." };
};

export const marketHandler: CommandHandler = async (_flags, positional) => {
  const action = positional[0] || "refresh";
  if (action !== "refresh") {
    return { success: false, message: "Usage: /market | /market refresh" };
  }
  return { success: true, message: "Overview refreshed." };
};

export const sessionHandler: CommandHandler = async (_flags, positional, ctx) => {
  const agent = ctx.agentSession;
  if (!agent) {
    return { success: false, message: "Agent session is not initialized yet." };
  }

  const action = positional[0] || "info";
  if (action === "compact") {
    return compactHandler(_flags, positional.slice(1), ctx);
  }

  if (action === "reset") {
    return {
      success: true,
      message: "Session reset.",
      effects: [{ type: "clearConversation" }, { type: "resetAgent" }],
    };
  }

  if (action === "entries") {
    const entries = await agent.getSessionEntries();
    const rows = entries.slice(-20).map((entry) => {
      const preview = entry.type === "message"
        ? extractEntryPreview(entry.message)
        : entry.type === "branch_summary"
          ? entry.summary
          : entry.type;
      return `${entry.id}  ${entry.type.padEnd(16)} ${preview.slice(0, 80)}`;
    });
    return {
      success: true,
      message: rows.length > 0
        ? ["Recent session entries", "────────────────────────────────────────────", ...rows].join("\n")
        : "No session entries yet.",
    };
  }

  if (action === "goto") {
    const targetId = positional[1];
    if (!targetId) {
      return { success: false, message: "Usage: /session goto <entryId>" };
    }
    const result = await agent.navigateTree(targetId);
    return {
      success: true,
      message: [
        `Moved session leaf to ${targetId}.`,
        result.editorText ? `editor_text: ${result.editorText}` : "editor_text: (none)",
      ].join("\n"),
    };
  }

  if (action !== "info") {
    return { success: false, message: "Usage: /session | /session info | /session entries | /session goto <entryId> | /session compact [instructions] | /session reset" };
  }

  const [metadata, entries, leafId] = await Promise.all([
    agent.getSessionMetadata(),
    agent.getSessionEntries(),
    agent.getLeafId(),
  ]);
  const usage = agent.getContextUsage();

  return {
    success: true,
    message: [
      "Session",
      "────────────────────────────────────────────",
      `id: ${metadata?.id ?? "unknown"}`,
      `cwd: ${metadata?.cwd ?? "unknown"}`,
      `file: ${metadata?.path ?? "unknown"}`,
      `entries: ${entries.length}`,
      `leaf: ${leafId ?? "root"}`,
      `context_tokens: ${usage?.tokens ?? "unknown"}`,
      `context_window: ${usage?.contextWindow ?? "unknown"}`,
      `context_percent: ${usage?.percent?.toFixed(2) ?? "unknown"}`,
    ].join("\n"),
  };
};

export const exitHandler = (): CommandResult => ({ success: true, message: "Goodbye." });

function extractEntryPreview(message: unknown): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part): part is { type: string; text?: string } => typeof part === "object" && part !== null)
      .filter((part) => part.type === "text" && !!part.text)
      .map((part) => part.text!)
      .join("");
  }
  return "";
}
