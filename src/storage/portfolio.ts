/**
 * Portfolio private holdings cache is disabled under `.ohquant/portfolio/`.
 *
 * Overview Portfolio symbols are managed in `.ohquant/panel-portfolio.json`
 * via `panel-portfolio.ts`. Live quotes are fetched by AppRuntime.
 */

import { assertPortfolioCacheDisabled } from "./policy.ts";
import { emitFileEvent } from "./fs-events.ts";
import { listLocalPortfolios, type LocalPortfolioSummary } from "./local-portfolios.ts";
import { isValidPanelSymbol, loadPanelPortfolio, savePanelPortfolio } from "./panel-portfolio.ts";
import type { DailyFile, HoldingsFile } from "../types/data.ts";

export interface PortfolioSymbol {
  code: string;
  name: string;
}

export { loadPanelPortfolio, savePanelPortfolio, PANEL_PORTFOLIO_PATH } from "./panel-portfolio.ts";
export type { PanelPortfolioEntry, PanelPortfolioFile, PortfolioGroup } from "./panel-portfolio.ts";
export {
  createGroup, renameGroup, deleteGroup,
  addSymbolToGroup, removeSymbolFromGroup,
  addSymbol, removeSymbol,
} from "./panel-portfolio.ts";

/** @deprecated Portfolio holdings are not read from local cache. */
export function loadHoldings(_variant = "live"): HoldingsFile {
  emitFileEvent({ operation: "READ", path: ".ohquant/portfolio/", detail: "blocked portfolio cache read" });
  return { updated: "", funds: [] };
}

/** Read Overview Portfolio codes/names from panel-portfolio.json. */
export async function loadPortfolioSymbols(): Promise<PortfolioSymbol[]> {
  return loadPanelPortfolio().symbols.map((entry) => ({
    code: entry.code,
    name: entry.name || entry.code,
  }));
}

export interface SyncedPanelPortfolio {
  portfolio: LocalPortfolioSummary;
  symbols: PortfolioSymbol[];
}

export function findLocalPortfolio(identifier: string): LocalPortfolioSummary | null {
  const portfolios = listLocalPortfolios();
  const needle = identifier.trim();
  if (!needle) return null;
  const index = Number.parseInt(needle, 10);
  if (Number.isInteger(index) && String(index) === needle && index >= 1 && index <= portfolios.length) {
    return portfolios[index - 1] ?? null;
  }
  const normalized = needle.toLowerCase();
  return portfolios.find((item) =>
    item.fileName.toLowerCase() === normalized
    || item.name.toLowerCase() === normalized
    || item.fileName.toLowerCase().replace(/\.json$/i, "") === normalized
  ) ?? null;
}

export function syncPanelPortfolioFromLocalPortfolio(identifier: string): SyncedPanelPortfolio | null {
  const portfolio = findLocalPortfolio(identifier);
  if (!portfolio) return null;
  const today = new Date().toISOString().slice(0, 10);
  const symbols = portfolio.holdings
    .filter((fund) => fund.code && isValidPanelSymbol(fund.code))
    .map((fund) => ({
      code: fund.code,
      name: fund.name || fund.code,
      added: today,
    }));
  const codes = symbols.map((symbol) => symbol.code);
  savePanelPortfolio({
    updated: today,
    symbols,
    groups: codes.length > 0 ? [{ id: "default", name: portfolio.name || "Default", symbolCodes: codes }] : [],
  });
  return {
    portfolio,
    symbols: symbols.map((symbol) => ({ code: symbol.code, name: symbol.name })),
  };
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
