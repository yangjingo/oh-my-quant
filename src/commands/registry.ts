/**
 * Slash command parser and dispatcher.
 * / prefix → direct execution.  No prefix → AI Agent.
 */
import type { CommandResult } from "../types/messages.ts";

export interface ParsedCommand {
  command: string; subcommand?: string; raw: string;
  flags: Record<string, string | number | boolean>;
  _raw: string[];
}

export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const parts = trimmed.slice(1).split(/\s+/);
  if (parts.length === 0) return null;
  const command = parts[0];
  let subcommand: string | undefined;
  let flagIdx = 1;
  if (parts.length > 1 && !parts[1].startsWith("--")) { subcommand = parts[1]; flagIdx = 2; }
  const flags: Record<string, string | number | boolean> = {};
  const positional: string[] = [];
  for (let i = flagIdx; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith("--")) {
      const key = part.slice(2);
      if (i + 1 < parts.length && !parts[i + 1].startsWith("--")) {
        i++; const val = parts[i]; const num = Number(val);
        flags[key] = isNaN(num) ? val : num;
      } else flags[key] = true;
    } else {
      positional.push(part);
    }
  }
  return { command, subcommand, raw: trimmed, flags, _raw: positional };
}

export async function executeCommand(cmd: ParsedCommand): Promise<CommandResult> {
  const { command, subcommand = "", flags, _raw } = cmd;
  switch (command) {
    case "skill":     return skillHandler(subcommand, flags);
    case "claw":      return clawHandler(subcommand, flags);
    case "add":       return addHandler(subcommand, flags);
    case "config":    return configHandler(subcommand, flags, _raw);
    case "benchmark": return benchmarkHandler(subcommand);
    case "mcp":       return mcpHandler(subcommand);
    case "help":      return { success: true, message: HELP_TEXT };
    case "clear":     return { success: true, message: "", renderAs: "text" };
    case "exit": case "quit": return { success: true, message: "Goodbye." };
    default:
      return { success: false, message: `Unknown /${command}. Try /help` };
  }
}

// ── /skill — Manage and trigger skills/tools ──

interface SkillEntry {
  name: string;
  label: string;
  description: string;
  category: "data" | "factor" | "backtest" | "risk" | "benchmark" | "portfolio" | "system";
  triggerable: boolean;
}

const BUILTIN_SKILLS: SkillEntry[] = [
  { name: "fetch_bars", label: "📥 Download", description: "Download OHLCV price data for any symbol", category: "data", triggerable: true },
  { name: "compute_factor", label: "📊 Factor", description: "Compute momentum, reversal, volatility, RSI, SMA deviation", category: "factor", triggerable: true },
  { name: "run_backtest", label: "📈 Backtest", description: "SMA crossover backtest with full metrics", category: "backtest", triggerable: true },
  { name: "check_risk", label: "⚠️ Risk", description: "VaR, CVaR, max drawdown, Sharpe, skewness, kurtosis", category: "risk", triggerable: true },
  { name: "score_benchmark", label: "🏆 Score", description: "3-dimension strategy evaluation (100-point scale)", category: "benchmark", triggerable: true },
  { name: "show_dashboard", label: "📋 Dashboard", description: "Aggregated benchmark results viewer", category: "benchmark", triggerable: true },
];

async function skillHandler(sub: string, flags: Record<string, string | number | boolean>): Promise<CommandResult> {
  if (sub === "list") {
    const category = String(flags.category || flags.c || "");
    const filtered = category
      ? BUILTIN_SKILLS.filter((s) => s.category === category)
      : BUILTIN_SKILLS;

    if (filtered.length === 0) {
      return { success: true, message: `No skills in category "${category}".\nCategories: data, factor, backtest, risk, benchmark, portfolio, system` };
    }

    const byCat: Record<string, SkillEntry[]> = {};
    for (const s of filtered) {
      byCat[s.category] = byCat[s.category] || [];
      byCat[s.category].push(s);
    }

    const lines: string[] = ["📦 Available Skills", "──────────────────"];
    for (const [cat, skills] of Object.entries(byCat)) {
      lines.push(`\n${cat}:`);
      for (const s of skills) {
        lines.push(`  ${s.label.padEnd(4)} /skill trigger --name ${s.name.padEnd(18)} ${s.description}`);
      }
    }
    lines.push("", "Trigger: /skill trigger --name fetch_bars --code 000001.SZ");
    lines.push("Install more skills from the community or add custom tools.");
    return { success: true, message: lines.join("\n") };
  }

  if (sub === "info") {
    const name = String(flags.name || "");
    const skill = BUILTIN_SKILLS.find((s) => s.name === name);
    if (!skill) return { success: false, message: `Skill "${name}" not found. Use /skill list to see all.` };
    return { success: true, message: [
      `${skill.label}  ${skill.name}`,
      `─────────────────────`,
      `Category:    ${skill.category}`,
      `Description: ${skill.description}`,
      `Triggerable: ${skill.triggerable ? "yes" : "no"}`,
      ``,
      `Trigger: /skill trigger --name ${skill.name} --code CODE`,
    ].join("\n") };
  }

  if (sub === "trigger") {
    const name = String(flags.name || flags.skill || "");
    if (!name) return { success: false, message: "Usage: /skill trigger --name fetch_bars --code 000001.SZ" };

    const skill = BUILTIN_SKILLS.find((s) => s.name === name);
    if (!skill) return { success: false, message: `Unknown skill: ${name}. Use /skill list` };
    if (!skill.triggerable) return { success: false, message: `${name} cannot be triggered directly (use via AI Agent)` };

    try {
      const { QUANT_TOOLS } = await import("../tools/quant-tools.ts");
      const tool = QUANT_TOOLS.find((t) => t.name === name);
      if (!tool) return { success: false, message: `Tool "${name}" not registered.` };

      // Build params from flags, remapping common flag→param names
      const params: Record<string, unknown> = {};
      const remap: Record<string, string> = {
        code: "symbol", c: "symbol", symbol: "symbol",
        market: "market", m: "market",
        factor: "factor", f: "factor",
        period: "period", p: "period",
        fast: "fast", slow: "slow",
        cash: "cash",
        benchmark: "benchmark_symbol", "benchmark-symbol": "benchmark_symbol",
        label: "label", l: "label",
        start: "start", end: "end",
      };
      for (const [k, v] of Object.entries(flags)) {
        if (k === "name" || k === "skill") continue;
        const mappedKey = remap[k] || k;
        if (typeof v === "string" && !isNaN(Number(v))) params[mappedKey] = Number(v);
        else params[mappedKey] = v;
      }

      // Use prepareArguments if available, otherwise pass params directly
      const preparedParams = tool.prepareArguments ? tool.prepareArguments(params) : params;
      const result = await tool.execute(`cli-${Date.now()}`, preparedParams, undefined);
      const text = result.content.map((c) => ("text" in c ? c.text : "[image]")).join("\n");
      return { success: true, message: text };
    } catch (err) {
      return { success: false, message: `Skill execution failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (sub === "install") {
    const name = String(flags.name || "");
    if (!name) return { success: false, message: "Usage: /skill install --name SKILL_NAME\nSkills are installed as npm packages or local modules." };
    return { success: true, message: [
      `To install a new skill:`,
      ``,
      `1. Create a skill file in src/tools/ following the AgentTool pattern`,
      `2. Register it in src/tools/quant-tools.ts QUANT_TOOLS array`,
      `3. Add it to BUILTIN_SKILLS in src/commands/registry.ts`,
      ``,
      `Skill "${name}" must be installed manually for now.`,
      `See docs/agent-system-spec.md for the tool definition format.`,
    ].join("\n") };
  }

  // Default
  return { success: true, message: [
    "/skill list                       List all skills",
    "/skill list --category factor     Filter by category",
    "/skill info --name fetch_bars     Show skill details",
    "/skill trigger --name fetch_bars --code 000001.SZ   Execute directly",
    "/skill install --name NAME        Install a new skill",
  ].join("\n") };
}

// ── /claw — Snapshot a stock or fund ──

async function clawHandler(sub: string, flags: Record<string, string | number | boolean>): Promise<CommandResult> {
  const code = String(flags.code || flags.symbol || flags.c || sub || "");
  if (!code) {
    return { success: false, message: "Usage: /claw --code 000001.SZ\n  or: /claw --code AAPL --market US" };
  }
  const market = String(flags.market || flags.m || "A");

  // Offline fallback: check .ohquant/ cache first
  let cachedBars: { date: string; close: number; open: number; high: number; low: number; volume: number }[] = [];
  let cachedName = code;
  try {
    const { loadBars, getMeta } = await import("../storage/bars.ts");
    const meta = await getMeta(code, "tushare");
    if (meta) {
      cachedName = meta.name;
      cachedBars = await loadBars(code, "tushare");
    }
  } catch { /* no cache */ }

  // If we have cached bars, show basic snapshot even when MCP is offline
  if (cachedBars.length > 0) {
    const last = cachedBars[cachedBars.length - 1];
    const first = cachedBars[0];
    const returns = cachedBars.slice(1).map((b, i) => b.close / cachedBars[i].close - 1);
    const posDays = returns.filter((r) => r > 0).length;
    const winRate = returns.length > 0 ? (posDays / returns.length * 100).toFixed(0) : "?";

    // Try MCP for richer data, but don't block on it
    let mcpExtra = "";
    try {
      const { callTool } = await import("../data/mcp-client.ts");
      if (market === "A") {
        try {
          const basic = await callTool("tushare", "daily_basic", { ts_code: code, trade_date: "" });
          const arr = Array.isArray(basic) ? basic : [];
          if (arr.length > 0) {
            const s = arr[arr.length - 1] as Record<string, unknown>;
            mcpExtra = [
              `PE (TTM):    ${s.pe ?? s.pe_ttm ?? "?"}`,
              `PB:          ${s.pb ?? "?"}`,
              `Market Cap:  ${Number(s.total_mv ?? s.circ_mv ?? 0).toLocaleString?.() ?? "?"} CNY`,
            ].join("\n");
          }
        } catch { /* MCP unavailable, offline fallback is fine */ }
      }
    } catch { /* MCP client not connected */ }

    return {
      success: true,
      message: [
        `📊 ${cachedName} (${code})`,
        `─────────────────────────────────`,
        `Range:       ${first.date} → ${last.date} (${cachedBars.length} days)`,
        `Latest:      ${last.close.toFixed(2)}  (Open: ${last.open.toFixed(2)}  High: ${last.high.toFixed(2)}  Low: ${last.low.toFixed(2)})`,
        `Volume:      ${(last.volume / 1e6).toFixed(1)}M`,
        `Win Rate:    ${winRate}% (${posDays}/${returns.length} up days)`,
        mcpExtra,
        ``,
        mcpExtra ? "" : "💡 MCP offline — showing cached data. Run /mcp connect for live fundamentals.",
        `To analyze: "compute momentum and RSI for ${code}"`,
      ].filter(Boolean).join("\n"),
    };
  }

  // No cache — try live MCP
  try {
    if (market === "A") {
      const { callTool } = await import("../data/mcp-client.ts");
      let name = code;
      try {
        const basic = await callTool("tushare", "stock_basic", { ts_code: code });
        const arr = Array.isArray(basic) ? basic : [];
        if (arr.length > 0 && (arr[0] as Record<string, unknown>).name) {
          name = (arr[0] as Record<string, unknown>).name as string;
        }
      } catch { /* fallback */ }

      let snapshot: Record<string, unknown> = {};
      try {
        const basic = await callTool("tushare", "daily_basic", { ts_code: code, trade_date: "" });
        const arr = Array.isArray(basic) ? basic : [];
        if (arr.length > 0) snapshot = arr[arr.length - 1] as Record<string, unknown>;
      } catch { /* empty */ }

      return {
        success: true,
        message: [
          `📊 ${name} (${code})`,
          `─────────────────────────────────`,
          `Industry:    ${snapshot.industry ?? "?"}`,
          `Close:       ${snapshot.close ?? "?"}`,
          `PE (TTM):    ${snapshot.pe ?? snapshot.pe_ttm ?? "?"}`,
          `PB:          ${snapshot.pb ?? "?"}`,
          `Market Cap:  ${Number(snapshot.total_mv ?? snapshot.circ_mv ?? 0).toLocaleString?.() ?? "?"} CNY`,
          ``,
          `To analyze: "compute momentum and RSI for ${code}"`,
        ].join("\n"),
      };
    }

    // US stocks
    const { callTool } = await import("../data/mcp-client.ts");
    const facts = await callTool("financial-datasets", "get_company_facts", { ticker: code });
    const metrics = await callTool("financial-datasets", "get_financial_metrics_snapshot", { ticker: code });
    const f = (facts as Record<string, unknown>) || {};
    const m = (metrics as Record<string, unknown>) || {};
    return {
      success: true,
      message: [
        `📊 ${f.company_name || code} (${code})`,
        `─────────────────────────────────`,
        `Sector:      ${f.sector || "?"}  /  ${f.industry || "?"}`,
        `Market Cap:  $${(Number(m.market_cap) / 1e9).toFixed(1) ?? "?"}B`,
        `PE Ratio:    ${m.pe_ratio ?? "?"}`,
        `PB Ratio:    ${m.pb_ratio ?? "?"}`,
        `Dividend:    ${m.dividend_yield ? (Number(m.dividend_yield) * 100).toFixed(2) + "%" : "?"}`,
        ``,
        `To analyze: "compute momentum and RSI for ${code}"`,
      ].join("\n"),
    };
  } catch {
    return { success: false, message: [
      `No data for ${code}. Options:`,
      `  1. npm run seed (bundled with sample data)`,
      `  2. /mcp connect (requires API keys)`,
      `  3. /config for setup guide`,
    ].join("\n") };
  }
}

// ── /add — Manage watchlist ──

async function addHandler(sub: string, flags: Record<string, string | number | boolean>): Promise<CommandResult> {
  const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");

  const watchlistPath = join(process.cwd(), ".ohquant", "watchlist.json");

  // Load or create
  let watchlist: { stocks: { code: string; name: string; market: string; added: string }[] } = { stocks: [] };
  if (existsSync(watchlistPath)) {
    try { watchlist = JSON.parse(readFileSync(watchlistPath, "utf-8")); } catch { /* reset */ }
  }

  if (sub === "list") {
    if (watchlist.stocks.length === 0) {
      return { success: true, message: "Watchlist empty. Add: /add stock --code 000001.SZ --name 平安银行" };
    }
    const lines = watchlist.stocks.map((s, i) =>
      `  ${i + 1}. ${s.code.padEnd(14)} ${s.name.padEnd(16)} ${s.market}  (${s.added})`
    );
    return { success: true, message: [`📋 Watchlist (${watchlist.stocks.length})`, ...lines].join("\n") };
  }

  if (sub === "remove") {
    const code = String(flags.code || "");
    if (!code) return { success: false, message: "Usage: /add remove --code 000001.SZ" };
    const before = watchlist.stocks.length;
    watchlist.stocks = watchlist.stocks.filter((s) => s.code !== code);
    if (watchlist.stocks.length === before) {
      return { success: false, message: `${code} not found in watchlist.` };
    }
    writeFileSync(watchlistPath, JSON.stringify(watchlist, null, 2), "utf-8");
    return { success: true, message: `Removed ${code} from watchlist.` };
  }

  if (sub === "stock") {
    const code = String(flags.code || "");
    const name = String(flags.name || code);
    const market = String(flags.market || "A");
    if (!code) return { success: false, message: "Usage: /add stock --code 000001.SZ --name 平安银行" };

    if (watchlist.stocks.some((s) => s.code === code)) {
      return { success: false, message: `${code} already in watchlist.` };
    }
    watchlist.stocks.push({ code, name, market, added: new Date().toISOString().slice(0, 10) });
    writeFileSync(watchlistPath, JSON.stringify(watchlist, null, 2), "utf-8");
    return { success: true, message: `Added ${name} (${code}) to watchlist.` };
  }

  // Default help
  return {
    success: true,
    message: [
      "/add stock --code CODE --name NAME    Add stock to watchlist",
      "/add stock --code AAPL --market US    US stock",
      "/add list                              Show watchlist",
      "/add remove --code CODE                Remove from watchlist",
      "",
      `Current: ${watchlist.stocks.length} stocks in watchlist`,
    ].join("\n"),
  };
}

// ── /mcp ──

async function mcpHandler(sub: string): Promise<CommandResult> {
  const { connectAll, getConnectedServers } = await import("../data/mcp-client.ts");
  if (sub === "connect") {
    await connectAll();
    const s = getConnectedServers();
    return { success: true, message: s.length > 0 ? `Connected: ${s.join(", ")}` : "No servers connected. Set keys: /config set ANTHROPIC_API_KEY sk-ant-..." };
  }
  const s = getConnectedServers();
  return { success: true, message: s.length > 0 ? `MCP: ${s.join(", ")}` : "No MCP. Run /config to see status" };
}

// ── /config ──

async function configHandler(sub: string, flags: Record<string, string | number | boolean>, positional: string[] = []): Promise<CommandResult> {
  const { loadSettings, saveSettings } = await import("../storage/index.ts");
  const cfg = loadSettings();
  const keys = cfg.apiKeys || {};

  // Map short aliases to full key names
  const aliasMap: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    tushare: "TUSHARE_TOKEN",
    financial: "FINANCIAL_DATASETS_KEY",
    llmquant: "LLMQUANT_API_KEY",
  };

  // /config anthropic sk-ant-xxx
  if (aliasMap[sub]) {
    const value = positional.join(" ") || "";
    if (!value) return { success: false, message: `/config ${sub} <value>` };
    const key = aliasMap[sub];
    (cfg.apiKeys as Record<string, string | undefined>)[key] = value;
    saveSettings(cfg);
    process.env[key] = value;
    return { success: true, message: `${key} configured ✓` };
  }

  // /config model NAME
  if (sub === "model") {
    const m = positional[0] || "claude-sonnet-4-6";
    cfg.anthropic.model = m; saveSettings(cfg);
    return { success: true, message: `model → ${m}` };
  }

  // /config thinking LEVEL
  if (sub === "thinking") {
    const l = positional[0] || "off";
    const valid = ["off", "minimal", "low", "medium", "high"];
    if (!valid.includes(l)) return { success: false, message: `thinking: ${valid.join(" | ")}` };
    cfg.anthropic.thinkingLevel = l as typeof cfg.anthropic.thinkingLevel;
    saveSettings(cfg);
    return { success: true, message: `thinking → ${l}` };
  }

  // /config — status display
  if (sub) return { success: false, message: `/config | /config anthropic|tushare|financial|llmquant <key> | /config model|thinking <val>` };

  const icon = (k: string) => (keys as Record<string, string | undefined>)[k] ? "✓" : "○";
  return { success: true, message: [
    `Configure your WhyJ Quant setup.`,
    `────────────────────────────────────────────`,
    ``,
    `  1. Anthropic API key          [${icon("ANTHROPIC_API_KEY")}]`,
    `     /config anthropic sk-ant-...`,
    ``,
    `  2. Tushare token              [${icon("TUSHARE_TOKEN")}]`,
    `     /config tushare TOKEN`,
    ``,
    `  3. Financial Datasets key     [${icon("FINANCIAL_DATASETS_KEY")}]`,
    `     /config financial KEY`,
    ``,
    `  4. LLMQuant key               [${icon("LLMQUANT_API_KEY")}]`,
    `     /config llmquant KEY`,
    ``,
    `  5. Model                      [${cfg.anthropic.model}]`,
    `     /config model claude-sonnet-4-6`,
    ``,
    `  6. Thinking depth             [${cfg.anthropic.thinkingLevel}]`,
    `     /config thinking medium`,
    ``,
    `────────────────────────────────────────────`,
    `Type a number or command to configure.`,
  ].join("\n") };
}

// ── /benchmark ──

async function benchmarkHandler(sub: string): Promise<CommandResult> {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = join(process.cwd(), ".ohquant", "benchmark", "results");

  if (sub === "dashboard") {
    const { collectResults, dashboardSummary } = await import("../services/dashboard.ts");
    let files: string[] = [];
    try { files = readdirSync(dir).filter((f: string) => f.endsWith(".json")); } catch { files = []; }
    if (files.length === 0) return { success: true, message: "No results. Ask AI agent: 'Run SMA 20/60 on 000001.SZ and score it'" };

    const results = files.map((f) => {
      try { return JSON.parse(readFileSync(join(dir, f), "utf-8")); } catch { return null; }
    }).filter(Boolean) as Record<string, unknown>[];
    const rows = collectResults(results);
    const s = dashboardSummary(rows);
    const sorted = [...rows].sort((a, b) => b.totalScore - a.totalScore).slice(0, 10);

    return { success: true, message: [
      `📋 Dashboard · ${s.totalEvals} runs  Avg: ${s.avgScore}  Best: ${s.bestStrategy} (${s.bestScore})`,
      ...sorted.map((r) => `  ${r.grade.padEnd(2)} ${r.strategy.padEnd(28)} score=${String(r.totalScore).padEnd(5)} sharpe=${r.sharpe}  dd=${(r.maxDrawdown * 100).toFixed(1)}%`),
    ].join("\n") };
  }

  // Default
  let files: string[] = [];
  try { files = readdirSync(dir).filter((f: string) => f.startsWith("portfolio_") && f.endsWith(".json")); } catch { files = []; }
  if (files.length === 0) return { success: true, message: "No portfolio benchmarks. Try /benchmark dashboard" };
  const results = files.slice(-5).map((f) => {
    try { return JSON.parse(readFileSync(join(dir, f), "utf-8")); } catch { return null; }
  }).filter(Boolean) as Record<string, unknown>[];
  return { success: true, message: [
    `Portfolio Benchmarks:`,
    ...results.map((r) => `  ${String(r.grade||"?")} ${String(r.strategy||"?").padEnd(38)} score=${r.total_score}`),
  ].join("\n") };
}

const HELP_TEXT = `
Commands:

  /skill             List available skills
  /skill list --category factor    Filter by category
  /skill info --name NAME          Show skill details
  /skill trigger --name NAME --code CODE   Execute directly

  /claw              Snapshot stock or fund info
    --code CODE      Stock code (000001.SZ / AAPL)
    --market A|US    Market (default: A)

  /add               Manage watchlist
    stock --code C --name N   Add stock
    list                      Show watchlist
    remove --code C           Remove from watchlist

  /benchmark         Portfolio benchmark summary
  /benchmark dashboard  Full results ranking

  /config            Setup guide
  /config show       Show current config + env status
  /config model --model NAME
  /config thinking --level L

  /mcp connect       Connect to data servers
  /mcp status        Show MCP status

  /help  /clear  /exit

  No / prefix → Chat with AI agent
`;
