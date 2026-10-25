import { loadWatchlistEntries as loadAppWatchlistEntries, type CodeEntry } from "../../../src/app-watchlist.ts";

export type { CodeEntry };

export async function loadWatchlistEntries(): Promise<CodeEntry[]> {
  try {
    return loadAppWatchlistEntries();
  } catch {
    return [];
  }
}