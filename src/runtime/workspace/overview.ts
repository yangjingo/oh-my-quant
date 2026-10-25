import { formatRefreshMinute } from "../../source/index.ts";
import type { PanelSection } from "../../types/ui.ts";
import type { OverviewSymbolEntry, OverviewQuote, OverviewHolding, OverviewPullMeta } from "./overview-data.ts";
export { fetchOverviewQuotes, fetchOverviewHoldings, overviewProviderSymbol } from "./overview-data.ts";
export type { OverviewSymbolEntry, OverviewQuote, OverviewHolding, OverviewPullMeta, OverviewQuoteFetcher, OverviewHoldingFetcher } from "./overview-data.ts";

export interface OverviewPortfolio {
  activeGroupId?: string;
  symbols: OverviewSymbolEntry[];
  groups?: Array<{ id: string; name: string; symbolCodes: string[] }>;
}

/** One selected group owns the research view; retain all saved groups outside this projection. */
export function selectResearchPortfolio<T extends OverviewPortfolio>(portfolio: T): T {
  const groups = portfolio.groups ?? [];
  const group = groups.find(group => group.id === portfolio.activeGroupId) ?? groups[0];
  if (!group) return portfolio;
  const codes = new Set(group.symbolCodes);
  return { ...portfolio, groups: [group], symbols: portfolio.symbols.filter(entry => codes.has(entry.code)) };
}


export const MARKET_INDICES: OverviewSymbolEntry[] = [
  { code: "000001.SH", name: "上证指数" },
  { code: "399001.SZ", name: "深证成指" },
  { code: "000300.SH", name: "沪深300" },
  { code: "000905.SH", name: "中证500" },
  { code: "399006.SZ", name: "创业板指" },
];

export function buildOverviewPanelSections({
  portfolio,
  portfolioSymbols = collectOverviewSymbols(portfolio),
  marketQuotes,
  portfolioRows,
  pullMeta,
  refreshedAt = new Date(),
}: {
  portfolio: OverviewPortfolio;
  portfolioSymbols?: OverviewSymbolEntry[];
  marketQuotes: OverviewQuote[];
  portfolioRows: OverviewHolding[];
  pullMeta: OverviewPullMeta;
  refreshedAt?: Date;
}): PanelSection[] {
  const groups = portfolio.groups ?? [];
  const sections: PanelSection[] = [];
  if (portfolioSymbols.length > 0 || groups.length > 0) {
    sections.push(...buildPortfolioSections(portfolioSymbols, groups, portfolioRows));
  }
  sections.push(buildMarketSection(marketQuotes));
  const rows = sections.flatMap(section => section.kind === "keyvalue" ? [] : section.rows);
  const available = rows.filter(row => !row.refreshState && Number.isFinite(row.price) && Number.isFinite(row.pct));
  sections[0]!.refresh = {
    at: formatRefreshMinute(refreshedAt),
    status: !available.length ? "unavailable" : available.length < rows.length || rows.some(row => row.observation?.state === "outside-window") ? "partial" : "success",
  };
  return sections;
}

export function collectOverviewSymbols(portfolio: OverviewPortfolio): OverviewSymbolEntry[] {
  const entries = new Map<string, OverviewSymbolEntry>();
  for (const entry of portfolio.symbols) {
    const name = entry.name || entry.code;
    entries.set(entry.code, { code: entry.code, name, instrument: entry.instrument });
  }
  for (const group of portfolio.groups ?? []) {
    for (const code of group.symbolCodes) {
      if (!entries.has(code)) entries.set(code, { code, name: code });
    }
  }
  return [...entries.values()];
}

function buildPortfolioSections(
  portfolioSymbols: OverviewSymbolEntry[],
  groups: NonNullable<OverviewPortfolio["groups"]>,
  portfolioRows: OverviewHolding[],
): PanelSection[] {
  const rowsByCode = new Map<string, OverviewHolding>();
  for (const row of portfolioRows) rowsByCode.set(row.code, row);

  const fallbackRows = portfolioSymbols.map((entry) => ({
    code: entry.code,
    name: entry.name || entry.code,
    price: Number.NaN,
    pct: Number.NaN,
  }));
  const fallbackByCode = new Map<string, OverviewHolding>();
  for (const row of fallbackRows) fallbackByCode.set(row.code, row);

  const getRow = (code: string): OverviewHolding => {
    return rowsByCode.get(code) || fallbackByCode.get(code) || {
      code, name: portfolioSymbols.find((symbol) => symbol.code === code)?.name || code,
      price: Number.NaN, pct: Number.NaN,
    };
  };

  if (groups.length > 0) {
    const sections: PanelSection[] = groups.map((group) => ({
      kind: "group",
      groupId: group.id,
      title: group.name,
      rows: group.symbolCodes.map((code) => getRow(code)),
      collapsed: false,
    }));
    const groupedCodes = new Set(groups.flatMap(group => group.symbolCodes));
    const ungrouped = portfolioSymbols.filter(entry => !groupedCodes.has(entry.code));
    if (ungrouped.length) sections.push({ kind: "holdings", title: "Ungrouped", rows: ungrouped.map(entry => getRow(entry.code)) });
    return sections;
  }
  const rows = portfolioRows.length > 0 ? portfolioRows : fallbackRows;
  return [{ kind: "holdings", title: "Portfolio", rows }];
}

function buildMarketSection(marketQuotes: OverviewQuote[]): PanelSection {
  if (marketQuotes.length > 0) return { kind: "quotes", title: "Market", rows: marketQuotes };
  return { kind: "keyvalue", title: "Market", rows: [{ label: "data", value: "unavailable" }] };
}
