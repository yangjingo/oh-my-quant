/**
 * Market source adapters — local/direct providers + local cache fallback.
 */

import { fetchFromAKShare } from "./akshare.ts";
import { fetchFromFinancialDatasets } from "./financial-datasets.ts";
import { fetchFromLlmQuant } from "./llmquant.ts";
import { fetchFromTushare, searchTushareSymbols } from "./tushare.ts";
import { loadBars, saveBars, isCacheFresh } from "../../storage/bars.ts";
import { loadSettings } from "../../storage/index.ts";
import type { Bar, Market, SymbolInfo } from "../../types/data.ts";

export type DataSource = "auto" | "akshare" | "tushare" | "llmquant-data" | "financial-datasets";

/** Provider id returned by live pull (not cache). */
export type PullSource = "akshare" | "tushare" | "llmquant-data" | "financial-datasets" | "unavailable";

export interface LiveFetchResult {
  bars: Bar[];
  source: PullSource;
  /** Latest bar date from provider, e.g. 2026-06-08. */
  asOfDate: string;
}

export const SOURCE_LABELS: Record<PullSource, string> = {
  akshare: "AKShare · 东方财富",
  tushare: "Tushare",
  "llmquant-data": "LLMQuant",
  "financial-datasets": "Financial Datasets",
  unavailable: "暂无数据",
};

export function formatSourceLabels(sources: Iterable<PullSource>): string {
  const uniq = [...new Set(sources)].filter((s) => s !== "unavailable");
  if (uniq.length === 0) return SOURCE_LABELS.unavailable;
  return uniq.map((s) => SOURCE_LABELS[s]).join(" + ");
}

/** Local wall-clock time with minute precision for Overview attribution. */
export function formatRefreshMinute(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Fetch daily bars. source="auto" picks best available. Explicit source skips cache. */
export async function fetchBars(
  symbol: string,
  market: Market,
  start?: string,
  end?: string,
  source?: DataSource,
): Promise<{ bars: Bar[]; source: string }> {
  const explicit = source && source !== "auto";
  const selected = source && source !== "auto" ? source : defaultSourceForMarket(market);

  // Cache: only use when auto mode and fresh
  if (!explicit) {
    const fresh = await isCacheFresh(symbol, selected);
    if (fresh) {
      const cached = await loadBars(symbol, selected);
      const filtered = filterBarsByDate(cached, start, end);
      if (filtered.length > 0) return { bars: filtered, source: selected };
    }
  }

  let bars = (await pullBarsFromProviders(symbol, market, start, end, selected)).bars;

  // Last resort: load any cached data
  if (bars.length === 0) {
    for (const src of ["akshare", "tushare", "llmquant-data", "financial-datasets"]) {
      const cached = await loadBars(symbol, src);
      if (cached.length > 0) { bars = cached; break; }
    }
  }

  const usedSource = explicit ? selected : (bars.length > 0 ? selected : "cache");
  if (bars.length > 0) {
    await saveBars(symbol, usedSource, bars);
  }

  return { bars: filterBarsByDate(bars, start, end), source: usedSource };
}

/** Live provider pull for TUI quotes — never reads or writes `.ohquant/data` cache. */
export async function fetchLiveBars(
  symbol: string,
  market: Market,
  start?: string,
  end?: string,
): Promise<LiveFetchResult> {
  const selected = defaultSourceForMarket(market);
  const pulled = await pullBarsFromProviders(symbol, market, start, end, selected);
  const bars = filterBarsByDate(pulled.bars, start, end);
  if (bars.length > 0) {
    return { bars, source: pulled.source, asOfDate: bars[bars.length - 1].date };
  }

  if (start || end) {
    const fallback = await pullBarsFromProviders(symbol, market, undefined, undefined, selected);
    if (fallback.bars.length > 0) {
      return {
        bars: fallback.bars,
        source: fallback.source,
        asOfDate: fallback.bars[fallback.bars.length - 1]?.date || "",
      };
    }
  }

  return { bars: [], source: pulled.source, asOfDate: "" };
}

/** Normalize bare 6-digit Chinese codes to exchange-suffixed format. */
function normalizeSymbol(symbol: string, market: Market): string {
  if (market !== "A") return symbol;
  // Already suffixed
  if (/\.(SH|SZ|BJ|OF)$/i.test(symbol)) return symbol;
  // 6-digit bare code
  if (/^\d{6}$/.test(symbol)) {
    const prefix = symbol.charAt(0);
    // Shanghai: 5xxxxx (funds), 6xxxxx (stocks), 68xxxx (STAR)
    if (prefix === "5" || prefix === "6") return `${symbol}.SH`;
    // Beijing: 8xxxxx, 4xxxxx
    if (prefix === "8" || prefix === "4") return `${symbol}.BJ`;
    // Shenzhen: 0xxxxx (funds), 1xxxxx (funds), 2xxxxx (stocks), 3xxxxx (ChiNext)
    return `${symbol}.SZ`;
  }
  return symbol;
}

/** Provider fallback chain for live/cache pulls. */
export async function pullBarsFromProviders(
  symbol: string,
  market: Market,
  start?: string,
  end?: string,
  selected: DataSource = defaultSourceForMarket(market),
): Promise<{ bars: Bar[]; source: PullSource }> {
  const normalized = normalizeSymbol(symbol, market);

  // Always try AKShare + Tushare for A-shares (regardless of selected source)
  if (market === "A") {
    try {
      const bars = await fetchFromAKShare(normalized, start, end);
      if (bars.length > 0) return { bars, source: "akshare" };
    } catch { /* fall through */ }

    try {
      const bars = await fetchFromTushare(normalized, start, end);
      if (bars.length > 0) return { bars, source: "tushare" };
    } catch { /* fall through */ }
  }

  // Try LLMQuant for US/HK or when selected explicitly
  if (selected === "llmquant-data" || market === "US" || market === "HK") {
    try {
      const bars = await fetchFromLlmQuant(normalized, start, end);
      if (bars.length > 0) return { bars, source: "llmquant-data" };
    } catch { /* fall through */ }
  }

  // Try Financial Datasets for US or when selected explicitly
  if (selected === "financial-datasets" || market === "US") {
    try {
      const bars = await fetchFromFinancialDatasets(normalized, start, end);
      if (bars.length > 0) return { bars, source: "financial-datasets" };
    } catch { /* fall through */ }
  }

  return { bars: [], source: "unavailable" };
}

/** Search symbols */
export async function searchSymbols(
  keyword: string,
  market?: Market,
): Promise<SymbolInfo[]> {
  if (market && market !== "A") return [];
  try {
    return await searchTushareSymbols(keyword);
  } catch {
    return [];
  }
}

function defaultSourceForMarket(_market: Market): DataSource {
  const settings = loadSettings();
  return settings.preferences.source;
}

// --- Helpers ---

export function filterBarsByDate(bars: Bar[], start?: string, end?: string): Bar[] {
  return bars.filter((b) => {
    if (start && b.date < start) return false;
    if (end && b.date > end) return false;
    return true;
  });
}
