/**
 * Daily bars storage — Parquet files under .ohquant/data/{source}/{symbol}/
 * Falls back to JSON when Parquet is unavailable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OHQUANT_DIR } from "./dirs.ts";
import { emitFileEvent } from "./fs-events.ts";
import type { Bar, SymbolMeta } from "../../types/data.ts";

function dataDir(): string {
  return join(process.env.OHQUANT_DIR || OHQUANT_DIR, "data");
}

/** Load cached bars for a symbol. Returns empty array if not cached. */
export async function loadBars(symbol: string, source: string): Promise<Bar[]> {
  const jsonPath = join(dataDir(), source, symbol, "daily.json");
  if (existsSync(jsonPath)) {
    try {
      const text = readFileSync(jsonPath, "utf-8");
      emitFileEvent({ operation: "READ", path: jsonPath, bytes: text.length, detail: "bars cache" });
      return JSON.parse(text);
    } catch {
      return [];
    }
  }
  return [];
}

/** Save bars, merging with existing and deduplicating by date */
export async function saveBars(symbol: string, source: string, bars: Bar[]): Promise<void> {
  const dir = join(dataDir(), source, symbol);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    emitFileEvent({ operation: "MKDIR", path: dir, detail: "bars cache" });
  }

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
  const barsText = JSON.stringify(existing);
  writeFileSync(jsonPath, barsText, "utf-8");
  emitFileEvent({ operation: "WRITE", path: jsonPath, bytes: barsText.length, detail: "bars cache" });

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
  const metaPath = join(dir, "meta.json");
  const metaText = JSON.stringify(meta, null, 2);
  writeFileSync(metaPath, metaText, "utf-8");
  emitFileEvent({ operation: "WRITE", path: metaPath, bytes: metaText.length, detail: "bars metadata" });
}

/** Check if cached bars are fresh (fetched today) */
export async function isCacheFresh(symbol: string, source: string): Promise<boolean> {
  const metaPath = join(dataDir(), source, symbol, "meta.json");
  if (!existsSync(metaPath)) return false;
  try {
    const text = readFileSync(metaPath, "utf-8");
    emitFileEvent({ operation: "READ", path: metaPath, bytes: text.length, detail: "bars metadata" });
    const meta: SymbolMeta = JSON.parse(text);
    const today = new Date().toISOString().slice(0, 10);
    return meta.fetchedAt.slice(0, 10) >= today;
  } catch {
    return false;
  }
}

/** Get meta info for a cached symbol */
export async function getMeta(symbol: string, source: string): Promise<SymbolMeta | null> {
  const metaPath = join(dataDir(), source, symbol, "meta.json");
  if (!existsSync(metaPath)) return null;
  try {
    const text = readFileSync(metaPath, "utf-8");
    emitFileEvent({ operation: "READ", path: metaPath, bytes: text.length, detail: "bars metadata" });
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** List all cached symbols for a source */
export function listCachedSymbols(source: string): string[] {
  const dir = join(dataDir(), source);
  if (!existsSync(dir)) return [];
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const entries = readdirSync(dir, { withFileTypes: true });
  emitFileEvent({ operation: "READ", path: dir, detail: "cache index" });
  return entries
    .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
    .map((d: { name: string }) => d.name);
}
