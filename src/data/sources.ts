/**
 * Data source adapters — unified interface to MCP backends.
 * Maps Bar type to MCP tool calls for tushare, llmquant, financial-datasets.
 */

import { callTool, type McpTool } from "./mcp-client.ts";
import { loadBars, saveBars, isCacheFresh } from "../storage/bars.ts";
import type { Bar, Market, SymbolInfo } from "../types/data.ts";

export type DataSource = "auto" | "akshare" | "tushare" | "llmquant-data" | "financial-datasets";

/** Fetch daily bars. source="auto" picks best available. Explicit source skips cache. */
export async function fetchBars(
  symbol: string,
  market: Market,
  start?: string,
  end?: string,
  source?: DataSource,
): Promise<{ bars: Bar[]; source: string }> {
  const explicit = source && source !== "auto";
  const selected = source && source !== "auto" ? source : (market === "A" ? "akshare" : "llmquant-data");

  // Cache: only use when auto mode and fresh
  if (!explicit) {
    const fresh = await isCacheFresh(symbol, selected);
    if (fresh) {
      const cached = await loadBars(symbol, selected);
      const filtered = filterByDate(cached, start, end);
      if (filtered.length > 0) return { bars: filtered, source: selected };
    }
  }

  let bars: Bar[] = [];

  if (selected === "akshare") {
    try {
      const { fetchFromAKShare } = await import("../bridge/akshare.ts");
      bars = await fetchFromAKShare(symbol, start, end);
    } catch { /* fall through */ }
  }

  if (selected === "tushare" || (selected === "akshare" && bars.length === 0)) {
    try {
      bars = await fetchFromTushare(symbol, start, end);
    } catch { /* fall through */ }
  }

  if (selected === "llmquant-data" || (market !== "A" && bars.length === 0)) {
    try {
      bars = await fetchFromLlmQuant(symbol, start, end);
    } catch { /* fall through */ }
  }

  // Last resort: load any cached data
  if (bars.length === 0) {
    for (const src of ["tushare", "akshare", "llmquant-data"]) {
      const cached = await loadBars(symbol, src);
      if (cached.length > 0) { bars = cached; break; }
    }
  }

  const usedSource = explicit ? selected : (bars.length > 0 ? selected : "cache");
  if (bars.length > 0) {
    await saveBars(symbol, usedSource, bars);
  }

  return { bars: filterByDate(bars, start, end), source: usedSource };
}

/** Search symbols */
export async function searchSymbols(
  keyword: string,
  market?: Market,
): Promise<SymbolInfo[]> {
  try {
    const result = await callTool("tushare", "stock_basic", {
      name: keyword,
      ...(market === "A" ? { exchange: "SSE" } : {}),
    });
    return parseTushareSymbols(result);
  } catch {
    return [];
  }
}

// --- Internal adapters ---

async function fetchFromTushare(symbol: string, start?: string, end?: string): Promise<Bar[]> {
  const result = await callTool("tushare", "daily", {
    ts_code: symbol,
    start_date: start?.replace(/-/g, ""),
    end_date: end?.replace(/-/g, ""),
  });

  if (!Array.isArray(result)) return [];
  return (result as TushareDailyRow[]).map((r) => ({
    date: formatDate(r.trade_date),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.vol),
    amount: Number(r.amount || 0),
  }));
}

interface TushareDailyRow {
  trade_date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  vol: string;
  amount?: string;
}

async function fetchFromLlmQuant(symbol: string, start?: string, end?: string): Promise<Bar[]> {
  const result = await callTool("llmquant-data", "equity_historical_prices", {
    ticker: symbol,
    ...(start ? { start_date: start } : {}),
    ...(end ? { end_date: end } : {}),
  });

  const content = Array.isArray(result) ? result : [];
  // MCP returns content blocks with text
  const text = content.map((c: { text?: string }) => c.text || "").join("\n");
  try {
    const data = JSON.parse(text);
    const rows = data?.data || data || [];
    if (!Array.isArray(rows)) return [];
    return rows.map((r: LlmQuantBar) => ({
      date: r.date || r.trade_date || "",
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume || 0),
      amount: 0,
      adjClose: r.adj_close ? Number(r.adj_close) : undefined,
    }));
  } catch {
    return [];
  }
}

interface LlmQuantBar {
  date?: string;
  trade_date?: string;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume?: unknown;
  adj_close?: unknown;
}

function parseTushareSymbols(result: unknown): SymbolInfo[] {
  if (!Array.isArray(result)) return [];
  return (result as TushareStockRow[]).map((r) => ({
    code: r.ts_code,
    name: r.name,
    market: "A",
    exchange: r.ts_code.endsWith(".SH") ? "SSE" : "SZSE",
    type: "stock",
    listDate: r.list_date,
  }));
}

interface TushareStockRow {
  ts_code: string;
  name: string;
  list_date?: string;
}

// --- Helpers ---

function filterByDate(bars: Bar[], start?: string, end?: string): Bar[] {
  return bars.filter((b) => {
    if (start && b.date < start) return false;
    if (end && b.date > end) return false;
    return true;
  });
}

function formatDate(d: string): string {
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return d;
}
