import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface LocalSettings {
  model?: string;
  preferences?: {
    portfolioVariant?: string;
  };
}

interface PortfolioConfig {
  schemes?: Array<{
    key?: string;
    variant?: string;
    label?: string;
    holdingsFile?: string;
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

export interface LocalUiState {
  model: string;
  portfolioVariant: string;
  portfolioSchemes: LocalPortfolioScheme[];
}

const OHQUANT_DIR = join(process.cwd(), ".ohquant");
const PORTFOLIO_DIR = join(OHQUANT_DIR, "portfolio");
const SETTINGS_PATH = join(OHQUANT_DIR, "settings.json");
const PORTFOLIO_CONFIG_PATH = join(PORTFOLIO_DIR, "config.json");

const DEFAULT_PORTFOLIO_SCHEMES: PortfolioSchemeConfig[] = [
  { key: "A", variant: "v1", label: "A", holdingsFile: "holdings.json" },
  { key: "B", variant: "v2-semicon", label: "B", holdingsFile: "holdings_v2_semicon.json" },
  { key: "C", variant: "v2-kc50", label: "C", holdingsFile: "holdings_v2_kc50.json" },
];

export function readLocalUiState(): LocalUiState {
  const settings = readJson<LocalSettings>(SETTINGS_PATH);
  const portfolioVariant = readLocalPortfolioVariant(settings);

  return {
    model: settings?.model || "model unset",
    portfolioVariant,
    portfolioSchemes: readLocalPortfolioSchemes(portfolioVariant),
  };
}

export function readLocalPortfolioVariant(settings = readJson<LocalSettings>(SETTINGS_PATH)): string {
  return settings?.preferences?.portfolioVariant || "v1";
}

export function readLocalPortfolioSchemes(activeVariant = readLocalPortfolioVariant()): LocalPortfolioScheme[] {
  const config = readJson<PortfolioConfig>(PORTFOLIO_CONFIG_PATH);
  const configured = normalizeConfiguredSchemes(config);
  const localSchemes = configured.length > 0 ? configured : inferSchemesFromHoldingsFiles();
  const schemes = localSchemes.length > 0 ? localSchemes : DEFAULT_PORTFOLIO_SCHEMES;
  const withActive = ensureActiveScheme(schemes, activeVariant);

  return withActive.map((scheme) => {
    const hp = join(PORTFOLIO_DIR, scheme.holdingsFile);
    const available = existsSync(hp);
    let name = scheme.variant;
    if (available) {
      try {
        const data = JSON.parse(readFileSync(hp, "utf-8"));
        if (data.name) name = data.name;
      } catch { /* keep variant as name */ }
    }
    return { ...scheme, name, available };
  });
}

export function holdingsFileForVariant(variant: string): string {
  const found = readLocalPortfolioSchemes(variant).find((scheme) => scheme.variant === variant);
  return found?.holdingsFile || DEFAULT_PORTFOLIO_SCHEMES[0].holdingsFile;
}

function normalizeConfiguredSchemes(config: PortfolioConfig | null): PortfolioSchemeConfig[] {
  if (!Array.isArray(config?.schemes)) return [];

  return config.schemes
    .filter((scheme) => scheme.key && scheme.variant && scheme.holdingsFile)
    .map((scheme) => ({
      key: String(scheme.key),
      variant: String(scheme.variant),
      label: String(scheme.label || scheme.key),
      holdingsFile: String(scheme.holdingsFile),
    }));
}

function inferSchemesFromHoldingsFiles(): PortfolioSchemeConfig[] {
  if (!existsSync(PORTFOLIO_DIR)) return [];

  try {
    const files = readdirSync(PORTFOLIO_DIR)
      .filter((file) => /^holdings.*\.json$/.test(file))
      .sort(sortHoldingsFiles);

    return files.map((file, index) => ({
      key: String.fromCharCode(65 + index),
      variant: variantFromHoldingsFile(file),
      label: String.fromCharCode(65 + index),
      holdingsFile: file,
    }));
  } catch {
    return [];
  }
}

function ensureActiveScheme(
  schemes: PortfolioSchemeConfig[],
  activeVariant: string,
): PortfolioSchemeConfig[] {
  if (schemes.some((scheme) => scheme.variant === activeVariant)) return schemes;
  return [
    ...schemes,
    {
      key: activeVariant,
      variant: activeVariant,
      label: activeVariant,
      holdingsFile: holdingsFileNameFromVariant(activeVariant),
    },
  ];
}

function sortHoldingsFiles(a: string, b: string): number {
  const order = DEFAULT_PORTFOLIO_SCHEMES.map((scheme) => scheme.holdingsFile);
  const ai = order.indexOf(a);
  const bi = order.indexOf(b);
  if (ai >= 0 || bi >= 0) {
    if (ai < 0) return 1;
    if (bi < 0) return -1;
    return ai - bi;
  }
  return a.localeCompare(b);
}

function variantFromHoldingsFile(file: string): string {
  if (file === "holdings.json") return "v1";
  return file.replace(/^holdings_/, "").replace(/\.json$/, "").replace(/_/g, "-");
}

function holdingsFileNameFromVariant(variant: string): string {
  const found = DEFAULT_PORTFOLIO_SCHEMES.find((scheme) => scheme.variant === variant);
  return found?.holdingsFile || `holdings_${variant.replace(/-/g, "_")}.json`;
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}
