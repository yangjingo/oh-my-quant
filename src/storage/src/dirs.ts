import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { emitFileEvent } from "./fs-events.ts";

export function resolveOhquantDir(): string {
  return process.env.OHQUANT_DIR || join(process.cwd(), ".ohquant");
}

export function resolveDataDir(): string {
  return join(resolveOhquantDir(), "data");
}

export function resolveSessionsDir(): string {
  return join(resolveOhquantDir(), "sessions");
}

export function resolveWorkbenchSessionsDir(): string {
  return join(resolveOhquantDir(), "workbench", "sessions");
}

export function resolveBenchmarkDir(): string {
  return join(resolveOhquantDir(), "benchmark");
}

export function resolveBenchmarkResultsDir(): string {
  return join(resolveBenchmarkDir(), "results");
}

export function resolveBenchmarkComparisonsDir(): string {
  return join(resolveBenchmarkDir(), "comparisons");
}

export function resolveCacheDir(): string {
  return join(resolveOhquantDir(), "cache");
}

export function resolveAlphaRunsDir(): string {
  return join(resolveOhquantDir(), "alpha", "runs");
}

export function resolveAnnualReportsDir(): string {
  return join(resolveOhquantDir(), "reports", "annual");
}

export function resolveWatchlistPath(): string {
  return join(resolveOhquantDir(), "watchlist.json");
}

export function resolveSettingsPath(): string {
  return join(resolveOhquantDir(), "settings.json");
}

export function resolveLegacyConfigPath(): string {
  return join(resolveOhquantDir(), "config.json");
}

export function resolvePanelPortfolioPath(): string {
  return join(resolveOhquantDir(), "panel-portfolio.json");
}

export function resolveLegacyPortfolioDir(): string {
  return join(resolveOhquantDir(), "portfolio");
}

export function resolveLegacyHoldingsPath(): string {
  return join(resolveLegacyPortfolioDir(), "holdings.json");
}

export function resolveArtifactsDir(): string {
  return join(resolveOhquantDir(), "artifacts");
}

export function resolveInsightCachePath(): string {
  return join(resolveOhquantDir(), "insights.json");
}

export function resolveSkillsDir(): string {
  return process.env.OHQUANT_SKILLS_DIR || join(resolveOhquantDir(), "skills");
}


export function ensureDirs(): void {
  for (const dir of [resolveDataDir(), resolveSessionsDir(), resolveBenchmarkDir(), resolveCacheDir()]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      emitFileEvent({ operation: "MKDIR", path: dir, detail: "local state" });
    }
  }
}
