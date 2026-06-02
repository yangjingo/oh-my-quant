import React from "react";
import { Box, Text } from "ink";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { GOLD } from "../tui/tokens.ts";

interface McpStatus {
  name: string;
  connected: boolean;
  tools: number;
  error?: string;
}

interface SidebarProps {
  mcpStatuses: McpStatus[];
}

interface Snapshot {
  code: string;
  name: string;
  price: number;
  changePct: number;
}

export function Sidebar({ mcpStatuses }: SidebarProps) {
  const holdings = getHoldings();
  const snapshots = getSnapshots(holdings);
  const updated = getLastUpdated();
  const dataServers = mcpStatuses.filter(
    (s) => !["web-search-prime", "web-reader"].includes(s.name)
  );

  return (
    <Box flexDirection="column" width={28} paddingLeft={1}>

      {/* Portfolio */}
      <SectionHeader title="Portfolio" hint={snapshots.length > 0 ? `${snapshots.length} held` : ""} />
      <Divider />
      {holdings.length > 0 ? (
        <Box flexDirection="column" marginBottom={1}>
          {snapshots.map((s, i) => (
            <HoldingRow key={s.code} stock={s} last={i === snapshots.length - 1} />
          ))}
        </Box>
      ) : (
        <Box marginBottom={1}>
          <Text dimColor>  no holdings</Text>
        </Box>
      )}

      {/* Data */}
      <SectionHeader title="Data" hint="" />
      <Divider />
      {dataServers.length > 0 ? (
        <Box flexDirection="column" marginBottom={1}>
          {dataServers.map((s) => (
            <Box key={s.name}>
              <Text>  </Text>
              <Text color={s.connected ? "green" : "red"}>
                {s.connected ? "on " : "--"}
              </Text>
              <Text dimColor>{s.name}</Text>
            </Box>
          ))}
        </Box>
      ) : (
        <Box marginBottom={1}>
          <Text dimColor>  /mcp connect</Text>
        </Box>
      )}

      {/* Updated timestamp */}
      {updated && (
        <Box>
          <Text dimColor>  {updated}</Text>
        </Box>
      )}
    </Box>
  );
}

// ── Sub-components ──

function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <Box>
      <Text color={GOLD}>▎ </Text>
      <Text bold>{title}</Text>
      {hint ? <Text dimColor>  {hint}</Text> : null}
    </Box>
  );
}

function Divider() {
  return (
    <Box>
      <Text dimColor>{"  "}{"-".repeat(24)}</Text>
    </Box>
  );
}

function HoldingRow({ stock, last }: { stock: Snapshot; last: boolean }) {
  const isUp = stock.changePct > 0;
  const isDown = stock.changePct < 0;
  const color = isUp ? "red" : isDown ? "green" : undefined;
  const sign = isUp ? "+" : isDown ? "-" : " ";
  const hasData = stock.price > 0;
  const pct = hasData ? `${sign}${Math.abs(stock.changePct).toFixed(2)}%` : "--";
  const price = hasData ? stock.price.toFixed(2) : "--.--";

  return (
    <Box flexDirection="column" marginBottom={last ? 0 : 1}>
      {/* Row 1: code + name */}
      <Box>
        <Text>  </Text>
        <Text dimColor>{stock.code.split(".")[0]}</Text>
        <Text> </Text>
        <Text>{stock.name}</Text>
      </Box>
      {/* Row 2: right-aligned price + pct */}
      <Box>
        <Text>  </Text>
        <Text>{price}</Text>
        <Text>  </Text>
        {hasData ? (
          <Text color={color}>{pct}</Text>
        ) : (
          <Text dimColor>{pct}</Text>
        )}
      </Box>
    </Box>
  );
}

// ── data ──

interface Holding { code: string; name: string; }

function getHoldings(): Holding[] {
  try {
    const hp = join(process.cwd(), ".ohquant", "portfolio", "holdings.json");
    if (existsSync(hp)) {
      const data = JSON.parse(readFileSync(hp, "utf-8"));
      if (data.funds?.length > 0) return data.funds.map((f: Holding) => ({ code: f.code, name: f.name }));
    }
  } catch { /* fall through */ }
  try {
    const wp = join(process.cwd(), ".ohquant", "watchlist.json");
    if (existsSync(wp)) {
      const data = JSON.parse(readFileSync(wp, "utf-8"));
      if (data.stocks?.length > 0) return data.stocks;
    }
  } catch { /* fall through */ }
  return [];
}

function getSnapshots(holdings: Holding[]): Snapshot[] {
  return holdings.map((h) => {
    const bars = loadBars(h.code);
    if (bars.length < 2) return { code: h.code, name: h.name, price: 0, changePct: 0 };
    const latest = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    const chg = prev.close !== 0 ? ((latest.close - prev.close) / prev.close) * 100 : 0;
    return { code: h.code, name: h.name, price: +latest.close.toFixed(2), changePct: +chg.toFixed(2) };
  });
}

function getLastUpdated(): string | null {
  try {
    let latest = 0;
    const hp = join(process.cwd(), ".ohquant", "portfolio", "holdings.json");
    if (existsSync(hp)) { const m = statSync(hp).mtimeMs; if (m > latest) latest = m; }
    const sources = ["tushare", "akshare", "llmquant-data"];
    for (const src of sources) {
      const dir = join(process.cwd(), ".ohquant", "data", src);
      if (!existsSync(dir)) continue;
      for (const h of getHoldings()) {
        const f = join(dir, h.code, "daily.json");
        if (existsSync(f)) { const m = statSync(f).mtimeMs; if (m > latest) latest = m; }
      }
    }
    if (latest === 0) return null;
    const d = new Date(latest);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return null; }
}

function loadBars(symbol: string): { date: string; close: number }[] {
  try {
    const sources = ["tushare", "akshare", "llmquant-data"];
    for (const src of sources) {
      const path = join(process.cwd(), ".ohquant", "data", src, symbol, "daily.json");
      if (existsSync(path)) return JSON.parse(readFileSync(path, "utf-8"));
    }
  } catch { /* ignore */ }
  return [];
}
