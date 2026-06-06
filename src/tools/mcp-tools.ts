/**
 * MCP-backed agent tools — direct wrappers around MCP server tools.
 * These replace the fetch_bars indirection. The agent calls MCP directly.
 */
import { Type } from "typebox";
import type { Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { callTool } from "../data/mcp-client.ts";
import { saveBars, loadBars } from "../storage/bars.ts";
import type { Bar } from "../types/data.ts";

// ── helpers ──

function ok(text: string, details?: unknown): AgentToolResult<unknown> {
  return { content: [{ type: "text" as const, text }], details: details ?? {} };
}

function errMsg(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text" as const, text }], details: {} };
}

function formatDate(d: string): string {
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return d;
}

// ── tushare daily ──

const TushareDaily = Type.Object({
  ts_code: Type.String({ description: "Stock code e.g. 000001.SZ" }),
  start_date: Type.Optional(Type.String({ description: "Start date YYYYMMDD" })),
  end_date: Type.Optional(Type.String({ description: "End date YYYYMMDD" })),
  trade_date: Type.Optional(Type.String({ description: "Single trade date YYYYMMDD" })),
});

export const tushareDailyTool: AgentTool<typeof TushareDaily> = {
  name: "tushare_daily",
  description: "Fetch A-share daily OHLCV bars from tushare MCP. Returns open, high, low, close, volume, amount. Caches locally.",
  label: "Tushare Daily",
  parameters: TushareDaily,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof TushareDaily>): Promise<AgentToolResult<unknown>> {
    const result = await callTool("tushare", "daily", {
      ts_code: args.ts_code,
      ...(args.start_date ? { start_date: args.start_date } : {}),
      ...(args.end_date ? { end_date: args.end_date } : {}),
      ...(args.trade_date ? { trade_date: args.trade_date } : {}),
    });

    if (!Array.isArray(result)) return errMsg("tushare daily returned unexpected format");

    const bars: Bar[] = (result as TushareRow[]).map((r) => ({
      date: formatDate(r.trade_date),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.vol),
      amount: Number(r.amount || 0),
    }));

    if (bars.length > 0) {
      await saveBars(args.ts_code, "tushare", bars);
    }

    const latest = bars[bars.length - 1];
    return ok([
      `${bars.length} bars for ${args.ts_code} via tushare`,
      latest ? `Range: ${bars[0]?.date} → ${latest.date}  |  Latest close: ${latest.close.toFixed(2)}` : "",
    ].filter(Boolean).join("\n"), { symbol: args.ts_code, source: "tushare", barCount: bars.length });
  },
};

interface TushareRow { trade_date: string; open: string; high: string; low: string; close: string; vol: string; amount?: string; }

// ── tushare stock_basic ──

const TushareStockBasic = Type.Object({
  ts_code: Type.Optional(Type.String({ description: "Specific stock code" })),
  name: Type.Optional(Type.String({ description: "Stock name for search" })),
  exchange: Type.Optional(Type.String({ description: "SSE or SZSE" })),
  market: Type.Optional(Type.String({ description: "主板/创业板/科创板" })),
  list_status: Type.Optional(Type.String({ default: "L", description: "L=listed" })),
});

export const tushareStockBasicTool: AgentTool<typeof TushareStockBasic> = {
  name: "tushare_stock_basic",
  description: "Search A-share stock list by name, code, exchange, or market. Returns stock code, name, industry, area, list date.",
  label: "Search A",
  parameters: TushareStockBasic,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof TushareStockBasic>): Promise<AgentToolResult<unknown>> {
    const params: Record<string, unknown> = { list_status: args.list_status ?? "L" };
    if (args.ts_code) params.ts_code = args.ts_code;
    if (args.name) params.name = args.name;
    if (args.exchange) params.exchange = args.exchange;
    if (args.market) params.market = args.market;

    const result = await callTool("tushare", "stock_basic", params);
    if (!Array.isArray(result)) return errMsg("tushare stock_basic returned unexpected format");

    const rows = result as Array<Record<string, unknown>>;
    const top = rows.slice(0, 20);
    const summary = top.map((r) => `${r.ts_code}  ${r.name}  ${r.industry || ""}  ${r.area || ""}`).join("\n");
    return ok(`Found ${rows.length} stocks (showing first ${top.length}):\n${summary}`, { count: rows.length });
  },
};

// ── tushare fina_indicator ──

const TushareFinaIndicator = Type.Object({
  ts_code: Type.String({ description: "Stock code e.g. 000001.SZ" }),
  start_date: Type.Optional(Type.String({ description: "Report period start YYYYMMDD" })),
  end_date: Type.Optional(Type.String({ description: "Report period end YYYYMMDD" })),
  period: Type.Optional(Type.String({ description: "Exact report period e.g. 20251231" })),
});

export const tushareFinaIndicatorTool: AgentTool<typeof TushareFinaIndicator> = {
  name: "tushare_fina_indicator",
  description: "Fetch A-share financial indicators: EPS, ROE, ROA, gross margin, debt ratio, PE, PB from tushare MCP.",
  label: "Financials A",
  parameters: TushareFinaIndicator,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof TushareFinaIndicator>): Promise<AgentToolResult<unknown>> {
    const result = await callTool("tushare", "fina_indicator", {
      ts_code: args.ts_code,
      ...(args.period ? { period: args.period } : {}),
      ...(args.start_date ? { start_date: args.start_date } : {}),
      ...(args.end_date ? { end_date: args.end_date } : {}),
    });

    if (!Array.isArray(result)) return errMsg("tushare fina_indicator returned unexpected format");

    const rows = result as Array<Record<string, unknown>>;
    const latest = rows.slice(0, 4);
    const summary = latest.map((r) => {
      return [
        `${r.end_date}`,
        `EPS:${r.eps ?? "?"} ROE:${r.roe ?? "?"}`,
        `Rev:${formatBig(r.total_revenue)} GP:${r.grossmargin ?? "?"}`,
        `PE:${r.pe ?? "?"} PB:${r.pb ?? "?"}`,
      ].join("  ");
    }).join("\n");

    return ok([
      `Financial indicators for ${args.ts_code}:`,
      summary,
    ].join("\n"), { symbol: args.ts_code, periods: rows.length });
  },
};

function formatBig(v: unknown): string {
  if (v == null) return "?";
  const n = Number(v);
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return n.toFixed(1);
}

// ── llmquant-data equity_historical_prices ──

const LlmQuantEquity = Type.Object({
  ticker: Type.String({ description: "US equity ticker e.g. AAPL, MSFT, ^GSPC" }),
  start_date: Type.Optional(Type.String({ description: "Start date YYYY-MM-DD" })),
  end_date: Type.Optional(Type.String({ description: "End date YYYY-MM-DD" })),
  limit: Type.Optional(Type.Number({ description: "Max bars, default 30" })),
});

export const llmQuantEquityTool: AgentTool<typeof LlmQuantEquity> = {
  name: "llmquant_price",
  description: "Fetch US equity daily OHLCV prices from llmquant-data MCP. Includes adj_close, dividends, splits. Caches locally.",
  label: "US Price",
  parameters: LlmQuantEquity,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof LlmQuantEquity>): Promise<AgentToolResult<unknown>> {
    const result = await callTool("llmquant-data", "equity_historical_prices", {
      ticker: args.ticker,
      ...(args.start_date ? { start_date: args.start_date } : {}),
      ...(args.end_date ? { end_date: args.end_date } : {}),
      ...(args.limit ? { limit: args.limit } : {}),
    });

    // MCP returns content blocks with text
    const text = Array.isArray(result)
      ? result.map((c: { text?: string }) => c.text || "").join("\n")
      : String(result ?? "");

    let data: { data?: LlmQuantRow[] } | LlmQuantRow[];
    try { data = JSON.parse(text); } catch { return errMsg("Failed to parse llmquant response"); }

    const rows = Array.isArray(data) ? data : (data.data || []);
    if (rows.length === 0) return errMsg(`No data for ${args.ticker}`);

    const bars: Bar[] = rows.map((r) => ({
      date: r.date || r.trade_date || "",
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume || 0),
      amount: 0,
      adjClose: r.adj_close != null ? Number(r.adj_close) : undefined,
    }));

    if (bars.length > 0) await saveBars(args.ticker, "llmquant-data", bars);

    const latest = bars[bars.length - 1];
    return ok([
      `${bars.length} bars for ${args.ticker} via llmquant`,
      latest ? `Range: ${bars[0]?.date} → ${latest.date}  |  Latest close: ${latest.close.toFixed(2)}` : "",
    ].join("\n"), { symbol: args.ticker, source: "llmquant-data", barCount: bars.length });
  },
};

interface LlmQuantRow {
  date?: string; trade_date?: string;
  open: unknown; high: unknown; low: unknown; close: unknown;
  volume?: unknown; adj_close?: unknown;
}

// ── financial-datasets get_stock_prices ──

const FDStockPrices = Type.Object({
  ticker: Type.String({ description: "US stock ticker e.g. AAPL, MSFT" }),
  start_date: Type.Optional(Type.String({ description: "Start date YYYY-MM-DD" })),
  end_date: Type.Optional(Type.String({ description: "End date YYYY-MM-DD" })),
  interval: Type.Optional(Type.String({ default: "day", description: "day, week, month" })),
});

export const fdStockPricesTool: AgentTool<typeof FDStockPrices> = {
  name: "fd_price",
  description: "Fetch US equity daily OHLCV prices from Financial Datasets MCP. Caches locally.",
  label: "US Price FD",
  parameters: FDStockPrices,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof FDStockPrices>): Promise<AgentToolResult<unknown>> {
    const result = await callTool("financial-datasets", "get_stock_prices", {
      ticker: args.ticker,
      ...(args.start_date ? { start_date: args.start_date } : {}),
      ...(args.end_date ? { end_date: args.end_date } : {}),
      ...(args.interval ? { interval: args.interval } : {}),
    });

    const text = Array.isArray(result)
      ? result.map((c: { text?: string }) => c.text || "").join("\n")
      : String(result ?? "");

    // FD returns the data directly in the text
    return ok(`Stock price data for ${args.ticker} via Financial Datasets:\n${text.slice(0, 500)}`, {
      symbol: args.ticker, source: "financial-datasets",
    });
  },
};

// ── financial-datasets get_financial_metrics_snapshot ──

const FDSnapshot = Type.Object({
  ticker: Type.String({ description: "US stock ticker e.g. AAPL" }),
});

export const fdSnapshotTool: AgentTool<typeof FDSnapshot> = {
  name: "fd_snapshot",
  description: "Get current financial metrics snapshot (PE, PB, ROE, market cap, dividend yield) from Financial Datasets MCP.",
  label: "Snapshot",
  parameters: FDSnapshot,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof FDSnapshot>): Promise<AgentToolResult<unknown>> {
    const result = await callTool("financial-datasets", "get_financial_metrics_snapshot", {
      ticker: args.ticker,
    });

    const text = Array.isArray(result)
      ? result.map((c: { text?: string }) => c.text || "").join("\n")
      : String(result ?? "");

    return ok(`Financial snapshot for ${args.ticker}:\n${text.slice(0, 500)}`, {
      symbol: args.ticker, source: "financial-datasets",
    });
  },
};

// ── financial-datasets get_company_facts ──

const FDCompanyFacts = Type.Object({
  ticker: Type.String({ description: "Stock ticker e.g. AAPL" }),
});

export const fdCompanyFactsTool: AgentTool<typeof FDCompanyFacts> = {
  name: "fd_company",
  description: "Get company facts (sector, industry, employees, market cap, exchange) from Financial Datasets MCP.",
  label: "Company",
  parameters: FDCompanyFacts,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof FDCompanyFacts>): Promise<AgentToolResult<unknown>> {
    const result = await callTool("financial-datasets", "get_company_facts", {
      ticker: args.ticker,
    });

    const text = Array.isArray(result)
      ? result.map((c: { text?: string }) => c.text || "").join("\n")
      : String(result ?? "");

    return ok(`Company facts for ${args.ticker}:\n${text.slice(0, 500)}`, {
      symbol: args.ticker, source: "financial-datasets",
    });
  },
};

// ── registry ──

/** All MCP-backed data tools. The agent calls these directly instead of fetch_bars. */
export const MCP_TOOLS: AgentTool[] = [
  tushareDailyTool,
  tushareStockBasicTool,
  tushareFinaIndicatorTool,
  llmQuantEquityTool,
  fdStockPricesTool,
  fdSnapshotTool,
  fdCompanyFactsTool,
];
