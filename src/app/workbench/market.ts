import { OverviewRefresh, type OverviewRefreshOptions } from "../../runtime/workspace/overview-refresh.ts";
import type { MarketSnapshot } from "../../types/workbench.ts";
import type { PanelSection } from "../../types/ui.ts";
import { normalizeMarketColorScheme } from "../../types/theme-colors.ts";
import { fetchAkshareAIndexSpot } from "../../source/index.ts";
import { fetchOverviewQuotes, type OverviewQuoteFetcher } from "../../runtime/workspace/overview.ts";

/** The quote panel needs source snapshots, not yesterday's last two historical closes. */
export const fetchMarketIndexQuotes: OverviewQuoteFetcher = async (entries, meta) => {
  if (!entries.length) return [];
  try {
    const spot = await fetchAkshareAIndexSpot(entries.map(entry => entry.code.split(".")[0]!), meta.signal);
    meta.signal?.throwIfAborted();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const rows = entries.map(entry => {
      const quote = spot.find(row => row.code === entry.code.split(".")[0]);
      if (!quote?.asOfDate || !quote.asOfTime || !quote.provider || !Number.isFinite(quote.price) || quote.price <= 0 || !quote.prevClose || !Number.isFinite(quote.prevClose) || quote.prevClose <= 0) throw new Error("Snapshot lacks dated price/previous close");
      return { code: entry.code, name: entry.name, price: quote.price, pct: (quote.price / quote.prevClose - 1) * 100,
        observation: { symbol: entry.code, source: "akshare", sourceLabel: quote.provider, asOfDate: quote.asOfDate, asOfTime: quote.asOfTime,
          basis: "snapshot" as const, fetchedAt: new Date().toISOString(), state: quote.asOfDate === today ? "available" as const : "outside-window" as const, fallback: false } };
    });
    meta.sources.push("akshare");
    rows.forEach((row, index) => { meta.asOfDates.push(row.observation.asOfDate); meta.onRow?.(row, index); });
    return rows;
  } catch {
    meta.signal?.throwIfAborted();
    const rows = await fetchOverviewQuotes(entries, { ...meta, onRow: undefined });
    rows.forEach((row, index) => {
      if (row.observation) row.observation = { ...row.observation, basis: "daily", state: row.observation.state === "unavailable" ? "unavailable" : "outside-window", fallback: true };
      meta.onRow?.(row, index);
    });
    return rows;
  }
};

/** Adapt the existing bounded refresh owner; never turn overview prices into research evidence. */
export function createMarketOverview(publish: (snapshot: MarketSnapshot) => void, options: OverviewRefreshOptions = {}, colorScheme: () => unknown = () => undefined) {
  let current: MarketSnapshot = { refreshedAt: "", quotes: [], source: { provider: null, updatedAt: null, available: 0, total: 0 }, status: "idle" };
  const accept = (sections: PanelSection[]) => {
    const refresh = sections[0]?.refresh;
    const quotes = sections.flatMap(section => section.kind === "keyvalue" ? [] : section.rows.map(row => ({
      group: section.kind === "quotes" ? "market" as const : "watchlist" as const,
      code: row.code, name: row.name, value: Number.isFinite(row.price) ? row.price : null,
      change: Number.isFinite(row.pct) ? row.pct : null, asOfDate: row.observation?.asOfDate ?? null,
      basis: row.observation?.basis ?? "daily", asOfTime: row.observation?.asOfTime,
      provider: row.observation?.sourceLabel ?? "暂无数据", freshness: row.refreshState ?? row.observation?.state ?? "unavailable",
    })));
    current = { refreshedAt: refresh?.at ?? "", quotes, colorScheme: normalizeMarketColorScheme(colorScheme()), status: refresh?.status ?? "idle", retryable: !!refresh?.retryKey,
      source: { provider: [...new Set(quotes.filter(row => row.value !== null).map(row => row.provider))].join(" / ") || null,
        updatedAt: null, available: quotes.filter(row => row.value !== null && row.change !== null && !["stale", "refreshing", "unavailable", "outside-window"].includes(row.freshness)).length, total: quotes.length } };
    publish(structuredClone(current));
  };
  const refresh = new OverviewRefresh({ timeoutMs: 25_000, quoteFetcher: fetchMarketIndexQuotes, ...options, onPanel: accept });
  let started = false;
  return {
    read() { if (!started) { started = true; void refresh.start(); } return structuredClone(current); },
    snapshot: () => structuredClone(current),
    refresh(failedOnly: boolean) { started = true; void (failedOnly ? refresh.retryFailed() : refresh.start()); return structuredClone(current); },
    invalidate() { if (started) void refresh.refresh(); },
    close: () => refresh.dispose(),
  };
}
