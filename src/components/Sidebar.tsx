import React from "react";
import { Box, Text } from "ink";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface McpStatus {
  name: string;
  connected: boolean;
  tools: number;
  error?: string;
}

interface SidebarProps {
  mcpStatuses: McpStatus[];
  lastSymbol: string | null;
  width?: number;
}

interface StockSnapshot {
  code: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
}

export function Sidebar({ mcpStatuses, lastSymbol, width = 28 }: SidebarProps) {
  const watchlist = getWatchlist();
  const snapshots = getSnapshots(watchlist);

  const dataServers = mcpStatuses.filter(
    (s) => !["web-search-prime", "web-reader"].includes(s.name)
  );

  return (
    <Box flexDirection="column" width={width} borderStyle="single" borderColor="gray" paddingX={1}>
      {/* Portfolio */}
      <Text bold>Portfolio</Text>

      {snapshots.length > 0 ? (
        <Box flexDirection="column" marginY={1}>
          {snapshots.map((s) => (
            <StockRow key={s.code} stock={s} />
          ))}
        </Box>
      ) : (
        <Box marginY={1}>
          <Text dimColor>/add stock --code CODE</Text>
        </Box>
      )}

      {/* Divider */}
      <Text dimColor>──────────────────────</Text>

      {/* API */}
      <Box marginTop={1}>
        <Text bold>Data</Text>
      </Box>

      {dataServers.length > 0 ? (
        <Box flexDirection="column" marginY={1}>
          {dataServers.map((s) => (
            <Box key={s.name}>
              <Text color={s.connected ? "green" : "red"}>
                {s.connected ? "●" : "○"}
              </Text>
              <Text> {s.name}</Text>
              {s.connected && <Text dimColor> {s.tools}t</Text>}
            </Box>
          ))}
        </Box>
      ) : (
        <Box marginY={1}>
          <Text dimColor>/mcp connect</Text>
        </Box>
      )}

      {/* Active symbol */}
      {lastSymbol && (
        <Box marginTop={1}>
          <Text dimColor>{lastSymbol}</Text>
        </Box>
      )}
    </Box>
  );
}

function StockRow({ stock }: { stock: StockSnapshot }) {
  const isUp = stock.change > 0;
  const isDown = stock.change < 0;
  const color = isUp ? "red" : isDown ? "green" : undefined;
  const arrow = isUp ? "↑" : isDown ? "↓" : "─";
  const hasData = stock.price > 0;

  return (
    <Box marginBottom={1} flexDirection="column">
      <Text dimColor>{stock.code.split(".")[0]}</Text>
      <Box>
        <Text bold>{hasData ? stock.price.toFixed(2) : "--.--"}</Text>
        {hasData ? (
          <Text color={color}>
            {" "}{arrow}{Math.abs(stock.change).toFixed(2)} {Math.abs(stock.changePct).toFixed(2)}%
          </Text>
        ) : (
          <Text dimColor> no data</Text>
        )}
      </Box>
    </Box>
  );
}

// --- data ---

function getWatchlist(): { code: string; name: string }[] {
  try {
    const path = join(process.cwd(), ".ohquant", "watchlist.json");
    if (!existsSync(path)) return [];
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return raw.stocks || [];
  } catch {
    return [];
  }
}

function getSnapshots(watchlist: { code: string; name: string }[]): StockSnapshot[] {
  return watchlist.map((s) => {
    const bars = loadCachedBars(s.code);
    if (bars.length < 2) {
      return { code: s.code, name: s.name, price: 0, change: 0, changePct: 0 };
    }
    const latest = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    const change = latest.close - prev.close;
    const changePct = prev.close !== 0 ? (change / prev.close) * 100 : 0;
    return {
      code: s.code,
      name: s.name,
      price: +latest.close.toFixed(2),
      change: +change.toFixed(2),
      changePct: +changePct.toFixed(2),
    };
  });
}

interface Bar { date: string; close: number; volume: number; }

function loadCachedBars(symbol: string): Bar[] {
  try {
    const sources = ["tushare", "akshare", "llmquant-data"];
    for (const src of sources) {
      const path = join(process.cwd(), ".ohquant", "data", src, symbol, "daily.json");
      if (existsSync(path)) return JSON.parse(readFileSync(path, "utf-8"));
    }
  } catch { /* ignore */ }
  return [];
}
