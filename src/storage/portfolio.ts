/**
 * Portfolio data storage — reads/writes JSON files under .ohquant/portfolio/
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PORTFOLIO_DIR } from "./index.ts";
import type { DailyFile, HoldingsFile } from "../types/data.ts";

/** Load holdings */
export function loadHoldings(variant = "v1"): HoldingsFile {
  const path = holdingsPath(variant);
  if (!existsSync(path)) return { updated: "", funds: [] };
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** Save holdings */
export function saveHoldings(holdings: HoldingsFile, variant = "v1"): void {
  const path = holdingsPath(variant);
  writeFileSync(path, JSON.stringify(holdings, null, 2), "utf-8");
}

/** Load daily NAV data */
export function loadDaily(variant = "v1"): DailyFile {
  const path = dailyPath(variant);
  if (!existsSync(path)) return { funds: {}, dates: [], lastUpdated: "" };
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** Save daily NAV data */
export function saveDaily(data: DailyFile, variant = "v1"): void {
  const path = dailyPath(variant);
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

// --- Helpers ---

function holdingsPath(variant: string): string {
  const files: Record<string, string> = {
    v1: "holdings.json",
    "v2-semicon": "holdings_v2_semicon.json",
    "v2-kc50": "holdings_v2_kc50.json",
  };
  return join(PORTFOLIO_DIR, files[variant] || "holdings.json");
}

function dailyPath(variant: string): string {
  const files: Record<string, string> = {
    v1: "daily.json",
    "v2-semicon": "daily_v2_semicon.json",
    "v2-kc50": "daily_v2_kc50.json",
  };
  return join(PORTFOLIO_DIR, files[variant] || "daily.json");
}
