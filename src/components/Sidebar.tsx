import React, { useState } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface SidebarProps {
  mcpServers: string[];
  lastSymbol: string | null;
  width?: number;
}

interface Section {
  title: string;
  content: () => React.ReactElement;
}

export function Sidebar({ mcpServers, lastSymbol, width = 28 }: SidebarProps) {
  const [tab, setTab] = useState<"market" | "data" | "portfolio">("market");

  useInput((_input, key) => {
    // No input needed — sidebar is read-only display
    // Tab switching could be added via Ctrl+N/P
  });

  const sections: Record<string, Section> = {
    market: {
      title: "Market",
      content: () => <MarketPanel />,
    },
    data: {
      title: "Data",
      content: () => <DataPanel mcpServers={mcpServers} lastSymbol={lastSymbol} />,
    },
    portfolio: {
      title: "Portfolio",
      content: () => <PortfolioPanel />,
    },
  };

  const current = sections[tab];

  return (
    <Box flexDirection="column" width={width} borderStyle="single" borderColor="gray" paddingX={1}>
      {/* Section title */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold>{current.title}</Text>
        <Text dimColor>···</Text>
      </Box>

      {/* Content */}
      <Box flexDirection="column" marginBottom={1}>
        {current.content()}
      </Box>

      {/* Tab switcher */}
      <Box justifyContent="space-between">
        {Object.entries(sections).map(([key, sec]) => (
          <Text
            key={key}
            bold={key === tab}
            color={key === tab ? "cyan" : undefined}
            dimColor={key !== tab}
          >
            {sec.title}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function MarketPanel() {
  return (
    <Box flexDirection="column">
      <Text dimColor>上证指数</Text>
      <Text>--.-- (--) </Text>
      <Box marginTop={1}>
        <Text dimColor>深证成指</Text>
      </Box>
      <Text>--.-- (--) </Text>
      <Box marginTop={1}>
        <Text dimColor>创业板指</Text>
      </Box>
      <Text>--.-- (--) </Text>
      <Box marginTop={1}>
        <Text dimColor>· data via MCP</Text>
      </Box>
    </Box>
  );
}

function DataPanel({ mcpServers, lastSymbol }: { mcpServers: string[]; lastSymbol: string | null }) {
  const barsCount = getCachedBarsCount(lastSymbol);

  return (
    <Box flexDirection="column">
      <Text dimColor>MCP servers</Text>
      {mcpServers.length > 0 ? (
        mcpServers.map((s) => (
          <Text key={s} color="green">✓ {s}</Text>
        ))
      ) : (
        <Text color="yellow">⚠ disconnected</Text>
      )}
      <Box marginTop={1}>
        <Text dimColor>Current symbol</Text>
      </Box>
      <Text>{lastSymbol || "—"}</Text>
      {barsCount > 0 && (
        <>
          <Box marginTop={1}>
            <Text dimColor>Cached bars</Text>
          </Box>
          <Text>{barsCount} days</Text>
        </>
      )}
    </Box>
  );
}

function PortfolioPanel() {
  const watchlist = getWatchlist();

  return (
    <Box flexDirection="column">
      <Text dimColor>Watchlist</Text>
      {watchlist.length > 0 ? (
        watchlist.map((s) => (
          <Text key={s.code}>{s.code}  {s.name}</Text>
        ))
      ) : (
        <Text dimColor>empty · /add stock</Text>
      )}
      <Box marginTop={1}>
        <Text dimColor>Benchmarks</Text>
      </Box>
      <Text>0 scored · /benchmark</Text>
    </Box>
  );
}

// --- helpers ---

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

function getCachedBarsCount(symbol: string | null): number {
  if (!symbol) return 0;
  try {
    const sources = ["akshare", "tushare", "llmquant-data"];
    for (const src of sources) {
      const path = join(process.cwd(), ".ohquant", "data", src, symbol, "meta.json");
      if (existsSync(path)) {
        const meta = JSON.parse(readFileSync(path, "utf-8"));
        return meta.barCount || 0;
      }
    }
  } catch {
    // ignore
  }
  return 0;
}
