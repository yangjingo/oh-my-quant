import { Type } from "typebox";
import type { Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { fetchFinancialDatasetsSnapshot, fetchTushareSnapshot, fetchBars, searchSymbols } from "../source/index.ts";
import type { Market } from "../types/data.ts";

const FetchBars = Type.Object({
  symbol: Type.String({ description: "Market symbol such as 000300.SH or 159915" }),
  market: Type.Optional(Type.String({ description: "Market code: A, US, HK" })),
  start: Type.Optional(Type.String({ description: "Start date YYYY-MM-DD" })),
  end: Type.Optional(Type.String({ description: "End date YYYY-MM-DD" })),
  source: Type.Optional(Type.String({ description: "Preferred local source. Only akshare is supported." })),
});

const SearchSymbols = Type.Object({
  keyword: Type.String({ description: "Symbol keyword or Chinese stock name" }),
  market: Type.Optional(Type.String({ description: "Market code, default A" })),
});

const FetchSnapshot = Type.Object({
  symbol: Type.String({ description: "Market symbol such as 000001.SZ or AAPL" }),
  market: Type.Optional(Type.String({ description: "Market code: A, US, HK" })),
});

function ok(text: string, details?: unknown): AgentToolResult<unknown> {
  return { content: [{ type: "text" as const, text }], details: details ?? {} };
}

function unsupported(symbol: string, market: string): AgentToolResult<unknown> {
  return ok(
    [
      `No local data adapter for ${symbol}.`,
      `Market     ${market}`,
      "Source     akshare only",
      "Action     use A-share / fund symbols, or update local files with the agent first.",
    ].join("\n"),
    { symbol, market, source: "unavailable", barCount: 0 },
  );
}

export const fetchBarsTool: AgentTool<typeof FetchBars> = {
  name: "fetch_bars",
  description: "Fetch and cache local bars through AKShare. Best for A-share, index, and fund symbols.",
  label: "Fetch Bars",
  parameters: FetchBars,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof FetchBars>): Promise<AgentToolResult<unknown>> {
    const market = (args.market || inferMarket(args.symbol)) as Market;
    if (market !== "A") {
      return unsupported(args.symbol, market);
    }

    const source = args.source === "akshare" || !args.source ? "akshare" : "akshare";
    const result = await fetchBars(args.symbol, market, args.start, args.end, source);
    if (result.bars.length === 0) {
      return ok(
        [
          `No bars for ${args.symbol}.`,
          `Market     ${market}`,
          "Source     akshare",
        ].join("\n"),
        { symbol: args.symbol, market, source: "akshare", barCount: 0 },
      );
    }

    const first = result.bars[0];
    const latest = result.bars[result.bars.length - 1];
    return ok(
      [
        `Downloaded  ${args.symbol}`,
        `Source      ${result.source}`,
        `Bars        ${result.bars.length}`,
        `Range       ${first?.date} → ${latest?.date}`,
        `Latest      ${latest?.close.toFixed(2)}`,
      ].join("\n"),
      { symbol: args.symbol, market, source: result.source, barCount: result.bars.length },
    );
  },
};

export const searchSymbolsTool: AgentTool<typeof SearchSymbols> = {
  name: "search_symbols",
  description: "Search stock symbols through the configured direct adapters.",
  label: "Search Symbols",
  parameters: SearchSymbols,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof SearchSymbols>): Promise<AgentToolResult<unknown>> {
    const rows = await searchSymbols(args.keyword, (args.market as Market | undefined) || "A");
    if (rows.length === 0) {
      return ok(`No symbols found for ${args.keyword}.`, { count: 0 });
    }
    const top = rows.slice(0, 10);
    return ok(
      [`Found  ${rows.length}`, ...top.map((row) => `${row.code}  ${row.name}`)].join("\n"),
      { count: rows.length, rows: top },
    );
  },
};

export const fetchSnapshotTool: AgentTool<typeof FetchSnapshot> = {
  name: "fetch_snapshot",
  description: "Fetch a compact company or trading snapshot through direct data adapters.",
  label: "Snapshot",
  parameters: FetchSnapshot,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof FetchSnapshot>): Promise<AgentToolResult<unknown>> {
    const market = (args.market || inferMarket(args.symbol)) as Market;
    let snapshot: Record<string, unknown>;
    if (market === "A") {
      snapshot = await fetchTushareSnapshot(args.symbol);
    } else {
      snapshot = await fetchFinancialDatasetsSnapshot(args.symbol);
    }
    const rows = Object.entries(snapshot)
      .filter(([, value]) => value != null && value !== "")
      .slice(0, 8)
      .map(([key, value]) => `${key}  ${String(value)}`);
    if (rows.length === 0) {
      return ok(`No snapshot data for ${args.symbol}.`, { symbol: args.symbol, market });
    }
    return ok([`Snapshot  ${args.symbol}`, ...rows].join("\n"), { symbol: args.symbol, market, snapshot });
  },
};

function inferMarket(symbol: string): Market {
  if (/\.HK$/i.test(symbol)) return "HK";
  if (/^[A-Z][A-Z0-9.-]*$/i.test(symbol) && !/^\d{6}/.test(symbol)) return "US";
  return "A";
}

export const DATA_TOOLS: AgentTool[] = [fetchBarsTool, searchSymbolsTool, fetchSnapshotTool];
