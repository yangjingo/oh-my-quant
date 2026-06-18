import type { Bar } from "../../types/data.ts";
import { getJson } from "./http.ts";

const FD_BASE_URL = process.env.FINANCIAL_DATASETS_BASE_URL || "https://api.financialdatasets.ai";

function apiKey(): string {
  const value = process.env.FINANCIAL_DATASETS_KEY;
  if (!value) throw new Error("FINANCIAL_DATASETS_KEY is not configured");
  return value;
}

function authHeaders(): Record<string, string> {
  return { "x-api-key": apiKey() };
}

type FDPriceRow = {
  date?: string;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  close?: number | string;
  volume?: number | string;
};

function rowsFromPayload(payload: unknown): FDPriceRow[] {
  if (Array.isArray(payload)) return payload as FDPriceRow[];
  if (payload && typeof payload === "object" && Array.isArray((payload as { prices?: unknown[] }).prices)) {
    return (payload as { prices: FDPriceRow[] }).prices;
  }
  if (payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown[] }).data)) {
    return (payload as { data: FDPriceRow[] }).data;
  }
  return [];
}

export async function fetchFromFinancialDatasets(symbol: string, start?: string, end?: string): Promise<Bar[]> {
  const query = new URLSearchParams({
    ticker: symbol,
    ...(start ? { start_date: start } : {}),
    ...(end ? { end_date: end } : {}),
  });
  const payload = await getJson<unknown>(`${FD_BASE_URL}/get_stock_prices?${query.toString()}`, authHeaders());
  const rows = rowsFromPayload(payload);
  return rows.map((row) => ({
    date: String(row.date || ""),
    open: Number(row.open || 0),
    high: Number(row.high || 0),
    low: Number(row.low || 0),
    close: Number(row.close || 0),
    volume: Number(row.volume || 0),
    amount: 0,
  }));
}

export async function fetchFinancialDatasetsSnapshot(symbol: string): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({ ticker: symbol });
  const metrics = await getJson<Record<string, unknown>>(
    `${FD_BASE_URL}/get_financial_metrics_snapshot?${query.toString()}`,
    authHeaders(),
  );
  const company = await getJson<Record<string, unknown>>(
    `${FD_BASE_URL}/get_company_facts?${query.toString()}`,
    authHeaders(),
  );
  return { ...company, ...metrics };
}
