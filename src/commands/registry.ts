/**
 * Slash command parser and dispatcher.
 * / prefix → direct execution.  No prefix → AI Agent.
 */
import type { CommandResult } from "../types/messages.ts";

export interface ParsedCommand {
  command: string; raw: string;
  flags: Record<string, string | number | boolean>;
  positional: string[];
}

export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const parts = trimmed.slice(1).split(/\s+/);
  if (parts.length === 0) return null;
  const command = parts[0];
  const flags: Record<string, string | number | boolean> = {};
  const positional: string[] = [];
  let i = 1;
  while (i < parts.length) {
    const part = parts[i];
    if (part.startsWith("--")) {
      const key = part.slice(2);
      if (i + 1 < parts.length && !parts[i + 1].startsWith("--")) {
        i++; flags[key] = parts[i];
      } else flags[key] = true;
    } else {
      positional.push(part);
    }
    i++;
  }
  return { command, raw: trimmed, flags, positional };
}

export async function executeCommand(cmd: ParsedCommand): Promise<CommandResult> {
  const { command, flags, positional } = cmd;
  switch (command) {
    case "skill":     return skillHandler(flags, positional);
    case "claw":      return clawHandler(flags, positional);
    case "watch":     return watchHandler(flags, positional);
    case "config":    return configHandler();
    case "benchmark": return benchmarkHandler();
    case "portfolio": return { success: true, message: "Type /portfolio in TUI to open the config panel." };
    case "mcp":       return mcpHandler(positional);
    case "help":      return { success: true, message: HELP_TEXT };
    case "clear":     return { success: true, message: "", renderAs: "text" };
    case "exit": case "quit": return { success: true, message: "Goodbye." };
    default:
      return { success: false, message: `Unknown /${command}. Try /help` };
  }
}

// ── /skill ──

interface SkillEntry {
  name: string; label: string; description: string;
  category: "data" | "factor" | "backtest" | "risk" | "benchmark" | "portfolio" | "system";
  triggerable: boolean;
}

const BUILTIN_SKILLS: SkillEntry[] = [
  { name: "fetch_bars", label: "Fetch Data", description: "Download OHLCV price data for any symbol", category: "data", triggerable: true },
  { name: "compute_factor", label: "Factor", description: "Compute momentum, reversal, volatility, RSI, SMA deviation", category: "factor", triggerable: true },
  { name: "run_backtest", label: "Backtest", description: "SMA crossover backtest with full metrics", category: "backtest", triggerable: true },
  { name: "check_risk", label: "Risk", description: "VaR, CVaR, max drawdown, Sharpe, skewness, kurtosis", category: "risk", triggerable: true },
  { name: "score_benchmark", label: "Score", description: "3-dimension strategy evaluation (100-point scale)", category: "benchmark", triggerable: true },
  { name: "show_dashboard", label: "Dashboard", description: "Aggregated benchmark results viewer", category: "benchmark", triggerable: true },
];

async function skillHandler(flags: Record<string, string | number | boolean>, positional: string[]): Promise<CommandResult> {
  // /skill trigger NAME --code CODE
  if (positional[0] === "trigger") {
    const name = positional[1] || String(flags.skill || "");
    if (!name) return { success: false, message: "Usage: select trigger action, then type skill name --code CODE" };
    const skill = BUILTIN_SKILLS.find((s) => s.name === name);
    if (!skill) return { success: false, message: `Unknown skill: ${name}. Use /skill to list.` };
    if (!skill.triggerable) return { success: false, message: `${name} cannot be triggered directly.` };

    try {
      const { QUANT_TOOLS } = await import("../tools/quant-tools.ts");
      const tool = QUANT_TOOLS.find((t) => t.name === name);
      if (!tool) return { success: false, message: `Tool "${name}" not registered.` };

      const params: Record<string, unknown> = {};
      const remap: Record<string, string> = { code: "symbol", c: "symbol", symbol: "symbol", market: "market", m: "market", factor: "factor", f: "factor", period: "period", p: "period", fast: "fast", slow: "slow", cash: "cash", benchmark: "benchmark_symbol" };
      for (const [k, v] of Object.entries(flags)) {
        const mappedKey = remap[k] || k;
        if (typeof v === "string" && !isNaN(Number(v))) params[mappedKey] = Number(v);
        else params[mappedKey] = v;
      }

      const preparedParams = tool.prepareArguments ? tool.prepareArguments(params) : params;
      const result = await tool.execute(`cli-${Date.now()}`, preparedParams, undefined);
      const text = result.content.map((c) => ("text" in c ? c.text : "[image]")).join("\n");
      return { success: true, message: text };
    } catch (err) {
      return { success: false, message: `Skill execution failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // /skill — list all
  const catFilter = String(flags.category || flags.c || "");
  const filtered = catFilter ? BUILTIN_SKILLS.filter((s) => s.category === catFilter) : BUILTIN_SKILLS;
  if (filtered.length === 0) return { success: true, message: `No skills in "${catFilter}".` };

  const byCat: Record<string, SkillEntry[]> = {};
  for (const s of filtered) { byCat[s.category] = byCat[s.category] || []; byCat[s.category].push(s); }

  const lines: string[] = ["Skills", "──────"];
  for (const [cat, skills] of Object.entries(byCat)) {
    lines.push(`\n${cat}:`);
    for (const s of skills) lines.push(`  ${s.label.padEnd(12)} ${s.name.padEnd(20)} ${s.description}`);
  }
  return { success: true, message: lines.join("\n") };
}

// ── /claw — Snapshot ──

async function clawHandler(flags: Record<string, string | number | boolean>, positional: string[]): Promise<CommandResult> {
  const code = String(flags.code || flags.symbol || flags.c || positional[0] || "");
  if (!code) return { success: false, message: "Usage: /claw --code 000001.SZ" };
  const market = String(flags.market || flags.m || "A");

  let cachedBars: { date: string; close: number; open: number; high: number; low: number; volume: number }[] = [];
  let cachedName = code;
  try {
    const { loadBars, getMeta } = await import("../storage/bars.ts");
    const meta = await getMeta(code, "tushare");
    if (meta) { cachedName = meta.name; cachedBars = await loadBars(code, "tushare"); }
  } catch { /* no cache */ }

  if (cachedBars.length > 0) {
    const last = cachedBars[cachedBars.length - 1];
    const first = cachedBars[0];
    const returns = cachedBars.slice(1).map((b, i) => b.close / cachedBars[i].close - 1);
    const posDays = returns.filter((r) => r > 0).length;
    const winRate = returns.length > 0 ? (posDays / returns.length * 100).toFixed(0) : "?";

    let mcpExtra = "";
    try {
      const { callTool } = await import("../data/mcp-client.ts");
      if (market === "A") {
        try {
          const basic = await callTool("tushare", "daily_basic", { ts_code: code, trade_date: "" });
          const arr = Array.isArray(basic) ? basic : [];
          if (arr.length > 0) {
            const s = arr[arr.length - 1] as Record<string, unknown>;
            mcpExtra = [`PE (TTM):    ${s.pe ?? s.pe_ttm ?? "?"}`, `PB:          ${s.pb ?? "?"}`, `Market Cap:  ${Number(s.total_mv ?? s.circ_mv ?? 0).toLocaleString?.() ?? "?"} CNY`].join("\n");
          }
        } catch { /* MCP unavailable */ }
      }
    } catch { /* MCP not connected */ }

    return { success: true, message: [`${cachedName} (${code})`, `─────────────────────────────────`, `Range: ${first.date} → ${last.date} (${cachedBars.length} days)`, `Latest: ${last.close.toFixed(2)}  O:${last.open.toFixed(2)} H:${last.high.toFixed(2)} L:${last.low.toFixed(2)}`, `Volume: ${(last.volume / 1e6).toFixed(1)}M`, `Win Rate: ${winRate}%`, mcpExtra].filter(Boolean).join("\n") };
  }

  try {
    if (market === "A") {
      const { callTool } = await import("../data/mcp-client.ts");
      let name = code;
      try {
        const basic = await callTool("tushare", "stock_basic", { ts_code: code });
        const arr = Array.isArray(basic) ? basic : [];
        if (arr.length > 0 && (arr[0] as Record<string, unknown>).name) name = (arr[0] as Record<string, unknown>).name as string;
      } catch { /* fallback */ }
      let snapshot: Record<string, unknown> = {};
      try { const basic = await callTool("tushare", "daily_basic", { ts_code: code, trade_date: "" }); const arr = Array.isArray(basic) ? basic : []; if (arr.length > 0) snapshot = arr[arr.length - 1] as Record<string, unknown>; } catch { /* empty */ }
      return { success: true, message: [`${name} (${code})`, `─────────────────────────────────`, `Industry: ${snapshot.industry ?? "?"}`, `Close: ${snapshot.close ?? "?"}`, `PE: ${snapshot.pe ?? snapshot.pe_ttm ?? "?"}`, `PB: ${snapshot.pb ?? "?"}`].join("\n") };
    }
    const { callTool } = await import("../data/mcp-client.ts");
    const facts = await callTool("financial-datasets", "get_company_facts", { ticker: code });
    const metrics = await callTool("financial-datasets", "get_financial_metrics_snapshot", { ticker: code });
    const f = (facts as Record<string, unknown>) || {};
    const m = (metrics as Record<string, unknown>) || {};
    return { success: true, message: [`${f.company_name || code} (${code})`, `─────────────────────────────────`, `Sector: ${f.sector || "?"} / ${f.industry || "?"}`, `Market Cap: $${(Number(m.market_cap) / 1e9).toFixed(1) ?? "?"}B`, `PE: ${m.pe_ratio ?? "?"}`, `PB: ${m.pb_ratio ?? "?"}`].join("\n") };
  } catch {
    return { success: false, message: `No data for ${code}. /mcp connect first.` };
  }
}

// ── /watch — Manage fund watchlist ──

async function watchHandler(flags: Record<string, string | number | boolean>, positional: string[]): Promise<CommandResult> {
  const { loadWatchlist, saveWatchlist } = await import("../storage/index.ts");
  const watchlist = loadWatchlist();

  // /watch remove CODE
  if (positional[0] === "remove") {
    const code = positional[1] || String(flags.code || "");
    if (!code) return { success: false, message: "Select remove, then type fund code." };
    const before = watchlist.funds.length;
    watchlist.funds = watchlist.funds.filter((f) => f.code !== code);
    if (watchlist.funds.length === before) return { success: false, message: `${code} not found.` };
    saveWatchlist(watchlist);
    return { success: true, message: `Removed ${code}.` };
  }

  // /watch CODE — add fund
  if (positional[0]) {
    const code = positional[0];
    if (watchlist.funds.some((f) => f.code === code)) return { success: false, message: `${code} already in watchlist.` };
    const name = flags.name ? String(flags.name) : code;
    watchlist.funds.push({ code, name, added: new Date().toISOString().slice(0, 10) });
    saveWatchlist(watchlist);
    return { success: true, message: `Added ${name} (${code}).` };
  }

  // /watch — show list
  if (watchlist.funds.length === 0) return { success: true, message: "Watchlist empty." };
  const lines = watchlist.funds.map((f, i) => `  ${i + 1}. ${f.code.padEnd(14)} ${f.name.padEnd(16)}  (${f.added})`);
  return { success: true, message: [`Watchlist (${watchlist.funds.length})`, ...lines].join("\n") };
}

// ── /mcp ──

async function mcpHandler(positional: string[]): Promise<CommandResult> {
  const { connectAll, getConnectedServers } = await import("../data/mcp-client.ts");
  if (positional[0] === "connect") {
    await connectAll();
    const s = getConnectedServers();
    return { success: true, message: s.length > 0 ? `Connected: ${s.join(", ")}` : "No servers connected. Set keys via /config." };
  }
  const s = getConnectedServers();
  return { success: true, message: s.length > 0 ? `MCP: ${s.join(", ")}` : "No MCP connections. Use /mcp → Connect all servers." };
}

// ── /config ──

async function configHandler(): Promise<CommandResult> {
  const { loadSettings, saveSettings } = await import("../storage/index.ts");
  const cfg = loadSettings();
  const keys = cfg.env || {};
  const icon = (k: string) => (keys as Record<string, string | undefined>)[k] ? "✓" : "○";
  return { success: true, message: [
    `WhyJ Quant Config`,
    `────────────────────────────────────────────`,
    ``, `  1. Auth token                  [${icon("WHYJ_AUTH_TOKEN")}]`,
    ``, `  2. Tushare token              [${icon("TUSHARE_TOKEN")}]`,
    ``, `  3. Financial Datasets key     [${icon("FINANCIAL_DATASETS_KEY")}]`,
    ``, `  4. LLMQuant key               [${icon("LLMQUANT_API_KEY")}]`,
    ``, `  5. Model                      [${cfg.model}]`,
    ``, `  6. Thinking depth             [${cfg.thinkingLevel}]`,
    ``, `────────────────────────────────────────────`,
    `Open ConfigPanel (Ctrl+P) to edit.`,
  ].join("\n") };
}

// ── /benchmark ──

async function benchmarkHandler(): Promise<CommandResult> {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = join(process.cwd(), ".ohquant", "benchmark", "results");
  const { collectResults, dashboardSummary } = await import("../services/dashboard.ts");
  let files: string[] = [];
  try { files = readdirSync(dir).filter((f: string) => f.endsWith(".json")); } catch { files = []; }
  if (files.length === 0) return { success: true, message: "No results. Ask AI agent: run SMA 20/60 on 000001.SZ and score it." };
  const results = files.map((f) => {
    try { return JSON.parse(readFileSync(join(dir, f), "utf-8")); } catch { return null; }
  }).filter(Boolean) as Record<string, unknown>[];
  const rows = collectResults(results);
  const s = dashboardSummary(rows);
  const sorted = [...rows].sort((a, b) => b.totalScore - a.totalScore).slice(0, 10);
  return { success: true, message: [`Dashboard · ${s.totalEvals} runs  Avg: ${s.avgScore}  Best: ${s.bestStrategy} (${s.bestScore})`, ...sorted.map((r) => `  ${r.grade.padEnd(2)} ${r.strategy.padEnd(28)} score=${String(r.totalScore).padEnd(5)} sharpe=${r.sharpe}  dd=${(r.maxDrawdown * 100).toFixed(1)}%`)].join("\n") };
}

const HELP_TEXT = `
Commands:

  /skill          List or trigger skills
  /claw --code C  Snapshot fund info
  /watch          Manage fund watchlist
  /config         Show config status
  /benchmark      Strategy scoring dashboard
  /mcp            MCP server status / connect
  /portfolio      Open portfolio config panel

  /help  /clear  /exit

  No / prefix → Chat with AI agent
`;
