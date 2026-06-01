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
  vol: number;
}

export function Sidebar({ mcpStatuses, lastSymbol, width = 24 }: SidebarProps) {
  const watchlist = getWatchlist();
  const snapshots = getSnapshots(watchlist);

  return (
    <Box flexDirection="column" width={width} borderStyle="single" borderColor="gray" paddingX={1}>
      {/* Portfolio section */}
      <Box marginBottom={1}>
        <Text bold>Portfolio</Text>
        <Text dimColor>  {watchlist.length} stk</Text>
      </Box>

      {snapshots.length > 0 ? (
        <Box flexDirection="column" marginBottom={1}>
          {snapshots.map((s) => (
            <StockRow key={s.code} stock={s} />
          ))}
        </Box>
      ) : (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>empty</Text>
          <Text dimColor>/add stock --code CODE</Text>
        </Box>
      )}

      {/* MCP / API status */}
      <Box marginTop={1} marginBottom={1}>
        <Text bold>API</Text>
      </Box>
      {mcpStatuses.length > 0 ? (
        <Box flexDirection="column">
          {mcpStatuses.map((s) => (
            <Box key={s.name}>
              <Text color={s.connected ? "green" : "red"}>
                {s.connected ? "✓" : "✗"}
              </Text>
              <Text dimColor> {s.name}</Text>
              {s.connected && <Text dimColor> ({s.tools}t)</Text>}
            </Box>
          ))}
        </Box>
      ) : (
        <Text dimColor>/mcp connect</Text>
      )}

      {lastSymbol && (
        <Box marginTop={1}>
          <Text dimColor>active: </Text>
          <Text>{lastSymbol}</Text>
        </Box>
      )}
    </Box>
  );
}

function StockRow({ stock }: { stock: StockSnapshot }) {
  const up = stock.change >= 0;
  const color = up ? "red" : "green";
  const arrow = up ? "↑" : "↓";

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text dimColor>{stock.code.split(".")[0]}</Text>
      </Box>
      <Box justifyContent="space-between">
        <Box>
          <Text bold>{stock.price.toFixed(2)}</Text>
        </Box>
        <Box>
          <Text color={color}>
            {arrow} {Math.abs(stock.change).toFixed(2)} ({Math.abs(stock.changePct).toFixed(2)}%)
          </Text>
        </Box>
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
      return { code: s.code, name: s.name, price: 0, change: 0, changePct: 0, vol: 0 };
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
      vol: latest.volume,
    };
  });
}

interface Bar {
  date: string;
  close: number;
  volume: number;
}

function loadCachedBars(symbol: string): Bar[] {
  try {
    const sources = ["tushare", "akshare", "llmquant-data"];
    for (const src of sources) {
      const path = join(process.cwd(), ".ohquant", "data", src, symbol, "daily.json");
      if (existsSync(path)) {
        return JSON.parse(readFileSync(path, "utf-8"));
      }
    }
  } catch {
    // ignore
  }
  return [];
}
