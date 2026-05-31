/** Daily OHLCV bar */
export interface Bar {
  date: string;     // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  adjClose?: number;
}

export type Market = "A" | "US" | "HK";

export interface SymbolInfo {
  code: string;
  name: string;
  market: Market;
  exchange?: string;
  type?: "stock" | "etf" | "index" | "fund";
  listDate?: string;
}

export interface SymbolMeta {
  symbol: string;
  name: string;
  market: string;
  source: string;
  firstDate: string;
  lastDate: string;
  rowCount: number;
  fetchedAt: string;
}

export interface FundHolding {
  code: string;
  name: string;
  type?: string;
  manager?: string;
  company?: string;
  addedDate?: string;
  note?: string;
  lockedUntil?: string | null;
}

export interface HoldingsFile {
  updated: string;
  funds: FundHolding[];
  focusSectors?: string[];
  hash?: string;
  hashOf?: string;
}

export interface DailyNav {
  date: string;
  nav: number;
  chgPct: number;
  navDate: string;
}

export interface DailyFile {
  funds: Record<string, DailyNav[]>;
  dates: string[];
  lastUpdated: string;
}
