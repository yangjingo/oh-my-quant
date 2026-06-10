import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  importLegacyHoldings,
  isValidPanelSymbol,
  loadPanelPortfolio,
  savePanelPortfolio,
  createGroup,
  renameGroup,
  deleteGroup,
  addSymbolToGroup,
  removeSymbolFromGroup,
  addSymbol,
  removeSymbol,
} from "./panel-portfolio.ts";
import { loadPortfolioSymbols } from "./portfolio.ts";

const OHQ = join(process.cwd(), ".ohquant-test-panel-portfolio");

beforeEach(() => {
  process.env.OHQUANT_DIR = OHQ;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
  mkdirSync(OHQ, { recursive: true });
});

afterEach(() => {
  delete process.env.OHQUANT_DIR;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
});

describe("panel-portfolio storage", () => {
  it("loads and saves symbols", () => {
    savePanelPortfolio({
      updated: "",
      symbols: [{ code: "510300.SH", name: "沪深300ETF", added: "2026-06-08" }],
      groups: [],
    });
    expect(loadPanelPortfolio().symbols).toEqual([
      { code: "510300.SH", name: "沪深300ETF", added: "2026-06-08" },
    ]);
  });

  it("loadPortfolioSymbols reads panel-portfolio.json", async () => {
    savePanelPortfolio({
      updated: "",
      symbols: [
        { code: "510300.SH", name: "沪深300ETF", added: "2026-06-08" },
        { code: "159915.SZ", name: "创业板ETF", added: "2026-06-08" },
      ],
      groups: [],
    });
    expect(await loadPortfolioSymbols()).toEqual([
      { code: "510300.SH", name: "沪深300ETF" },
      { code: "159915.SZ", name: "创业板ETF" },
    ]);
  });

  it("returns empty list when file is missing", async () => {
    expect(loadPanelPortfolio().symbols).toEqual([]);
    expect(await loadPortfolioSymbols()).toEqual([]);
  });

  it("auto-imports legacy holdings when panel has only invalid codes", () => {
    mkdirSync(join(OHQ, "portfolio"), { recursive: true });
    writeFileSync(
      join(OHQ, "portfolio", "holdings.json"),
      JSON.stringify({
        funds: [
          { code: "022364", name: "永赢科技智选发起A" },
          { code: "016372", name: "信澳匠心严选一年持有A" },
        ],
      }),
    );
    savePanelPortfolio({
      updated: "2026-06-08",
      symbols: [{ code: "51", name: "51", added: "2026-06-08" }],
      groups: [],
    });
    const loaded = loadPanelPortfolio();
    expect(loaded.symbols.map((s) => s.code)).toEqual(["022364", "016372"]);
    expect(isValidPanelSymbol("51")).toBe(false);
    expect(isValidPanelSymbol("022364")).toBe(true);
  });

  it("strips invalid symbols while keeping valid panel entries", () => {
    savePanelPortfolio({
      updated: "2026-06-08",
      symbols: [
        { code: "022364", name: "永赢科技智选发起A", added: "2026-06-08" },
        { code: "51", name: "51", added: "2026-06-08" },
      ],
      groups: [],
    });
    const loaded = loadPanelPortfolio();
    expect(loaded.symbols.map((s) => s.code)).toEqual(["022364"]);
  });
});

describe("panel-portfolio groups", () => {
  it("migrates old format (symbols-only) to new format with default group", () => {
    savePanelPortfolio({
      updated: "2026-06-08",
      symbols: [
        { code: "510300.SH", name: "沪深300ETF", added: "2026-06-08" },
        { code: "159915.SZ", name: "创业板ETF", added: "2026-06-08" },
      ],
      groups: [],
    });
    const loaded = loadPanelPortfolio();
    expect(loaded.groups).toBeDefined();
    expect(loaded.groups.length).toBe(1);
    expect(loaded.groups[0].id).toBe("default");
    expect(loaded.groups[0].name).toBe("Default");
    expect(loaded.groups[0].symbolCodes).toEqual(["510300.SH", "159915.SZ"]);
  });

  it("createGroup adds a new group with unique ID", () => {
    let data = loadPanelPortfolio();
    data = addSymbol(data, "510300.SH", "沪深300ETF");
    const result = createGroup(data, "科技组", ["510300.SH"]);
    expect(result.id).toBe("group-1");
    expect(result.data.groups.length).toBe(1);
    expect(result.data.groups[0].name).toBe("科技组");
    expect(result.data.groups[0].symbolCodes).toEqual(["510300.SH"]);

    const result2 = createGroup(result.data, "消费组");
    expect(result2.id).toBe("group-2");
    expect(result2.data.groups.length).toBe(2);
  });

  it("renameGroup updates group name", () => {
    let data = loadPanelPortfolio();
    const created = createGroup(data, "旧名称");
    const renamed = renameGroup(created.data, created.id, "新名称");
    expect(renamed.groups[0].name).toBe("新名称");
  });

  it("deleteGroup removes group by ID", () => {
    let data = loadPanelPortfolio();
    const g1 = createGroup(data, "组1");
    const g2 = createGroup(g1.data, "组2");
    const deleted = deleteGroup(g2.data, g1.id);
    expect(deleted.groups.length).toBe(1);
    expect(deleted.groups[0].id).toBe(g2.id);
  });

  it("addSymbolToGroup adds symbol without duplicates", () => {
    let data = loadPanelPortfolio();
    const created = createGroup(data, "测试组");
    const added = addSymbolToGroup(created.data, created.id, "510300.SH");
    expect(added.groups[0].symbolCodes).toEqual(["510300.SH"]);

    const addedAgain = addSymbolToGroup(added, created.id, "510300.SH");
    expect(addedAgain.groups[0].symbolCodes).toEqual(["510300.SH"]);
  });

  it("removeSymbolFromGroup removes symbol from group", () => {
    let data = loadPanelPortfolio();
    const created = createGroup(data, "测试组", ["510300.SH", "159915.SZ"]);
    const removed = removeSymbolFromGroup(created.data, created.id, "510300.SH");
    expect(removed.groups[0].symbolCodes).toEqual(["159915.SZ"]);
  });

  it("addSymbol adds to symbols array", () => {
    let data = loadPanelPortfolio();
    const added = addSymbol(data, "510300.SH", "沪深300ETF");
    expect(added.symbols.length).toBe(1);
    expect(added.symbols[0].code).toBe("510300.SH");
    expect(added.symbols[0].name).toBe("沪深300ETF");

    const addedAgain = addSymbol(added, "510300.SH", "沪深300ETF");
    expect(addedAgain.symbols.length).toBe(1);
  });

  it("removeSymbol removes from symbols and all groups", () => {
    let data = loadPanelPortfolio();
    data = addSymbol(data, "510300.SH", "沪深300ETF");
    const g1 = createGroup(data, "组1", ["510300.SH"]);
    const g2 = createGroup(g1.data, "组2", ["510300.SH"]);
    const removed = removeSymbol(g2.data, "510300.SH");
    expect(removed.symbols.length).toBe(0);
    expect(removed.groups[0].symbolCodes).toEqual([]);
    expect(removed.groups[1].symbolCodes).toEqual([]);
  });

  it("validates and repairs invalid symbols in groups on load", () => {
    savePanelPortfolio({
      updated: "2026-06-08",
      symbols: [
        { code: "510300.SH", name: "沪深300ETF", added: "2026-06-08" },
      ],
      groups: [
        { id: "group-1", name: "测试组", symbolCodes: ["510300.SH", "invalid", "99"] },
      ],
    });
    const loaded = loadPanelPortfolio();
    expect(loaded.groups[0].symbolCodes).toEqual(["510300.SH"]);
  });

  it("filters out empty groups after validation", () => {
    savePanelPortfolio({
      updated: "2026-06-08",
      symbols: [],
      groups: [
        { id: "group-1", name: "空组", symbolCodes: ["invalid1", "invalid2"] },
        { id: "group-2", name: "有效组", symbolCodes: ["510300.SH"] },
      ],
    });
    const loaded = loadPanelPortfolio();
    expect(loaded.groups.length).toBe(0);
  });

  it("persists and loads groups correctly", () => {
    let data = loadPanelPortfolio();
    data = addSymbol(data, "510300.SH", "沪深300ETF");
    data = addSymbol(data, "159915.SZ", "创业板ETF");
    const g1 = createGroup(data, "科技组", ["510300.SH"]);
    const g2 = createGroup(g1.data, "消费组", ["159915.SZ"]);
    savePanelPortfolio(g2.data);

    const loaded = loadPanelPortfolio();
    expect(loaded.groups.length).toBe(2);
    expect(loaded.groups[0].name).toBe("科技组");
    expect(loaded.groups[0].symbolCodes).toEqual(["510300.SH"]);
    expect(loaded.groups[1].name).toBe("消费组");
    expect(loaded.groups[1].symbolCodes).toEqual(["159915.SZ"]);
  });
});
