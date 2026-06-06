import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { loadSidebarSnapshot, type WatchItem } from "../tui/local-snapshot.ts";
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

interface SidebarSnapshot {
  watchItems: WatchItem[];
  localSources: string[];
  loading: boolean;
}

export function Sidebar({ mcpStatuses }: SidebarProps) {
  void mcpStatuses;
  const [{ watchItems, localSources, loading }, setSnapshot] = useState<SidebarSnapshot>({
    watchItems: [],
    localSources: [],
    loading: true,
  });

  useEffect(() => {
    let active = true;
    setSnapshot((current) => ({ ...current, loading: true }));
    void loadSidebarSnapshot().then((snapshot) => {
      if (!active) return;
      setSnapshot({
        ...snapshot,
        loading: false,
      });
    });
    return () => { active = false; };
  }, []);

  const priced = watchItems.filter((item) => item.latest).length;
  const latestUpdate = getLatestUpdateDate(watchItems);

  return (
    <Box flexDirection="column" width={SIDEBAR_WIDTH} flexShrink={0} paddingLeft={1} marginTop={1}>
      {/* Watchlist */}
      <SectionHeader title="Watchlist" hint={watchItems.length > 0 ? `${priced}/${watchItems.length} priced` : ""} />
      <Divider />
      <MetaRow text={loading ? "updated --" : `updated ${latestUpdate || "--"}`} />
      {loading ? (
        <Box marginBottom={0}>
          <Text dimColor>  loading local state</Text>
        </Box>
      ) : watchItems.length > 0 ? (
        <Box flexDirection="column" marginBottom={0}>
          {watchItems.map((item) => (
            <WatchRow key={item.code} item={item} />
          ))}
        </Box>
      ) : (
        <Box marginBottom={0}>
          <Text dimColor>  no watchlist data</Text>
        </Box>
      )}

      {/* Source */}
      <SectionHeader title="Source" hint={!loading && localSources.length > 0 ? `${localSources.length} active` : ""} />
      <Divider />
      {loading ? (
        <Box marginBottom={0}>
          <Text dimColor>  loading sources</Text>
        </Box>
      ) : localSources.length > 0 ? (
        <Box flexDirection="column" marginBottom={0}>
          {localSources.map((source) => (
            <SourceRow key={source} source={source} />
          ))}
        </Box>
      ) : (
        <Box marginBottom={0}>
          <Text dimColor>  no local sources</Text>
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

function WatchRow({ item }: { item: WatchItem }) {
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

function MetaRow({ text }: { text: string }) {
  return (
    <Box>
      <Box width={2} flexShrink={0}>
        <Text>  </Text>
      </Box>
      <Text dimColor>{text}</Text>
    </Box>
  );
}

function SourceRow({ source }: { source: string }) {
  const parsed = parseSource(source);

  return (
    <Box>
      <Box width={2} flexShrink={0}>
        <Text>  </Text>
      </Box>
      <Box width={20} flexShrink={0}>
        <Text dimColor>{truncate(parsed.name, 18)}</Text>
      </Box>
      <Box width={2} flexShrink={0}>
        <Text> </Text>
      </Box>
      <Box width={8} justifyContent="flex-end" flexShrink={0}>
        <Text color={GOLD}>{parsed.count}</Text>
      </Box>
    </Box>
  );
}

function parseSource(source: string): { name: string; count: string } {
  const match = source.match(/^(.*)\s+(\d+)$/);
  if (!match) return { name: source, count: "--" };
  return { name: match[1], count: match[2] };
}

function formatPrice(value: number): string {
  return value.toFixed(value >= 100 ? 1 : 2);
}

function formatChange(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function getLatestUpdateDate(items: WatchItem[]): string {
  const dates = items
    .map((item) => item.latest?.date)
    .filter((date): date is string => !!date);
  return dates.sort().at(-1) || "";
}

function truncate(value: string, max: number): string {
  return [...value].length > max ? [...value].slice(0, max - 1).join("") + "…" : value;
}
