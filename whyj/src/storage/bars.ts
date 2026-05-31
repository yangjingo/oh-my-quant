/**
 * Daily bars storage — Parquet files under .ohquant/data/{source}/{symbol}/
 * Falls back to JSON when Parquet is unavailable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./index.ts";
import type { Bar, SymbolMeta } from "../types/data.ts";

/** Load cached bars for a symbol. Returns empty array if not cached. */
export async function loadBars(symbol: string, source: string): Promise<Bar[]> {
  const jsonPath = join(DATA_DIR, source, symbol, "daily.json");
  if (existsSync(jsonPath)) {
    try {
      return JSON.parse(readFileSync(jsonPath, "utf-8"));
    } catch {
      return [];
    }
  }
  return [];
}

/** Save bars, merging with existing and deduplicating by date */
export async function saveBars(symbol: string, source: string, bars: Bar[]): Promise<void> {
  const dir = join(DATA_DIR, source, symbol);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const existing = await loadBars(symbol, source);
  const dateSet = new Set(existing.map((b) => b.date));
  for (const bar of bars) {
    if (!dateSet.has(bar.date)) {
      existing.push(bar);
      dateSet.add(bar.date);
    }
  }
  // Sort by date
  existing.sort((a, b) => a.date.localeCompare(b.date));

  const jsonPath = join(dir, "daily.json");
  writeFileSync(jsonPath, JSON.stringify(existing), "utf-8");

  // Update meta
  const meta: SymbolMeta = {
    symbol,
    name: symbol,
    market: "A",
    source,
    firstDate: existing[0]?.date || "",
    lastDate: existing[existing.length - 1]?.date || "",
    rowCount: existing.length,
    fetchedAt: new Date().toISOString(),
  };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");
}

/** Check if cached bars are fresh (fetched today) */
export async function isCacheFresh(symbol: string, source: string): Promise<boolean> {
  const metaPath = join(DATA_DIR, source, symbol, "meta.json");
  if (!existsSync(metaPath)) return false;
  try {
    const meta: SymbolMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
    const today = new Date().toISOString().slice(0, 10);
    return meta.fetchedAt.slice(0, 10) >= today;
  } catch {
    return false;
  }
}

/** Get meta info for a cached symbol */
export async function getMeta(symbol: string, source: string): Promise<SymbolMeta | null> {
  const metaPath = join(DATA_DIR, source, symbol, "meta.json");
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, "utf-8"));
  } catch {
    return null;
  }
}

/** List all cached symbols for a source */
export function listCachedSymbols(source: string): string[] {
  const dir = join(DATA_DIR, source);
  if (!existsSync(dir)) return [];
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(dir, { withFileTypes: true })
    .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
    .map((d: { name: string }) => d.name);
}
