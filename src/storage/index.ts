import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OhQuantSettings } from "../types/config.ts";
import { DEFAULT_SETTINGS } from "../types/config.ts";

export const OHQUANT_DIR = join(process.cwd(), ".ohquant");
export const DATA_DIR = join(OHQUANT_DIR, "data");
export const SESSIONS_DIR = join(OHQUANT_DIR, "sessions");
export const PORTFOLIO_DIR = join(OHQUANT_DIR, "portfolio");
export const BENCHMARK_DIR = join(OHQUANT_DIR, "benchmark");
export const CACHE_DIR = join(OHQUANT_DIR, "cache");

const SETTINGS_PATH = join(OHQUANT_DIR, "settings.json");

export function ensureDirs(): void {
  for (const dir of [DATA_DIR, SESSIONS_DIR, PORTFOLIO_DIR, BENCHMARK_DIR, CACHE_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

export function loadSettings(): OhQuantSettings {
  ensureDirs();
  if (!existsSync(SETTINGS_PATH)) {
    writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2), "utf-8");
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
    return { ...DEFAULT_SETTINGS, ...raw, preferences: { ...DEFAULT_SETTINGS.preferences, ...raw.preferences } };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: OhQuantSettings): void {
  ensureDirs();
  writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), "utf-8");
}

/** Remove old config.json if present (migrated to settings.json) */
export function migrateOldConfig(): void {
  const old = join(OHQUANT_DIR, "config.json");
  if (existsSync(old)) {
    try {
      const oldData = JSON.parse(readFileSync(old, "utf-8"));
      const settings = loadSettings();
      if (oldData.anthropic) settings.anthropic = { ...settings.anthropic, ...oldData.anthropic };
      if (oldData.preferences) settings.preferences = { ...settings.preferences, ...oldData.preferences };
      if (oldData.mcp) settings.mcp = { ...settings.mcp, ...oldData.mcp };
      saveSettings(settings);
      // Delete old file
      const { unlinkSync } = require("node:fs") as typeof import("node:fs");
      try { unlinkSync(old); } catch { /* ok */ }
    } catch { /* skip broken files */ }
  }
}
