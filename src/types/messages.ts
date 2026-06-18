import type { Bar } from "./data.ts";

export type { CommandResult } from "../cli/types.ts";

/** Bar data with source tracking */
export interface BarsResult {
  symbol: string;
  name: string;
  market: string;
  source: string;
  bars: Bar[];
}
