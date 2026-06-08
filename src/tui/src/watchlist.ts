import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface CodeEntry { code: string; name: string }

const ohquantDir = () => process.env.OHQUANT_DIR || join(process.cwd(), ".ohquant");

export async function loadWatchlistEntries(): Promise<CodeEntry[]> {
  try {
    const path = join(ohquantDir(), "watchlist.json");
    if (!existsSync(path)) return [];
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return data?.funds?.length ? data.funds : data?.stocks ?? [];
  } catch {
    return [];
  }
}
