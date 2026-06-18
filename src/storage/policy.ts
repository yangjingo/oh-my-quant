/**
 * .ohquant local filesystem policy.
 *
 * Mirrors the Codex/pi pattern: keep durable user-controlled state separate
 * from derived caches and runtime session artifacts.
 */

export type StorageClass = "durable" | "cache" | "artifact" | "forbidden";

export interface StoragePolicyEntry {
  path: string;
  class: StorageClass;
  cacheable: boolean;
  description: string;
}

export const STORAGE_POLICY: StoragePolicyEntry[] = [
  {
    path: ".ohquant/settings.json",
    class: "durable",
    cacheable: false,
    description: "User configuration, model preferences, direct data adapter settings, and redacted auth references.",
  },
  {
    path: ".ohquant/watchlist.json",
    class: "durable",
    cacheable: false,
    description: "User-authored watchlist. Composer autocomplete only; not Overview Portfolio.",
  },
  {
    path: ".ohquant/panel-portfolio.json",
    class: "durable",
    cacheable: false,
    description: "User-authored Overview Portfolio symbol list (code/name). Live quotes fetched at refresh.",
  },
  {
    path: ".ohquant/data/{source}/{symbol}/",
    class: "cache",
    cacheable: true,
    description: "Public or provider-sourced market bars and metadata, safe to recompute/refetch.",
  },
  {
    path: ".ohquant/cache/",
    class: "cache",
    cacheable: true,
    description: "Short-lived derived artifacts with TTL semantics.",
  },
  {
    path: ".ohquant/benchmark/results/",
    class: "artifact",
    cacheable: false,
    description: "Named research outputs produced by explicit benchmark commands.",
  },
  {
    path: ".ohquant/sessions/",
    class: "artifact",
    cacheable: false,
    description: "Human-readable session transcript artifacts, compacted like pi sessions.",
  },
  {
    path: ".ohquant/portfolio/",
    class: "forbidden",
    cacheable: false,
    description: "Portfolio holdings, NAV snapshots, allocations, and personal positions must not be cached or inferred from local files.",
  },
];

export function isPortfolioCachePath(path: string): boolean {
  return /(^|[\\/])\.ohquant[\\/]portfolio([\\/]|$)/.test(path);
}

export function assertPortfolioCacheDisabled(operation: string): never {
  throw new Error(
    `${operation} is disabled: portfolio holdings/NAV/allocation data is private live state and must not be cached under .ohquant.`,
  );
}
