import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { WATCHLIST_PATH, ensureDirs } from "./dirs.ts";
import { emitFileEvent } from "./fs-events.ts";

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
