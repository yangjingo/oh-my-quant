import { access, readFile, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { emitFileEvent } from "../storage/fs-events.ts";

export interface CodeEntry {
  code: string;
  name: string;
}

export interface WatchItem {
  code: string;
  name: string;
  source?: string;
  latest?: {
    date: string;
    close: number;
    changePct: number;
  };
}

export interface SidebarSnapshot {
  watchItems: WatchItem[];
  localSources: string[];
}

interface LocalSettings {
  model?: string;
  env?: Record<string, string>;
}

interface DataMeta {
  symbol?: string;
  name?: string;
  source?: string;
}

interface Bar {
  date: string;
  close: number;
}

const OHQUANT_DIR = join(process.cwd(), ".ohquant");

export async function loadLocalModel(): Promise<string> {
  const settings = await readJsonFile<LocalSettings>(join(OHQUANT_DIR, "settings.json"));
  return settings?.env?.["WHYJ_DEFAULT_SONNET_MODEL"]
    ?? process.env["WHYJ_DEFAULT_SONNET_MODEL"]
    ?? "deepseek-v4-pro";
}

export async function loadSidebarSnapshot(): Promise<SidebarSnapshot> {
  const [watchlist, localData, localSources] = await Promise.all([
    loadWatchlistEntries(),
    getSymbolsWithLocalData(),
    getLocalDataSources(),
  ]);
  const symbols = watchlist.length > 0
    ? watchlist.map((symbol) => findSymbol(symbol.code, localData) || symbol)
    : localData;
  const watchItems = await Promise.all(symbols.map(loadWatchItem));

  return { watchItems, localSources };
}

export async function loadWatchlistEntries(): Promise<CodeEntry[]> {
  const data = await readJsonFile<{ funds?: CodeEntry[]; stocks?: CodeEntry[] }>(join(OHQUANT_DIR, "watchlist.json"));
  if (data?.funds?.length) return data.funds.map((s) => ({ code: s.code, name: s.name }));
  if (data?.stocks?.length) return data.stocks.map((s) => ({ code: s.code, name: s.name }));
  return [];
}

async function loadWatchItem(symbol: CodeEntry): Promise<WatchItem> {
  const loaded = await loadSymbolData(symbol.code);
  const name = loaded.meta?.name || symbol.name || symbol.code;
  return {
    code: symbol.code,
    name,
    source: loaded.source,
    latest: getLatestSnapshot(loaded.bars),
  };
}

function findSymbol(code: string, group: CodeEntry[]): CodeEntry | null {
  return group.find((item) => item.code === code) || null;
}

async function loadSymbolData(symbol: string): Promise<{ bars: Bar[]; meta: DataMeta | null; source?: string }> {
  const sources = ["tushare", "akshare", "llmquant-data"];
  for (const src of sources) {
    const dir = join(OHQUANT_DIR, "data", src, symbol);
    const dailyPath = join(dir, "daily.json");
    if (!(await pathExists(dailyPath))) continue;
    const [bars, meta] = await Promise.all([
      readJsonFile<Bar[]>(dailyPath),
      readJsonFile<DataMeta>(join(dir, "meta.json")),
    ]);
    return {
      bars: bars ?? [],
      meta,
      source: meta?.source || src,
    };
  }
  return { bars: [], meta: null };
}

async function getSymbolsWithLocalData(): Promise<CodeEntry[]> {
  const dataRoot = join(OHQUANT_DIR, "data");
  const sources = ["tushare", "akshare", "llmquant-data"];
  const symbols: CodeEntry[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    const sourceDir = join(dataRoot, source);
    let entries: Dirent<string>[];
    try {
      entries = await readdir(sourceDir, { withFileTypes: true });
      emitFileEvent({ operation: "READ", path: sourceDir, detail: "cache index" });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || seen.has(entry.name)) continue;
      if (!(await pathExists(join(sourceDir, entry.name, "daily.json")))) continue;
      const meta = await readJsonFile<DataMeta>(join(sourceDir, entry.name, "meta.json"));
      symbols.push({
        code: meta?.symbol || entry.name,
        name: meta?.name || entry.name,
      });
      seen.add(entry.name);
    }
  }

  return symbols;
}

async function getLocalDataSources(): Promise<string[]> {
  const dataRoot = join(OHQUANT_DIR, "data");
  const sources = ["tushare", "akshare", "llmquant-data"];
  const result: string[] = [];

  for (const source of sources) {
    const sourceDir = join(dataRoot, source);
    let entries: Dirent<string>[];
    try {
      entries = await readdir(sourceDir, { withFileTypes: true });
      emitFileEvent({ operation: "READ", path: sourceDir, detail: "cache index" });
    } catch {
      continue;
    }

    let count = 0;
    for (const entry of entries) {
      if (entry.isDirectory() && await pathExists(join(sourceDir, entry.name, "daily.json"))) count += 1;
    }
    if (count > 0) result.push(`${source} ${count}`);
  }

  return result;
}

function getLatestSnapshot(bars: Bar[]): WatchItem["latest"] | undefined {
  if (bars.length < 1) return undefined;
  const latest = bars[bars.length - 1];
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;
  const changePct = prev && prev.close !== 0
    ? ((latest.close - prev.close) / prev.close) * 100
    : 0;
  return {
    date: latest.date,
    close: latest.close,
    changePct,
  };
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const text = await readFile(path, "utf-8");
    emitFileEvent({ operation: "READ", path, bytes: text.length, detail: "local snapshot" });
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
