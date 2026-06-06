/**
 * Portfolio local storage is intentionally disabled.
 *
 * Holdings, NAV snapshots, allocations, and personal positions are private live
 * state. They must be fetched or supplied for the current session and must not
 * be cached under .ohquant.
 */

import { assertPortfolioCacheDisabled } from "./policy.ts";
import { emitFileEvent } from "./fs-events.ts";
import type { DailyFile, HoldingsFile } from "../types/data.ts";

/** @deprecated Portfolio holdings are not read from local cache. */
export function loadHoldings(_variant = "live"): HoldingsFile {
  emitFileEvent({ operation: "READ", path: ".ohquant/portfolio/", detail: "blocked portfolio cache read" });
  return { updated: "", funds: [] };
}

/** @deprecated Portfolio holdings must not be cached under .ohquant. */
export function saveHoldings(_holdings: HoldingsFile, _variant = "live"): void {
  emitFileEvent({ operation: "WRITE", path: ".ohquant/portfolio/", detail: "blocked portfolio cache write" });
  assertPortfolioCacheDisabled("saveHoldings");
}

/** @deprecated Portfolio NAV data is not read from local cache. */
export function loadDaily(_variant = "live"): DailyFile {
  emitFileEvent({ operation: "READ", path: ".ohquant/portfolio/", detail: "blocked portfolio NAV read" });
  return { funds: {}, dates: [], lastUpdated: "" };
}

/** @deprecated Portfolio NAV data must not be cached under .ohquant. */
export function saveDaily(_data: DailyFile, _variant = "live"): void {
  emitFileEvent({ operation: "WRITE", path: ".ohquant/portfolio/", detail: "blocked portfolio NAV write" });
  assertPortfolioCacheDisabled("saveDaily");
}
