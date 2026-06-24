import { Type } from "typebox";
import type { Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { fetchFinancialDatasetsSnapshot, fetchTushareSnapshot, fetchBars, searchSymbols } from "../source/index.ts";
import type { DataSource } from "../source/index.ts";
import type { Bar, Market } from "../types/data.ts";

const FetchBars = Type.Object({
  symbol: Type.String({ description: "Market symbol such as 000300.SH or 159915" }),
  market: Type.Optional(Type.String({ description: "Market code: A, US, HK" })),
  start: Type.Optional(Type.String({ description: "Start date YYYY-MM-DD" })),
  end: Type.Optional(Type.String({ description: "End date YYYY-MM-DD" })),
  source: Type.Optional(Type.String({ description: "Preferred data source: akshare (default) or tushare" })),
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
      `No daily-bars adapter is available for ${symbol} in market ${market}.`,
      `Market     ${market}`,
      "Source     akshare supports A-share, index, and fund symbols",
      "Next       Use an A-share/fund symbol, or ask the agent to update local files from a configured source.",
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

    const source: DataSource = args.source === "tushare" ? "tushare" : "akshare";
    const result = await fetchBars(args.symbol, market, args.start, args.end, source);
    if (result.bars.length === 0) {
      return ok(
        [
          `No daily bars were returned for ${args.symbol}.`,
          `Market     ${market}`,
          "Source     akshare",
          "Next       Check the symbol/date range, or run /config to verify the data source.",
        ].join("\n"),
        { symbol: args.symbol, market, source: "akshare", barCount: 0 },
      );
    }

    const first = result.bars[0];
    const latest = result.bars[result.bars.length - 1];
    return ok(
      [
        `Downloaded  ${args.symbol}`,
        ...formatBarsChartBlock(result.bars),
        `Source      ${result.source}`,
        `Bars        ${result.bars.length}`,
        `Range       ${first?.date} → ${latest?.date}`,
        `Latest      ${latest?.close.toFixed(2)}`,
      ].join("\n"),
      { symbol: args.symbol, market, source: result.source, barCount: result.bars.length },
    );
  },
};

const SPARK_CHARS = "▁▂▃▄▅▆▇█";

export function formatBarsChartBlock(bars: Bar[]): string[] {
  if (bars.length === 0) return [];
  return [
    formatCloseSparkline(bars),
    formatVolumeSparkline(bars),
    ...formatKLineRows(bars),
  ];
}

function formatCloseSparkline(bars: Bar[], count = 24): string {
  const sample = bars.slice(-count);
  const closes = sample.map((bar) => bar.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min;
  const spark = closes.map((close) => {
    const idx = span === 0 ? Math.floor(SPARK_CHARS.length / 2) : Math.round((close - min) / span * (SPARK_CHARS.length - 1));
    return SPARK_CHARS[Math.max(0, Math.min(SPARK_CHARS.length - 1, idx))];
  }).join("");
  const latest = sample[sample.length - 1];
  const previous = sample[sample.length - 2];
  const change = previous && previous.close !== 0 ? (latest.close - previous.close) / previous.close * 100 : 0;
  return `⌁ Close     ${spark}  ${latest.close.toFixed(2)}  ${formatSignedPct(change)}`;
}

function formatVolumeSparkline(bars: Bar[], count = 24): string {
  const sample = bars.slice(-count);
  const volumes = sample.map((bar) => bar.volume);
  const min = Math.min(...volumes);
  const max = Math.max(...volumes);
  const span = max - min;
  const spark = volumes.map((volume) => {
    const idx = span === 0 ? Math.floor(SPARK_CHARS.length / 2) : Math.round((volume - min) / span * (SPARK_CHARS.length - 1));
    return SPARK_CHARS[Math.max(0, Math.min(SPARK_CHARS.length - 1, idx))];
  }).join("");
  const latest = sample[sample.length - 1];
  return `▥ Volume    ${spark}  ${formatCompactNumber(latest.volume)}`;
}

function formatKLineRows(bars: Bar[], count = 3): string[] {
  const start = Math.max(0, bars.length - count);
  const rows = ["┃ K-line"];
  for (let i = start; i < bars.length; i++) {
    const bar = bars[i]!;
    const previous = bars[i - 1];
    const direction = bar.close > bar.open ? "▲" : bar.close < bar.open ? "▼" : "─";
    const base = previous?.close || bar.open;
    const change = base !== 0 ? (bar.close - base) / base * 100 : 0;
    rows.push(
      `${bar.date}  ${direction}  O=${bar.open.toFixed(2)} H=${bar.high.toFixed(2)} L=${bar.low.toFixed(2)} C=${bar.close.toFixed(2)}  ${formatSignedPct(change)}`,
    );
  }
  return rows;
}

function formatSignedPct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatCompactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toFixed(0);
}

export const searchSymbolsTool: AgentTool<typeof SearchSymbols> = {
  name: "search_symbols",
  description: "Search stock symbols through the configured direct adapters.",
  label: "Search Symbols",
  parameters: SearchSymbols,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof SearchSymbols>): Promise<AgentToolResult<unknown>> {
    const rows = await searchSymbols(args.keyword, (args.market as Market | undefined) || "A");
    if (rows.length === 0) {
      return ok(
        [
          `No symbols matched "${args.keyword}".`,
          "Next       Try a full code such as 000001.SZ, or use a more specific Chinese/English name.",
        ].join("\n"),
        { count: 0 },
      );
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
      return ok(
        [
          `No snapshot fields were returned for ${args.symbol}.`,
          `Market     ${market}`,
          "Next       Check the symbol and configured data keys in /config, then retry.",
        ].join("\n"),
        { symbol: args.symbol, market },
      );
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
