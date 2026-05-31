/**
 * .ohquant/ storage initialization and config management.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OhQuantConfig } from "../types/config.ts";
import { DEFAULT_CONFIG } from "../types/config.ts";

export const OHQUANT_DIR = join(process.cwd(), ".ohquant");
export const DATA_DIR = join(OHQUANT_DIR, "data");
export const SESSIONS_DIR = join(OHQUANT_DIR, "sessions");
export const PORTFOLIO_DIR = join(OHQUANT_DIR, "portfolio");
export const BENCHMARK_RESULTS_DIR = join(OHQUANT_DIR, "benchmark");
export const CACHE_DIR = join(OHQUANT_DIR, "cache");

const CONFIG_PATH = join(OHQUANT_DIR, "config.json");

/** Ensure all .ohquant/ subdirectories exist */
export function ensureDirs(): void {
  for (const dir of [DATA_DIR, SESSIONS_DIR, PORTFOLIO_DIR, BENCHMARK_RESULTS_DIR, CACHE_DIR]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/** Load user config from .ohquant/config.json, merging with defaults */
export function loadConfig(): OhQuantConfig {
  ensureDirs();
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    return { ...DEFAULT_CONFIG, ...raw, preferences: { ...DEFAULT_CONFIG.preferences, ...raw.preferences } };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Save user config */
export function saveConfig(config: OhQuantConfig): void {
  ensureDirs();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}
