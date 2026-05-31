/**
 * Slash command parser and dispatcher.
 * / prefix → direct execution.  No prefix → AI Agent.
 */
import type { CommandResult } from "../types/messages.ts";

export interface ParsedCommand {
  command: string;
  subcommand?: string;
  raw: string;
  flags: Record<string, string | number | boolean>;
}

export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const parts = trimmed.slice(1).split(/\s+/);
  if (parts.length === 0) return null;
  const command = parts[0];
  let subcommand: string | undefined;
  let flagIdx = 1;
  if (parts.length > 1 && !parts[1].startsWith("--")) {
    subcommand = parts[1]; flagIdx = 2;
  }
  const flags: Record<string, string | number | boolean> = {};
  for (let i = flagIdx; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith("--")) {
      const key = part.slice(2);
      if (i + 1 < parts.length && !parts[i + 1].startsWith("--")) {
        i++; const val = parts[i];
        const num = Number(val);
        flags[key] = isNaN(num) ? val : num;
      } else flags[key] = true;
    }
  }
  return { command, subcommand, raw: trimmed, flags };
}

export async function executeCommand(cmd: ParsedCommand): Promise<CommandResult> {
  const { command, subcommand = "", flags } = cmd;
  switch (command) {
    case "mcp":       return mcpHandler(subcommand);
    case "config":    return configHandler(subcommand, flags);
    case "benchmark": return benchmarkHandler(subcommand, flags);
    case "help":      return { success: true, message: HELP_TEXT };
    case "clear":     return { success: true, message: "", renderAs: "text" };
    case "exit": case "quit": return { success: true, message: "Goodbye.", renderAs: "text" };
    default:
      return { success: false, message: `Unknown /${command}. Try /help` };
  }
}

// ── MCP ──

async function mcpHandler(sub: string): Promise<CommandResult> {
  const { connectAll, getConnectedServers } = await import("../data/mcp-client.ts");
  if (sub === "connect") {
    await connectAll();
    const servers = getConnectedServers();
    return { success: true, message: servers.length > 0 ? `Connected: ${servers.join(", ")}` : "No servers connected (check .env)" };
  }
  const servers = getConnectedServers();
  return { success: true, message: servers.length > 0 ? `MCP: ${servers.join(", ")}` : "No MCP connected. Run /mcp connect" };
}

// ── Config (LLM API + MCP env) ──

async function configHandler(sub: string, flags: Record<string, string | number | boolean>): Promise<CommandResult> {
  const { loadConfig, saveConfig } = await import("../storage/index.ts");
  const config = loadConfig();

  if (sub === "show") {
    return {
      success: true,
      message: [
        `Current configuration (.ohquant/config.json):`,
        ``,
        `LLM:`,
        `  provider: anthropic`,
        `  model:    ${config.anthropic.model}`,
        `  thinking: ${config.anthropic.thinkingLevel}`,
        `  api_key:  ${config.anthropic.apiKey ? "***configured***" : "NOT SET (set ANTHROPIC_API_KEY in .env)"}`,
        ``,
        `MCP:`,
        `  enabled:  ${config.mcp.enabled}`,
        `  servers:  ${config.mcp.autoConnect ? "auto-connect" : "manual"}`,
        ``,
        `Environment (from .env / process.env):`,
        `  ANTHROPIC_API_KEY:      ${process.env["ANTHROPIC_API_KEY"] ? "✓ set" : "✗ NOT SET"}`,
        `  TUSHARE_TOKEN:          ${process.env["TUSHARE_TOKEN"] ? "✓ set" : "✗ NOT SET"}`,
        `  FINANCIAL_DATASETS_KEY: ${process.env["FINANCIAL_DATASETS_KEY"] ? "✓ set" : "✗ NOT SET"}`,
        `  LLMQUANT_API_KEY:       ${process.env["LLMQUANT_API_KEY"] ? "✓ set" : "✗ NOT SET"}`,
        ``,
        `Set env vars in .env file at project root.`,
        `MCP config at .claude/mcp.json`,
      ].join("\n"),
    };
  }

  if (sub === "model") {
    const model = String(flags.model || flags.m || "");
    if (!model) {
      return { success: true, message: `Current model: ${config.anthropic.model}\nUsage: /config model --model claude-sonnet-4-6` };
    }
    config.anthropic.model = model;
    saveConfig(config);
    return { success: true, message: `Model set to: ${model}` };
  }

  if (sub === "thinking") {
    const level = String(flags.level || flags.l || "");
    const valid = ["off", "minimal", "low", "medium", "high"];
    if (!level || !valid.includes(level)) {
      return { success: true, message: `Current thinking: ${config.anthropic.thinkingLevel}\nValid levels: ${valid.join(", ")}\nUsage: /config thinking --level medium` };
    }
    config.anthropic.thinkingLevel = level as typeof config.anthropic.thinkingLevel;
    saveConfig(config);
    return { success: true, message: `Thinking level: ${level}` };
  }

  // Default: show setup guide
  return {
    success: true,
    message: [
      `⚙️  Configuration Setup Guide`,
      `─────────────────────────────`,
      ``,
      `1. LLM API Key (required for AI agent):`,
      `   Create .env file at project root:`,
      `     ANTHROPIC_API_KEY=sk-ant-...`,
      ``,
      `2. MCP Data Sources (for market data):`,
      `   Add to .env:`,
      `     TUSHARE_TOKEN=your_token          # A-share data`,
      `     FINANCIAL_DATASETS_KEY=your_key   # US fundamentals`,
      `     LLMQUANT_API_KEY=your_key         # US prices + ETFs`,
      ``,
      `3. Check status: /config show`,
      `4. Set model:     /config model --model claude-sonnet-4-6`,
      `5. Connect MCP:   /mcp connect`,
      ``,
      `Config stored in: .ohquant/config.json`,
      `MCP servers defined in: .claude/mcp.json`,
      `Secrets in: .env (never commit to git)`,
    ].join("\n"),
  };
}

// ── Benchmark ──

async function benchmarkHandler(sub: string, flags: Record<string, string | number | boolean>): Promise<CommandResult> {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = join(process.cwd(), ".ohquant", "benchmark", "results");

  if (sub === "dashboard") {
    const { collectResults, dashboardSummary } = await import("../services/dashboard.ts");
    let files: string[] = [];
    try { files = readdirSync(dir).filter((f: string) => f.endsWith(".json")); } catch { files = []; }
    if (files.length === 0) return { success: true, message: "No benchmark results yet. Use the AI agent to run one:\n  'Run an SMA 20/60 backtest on 000001.SZ and score it'" };

    const results = files.map((f) => {
      try { return JSON.parse(readFileSync(join(dir, f), "utf-8")); } catch { return null; }
    }).filter(Boolean) as Record<string, unknown>[];
    const rows = collectResults(results);
    const s = dashboardSummary(rows);
    const sorted = [...rows].sort((a, b) => b.totalScore - a.totalScore).slice(0, 10);

    return {
      success: true,
      message: [
        `📋 Benchmark Dashboard · ${s.totalEvals} runs`,
        `Avg: ${s.avgScore}  Median: ${s.medianScore}  Best: ${s.bestStrategy} (${s.bestScore})`,
        `Grades: ${Object.entries(s.gradeDistribution).map(([g, n]) => `${g}:${n}`).join("  ")}`,
        `Avg Sharpe: ${s.avgSharpe}  Avg Max DD: ${(s.avgMaxDD * 100).toFixed(1)}%`,
        ``,
        `Top Results:`,
        ...sorted.map((r) => `  ${r.grade.padEnd(2)} ${r.strategy.padEnd(28)} score=${String(r.totalScore).padEnd(5)} sharpe=${r.sharpe}  dd=${(r.maxDrawdown * 100).toFixed(1)}%`),
      ].join("\n"),
    };
  }

  // Default: show latest portfolio benchmark summary
  let files: string[] = [];
  try { files = readdirSync(dir).filter((f: string) => f.startsWith("portfolio_") && f.endsWith(".json")); } catch { files = []; }
  if (files.length === 0) {
    return { success: true, message: "No portfolio benchmarks yet. Run /benchmark dashboard to see all results." };
  }

  const portfolioResults = files.map((f) => {
    try { return JSON.parse(readFileSync(join(dir, f), "utf-8")); } catch { return null; }
  }).filter(Boolean) as Record<string, unknown>[];

  const lines = [`Portfolio Benchmark Results:`];
  for (const r of portfolioResults.slice(-5)) {
    lines.push(`  ${String(r.strategy || "?").padEnd(40)} ${String(r.grade || "?")}  score=${r.total_score}  sharpe=${(r.details as Record<string, number>)?.sharpe || "?"}  dd=${((r.details as Record<string, number>)?.max_drawdown || 0).toFixed(2)}`);
  }
  return { success: true, message: lines.join("\n") };
}

const HELP_TEXT = `
Available commands:

  /benchmark         Portfolio benchmark summary
  /benchmark dashboard  Full benchmark results
  /benchmark run     Run new scoring (via AI agent)

  /config            Show configuration setup guide
  /config show       Show current config + env status
  /config model --model NAME   Set LLM model
  /config thinking --level L   Set thinking level

  /mcp connect       Connect to MCP data servers
  /mcp status        Show MCP connection status

  /help              Show this help
  /clear             Clear conversation
  /exit              Quit

  No / prefix → Chat with AI agent.
  "Run a 20/60 SMA backtest on 000001.SZ and score it"
`;
