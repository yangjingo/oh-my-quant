import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { OhQuantSettings } from "../types/config.ts";
import { DEFAULT_SETTINGS } from "../types/config.ts";
import { emitFileEvent } from "./fs-events.ts";
export { STORAGE_POLICY, assertPortfolioCacheDisabled, isPortfolioCachePath } from "./policy.ts";

export const OHQUANT_DIR = process.env.OHQUANT_DIR || join(process.cwd(), ".ohquant");
export const DATA_DIR = join(OHQUANT_DIR, "data");
export const SESSIONS_DIR = join(OHQUANT_DIR, "sessions");
export const BENCHMARK_DIR = join(OHQUANT_DIR, "benchmark");
export const CACHE_DIR = join(OHQUANT_DIR, "cache");
export const WATCHLIST_PATH = join(OHQUANT_DIR, "watchlist.json");

export const SETTINGS_PATH = join(OHQUANT_DIR, "settings.json");

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
  const sp = join(process.env.OHQUANT_DIR || OHQUANT_DIR, "settings.json");
  if (!existsSync(sp)) {
    const text = JSON.stringify(DEFAULT_SETTINGS, null, 2);
    writeFileSync(sp, text, "utf-8");
    emitFileEvent({ operation: "WRITE", path: sp, bytes: text.length, detail: "default settings" });
    return cloneSettings(DEFAULT_SETTINGS);
  }
  try {
    const text = readFileSync(sp, "utf-8");
    emitFileEvent({ operation: "READ", path: sp, bytes: text.length, detail: "settings" });
    const raw = JSON.parse(text);
    const settings = normalizeSettings(raw);
    if (JSON.stringify(raw) !== JSON.stringify(settings)) {
      saveSettings(settings);
    }
    return settings;
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: OhQuantSettings): void {
  ensureDirs();
  const text = JSON.stringify(normalizeSettings(s), null, 2);
  const sp = join(process.env.OHQUANT_DIR || OHQUANT_DIR, "settings.json");
  writeFileSync(sp, text, "utf-8");
  emitFileEvent({ operation: "WRITE", path: sp, bytes: text.length, detail: "settings" });
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
    thinkingLevel: raw.thinkingLevel && raw.thinkingLevel !== "off" ? raw.thinkingLevel : DEFAULT_SETTINGS.thinkingLevel,
    insightEnabled: raw.insightEnabled ?? DEFAULT_SETTINGS.insightEnabled,
    showPortfolioPanel: raw.showPortfolioPanel ?? DEFAULT_SETTINGS.showPortfolioPanel,
    permissions: { ...DEFAULT_SETTINGS.permissions, ...(raw.permissions ?? {}) },
    preferences: normalizePreferences(raw.preferences),
  };
}

const VALID_SOURCES = new Set(["akshare", "tushare", "llmquant-data", "financial-datasets"]);
function isValidSource(s: unknown): boolean {
  return typeof s === "string" && VALID_SOURCES.has(s);
}

function normalizePreferences(raw: Partial<OhQuantSettings["preferences"]> | undefined): OhQuantSettings["preferences"] {
  return {
    defaultMarket: raw?.defaultMarket ?? DEFAULT_SETTINGS.preferences.defaultMarket,
    defaultBenchmark: raw?.defaultBenchmark ?? DEFAULT_SETTINGS.preferences.defaultBenchmark,
    defaultCash: raw?.defaultCash ?? DEFAULT_SETTINGS.preferences.defaultCash,
    defaultFast: raw?.defaultFast ?? DEFAULT_SETTINGS.preferences.defaultFast,
    defaultSlow: raw?.defaultSlow ?? DEFAULT_SETTINGS.preferences.defaultSlow,
    currentPortfolioFile: raw?.currentPortfolioFile ?? DEFAULT_SETTINGS.preferences.currentPortfolioFile,
    source: isValidSource(raw?.source) ? raw!.source! : DEFAULT_SETTINGS.preferences.source,
  };
}
