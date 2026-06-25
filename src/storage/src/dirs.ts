import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { emitFileEvent } from "./fs-events.ts";

export const OHQUANT_DIR = process.env.OHQUANT_DIR || join(process.cwd(), ".ohquant");
export const DATA_DIR = join(OHQUANT_DIR, "data");
export const SESSIONS_DIR = join(OHQUANT_DIR, "sessions");
export const BENCHMARK_DIR = join(OHQUANT_DIR, "benchmark");
export const CACHE_DIR = join(OHQUANT_DIR, "cache");
export const WATCHLIST_PATH = join(OHQUANT_DIR, "watchlist.json");
export const SETTINGS_PATH = join(OHQUANT_DIR, "settings.json");

export function resolveOhquantDir(): string {
  return process.env.OHQUANT_DIR || OHQUANT_DIR;
}

export function resolveSessionsDir(): string {
  return join(resolveOhquantDir(), "sessions");
}

export function ensureDirs(): void {
  for (const dir of [DATA_DIR, SESSIONS_DIR, BENCHMARK_DIR, CACHE_DIR]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      emitFileEvent({ operation: "MKDIR", path: dir, detail: "local state" });
    }
  }
}
