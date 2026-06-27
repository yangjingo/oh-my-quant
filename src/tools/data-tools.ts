import { Type } from "typebox";
import type { Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  AKSHARE_PUBLIC_INDEX_ENDPOINTS,
  fetchAkshareAIndexSpot,
  fetchAkshareIndexConstituents,
  fetchAkshareIndexInfo,
  fetchAkshareIndexRows,
  fetchFinancialDatasetsSnapshot,
  fetchTushareSnapshot,
  fetchBars,
  searchSymbols,
  type AkshareIndexConstituent,
  type AkshareIndexConstituentsResult,
  type AkshareIndexInfoRow,
  type AkshareIndexQuote,
  type AksharePublicIndexEndpoint,
  type DataSource,
} from "../source/index.ts";
import type { Bar, Market } from "../types/data.ts";
import { AKSHARE_FUND_TOOLS } from "./akshare-fund-tools.ts";

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

const FetchIndexSpot = Type.Object({
  symbol: Type.Optional(Type.String({ description: "AKShare stock_zh_index_spot_em category, e.g. 沪深重要指数/上证系列指数/深证系列指数/中证系列指数. Defaults to common A-share index categories." })),
  keyword: Type.Optional(Type.String({ description: "Local keyword filter across index code/name/category." })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Maximum rows to include. Default 20." })),
});

const FetchIndexInfo = Type.Object({
  keyword: Type.Optional(Type.String({ description: "Local keyword filter across index code/name/publish date." })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Maximum rows to include. Default 20." })),
});

const FetchIndexConstituents = Type.Object({
  symbol: Type.String({ description: "Index code such as 000300, 399300, 000905, or 399639." }),
  keyword: Type.Optional(Type.String({ description: "Local keyword filter across stock code/name/exchange." })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Maximum constituents to include. Default 20." })),
  source_priority: Type.Optional(Type.String({ description: "Optional source order: csindex,sina,index_stock_cons. Default tries csindex then sina then index_stock_cons." })),
});

const FetchIndexRows = Type.Object({
  endpoint: Type.String({ description: "Whitelisted AKShare index endpoint, e.g. index_zh_a_hist, stock_zh_index_spot_em, index_realtime_sw, stock_zh_index_hist_csindex." }),
  params: Type.Optional(Type.Any({ description: "Endpoint keyword parameters passed to AKShare, such as { symbol: '000300', start_date: '20260101', end_date: '20260627' }." })),
  keyword: Type.Optional(Type.String({ description: "Local keyword filter across returned values. Not passed to AKShare." })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Maximum rows to include. Default 20." })),
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

export const fetchIndexSpotTool: AgentTool<typeof FetchIndexSpot> = {
  name: "fetch_index_spot",
  description: "Fetch realtime A-share index quotes through AKShare stock_zh_index_spot_em.",
  label: "Index Spot",
  parameters: FetchIndexSpot,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof FetchIndexSpot>): Promise<AgentToolResult<unknown>> {
    const categories = args.symbol
      ? [args.symbol]
      : ["沪深重要指数", "上证系列指数", "深证系列指数", "中证系列指数"];
    const quotes = await fetchAkshareAIndexSpot(categories);
    const filtered = filterIndexQuotes(quotes, args.keyword);
    const rows = filtered.slice(0, outputLimit(args.limit));
    if (rows.length === 0) {
      return ok(
        [
          "Index Spot  no rows",
          "Source      akshare:stock_zh_index_spot_em",
          args.keyword ? `Filter      ${args.keyword}` : "Filter      --",
        ].join("\n"),
        { source: "akshare", endpoint: "stock_zh_index_spot_em", categories, count: 0, quotes: [] },
      );
    }
    return ok(
      [
        "Index Spot  AKShare realtime",
        "Endpoint    stock_zh_index_spot_em",
        `Rows        ${filtered.length}`,
        ...rows.map(formatIndexQuoteRow),
      ].join("\n"),
      { source: "akshare", endpoint: "stock_zh_index_spot_em", categories, count: filtered.length, quotes: rows },
    );
  },
};

export const fetchIndexInfoTool: AgentTool<typeof FetchIndexInfo> = {
  name: "fetch_index_info",
  description: "Fetch AKShare index_stock_info catalogue rows for index code lookup.",
  label: "Index Info",
  parameters: FetchIndexInfo,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof FetchIndexInfo>): Promise<AgentToolResult<unknown>> {
    const data = await fetchAkshareIndexInfo(args.keyword);
    const rows = data.rows.slice(0, outputLimit(args.limit, 500));
    return ok(
      formatIndexInfoText(data.rowCount, data.rows.length, rows, args.keyword),
      {
        source: "akshare",
        endpoint: "index_stock_info",
        fetchedAt: data.fetchedAt,
        rowCount: data.rowCount,
        filteredRowCount: data.rows.length,
        rows,
      },
    );
  },
};

export const fetchIndexConstituentsTool: AgentTool<typeof FetchIndexConstituents> = {
  name: "fetch_index_constituents",
  description: "Fetch latest index constituents through AKShare, preferring csindex/sina and falling back to index_stock_cons.",
  label: "Index Constituents",
  parameters: FetchIndexConstituents,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof FetchIndexConstituents>): Promise<AgentToolResult<unknown>> {
    const data = await fetchAkshareIndexConstituents(args.symbol, args.source_priority);
    const filtered = filterIndexConstituents(data.constituents, args.keyword);
    const rows = filtered.slice(0, outputLimit(args.limit, 500));
    return ok(
      formatIndexConstituentsText(data, filtered.length, rows, args.keyword),
      {
        source: "akshare",
        endpoint: data.source,
        symbol: data.symbol,
        indexName: data.indexName,
        fetchedAt: data.fetchedAt,
        count: data.constituents.length,
        filteredCount: filtered.length,
        rows,
        attempts: data.attempts,
      },
    );
  },
};

export const fetchIndexRowsTool: AgentTool<typeof FetchIndexRows> = {
  name: "fetch_index_rows",
  description: "Fetch rows from a whitelisted AKShare index endpoint with local preview filtering.",
  label: "Index Rows",
  parameters: FetchIndexRows,
  executionMode: "sequential",
  async execute(_id: string, args: Static<typeof FetchIndexRows>): Promise<AgentToolResult<unknown>> {
    const endpoint = args.endpoint.trim();
    if (!AKSHARE_PUBLIC_INDEX_ENDPOINTS.includes(endpoint as AksharePublicIndexEndpoint)) {
      return ok(
        [
          `Unsupported AKShare index endpoint: ${endpoint}`,
          "Next       Use one of the whitelisted index endpoints from AKSHARE_PUBLIC_INDEX_ENDPOINTS.",
        ].join("\n"),
        { endpoint, supportedEndpoints: AKSHARE_PUBLIC_INDEX_ENDPOINTS },
      );
    }
    const params = isRecord(args.params) ? args.params : {};
    const data = await fetchAkshareIndexRows(endpoint as AksharePublicIndexEndpoint, params);
    const filtered = filterRowsByKeyword(data.rows, args.keyword);
    const rows = filtered.slice(0, outputLimit(args.limit));
    return ok(
      formatIndexRowsText(endpoint, data.rowCount, filtered.length, rows, params, args.keyword),
      {
        source: "akshare",
        endpoint,
        params,
        fetchedAt: data.fetchedAt,
        rowCount: data.rowCount,
        filteredRowCount: filtered.length,
        rows,
      },
    );
  },
};

function formatIndexInfoText(
  rowCount: number,
  filteredRowCount: number,
  rows: AkshareIndexInfoRow[],
  keyword?: string,
): string {
  const lines = [
    "Index Info  AKShare index_stock_info",
    `Rows        ${filteredRowCount === rowCount ? rowCount : `${filteredRowCount} / ${rowCount}`}`,
  ];
  if (keyword) lines.push(`Filter      ${keyword}`);
  if (rows.length === 0) {
    lines.push("Preview     --");
    return lines.join("\n");
  }
  lines.push(...rows.map((row) => `${row.indexCode.padEnd(8)} ${row.displayName.padEnd(18)} ${row.publishDate || "--"}`));
  return lines.join("\n");
}

function filterIndexConstituents(rows: AkshareIndexConstituent[], keyword?: string): AkshareIndexConstituent[] {
  const lower = String(keyword || "").trim().toLowerCase();
  if (!lower) return rows;
  return rows.filter((row) => [
    row.stockCode,
    row.stockName,
    row.inclusionDate,
    row.indexCode,
    row.indexName,
    row.exchange,
    row.source,
  ].some((value) => String(value || "").toLowerCase().includes(lower)));
}

function formatIndexConstituentsText(
  data: AkshareIndexConstituentsResult,
  filteredCount: number,
  rows: AkshareIndexConstituent[],
  keyword?: string,
): string {
  const title = data.indexName ? `${data.indexName} (${data.symbol})` : data.symbol;
  const lines = [
    `Index Cons  ${title}`,
    `Source      ${data.source || "--"}`,
    `Rows        ${filteredCount === data.constituents.length ? data.constituents.length : `${filteredCount} / ${data.constituents.length}`}`,
  ];
  if (keyword) lines.push(`Filter      ${keyword}`);
  if (data.attempts.length > 0) {
    lines.push(`Attempts    ${data.attempts.map((attempt) => `${attempt.endpoint}:${attempt.status}${attempt.rows == null ? "" : `(${attempt.rows})`}`).join(" -> ")}`);
  }
  if (rows.length === 0) {
    lines.push("Preview     --");
    return lines.join("\n");
  }
  rows.forEach((row, index) => lines.push(formatIndexConstituentRow(row, index + 1)));
  return lines.join("\n");
}

function formatIndexConstituentRow(row: AkshareIndexConstituent, index: number): string {
  const extras = [
    row.inclusionDate ? `纳入=${row.inclusionDate}` : "",
    row.weight == null ? "" : `权重=${formatCell(row.weight)}%`,
    row.exchange ? `交易所=${row.exchange}` : "",
  ].filter(Boolean).join("  ");
  return `${String(index).padStart(2, "0")}         ${row.stockCode.padEnd(8)} ${row.stockName.padEnd(12)}${extras ? `  ${extras}` : ""}`;
}

function filterIndexQuotes(rows: AkshareIndexQuote[], keyword?: string): AkshareIndexQuote[] {
  const lower = String(keyword || "").trim().toLowerCase();
  if (!lower) return rows;
  return rows.filter((row) => [row.code, row.name, row.category].some((value) => String(value || "").toLowerCase().includes(lower)));
}

function formatIndexQuoteRow(row: AkshareIndexQuote): string {
  const category = row.category ? `  ${row.category}` : "";
  return `${row.code.padEnd(8)} ${row.name.padEnd(12)} ${row.price.toFixed(2).padStart(10)}  ${formatSignedPct(row.changePct ?? 0).padStart(8)}${category}`;
}

function filterRowsByKeyword(rows: Record<string, unknown>[], keyword?: string): Record<string, unknown>[] {
  const lower = String(keyword || "").trim().toLowerCase();
  if (!lower) return rows;
  return rows.filter((row) => Object.values(row).some((value) => textValue(value).toLowerCase().includes(lower)));
}

function formatIndexRowsText(
  endpoint: string,
  rowCount: number,
  filteredRowCount: number,
  rows: Record<string, unknown>[],
  params: Record<string, unknown>,
  keyword?: string,
): string {
  const lines = [
    `AKShare    ${endpoint}`,
    `Rows       ${filteredRowCount === rowCount ? rowCount : `${filteredRowCount} / ${rowCount}`}`,
  ];
  const paramLine = formatParams(params);
  if (paramLine) lines.push(`Params     ${paramLine}`);
  if (keyword) lines.push(`Filter     ${keyword}`);
  if (rows.length === 0) {
    lines.push("Preview    --");
    return lines.join("\n");
  }
  const fields = previewFields(rows);
  lines.push(`Columns    ${fields.join(", ")}`);
  rows.forEach((row, index) => {
    const values = fields.map((field) => `${field}=${formatCell(row[field])}`).join("  ");
    lines.push(`${String(index + 1).padStart(2, "0")}         ${values}`);
  });
  return lines.join("\n");
}

function formatParams(params: Record<string, unknown>): string {
  return Object.entries(params)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `${key}=${formatCell(value)}`)
    .join("  ");
}

const INDEX_PREVIEW_FIELD_PRIORITY = [
  "代码",
  "名称",
  "指数代码",
  "指数名称",
  "指数中文简称",
  "日期",
  "最新价",
  "收盘",
  "收盘指数",
  "涨跌幅",
  "涨跌额",
  "成交量",
  "成交额",
  "开盘",
  "最高",
  "最低",
  "权重",
];

function previewFields(rows: Record<string, unknown>[]): string[] {
  const available = new Set(rows.flatMap((row) => Object.keys(row)));
  const fields = INDEX_PREVIEW_FIELD_PRIORITY.filter((field) => available.has(field));
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!fields.includes(key)) fields.push(key);
      if (fields.length >= 8) return fields;
    }
  }
  return fields.slice(0, 8);
}

function outputLimit(value: unknown, max = 100): number {
  const n = Number(value ?? 20);
  if (!Number.isFinite(n)) return 20;
  return Math.max(1, Math.min(max, Math.trunc(n)));
}

function textValue(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function formatCell(value: unknown): string {
  const text = typeof value === "number" && Number.isFinite(value)
    ? Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "")
    : textValue(value);
  if (!text) return "--";
  return text.length > 30 ? `${text.slice(0, 27)}...` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function inferMarket(symbol: string): Market {
  if (/\.HK$/i.test(symbol)) return "HK";
  if (/^[A-Z][A-Z0-9.-]*$/i.test(symbol) && !/^\d{6}/.test(symbol)) return "US";
  return "A";
}

export const DATA_TOOLS: AgentTool[] = [
  fetchBarsTool,
  searchSymbolsTool,
  fetchSnapshotTool,
  fetchIndexSpotTool,
  fetchIndexInfoTool,
  fetchIndexConstituentsTool,
  fetchIndexRowsTool,
  ...AKSHARE_FUND_TOOLS,
];
