import type { AppState, PanelSection } from "../../types/ui.ts";
import { normalizeMarketColorScheme, type MarketColorScheme } from "../../types/theme-colors.ts";
import { normalizeHudMode, type HudMode } from "../../types/config.ts";
import { selectResearchPortfolio, type OverviewPortfolio } from "./overview.ts";

interface RuntimeSettingsLike {
  preferences: {
    currentPortfolioFile?: string;
    source?: string;
    marketColorScheme?: MarketColorScheme;
    hudMode?: HudMode;
  };
  showPortfolioPanel?: boolean;
}

type PanelPortfolioLike = OverviewPortfolio;

export function activePanelPortfolioName(portfolio: PanelPortfolioLike, fallback: string): string {
  const active = selectResearchPortfolio(portfolio);
  if (active.groups?.[0]?.name) return active.groups[0].name;
  if (active.symbols.length > 0) return "Portfolio";
  return fallback;
}

export function buildLocalStorageState(
  settings: RuntimeSettingsLike,
  portfolio: PanelPortfolioLike,
): Pick<AppState, "activePortfolio" | "source" | "showPortfolioPanel" | "marketColorScheme" | "hudMode"> {
  return {
    activePortfolio: activePanelPortfolioName(portfolio, "No portfolios"),
    source: settings.preferences.source || "llmquant-data",
    showPortfolioPanel: settings.showPortfolioPanel !== false,
    marketColorScheme: normalizeMarketColorScheme(settings.preferences.marketColorScheme),
    hudMode: normalizeHudMode(settings.preferences.hudMode),
  };
}

export function marketRefreshLoadingPanel(): PanelSection[] {
  return [{ kind: "keyvalue", title: "Market", rows: [], refresh: { at: null, status: "idle" } }];
}

export function marketUnavailablePanel(): PanelSection[] {
  return [{ kind: "keyvalue", title: "Market", rows: [{ label: "data", value: "unavailable" }] }];
}

