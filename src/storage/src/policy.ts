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
  { path: ".ohquant/workbench/sessions/", class: "durable", cacheable: false,
    description: "Private versioned Workbench conversation projections and run identity, bound to Quant journals. Not verified research artifacts; preserve on downgrade or unknown versions." },
  { path: ".ohquant/skills/.selection.json", class: "durable", cacheable: false,
    description: "User-selected skill names per shared repository. Removal changes loading choices, not cached source files or local edits." },
  { path: ".ohquant/research/decisions/", class: "artifact", cacheable: false,
    description: "Explicit research choices and rationale bound to comparison archives. Not verified user approval, account activity or public market cache; free text may contain private research notes." },
  {
    path: ".ohquant/reports/annual/",
    class: "artifact",
    cacheable: false,
    description: "Immutable local annual observation research and HTML previews bound to archived comparisons; includes group names, no account performance. Not a public share copy.",
  },
  {
    path: ".ohquant/model-auth/{id}.json",
    class: "durable",
    cacheable: false,
    description: "Private OAuth login generations and rotated credentials; settings contain only an opaque reference. Never publish or treat as cache.",
  },
  {
    path: ".ohquant/alpha/runs/",
    class: "artifact",
    cacheable: false,
    description: "Immutable hypothetical alpha research with explicit assumptions and public DatasetRef; not account positions or executions.",
  },
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
