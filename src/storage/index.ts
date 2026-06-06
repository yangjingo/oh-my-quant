import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { OhQuantSettings } from "../types/config.ts";
import { DEFAULT_SETTINGS } from "../types/config.ts";
import { emitFileEvent } from "./fs-events.ts";
export { STORAGE_POLICY, assertPortfolioCacheDisabled, isPortfolioCachePath } from "./policy.ts";

export const OHQUANT_DIR = join(process.cwd(), ".ohquant");
export const DATA_DIR = join(OHQUANT_DIR, "data");
export const SESSIONS_DIR = join(OHQUANT_DIR, "sessions");
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
    const text = readFileSync(WATCHLIST_PATH, "utf-8");
    emitFileEvent({ operation: "READ", path: WATCHLIST_PATH, bytes: text.length, detail: "watchlist" });
    const raw = JSON.parse(text);
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
  const text = JSON.stringify(wl, null, 2);
  writeFileSync(WATCHLIST_PATH, text, "utf-8");
  emitFileEvent({ operation: "WRITE", path: WATCHLIST_PATH, bytes: text.length, detail: "watchlist" });
}

export function ensureDirs(): void {
  for (const dir of [DATA_DIR, SESSIONS_DIR, BENCHMARK_DIR, CACHE_DIR]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      emitFileEvent({ operation: "MKDIR", path: dir, detail: "local state" });
    }
  }
}

export function loadSettings(): OhQuantSettings {
  ensureDirs();
  if (!existsSync(SETTINGS_PATH)) {
    const text = JSON.stringify(DEFAULT_SETTINGS, null, 2);
    writeFileSync(SETTINGS_PATH, text, "utf-8");
    emitFileEvent({ operation: "WRITE", path: SETTINGS_PATH, bytes: text.length, detail: "default settings" });
    return cloneSettings(DEFAULT_SETTINGS);
  }
  try {
    const text = readFileSync(SETTINGS_PATH, "utf-8");
    emitFileEvent({ operation: "READ", path: SETTINGS_PATH, bytes: text.length, detail: "settings" });
    const raw = JSON.parse(text);
    return normalizeSettings(raw);
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: OhQuantSettings): void {
  ensureDirs();
  const text = JSON.stringify(normalizeSettings(s), null, 2);
  writeFileSync(SETTINGS_PATH, text, "utf-8");
  emitFileEvent({ operation: "WRITE", path: SETTINGS_PATH, bytes: text.length, detail: "settings" });
}

export function migrateOldConfig(): void {
  const old = join(OHQUANT_DIR, "config.json");
  if (existsSync(old)) {
    try {
      const oldText = readFileSync(old, "utf-8");
      emitFileEvent({ operation: "READ", path: old, bytes: oldText.length, detail: "legacy config" });
      const oldData = JSON.parse(oldText);
      const settings = loadSettings();
      if (oldData.preferences) settings.preferences = { ...settings.preferences, ...oldData.preferences };
      if (oldData.mcp) settings.mcp = { ...settings.mcp, ...oldData.mcp };
      saveSettings(settings);
      try {
        unlinkSync(old);
        emitFileEvent({ operation: "DELETE", path: old, detail: "legacy config migrated" });
      } catch { /* ok */ }
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
    preferences: normalizePreferences(raw.preferences),
    mcp: { ...DEFAULT_SETTINGS.mcp, ...(raw.mcp ?? {}) },
  };
}

function normalizePreferences(raw: Partial<OhQuantSettings["preferences"]> | undefined): OhQuantSettings["preferences"] {
  return {
    defaultMarket: raw?.defaultMarket ?? DEFAULT_SETTINGS.preferences.defaultMarket,
    defaultBenchmark: raw?.defaultBenchmark ?? DEFAULT_SETTINGS.preferences.defaultBenchmark,
    defaultCash: raw?.defaultCash ?? DEFAULT_SETTINGS.preferences.defaultCash,
    defaultFast: raw?.defaultFast ?? DEFAULT_SETTINGS.preferences.defaultFast,
    defaultSlow: raw?.defaultSlow ?? DEFAULT_SETTINGS.preferences.defaultSlow,
  };
}
