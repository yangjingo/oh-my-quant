import { describe, expect, it } from "bun:test";

import {
  activePanelPortfolioName,
  buildLocalStorageState,
  marketRefreshLoadingPanel,
  marketUnavailablePanel,
} from "../workspace/panel-service.ts";

describe("runtime panel service", () => {
  it("derives active portfolio names from groups, symbols, or fallback files", () => {
    expect(activePanelPortfolioName({ symbols: [], groups: [{ id: "core", name: "Core", symbolCodes: [] }] }, "holdings.json")).toBe("Core");
    expect(activePanelPortfolioName({ symbols: [], groups: [{ id: "a", name: "A", symbolCodes: [] }, { id: "b", name: "B", symbolCodes: [] }] }, "holdings.json")).toBe("A");
    expect(activePanelPortfolioName({ symbols: [{ code: "510300.SH", name: "ETF" }], groups: [] }, "holdings.json")).toBe("Portfolio");
    expect(activePanelPortfolioName({ symbols: [], groups: [] }, "holdings.json")).toBe("holdings.json");
  });

  it("builds local state from settings and the loaded panel portfolio", () => {
    expect(buildLocalStorageState({
      preferences: { currentPortfolioFile: "alpha.json", source: "akshare" },
      showPortfolioPanel: false,
    }, {
      symbols: [],
      groups: [{ id: "alpha", name: "Alpha", symbolCodes: [] }],
    })).toEqual({
      activePortfolio: "Alpha",
      source: "akshare",
      showPortfolioPanel: false,
      marketColorScheme: "red-up",
      hudMode: "full",
    });

    expect(buildLocalStorageState({ preferences: {} }, { symbols: [], groups: [] })).toEqual({
      activePortfolio: "No portfolios",
      source: "llmquant-data",
      showPortfolioPanel: true,
      marketColorScheme: "red-up",
      hudMode: "full",
    });
  });

  it("provides stable loading and unavailable market panels", () => {
    expect(marketRefreshLoadingPanel()).toEqual([
      { kind: "keyvalue", title: "Market", rows: [], refresh: { at: null, status: "idle" } },
    ]);
    expect(marketUnavailablePanel()).toEqual([
      { kind: "keyvalue", title: "Market", rows: [{ label: "data", value: "unavailable" }] },
    ]);
  });
});

