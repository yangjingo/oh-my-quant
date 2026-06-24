import type { Bar, SymbolInfo } from "../../types/data.ts";
import { postJson } from "./http.ts";
import { readWhyjEnvValue } from "../../storage/index.ts";

const TUSHARE_BASE_URL = process.env.TUSHARE_BASE_URL || "https://api.tushare.pro";

interface TushareResponse<T> {
  code: number;
  msg?: string;
  data?: {
    fields: string[];
    items: T[];
  };
}

type TusharePrimitive = string | number | null;

function token(): string {
  const value = readWhyjEnvValue(process.env, "tushareToken");
  if (!value) throw new Error("WHYJ_QUANT_TUSHARE_TOKEN is not configured");
  return value;
}

async function callTushare<T extends TusharePrimitive[]>(
  apiName: string,
  params: Record<string, unknown>,
  fields: string[],
): Promise<Array<Record<string, TusharePrimitive>>> {
  const result = await postJson<TushareResponse<T>>(TUSHARE_BASE_URL, {
    api_name: apiName,
    token: token(),
    params,
    fields: fields.join(","),
  });
  if (result.code !== 0) {
    throw new Error(result.msg || `${apiName} failed`);
  }
  const resultFields = result.data?.fields || fields;
  const items = result.data?.items || [];
  return items.map((row) => Object.fromEntries(resultFields.map((field, index) => [field, row[index] ?? null])));
}

function formatDate(d: string): string {
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
}

export async function fetchFromTushare(symbol: string, start?: string, end?: string): Promise<Bar[]> {
  const dateParams = {
    ...(start ? { start_date: start.replace(/-/g, "") } : {}),
    ...(end ? { end_date: end.replace(/-/g, "") } : {}),
  };

  // Try stock daily first; fall back to fund_daily for ETF/LOF symbols
  let rows = await callTushare("daily", { ts_code: symbol, ...dateParams }, DAILY_FIELDS);
  if (rows.length === 0) {
    rows = await callTushare("fund_daily", { ts_code: symbol, ...dateParams }, DAILY_FIELDS);
  }

  return rows.map((row) => ({
    date: formatDate(String(row.trade_date || "")),
    open: Number(row.open || 0),
    high: Number(row.high || 0),
    low: Number(row.low || 0),
    close: Number(row.close || 0),
    volume: Number(row.vol || 0),
    amount: Number(row.amount || 0),
  }));
}

const DAILY_FIELDS = ["ts_code", "trade_date", "open", "high", "low", "close", "vol", "amount"];

export async function searchTushareSymbols(keyword: string): Promise<SymbolInfo[]> {
  const rows = await callTushare(
    "stock_basic",
    { name: keyword, list_status: "L" },
    ["ts_code", "name", "area", "industry", "market", "list_date"],
  );
  return rows.map((row) => ({
    code: String(row.ts_code || ""),
    name: String(row.name || row.ts_code || ""),
    market: "A",
    exchange: String(row.ts_code || "").endsWith(".SH") ? "SSE" : "SZSE",
    type: "stock",
    listDate: String(row.list_date || ""),
  }));
}

export async function fetchTushareSnapshot(symbol: string): Promise<Record<string, unknown>> {
  const [basic] = await callTushare(
    "daily_basic",
    { ts_code: symbol },
    ["ts_code", "trade_date", "close", "pe", "pe_ttm", "pb", "total_mv", "circ_mv"],
  );
  return basic || {};
}
