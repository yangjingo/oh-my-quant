import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { OhQuantSettings } from "../../types/config.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import { emitFileEvent } from "./fs-events.ts";
import { canonicalizeWhyjEnv } from "./env-keys.ts";
import { OHQUANT_DIR, ensureDirs } from "./dirs.ts";

export function loadSettings(): OhQuantSettings {
  ensureDirs();
  const sp = join(process.env.OHQUANT_DIR || OHQUANT_DIR, "settings.json");
  if (!existsSync(sp)) {
    const text = JSON.stringify(DEFAULT_SETTINGS, null, 2);
    writeFileSync(sp, text, "utf-8");
    emitFileEvent({ operation: "WRITE", path: sp, bytes: text.length, detail: "default settings" });
    return cloneSettings(DEFAULT_SETTINGS);
  }
  try {
    const text = readFileSync(sp, "utf-8");
    emitFileEvent({ operation: "READ", path: sp, bytes: text.length, detail: "settings" });
    const raw = JSON.parse(text);
    const settings = normalizeSettings(raw);
    if (JSON.stringify(raw) !== JSON.stringify(settings)) {
      saveSettings(settings);
    }
    return settings;
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: OhQuantSettings): void {
  ensureDirs();
  const text = JSON.stringify(normalizeSettings(s), null, 2);
  const sp = join(process.env.OHQUANT_DIR || OHQUANT_DIR, "settings.json");
  writeFileSync(sp, text, "utf-8");
  emitFileEvent({ operation: "WRITE", path: sp, bytes: text.length, detail: "settings" });
}

export function migrateOldConfig(): void {
  const old = join(OHQUANT_DIR, "config.json");
  if (existsSync(old)) {
    try {
      const oldText = readFileSync(old, "utf-8");
      emitFileEvent({ operation: "READ", path: old, bytes: oldText.length, detail: "legacy config" });
      const oldData = JSON.parse(oldText);
      const settings = loadSettings();
      if (oldData.preferences) settings.preferences = { ...settings.preferences, ...oldData.preferences };
      saveSettings(settings);
      try {
        unlinkSync(old);
        emitFileEvent({ operation: "DELETE", path: old, detail: "legacy config migrated" });
      } catch { /* ok */ }
    } catch { /* skip broken files */ }
  }
}

function cloneSettings(settings: OhQuantSettings): OhQuantSettings {
  return JSON.parse(JSON.stringify(settings)) as OhQuantSettings;
}

function normalizeSettings(raw: Partial<OhQuantSettings>): OhQuantSettings {
  return {
    version: raw.version ?? DEFAULT_SETTINGS.version,
    env: { ...DEFAULT_SETTINGS.env, ...canonicalizeWhyjEnv(raw.env ?? {}) },
    model: raw.model || DEFAULT_SETTINGS.model,
    thinkingLevel: raw.thinkingLevel && raw.thinkingLevel !== "off" ? raw.thinkingLevel : DEFAULT_SETTINGS.thinkingLevel,
    insightEnabled: raw.insightEnabled ?? DEFAULT_SETTINGS.insightEnabled,
    showPortfolioPanel: raw.showPortfolioPanel ?? DEFAULT_SETTINGS.showPortfolioPanel,
    skillIntegrations: normalizeSkillIntegrations(raw.skillIntegrations),
    permissions: { ...DEFAULT_SETTINGS.permissions, ...(raw.permissions ?? {}) },
    preferences: normalizePreferences(raw.preferences),
  };
}

const VALID_SOURCES = new Set(["akshare", "tushare", "llmquant-data", "financial-datasets"]);
function isValidSource(s: unknown): boolean {
  return typeof s === "string" && VALID_SOURCES.has(s);
}

function normalizeSkillIntegrations(
  raw: Partial<OhQuantSettings["skillIntegrations"]> | undefined,
): OhQuantSettings["skillIntegrations"] {
  return {
    codex: raw?.codex ?? DEFAULT_SETTINGS.skillIntegrations.codex,
    claude: raw?.claude ?? DEFAULT_SETTINGS.skillIntegrations.claude,
  };
}

function normalizePreferences(raw: Partial<OhQuantSettings["preferences"]> | undefined): OhQuantSettings["preferences"] {
  return {
    defaultMarket: raw?.defaultMarket ?? DEFAULT_SETTINGS.preferences.defaultMarket,
    defaultBenchmark: raw?.defaultBenchmark ?? DEFAULT_SETTINGS.preferences.defaultBenchmark,
    defaultCash: raw?.defaultCash ?? DEFAULT_SETTINGS.preferences.defaultCash,
    defaultFast: raw?.defaultFast ?? DEFAULT_SETTINGS.preferences.defaultFast,
    defaultSlow: raw?.defaultSlow ?? DEFAULT_SETTINGS.preferences.defaultSlow,
    currentPortfolioFile: raw?.currentPortfolioFile ?? DEFAULT_SETTINGS.preferences.currentPortfolioFile,
    source: isValidSource(raw?.source) ? raw!.source! : DEFAULT_SETTINGS.preferences.source,
  };
}
