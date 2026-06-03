import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { OhQuantSettings } from "../types/config.ts";
import { DEFAULT_SETTINGS } from "../types/config.ts";

export const OHQUANT_DIR = join(process.cwd(), ".ohquant");
export const DATA_DIR = join(OHQUANT_DIR, "data");
export const SESSIONS_DIR = join(OHQUANT_DIR, "sessions");
export const PORTFOLIO_DIR = join(OHQUANT_DIR, "portfolio");
export const BENCHMARK_DIR = join(OHQUANT_DIR, "benchmark");
export const CACHE_DIR = join(OHQUANT_DIR, "cache");
export const WATCHLIST_PATH = join(OHQUANT_DIR, "watchlist.json");

const SETTINGS_PATH = join(OHQUANT_DIR, "settings.json");

// ── Watchlist ──

export interface WatchlistEntry {
  code: string;
  name: string;
  added: string;
}

export interface Watchlist {
  funds: WatchlistEntry[];
}

export function loadWatchlist(): Watchlist {
  if (!existsSync(WATCHLIST_PATH)) return { funds: [] };
  try {
    const raw = JSON.parse(readFileSync(WATCHLIST_PATH, "utf-8"));
    // migrate old "stocks" format
    if (!raw.funds && raw.stocks) {
      return { funds: raw.stocks.map((s: any) => ({ code: s.code, name: s.name, added: s.added })) };
    }
    return { funds: raw.funds ?? [] };
  } catch {
    return { funds: [] };
  }
}

export function saveWatchlist(wl: Watchlist): void {
  ensureDirs();
  writeFileSync(WATCHLIST_PATH, JSON.stringify(wl, null, 2), "utf-8");
}

export function ensureDirs(): void {
  for (const dir of [DATA_DIR, SESSIONS_DIR, PORTFOLIO_DIR, BENCHMARK_DIR, CACHE_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

export function loadSettings(): OhQuantSettings {
  ensureDirs();
  if (!existsSync(SETTINGS_PATH)) {
    writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2), "utf-8");
    return cloneSettings(DEFAULT_SETTINGS);
  }
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
    return normalizeSettings(raw);
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: OhQuantSettings): void {
  ensureDirs();
  writeFileSync(SETTINGS_PATH, JSON.stringify(normalizeSettings(s), null, 2), "utf-8");
}

export function migrateOldConfig(): void {
  const old = join(OHQUANT_DIR, "config.json");
  if (existsSync(old)) {
    try {
      const oldData = JSON.parse(readFileSync(old, "utf-8"));
      const settings = loadSettings();
      if (oldData.preferences) settings.preferences = { ...settings.preferences, ...oldData.preferences };
      if (oldData.mcp) settings.mcp = { ...settings.mcp, ...oldData.mcp };
      saveSettings(settings);
      try { unlinkSync(old); } catch { /* ok */ }
    } catch { /* skip broken files */ }
  }
}

function cloneSettings(settings: OhQuantSettings): OhQuantSettings {
  return JSON.parse(JSON.stringify(settings)) as OhQuantSettings;
}

function normalizeSettings(raw: Partial<OhQuantSettings>): OhQuantSettings {
  return {
    version: raw.version ?? DEFAULT_SETTINGS.version,
    env: { ...DEFAULT_SETTINGS.env, ...(raw.env ?? {}) },
    model: raw.model || DEFAULT_SETTINGS.model,
    thinkingLevel: raw.thinkingLevel || DEFAULT_SETTINGS.thinkingLevel,
    permissions: { ...DEFAULT_SETTINGS.permissions, ...(raw.permissions ?? {}) },
    preferences: { ...DEFAULT_SETTINGS.preferences, ...(raw.preferences ?? {}) },
    mcp: { ...DEFAULT_SETTINGS.mcp, ...(raw.mcp ?? {}) },
  };
}
