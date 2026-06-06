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
    } else if (/^-[A-Za-z]$/.test(part)) {
      const key = part.slice(1);
      if (i + 1 < parts.length && !parts[i + 1].startsWith("-")) {
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
    case "data":      return dataHandler(flags, positional);
    case "factor":    return factorHandler(flags, positional);
    case "backtest":  return backtestHandler(flags, positional);
    case "risk":      return riskHandler(flags, positional);
    case "skill":     return skillHandler(flags, positional);
    case "claw":      return clawHandler(flags, positional);
    case "add":       return addHandler(flags, positional);
    case "watch":     return watchHandler(flags, positional);
    case "config":    return configHandler();
    case "benchmark": return benchmarkHandler(flags, positional);
    case "portfolio": return { success: true, message: "/portfolio is a compatibility alias for /config. Portfolio data is live-only and is not cached locally." };
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
  // MCP data tools
  { name: "tushare_daily", label: "A-Share Bars", description: "Fetch A-share daily OHLCV bars via tushare MCP", category: "data", triggerable: true },
  { name: "tushare_stock_basic", label: "Search A", description: "Search A-share stocks by name/code via tushare", category: "data", triggerable: true },
  { name: "tushare_fina_indicator", label: "A Financials", description: "A-share financial indicators via tushare", category: "data", triggerable: true },
  { name: "llmquant_price", label: "US Price", description: "US equity daily OHLCV via llmquant-data MCP", category: "data", triggerable: true },
  { name: "fd_price", label: "US Price FD", description: "US equity prices via Financial Datasets", category: "data", triggerable: true },
  { name: "fd_snapshot", label: "Snapshot", description: "Financial metrics snapshot via FD", category: "data", triggerable: true },
  { name: "fd_company", label: "Company", description: "Company facts via FD", category: "data", triggerable: true },
  // Computation tools
  { name: "compute_factor", label: "Factor", description: "Compute momentum, reversal, volatility, RSI, SMA deviation", category: "factor", triggerable: true },
  { name: "run_backtest", label: "Backtest", description: "SMA crossover backtest with full metrics", category: "backtest", triggerable: true },
  { name: "check_risk", label: "Risk", description: "VaR, CVaR, max drawdown, Sharpe, skewness, kurtosis", category: "risk", triggerable: true },
  { name: "score_benchmark", label: "Score", description: "3-dimension strategy evaluation (100-point scale)", category: "benchmark", triggerable: true },
  { name: "show_dashboard", label: "Dashboard", description: "Aggregated benchmark results viewer", category: "benchmark", triggerable: true },
];

const FACTORS = ["momentum", "reversal", "volatility", "volume_ratio", "rsi", "sma_deviation"];

async function runQuantTool(
  name: string,
  flags: Record<string, string | number | boolean>,
  defaults: Record<string, unknown> = {},
): Promise<CommandResult> {
  try {
    const { MCP_TOOLS } = await import("../tools/mcp-tools.ts");
    const { COMPUTE_TOOLS } = await import("../tools/quant-tools.ts");
    const tool = [...MCP_TOOLS, ...COMPUTE_TOOLS].find((t) => t.name === name);
    if (!tool) return { success: false, message: `Tool "${name}" not registered.` };

    const params = normalizeToolParams(flags, defaults);
    const preparedParams = tool.prepareArguments ? tool.prepareArguments(params) : params;
    const result = await tool.execute(`cli-${Date.now()}`, preparedParams, undefined);
    const text = result.content.map((c) => ("text" in c ? c.text : "[image]")).join("\n");
    return { success: true, message: text, data: result.details };
  } catch (err) {
    return { success: false, message: `Command failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function normalizeToolParams(
  flags: Record<string, string | number | boolean>,
  defaults: Record<string, unknown> = {},
): Record<string, unknown> {
  const params: Record<string, unknown> = { ...defaults };
  const remap: Record<string, string> = {
    code: "symbol",
    c: "symbol",
    symbol: "symbol",
    s: "symbol",
    market: "market",
    m: "market",
    factor: "factor",
    f: "factor",
    period: "period",
    p: "period",
    fast: "fast",
    slow: "slow",
    cash: "cash",
    benchmark: "benchmark_symbol",
    benchmarkSymbol: "benchmark_symbol",
    "benchmark-symbol": "benchmark_symbol",
    label: "label",
    source: "source",
    start: "start",
    end: "end",
    "sort-by": "sort_by",
    sort: "sort_by",
  };

  for (const [key, value] of Object.entries(flags)) {
    const mappedKey = remap[key] || key;
    params[mappedKey] = coerceFlagValue(value);
  }
  return params;
}

function coerceFlagValue(value: string | number | boolean): string | number | boolean {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed !== "" && /^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return value;
}

// ── Canonical workflow commands ──

async function dataHandler(flags: Record<string, string | number | boolean>, positional: string[]): Promise<CommandResult> {
  const action = positional[0] || "info";
  if (action === "download" || action === "fetch") {
    const symbol = String(flags.symbol || flags.code || flags.s || flags.c || positional[1] || "");
    if (!symbol) return { success: false, message: "Usage: /data download --symbol 000001.SZ [--market A]" };
    const m = String(flags.market || flags.m || "A");
    if (m === "US" || m === "HK") return runQuantTool("llmquant_price", { ...flags, ticker: symbol }, {});
    return runQuantTool("tushare_daily", { ...flags, ts_code: symbol }, {});
  }
  if (action === "info" || action === "snapshot") {
    const symbol = String(flags.symbol || flags.code || flags.s || flags.c || positional[1] || "");
    if (!symbol) return { success: false, message: "Usage: /data info --symbol CODE" };
    return clawHandler(flags, positional.slice(1));
  }
  return { success: false, message: "Usage: /data download --symbol CODE | /data info --symbol CODE" };
}

async function factorHandler(flags: Record<string, string | number | boolean>, positional: string[]): Promise<CommandResult> {
  const action = positional[0] || "analyze";
  if (action === "list") {
    return { success: true, message: ["Factors", "───────", ...FACTORS.map((f) => `  ${f}`)].join("\n"), data: FACTORS };
  }
  if (action === "analyze" || action === "compute") {
    const symbol = String(flags.symbol || flags.code || flags.s || flags.c || positional[1] || "");
    const factor = String(flags.factor || flags.f || positional[2] || "");
    if (!symbol || !factor) return { success: false, message: "Usage: /factor analyze --symbol CODE --factor momentum [--period 20]" };
    return runQuantTool("compute_factor", { ...flags, symbol, factor }, { period: 20 });
  }
  return { success: false, message: "Usage: /factor list | /factor analyze --symbol CODE --factor NAME" };
}

async function backtestHandler(flags: Record<string, string | number | boolean>, positional: string[]): Promise<CommandResult> {
  const action = positional[0] || "run";
  if (action !== "run") return { success: false, message: "Usage: /backtest run --symbol CODE [--fast 20 --slow 60]" };
  const symbol = String(flags.symbol || flags.code || flags.s || flags.c || positional[1] || "");
  if (!symbol) return { success: false, message: "Usage: /backtest run --symbol CODE [--fast 20 --slow 60]" };
  return runQuantTool("run_backtest", { ...flags, symbol }, { fast: 20, slow: 60, cash: 100_000 });
}

async function riskHandler(flags: Record<string, string | number | boolean>, positional: string[]): Promise<CommandResult> {
  const action = positional[0] || "check";
  if (action !== "check") return { success: false, message: "Usage: /risk check --symbol CODE" };
  const symbol = String(flags.symbol || flags.code || flags.s || flags.c || positional[1] || "");
  if (!symbol) return { success: false, message: "Usage: /risk check --symbol CODE" };
  return runQuantTool("check_risk", { ...flags, symbol });
}

async function skillHandler(flags: Record<string, string | number | boolean>, positional: string[]): Promise<CommandResult> {
  if (positional[0] === "info") {
    const name = positional[1] || String(flags.name || flags.skill || "");
    if (!name) return { success: false, message: "Usage: /skill info --name fetch_bars" };
    const skill = BUILTIN_SKILLS.find((s) => s.name === name);
    if (!skill) return { success: false, message: `Unknown skill: ${name}. Use /skill list.` };
    return {
      success: true,
      message: [
        `${skill.name}`,
        `────────────────────`,
        `Label:       ${skill.label}`,
        `Category:    ${skill.category}`,
        `Triggerable: ${skill.triggerable ? "yes" : "no"}`,
        `Description: ${skill.description}`,
      ].join("\n"),
      data: skill,
    };
  }

  if (positional[0] === "install") {
    return {
      success: false,
      message: "Skill install is not wired yet. Add a tool in src/tools/mcp-tools.ts or quant-tools.ts.",
    };
  }

  // /skill trigger NAME --code CODE
  if (positional[0] === "trigger") {
    const name = positional[1] || String(flags.name || flags.skill || "");
    if (!name) return { success: false, message: "Usage: select trigger action, then type skill name --code CODE" };
    const skill = BUILTIN_SKILLS.find((s) => s.name === name);
    if (!skill) return { success: false, message: `Unknown skill: ${name}. Use /skill to list.` };
    if (!skill.triggerable) return { success: false, message: `${name} cannot be triggered directly.` };
    return runQuantTool(name, flags);
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
  return { success: true, message: lines.join("\n"), data: filtered };
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

// ── /add — Stock watchlist alias documented in CLI manual ──

async function addHandler(flags: Record<string, string | number | boolean>, positional: string[]): Promise<CommandResult> {
  const action = positional[0] || "list";
  if (action === "stock") {
    const code = String(flags.code || flags.symbol || flags.c || positional[1] || "");
    if (!code) return { success: false, message: "Usage: /add stock --code 000001.SZ --name 平安银行" };
    return watchHandler(flags, [code]);
  }
  if (action === "list") return watchHandler(flags, []);
  if (action === "remove") {
    const code = String(flags.code || flags.symbol || flags.c || positional[1] || "");
    return watchHandler(flags, ["remove", code]);
  }
  return { success: false, message: "Usage: /add stock --code CODE [--name NAME] | /add list | /add remove --code CODE" };
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

async function benchmarkHandler(flags: Record<string, string | number | boolean>, positional: string[]): Promise<CommandResult> {
  const action = positional[0] || "dashboard";
  if (action === "run" || action === "score") {
    const symbol = String(flags.symbol || flags.code || flags.s || flags.c || positional[1] || "");
    if (!symbol) return { success: false, message: "Usage: /benchmark run --symbol CODE [--benchmark-symbol 000300.SH]" };
    return runQuantTool("score_benchmark", { ...flags, symbol }, {
      benchmark_symbol: "000300.SH",
      fast: 20,
      slow: 60,
      cash: 100_000,
    });
  }
  if (action !== "dashboard" && action !== "list") {
    return { success: false, message: "Usage: /benchmark run --symbol CODE | /benchmark dashboard" };
  }

  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { emitFileEvent } = await import("../storage/fs-events.ts");
  const dir = join(process.cwd(), ".ohquant", "benchmark", "results");
  const { collectResults, dashboardSummary } = await import("../services/dashboard.ts");
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f: string) => f.endsWith(".json"));
    emitFileEvent({ operation: "READ", path: dir, detail: "benchmark index" });
  } catch { files = []; }
  if (files.length === 0) return { success: true, message: "No results. Ask AI agent: run SMA 20/60 on 000001.SZ and score it." };
  const results = files.map((f) => {
    const path = join(dir, f);
    try {
      const text = readFileSync(path, "utf-8");
      emitFileEvent({ operation: "READ", path, bytes: text.length, detail: "benchmark result" });
      return JSON.parse(text);
    } catch { return null; }
  }).filter(Boolean) as Record<string, unknown>[];
  const rows = collectResults(results);
  const s = dashboardSummary(rows);
  const sorted = [...rows].sort((a, b) => b.totalScore - a.totalScore).slice(0, 10);
  return { success: true, message: [`Dashboard · ${s.totalEvals} runs  Avg: ${s.avgScore}  Best: ${s.bestStrategy} (${s.bestScore})`, ...sorted.map((r) => `  ${r.grade.padEnd(2)} ${r.strategy.padEnd(28)} score=${String(r.totalScore).padEnd(5)} sharpe=${r.sharpe}  dd=${(r.maxDrawdown * 100).toFixed(1)}%`)].join("\n") };
}

const HELP_TEXT = `
Commands:

  /data           Download data or show symbol info
  /factor         List or compute factors
  /backtest       Run SMA backtests
  /risk           Check risk metrics
  /benchmark      Run scoring or show dashboard
  /add            Add/list/remove watchlist stocks
  /config         Show config status
  /mcp            MCP server status / connect
  /portfolio      Alias for /config; portfolio data is live-only

  /help  /clear  /exit

  Compatibility: /skill  /claw  /watch

  No / prefix → Chat with AI agent
`;
