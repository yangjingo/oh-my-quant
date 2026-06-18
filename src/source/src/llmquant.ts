import type { Bar } from "../../types/data.ts";
import { getJson } from "./http.ts";

const LLMQUANT_BASE_URL = process.env.LLMQUANT_BASE_URL || "https://api.llmquantdata.com";

function apiKey(): string {
  const value = process.env.LLMQUANT_API_KEY;
  if (!value) throw new Error("LLMQUANT_API_KEY is not configured");
  return value;
}

type LlmQuantRow = {
  date?: string;
  trade_date?: string;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  close?: number | string;
  volume?: number | string;
  adj_close?: number | string;
};

function rowsFromPayload(payload: unknown): LlmQuantRow[] {
  if (Array.isArray(payload)) return payload as LlmQuantRow[];
  if (payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown[] }).data)) {
    return (payload as { data: LlmQuantRow[] }).data;
  }
  return [];
}

export async function fetchFromLlmQuant(symbol: string, start?: string, end?: string): Promise<Bar[]> {
  const query = new URLSearchParams({
    ticker: symbol,
    ...(start ? { start_date: start } : {}),
    ...(end ? { end_date: end } : {}),
  });
  const payload = await getJson<unknown>(`${LLMQUANT_BASE_URL}/equity_historical_prices?${query.toString()}`, {
    authorization: `Bearer ${apiKey()}`,
  });
  const rows = rowsFromPayload(payload);
  return rows.map((row) => ({
    date: String(row.date || row.trade_date || ""),
    open: Number(row.open || 0),
    high: Number(row.high || 0),
    low: Number(row.low || 0),
    close: Number(row.close || 0),
    volume: Number(row.volume || 0),
    amount: 0,
    adjClose: row.adj_close != null ? Number(row.adj_close) : undefined,
  }));
}
