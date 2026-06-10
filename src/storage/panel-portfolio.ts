/**
 * Overview Portfolio panel symbol list — durable user preference, not holdings cache.
 * Prices are fetched live by AppRuntime; this file stores code/name only.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emitFileEvent } from "./fs-events.ts";
import { OHQUANT_DIR, ensureDirs } from "./index.ts";
import type { HoldingsFile } from "../types/data.ts";

export interface PanelPortfolioEntry {
  code: string;
  name: string;
  added: string;
}

export interface PortfolioGroup {
  id: string;
  name: string;
  symbolCodes: string[];
}

export interface PanelPortfolioFile {
  updated: string;
  symbols: PanelPortfolioEntry[];
  groups: PortfolioGroup[];
}

export const PANEL_PORTFOLIO_PATH = join(OHQUANT_DIR, "panel-portfolio.json");

const panelPortfolioPath = () =>
  join(process.env.OHQUANT_DIR || OHQUANT_DIR, "panel-portfolio.json");

const legacyHoldingsPath = () =>
  join(process.env.OHQUANT_DIR || OHQUANT_DIR, "portfolio", "holdings.json");

function readPanelFile(path: string): PanelPortfolioFile {
  if (!existsSync(path)) return { updated: "", symbols: [], groups: [] };
  try {
    const text = readFileSync(path, "utf-8");
    emitFileEvent({ operation: "READ", path, bytes: text.length, detail: "panel portfolio" });
    const raw = JSON.parse(text) as Partial<PanelPortfolioFile>;
    const symbols = Array.isArray(raw.symbols) ? raw.symbols : [];
    const groups = Array.isArray(raw.groups) ? raw.groups : [];
    return {
      updated: raw.updated ?? "",
      symbols,
      groups: groups.length > 0 ? groups : (symbols.length > 0 ? [{ id: "default", name: "Default", symbolCodes: symbols.map(s => s.code) }] : []),
    };
  } catch {
    return { updated: "", symbols: [], groups: [] };
  }
}

/** One-time bootstrap from legacy `.ohquant/portfolio/holdings.json` into panel-portfolio.json. */
export function importLegacyHoldings(): PanelPortfolioFile {
  const path = legacyHoldingsPath();
  if (!existsSync(path)) return { updated: "", symbols: [], groups: [] };
  try {
    const text = readFileSync(path, "utf-8");
    emitFileEvent({ operation: "READ", path, bytes: text.length, detail: "legacy holdings import" });
    const raw = JSON.parse(text) as HoldingsFile;
    const today = new Date().toISOString().slice(0, 10);
    const symbols = (raw.funds ?? [])
      .filter((fund) => fund.code)
      .map((fund) => ({
        code: fund.code,
        name: fund.name || fund.code,
        added: today,
      }));
    const groups = symbols.length > 0 ? [{ id: "default", name: "Default", symbolCodes: symbols.map(s => s.code) }] : [];
    return { updated: today, symbols, groups };
  } catch {
    return { updated: "", symbols: [], groups: [] };
  }
}

/** Valid Overview symbol: 6-digit A-share/fund code or exchange-suffixed ticker. */
export function isValidPanelSymbol(code: string): boolean {
  const base = code.split(".")[0] || code;
  if (/^\d{6}$/.test(base)) return true;
  if (/^\d{6}\.(SH|SZ|BJ)$/i.test(code)) return true;
  return false;
}

export function loadPanelPortfolio(): PanelPortfolioFile {
  const path = panelPortfolioPath();
  const existing = readPanelFile(path);
  const legacy = importLegacyHoldings();
  const validSymbols = existing.symbols.filter((entry) => isValidPanelSymbol(entry.code));
  const validCodes = new Set(validSymbols.map(s => s.code));

  if (validSymbols.length === 0) {
    if (legacy.symbols.length > 0) {
      savePanelPortfolio(legacy);
      return legacy;
    }
    if (existing.symbols.length > 0) {
      savePanelPortfolio({ updated: existing.updated, symbols: [], groups: [] });
    }
    return { updated: existing.updated, symbols: [], groups: [] };
  }

  const repairedGroups = existing.groups
    .map(g => ({ ...g, symbolCodes: g.symbolCodes.filter(code => validCodes.has(code)) }))
    .filter(g => g.symbolCodes.length > 0);

  const symbolsChanged = validSymbols.length !== existing.symbols.length;
  const groupsChanged = JSON.stringify(repairedGroups) !== JSON.stringify(existing.groups);

  if (symbolsChanged || groupsChanged) {
    const repaired: PanelPortfolioFile = { updated: existing.updated, symbols: validSymbols, groups: repairedGroups };
    savePanelPortfolio(repaired);
    return repaired;
  }

  return existing;
}

export function savePanelPortfolio(data: PanelPortfolioFile): void {
  ensureDirs();
  const path = panelPortfolioPath();
  const payload: PanelPortfolioFile = {
    updated: new Date().toISOString().slice(0, 10),
    symbols: data.symbols,
    groups: data.groups ?? [],
  };
  const text = JSON.stringify(payload, null, 2);
  writeFileSync(path, text, "utf-8");
  emitFileEvent({ operation: "WRITE", path, bytes: text.length, detail: "panel portfolio" });
}

// ── Group CRUD ──

export function createGroup(data: PanelPortfolioFile, name: string, symbolCodes: string[] = []): { data: PanelPortfolioFile; id: string } {
  const id = generateGroupId(data);
  const groups = [...(data.groups ?? []), { id, name, symbolCodes }];
  return { data: { ...data, groups }, id };
}

export function renameGroup(data: PanelPortfolioFile, id: string, name: string): PanelPortfolioFile {
  return { ...data, groups: (data.groups ?? []).map(g => g.id === id ? { ...g, name } : g) };
}

export function deleteGroup(data: PanelPortfolioFile, id: string): PanelPortfolioFile {
  return { ...data, groups: (data.groups ?? []).filter(g => g.id !== id) };
}

export function addSymbolToGroup(data: PanelPortfolioFile, groupId: string, code: string): PanelPortfolioFile {
  return {
    ...data,
    groups: (data.groups ?? []).map(g => {
      if (g.id !== groupId) return g;
      if (g.symbolCodes.includes(code)) return g;
      return { ...g, symbolCodes: [...g.symbolCodes, code] };
    }),
  };
}

export function removeSymbolFromGroup(data: PanelPortfolioFile, groupId: string, code: string): PanelPortfolioFile {
  return {
    ...data,
    groups: (data.groups ?? []).map(g =>
      g.id !== groupId ? g : { ...g, symbolCodes: g.symbolCodes.filter(c => c !== code) },
    ),
  };
}

export function addSymbol(data: PanelPortfolioFile, code: string, name: string): PanelPortfolioFile {
  if (data.symbols.some(s => s.code === code)) return data;
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...data,
    symbols: [...data.symbols, { code, name, added: today }],
  };
}

export function removeSymbol(data: PanelPortfolioFile, code: string): PanelPortfolioFile {
  return {
    ...data,
    symbols: data.symbols.filter(s => s.code !== code),
    groups: (data.groups ?? []).map(g => ({ ...g, symbolCodes: g.symbolCodes.filter(c => c !== code) })),
  };
}

function generateGroupId(data: PanelPortfolioFile): string {
  const existing = new Set((data.groups ?? []).map(g => g.id));
  for (let i = 1; i <= 1000; i++) {
    const id = `group-${i}`;
    if (!existing.has(id)) return id;
  }
  return `group-${Date.now()}`;
}
