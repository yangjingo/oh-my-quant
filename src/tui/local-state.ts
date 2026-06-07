/**
 * Local UI state reader — settings, portfolio config, model name.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadLocalModel } from "./local-snapshot.ts";

interface LocalSettings {
  model?: string;
  env?: Record<string, string>;
  preferences?: { portfolioVariant?: string };
}

interface PortfolioConfig {
  schemes?: Array<{
    key?: string; variant?: string; label?: string; holdingsFile?: string;
  }>;
}

export interface LocalPortfolioScheme {
  key: string;
  variant: string;
  label: string;
  name: string;
  holdingsFile: string;
  available: boolean;
}

type PortfolioSchemeConfig = Omit<LocalPortfolioScheme, "available" | "name">;

const OHQUANT_DIR = join(process.cwd(), ".ohquant");
const PORTFOLIO_DIR = join(OHQUANT_DIR, "portfolio");
const PORTFOLIO_CONFIG_PATH = join(PORTFOLIO_DIR, "config.json");

const DEFAULT_SCHEMES: PortfolioSchemeConfig[] = [
  { key: "A", variant: "v1", label: "A", holdingsFile: "holdings.json" },
  { key: "B", variant: "v2-semicon", label: "B", holdingsFile: "holdings_v2_semicon.json" },
  { key: "C", variant: "v2-kc50", label: "C", holdingsFile: "holdings_v2_kc50.json" },
];

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf-8")) as T; } catch { return null; }
}

// Sync wrapper matching loadLocalModel() contract
function loadModelSync(): string {
  try {
    const p = join(OHQUANT_DIR, "settings.json");
    const s = JSON.parse(existsSync(p) ? readFileSync(p, "utf-8") : "{}");
    return s?.env?.["WHYJ_DEFAULT_SONNET_MODEL"] ?? "deepseek-v4-pro";
  } catch { return "deepseek-v4-pro"; }
}

const SHORT_MODEL: Record<string, string> = {
  "claude-sonnet-4-6": "sonnet",
  "claude-opus-4-7": "opus",
  "claude-haiku-4-5": "haiku",
  "deepseek-v4-pro": "deepseek",
};

export function readLocalUiState(): {
  model: string;
  modelLabel: string;
  portfolioVariant: string;
  activeScheme: LocalPortfolioScheme | null;
} {
  const settings = readJson<LocalSettings>(join(OHQUANT_DIR, "settings.json"));
  const portfolioVariant = settings?.preferences?.portfolioVariant || "v1";
  const model = loadModelSync();

  const schemes = readPortfolioSchemes(portfolioVariant);
  const activeScheme = schemes.find((s) => s.variant === portfolioVariant && s.available) || null;

  return {
    model,
    modelLabel: SHORT_MODEL[model] || model.split("-").pop() || model,
    portfolioVariant,
    activeScheme,
  };
}

function readPortfolioSchemes(activeVariant: string): LocalPortfolioScheme[] {
  const config = readJson<PortfolioConfig>(PORTFOLIO_CONFIG_PATH);
  const configured = normalizeSchemes(config);
  const localSchemes = configured.length > 0 ? configured : inferSchemes();
  const schemes = localSchemes.length > 0 ? localSchemes : DEFAULT_SCHEMES;
  return ensureActive(schemes, activeVariant).map((scheme) => {
    const hp = join(PORTFOLIO_DIR, scheme.holdingsFile);
    const available = existsSync(hp);
    let name = scheme.variant;
    if (available) {
      try {
        const data = JSON.parse(readFileSync(hp, "utf-8"));
        if (data.name) name = data.name;
      } catch { /* keep variant */ }
    }
    return { ...scheme, name, available };
  });
}

function normalizeSchemes(config: PortfolioConfig | null): PortfolioSchemeConfig[] {
  if (!Array.isArray(config?.schemes)) return [];
  return config.schemes
    .filter((s) => s.key && s.variant && s.holdingsFile)
    .map((s) => ({
      key: String(s.key), variant: String(s.variant),
      label: String(s.label || s.key), holdingsFile: String(s.holdingsFile),
    }));
}

function inferSchemes(): PortfolioSchemeConfig[] {
  if (!existsSync(PORTFOLIO_DIR)) return [];
  try {
    const order = DEFAULT_SCHEMES.map((s) => s.holdingsFile);
    const files = readdirSync(PORTFOLIO_DIR)
      .filter((f) => /^holdings.*\.json$/.test(f))
      .sort((a, b) => {
        const ai = order.indexOf(a), bi = order.indexOf(b);
        return ai >= 0 && bi >= 0 ? ai - bi : ai < 0 ? 1 : bi < 0 ? -1 : a.localeCompare(b);
      });
    return files.map((f, i) => ({
      key: String.fromCharCode(65 + i),
      variant: f === "holdings.json" ? "v1" : f.replace(/^holdings_/, "").replace(/\.json$/, "").replace(/_/g, "-"),
      label: String.fromCharCode(65 + i),
      holdingsFile: f,
    }));
  } catch { return []; }
}

function ensureActive(schemes: PortfolioSchemeConfig[], activeVariant: string): PortfolioSchemeConfig[] {
  if (schemes.some((s) => s.variant === activeVariant)) return schemes;
  const found = DEFAULT_SCHEMES.find((s) => s.variant === activeVariant);
  return [...schemes, {
    key: activeVariant, variant: activeVariant, label: activeVariant,
    holdingsFile: found?.holdingsFile || `holdings_${activeVariant.replace(/-/g, "_")}.json`,
  }];
}

export function holdingsFileForVariant(variant: string): string {
  const schemes = readPortfolioSchemes(variant);
  const found = schemes.find((s) => s.variant === variant);
  return found?.holdingsFile || DEFAULT_SCHEMES[0].holdingsFile;
}
