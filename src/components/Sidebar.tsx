import React from "react";
import { Box, Text } from "ink";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { holdingsFileForVariant, readLocalPortfolioVariant } from "../tui/local-state.ts";
import { DIVIDER_CHAR, GOLD, SECTION_ACCENT, SIDEBAR_WIDTH } from "../tui/tokens.ts";

interface McpStatus {
  name: string;
  connected: boolean;
  tools: number;
  error?: string;
}

interface SidebarProps {
  mcpStatuses: McpStatus[];
}

interface PortfolioItem {
  code: string;
  name: string;
  source?: string;
  latest?: {
    date: string;
    close: number;
    changePct: number;
  };
}

export function Sidebar({ mcpStatuses }: SidebarProps) {
  const portfolio = getPortfolioItems();
  void mcpStatuses;
  const localSources = getLocalDataSources();
  const priced = portfolio.filter((item) => item.latest).length;

  return (
    <Box flexDirection="column" width={SIDEBAR_WIDTH} paddingLeft={1} marginTop={1}>
      {/* Portfolio */}
      <SectionHeader title="Portfolio" hint={portfolio.length > 0 ? `${priced}/${portfolio.length} priced` : ""} />
      <Divider />
      {portfolio.length > 0 ? (
        <Box flexDirection="column" marginBottom={0}>
          {portfolio.map((item) => (
            <PortfolioRow key={item.code} item={item} />
          ))}
        </Box>
      ) : (
        <Box marginBottom={0}>
          <Text dimColor>  no .ohquant data</Text>
        </Box>
      )}

      {/* Data */}
      <SectionHeader title="Data" hint="" />
      <Divider />
      {localSources.length > 0 ? (
        <Box marginBottom={0}>
          <Text dimColor>  {localSources.join("  ")}</Text>
        </Box>
      ) : (
        <Box marginBottom={0}>
          <Text dimColor>  no local data</Text>
        </Box>
      )}
    </Box>
  );
}

// ── Sub-components ──

function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <Box>
      <Text color={GOLD}>{SECTION_ACCENT}</Text>
      <Text bold>{title}</Text>
      {hint ? <Text dimColor>  {hint}</Text> : null}
    </Box>
  );
}

function Divider() {
  return (
    <Box>
      <Text dimColor>{"  "}{DIVIDER_CHAR.repeat(SIDEBAR_WIDTH - 2)}</Text>
    </Box>
  );
}

function PortfolioRow({ item }: { item: PortfolioItem }) {
  const code = item.code.split(".")[0];
  const name = truncate(item.name || item.code, 4);
  const price = item.latest ? formatPrice(item.latest.close) : "--";
  const change = item.latest ? formatChange(item.latest.changePct) : "--";
  const changeColor = item.latest
    ? item.latest.changePct > 0
      ? "red"
      : item.latest.changePct < 0
        ? "green"
        : undefined
    : undefined;

  return (
    <Box>
      <Box width={17} flexShrink={0}>
        <Text>  </Text>
        <Text dimColor>{code}</Text>
        <Text> </Text>
        <Text>{name}</Text>
      </Box>
      <Box width={1} flexShrink={0}>
        <Text> </Text>
      </Box>
      <Box width={7} justifyContent="flex-end" flexShrink={0}>
        <Text>{price}</Text>
      </Box>
      <Box width={1} flexShrink={0}>
        <Text> </Text>
      </Box>
      <Box width={7} justifyContent="flex-end" flexShrink={0}>
        <Text color={changeColor}>{change}</Text>
      </Box>
    </Box>
  );
}

// ── data ──

interface SymbolEntry { code: string; name: string; }
interface DataMeta {
  symbol?: string;
  name?: string;
  source?: string;
}
interface Bar {
  date: string;
  close: number;
}

function getPortfolioItems(): PortfolioItem[] {
  const symbols = getPortfolioSymbols();
  return symbols.map((symbol) => {
    const loaded = loadSymbolData(symbol.code);
    const name = loaded.meta?.name || symbol.name || symbol.code;
    const latest = getLatestSnapshot(loaded.bars);
    return {
      code: symbol.code,
      name,
      source: loaded.source,
      latest,
    };
  });
}

function getPortfolioSymbols(): SymbolEntry[] {
  const activeVariant = readLocalPortfolioVariant();
  const configPath = join(process.cwd(), ".ohquant", "portfolio", "config.json");
  let displayCodes: string[] = [];
  if (existsSync(configPath)) {
    try { const cfg = JSON.parse(readFileSync(configPath, "utf-8")); displayCodes = cfg.display || []; } catch { /* ignore */ }
  }

  const portfolioHoldings = loadPortfolioHoldings(activeVariant);
  const watchlist = loadWatchlist();
  const localData = getSymbolsWithLocalData();

  if (displayCodes.length > 0) {
    return displayCodes
      .map((code) => findSymbol(code, localData, portfolioHoldings, watchlist) || { code, name: code });
  }

  if (localData.length > 0) return localData;
  if (portfolioHoldings.length > 0) return portfolioHoldings;
  return watchlist;
}

function loadPortfolioHoldings(variant: string): SymbolEntry[] {
  try {
    const hp = join(process.cwd(), ".ohquant", "portfolio", holdingsFileForVariant(variant));
    if (existsSync(hp)) {
      const data = JSON.parse(readFileSync(hp, "utf-8"));
      if (data.funds?.length > 0) {
        return data.funds.map((f: SymbolEntry) => ({ code: f.code, name: f.name }));
      }
    }
  } catch { /* ignore */ }
  return [];
}

function loadWatchlist(): SymbolEntry[] {
  try {
    const wp = join(process.cwd(), ".ohquant", "watchlist.json");
    if (existsSync(wp)) {
      const data = JSON.parse(readFileSync(wp, "utf-8"));
      if (data.stocks?.length > 0) {
        return data.stocks.map((s: SymbolEntry) => ({ code: s.code, name: s.name }));
      }
    }
  } catch { /* ignore */ }
  return [];
}

function findSymbol(code: string, ...groups: SymbolEntry[][]): SymbolEntry | null {
  for (const group of groups) {
    const found = group.find((item) => item.code === code);
    if (found) return found;
  }
  return null;
}

function loadSymbolData(symbol: string): { bars: Bar[]; meta: DataMeta | null; source?: string } {
  try {
    const sources = ["tushare", "akshare", "llmquant-data"];
    for (const src of sources) {
      const dir = join(process.cwd(), ".ohquant", "data", src, symbol);
      const dailyPath = join(dir, "daily.json");
      if (!existsSync(dailyPath)) continue;
      const metaPath = join(dir, "meta.json");
      const meta = existsSync(metaPath)
        ? JSON.parse(readFileSync(metaPath, "utf-8"))
        : null;
      return {
        bars: JSON.parse(readFileSync(dailyPath, "utf-8")),
        meta,
        source: meta?.source || src,
      };
    }
  } catch { /* ignore */ }
  return { bars: [], meta: null };
}

function getLatestSnapshot(bars: Bar[]): PortfolioItem["latest"] | undefined {
  if (bars.length < 1) return undefined;
  const latest = bars[bars.length - 1];
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;
  const changePct = prev && prev.close !== 0
    ? ((latest.close - prev.close) / prev.close) * 100
    : 0;
  return {
    date: latest.date,
    close: latest.close,
    changePct,
  };
}

function getSymbolsWithLocalData(): SymbolEntry[] {
  const dataRoot = join(process.cwd(), ".ohquant", "data");
  const sources = ["tushare", "akshare", "llmquant-data"];
  const symbols: SymbolEntry[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    const sourceDir = join(dataRoot, source);
    if (!existsSync(sourceDir)) continue;
    try {
      for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || seen.has(entry.name)) continue;
        if (!existsSync(join(sourceDir, entry.name, "daily.json"))) continue;
        const metaPath = join(sourceDir, entry.name, "meta.json");
        const meta = existsSync(metaPath)
          ? JSON.parse(readFileSync(metaPath, "utf-8"))
          : null;
        symbols.push({
          code: meta?.symbol || entry.name,
          name: meta?.name || entry.name,
        });
        seen.add(entry.name);
      }
    } catch { /* ignore */ }
  }

  return symbols;
}

function getLocalDataSources(): string[] {
  const dataRoot = join(process.cwd(), ".ohquant", "data");
  const sources = ["tushare", "akshare", "llmquant-data"];
  const result: string[] = [];

  for (const source of sources) {
    const sourceDir = join(dataRoot, source);
    if (!existsSync(sourceDir)) continue;
    try {
      const count = readdirSync(sourceDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .filter((entry) => existsSync(join(sourceDir, entry.name, "daily.json")))
        .length;
      if (count > 0) result.push(`${source} ${count}`);
    } catch { /* ignore */ }
  }

  return result;
}

function formatPrice(value: number): string {
  return value.toFixed(value >= 100 ? 1 : 2);
}

function formatChange(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function truncate(value: string, max: number): string {
  return [...value].length > max ? [...value].slice(0, max - 1).join("") + "…" : value;
}
