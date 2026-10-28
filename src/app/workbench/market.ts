import { OverviewRefresh, type OverviewRefreshOptions } from "../../runtime/workspace/overview-refresh.ts";
import type { MarketSnapshot } from "../../types/workbench.ts";
import type { PanelSection } from "../../types/ui.ts";
import { normalizeMarketColorScheme } from "../../types/theme-colors.ts";

/** Adapt the existing bounded refresh owner; never turn overview prices into research evidence. */
export function createMarketOverview(publish: (snapshot: MarketSnapshot) => void, options: OverviewRefreshOptions = {}, colorScheme: () => unknown = () => undefined) {
  let current: MarketSnapshot = { refreshedAt: "", quotes: [], source: { provider: null, updatedAt: null, available: 0, total: 0 }, status: "idle" };
  const accept = (sections: PanelSection[]) => {
    const refresh = sections[0]?.refresh;
    const quotes = sections.flatMap(section => section.kind === "keyvalue" ? [] : section.rows.map(row => ({
      group: section.kind === "quotes" ? "market" as const : "watchlist" as const,
      code: row.code, name: row.name, value: Number.isFinite(row.price) ? row.price : null,
      change: Number.isFinite(row.pct) ? row.pct : null, asOfDate: row.observation?.asOfDate ?? null,
      provider: row.observation?.sourceLabel ?? "暂无数据", freshness: row.refreshState ?? row.observation?.state ?? "unavailable",
    })));
    current = { refreshedAt: refresh?.at ?? "", quotes, colorScheme: normalizeMarketColorScheme(colorScheme()), status: refresh?.status ?? "idle", retryable: !!refresh?.retryKey,
      source: { provider: [...new Set(quotes.filter(row => row.value !== null).map(row => row.provider))].join(" / ") || null,
        updatedAt: null, available: quotes.filter(row => row.value !== null && row.change !== null && !["stale", "refreshing", "unavailable"].includes(row.freshness)).length, total: quotes.length } };
    publish(structuredClone(current));
  };
  const refresh = new OverviewRefresh({ timeoutMs: 25_000, ...options, onPanel: accept });
  let started = false;
  return {
    read() { if (!started) { started = true; void refresh.start(); } return structuredClone(current); },
    snapshot: () => structuredClone(current),
    refresh(failedOnly: boolean) { started = true; void (failedOnly ? refresh.retryFailed() : refresh.start()); return structuredClone(current); },
    invalidate() { if (started) void refresh.refresh(); },
    close: () => refresh.dispose(),
  };
}
