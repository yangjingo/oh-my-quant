/**
 * Sync portfolio data loader for the frame-buffer TUI dock panel.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PanelSection, Holding, Quote } from "./types.ts";

const DATA = join(process.cwd(), ".ohquant", "data");
const SOURCES = ["tushare", "akshare", "llmquant-data"];

export function loadPortfolioSnapshot(): PanelSection[] {
  const sections: PanelSection[] = [];
  const holdings = loadHoldings();
  if (holdings.length > 0) sections.push({ kind: "holdings", title: "Holdings", rows: holdings });
  const watch = loadWatchlistPrices();
  if (watch.length > 0) sections.push({ kind: "quotes", title: "Watchlist", rows: watch });
  const market = loadMarketIndices();
  if (market.length > 0) sections.push({ kind: "quotes", title: "Market", rows: market });
  return sections;
}

function loadHoldings(): Holding[] {
  const result: Holding[] = [];
  for (const src of SOURCES) {
    const dir = join(DATA, src);
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const bars = loadBars(join(dir, entry.name));
        if (bars.length < 2) continue;
        const meta = loadMeta(join(dir, entry.name));
        const last = bars[bars.length - 1], prev = bars[bars.length - 2];
        result.push({
          code: entry.name,
          name: meta?.name || entry.name,
          price: last.close,
          pct: prev.close ? (last.close - prev.close) / prev.close * 100 : 0,
        });
      }
    } catch { /* skip */ }
  }
  return result.slice(0, 20);
}

function loadWatchlistPrices(): Quote[] {
  const result: Quote[] = [];
  try {
    const wp = join(process.cwd(), ".ohquant", "watchlist.json");
    if (!existsSync(wp)) return [];
    const wl = JSON.parse(readFileSync(wp, "utf-8"));
    for (const f of (wl.funds || []).slice(0, 5)) {
      const bars = loadBarsForCode(f.code);
      if (bars.length < 2) continue;
      const last = bars[bars.length - 1], prev = bars[bars.length - 2];
      result.push({ symbol: f.name || f.code, price: last.close, pct: (last.close - prev.close) / prev.close * 100 });
    }
  } catch { /* skip */ }
  return result;
}

function loadMarketIndices(): Quote[] {
  const result: Quote[] = [];
  for (const src of ["tushare", "akshare"]) {
    const dir = join(DATA, src);
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const name = entry.name.toUpperCase();
        if (name.includes("000300") || name.includes("399001") || name.includes("000001") || name.includes("HSI")) {
          const bars = loadBars(join(dir, entry.name));
          if (bars.length < 2) continue;
          const last = bars[bars.length - 1], prev = bars[bars.length - 2];
          const label = name.includes("000300") ? "沪深300" : name.includes("399001") ? "深证" : name.includes("HSI") ? "恒生" : name;
          result.push({ symbol: label, price: last.close, pct: (last.close - prev.close) / prev.close * 100 });
        }
      }
    } catch { /* skip */ }
  }
  return result;
}

function loadBars(dir: string): Array<{ date: string; close: number }> {
  const dp = join(dir, "daily.json");
  if (!existsSync(dp)) return [];
  try { return JSON.parse(readFileSync(dp, "utf-8")); } catch { return []; }
}

function loadMeta(dir: string): { name?: string } | null {
  const mp = join(dir, "meta.json");
  if (!existsSync(mp)) return null;
  try { return JSON.parse(readFileSync(mp, "utf-8")); } catch { return null; }
}

function loadBarsForCode(code: string): Array<{ date: string; close: number }> {
  for (const src of SOURCES) {
    const dir = join(DATA, src, code);
    if (!existsSync(dir)) continue;
    const bars = loadBars(dir);
    if (bars.length > 0) return bars;
  }
  return [];
}

// ── Backward-compat exports (used by Ink components) ──

export interface CodeEntry { code: string; name: string }
export interface WatchItem { code: string; name: string; source?: string; latest?: { date: string; close: number; changePct: number } }
export interface SidebarSnapshot { watchItems: WatchItem[]; localSources: string[] }

export async function loadLocalModel(): Promise<string> {
  try {
    const s = JSON.parse(existsSync(join(process.cwd(), ".ohquant", "settings.json"))
      ? readFileSync(join(process.cwd(), ".ohquant", "settings.json"), "utf-8") : "{}");
    return s?.env?.["WHYJ_DEFAULT_SONNET_MODEL"] ?? "deepseek-v4-pro";
  } catch { return "deepseek-v4-pro"; }
}

export async function loadWatchlistEntries(): Promise<CodeEntry[]> {
  try {
    const wp = join(process.cwd(), ".ohquant", "watchlist.json");
    if (!existsSync(wp)) return [];
    const d = JSON.parse(readFileSync(wp, "utf-8"));
    if (d?.funds?.length) return d.funds;
    if (d?.stocks?.length) return d.stocks;
    return [];
  } catch { return []; }
}

export async function loadSidebarSnapshot(): Promise<SidebarSnapshot> {
  const watchItems: WatchItem[] = [];
  for (const h of loadHoldings()) {
    watchItems.push({ code: h.code, name: h.name, latest: { date: "", close: h.price, changePct: h.pct } });
  }
  const localSources = SOURCES.filter((s) => existsSync(join(DATA, s)));
  return { watchItems, localSources: localSources.map((s) => `${s} 0`) };
}
