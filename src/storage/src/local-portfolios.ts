import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OHQUANT_DIR } from "./dirs.ts";
import { loadSettings } from "./settings.ts";
import type { FundHolding } from "../../types/data.ts";

export interface LocalPortfolioSummary {
  fileName: string;
  filePath: string;
  name: string;
  updated: string;
  count: number;
  focusSectors: string[];
  strategy: string;
  riskTag: string;
  holdings: FundHolding[];
}

type RawHolding = FundHolding & Record<string, unknown>;

function portfolioDir(): string {
  return join(process.env.OHQUANT_DIR || OHQUANT_DIR, "portfolio");
}

export function listLocalPortfolios(): LocalPortfolioSummary[] {
  const dir = portfolioDir();
  if (!existsSync(dir)) return [];
  const portfolios = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^holdings.*\.json$/i.test(entry.name))
    .map((entry) => {
      const filePath = join(dir, entry.name);
      try {
        const raw = JSON.parse(readFileSync(filePath, "utf-8")) as {
          name?: string;
          updated?: string;
          funds?: RawHolding[];
          stocks?: RawHolding[];
          focusSectors?: string[];
        };
        const rawHoldings = Array.isArray(raw.funds) ? raw.funds
          : Array.isArray(raw.stocks) ? raw.stocks
          : [];
        const holdings: FundHolding[] = rawHoldings.map((holding) => ({
          code: holding.code,
          name: holding.name,
          type: holding.type,
          manager: holding.manager,
          company: holding.company,
          addedDate: holding.addedDate,
          note: holding.note,
          lockedUntil: holding.lockedUntil,
        }));
        const focusSectors = deriveFocusSectors(raw.name || entry.name, raw.focusSectors, rawHoldings);
        const assessment = summarizePortfolio(raw.name || entry.name, rawHoldings, focusSectors);
        return {
          fileName: entry.name,
          filePath,
          name: raw.name?.trim() || entry.name.replace(/\.json$/i, ""),
          updated: raw.updated || "",
          count: holdings.length,
          focusSectors,
          strategy: assessment.strategy,
          riskTag: assessment.riskTag,
          holdings,
        } satisfies LocalPortfolioSummary;
      } catch {
        return null;
      }
    })
    .filter((item): item is LocalPortfolioSummary => item !== null)
    .sort((a, b) => new Date(b.updated || 0).getTime() - new Date(a.updated || 0).getTime());
  return dedupePortfolios(portfolios, loadSettings().preferences.currentPortfolioFile || "");
}

function dedupePortfolios(portfolios: LocalPortfolioSummary[], currentFileName: string): LocalPortfolioSummary[] {
  const byFingerprint = new Map<string, LocalPortfolioSummary>();
  for (const portfolio of portfolios) {
    const key = portfolioFingerprint(portfolio);
    const existing = byFingerprint.get(key);
    if (!existing || comparePortfolioRepresentative(portfolio, existing, currentFileName) < 0) {
      byFingerprint.set(key, portfolio);
    }
  }
  return [...byFingerprint.values()]
    .sort((a, b) => new Date(b.updated || 0).getTime() - new Date(a.updated || 0).getTime());
}

function portfolioFingerprint(portfolio: LocalPortfolioSummary): string {
  const holdings = portfolio.holdings
    .map((holding) => `${holding.code}:${holding.name}`)
    .sort()
    .join("|");
  const sectors = [...portfolio.focusSectors].sort().join("|");
  return [
    portfolio.name.trim(),
    portfolio.updated,
    holdings,
    sectors,
  ].join("\n");
}

function comparePortfolioRepresentative(
  left: LocalPortfolioSummary,
  right: LocalPortfolioSummary,
  currentFileName: string,
): number {
  const leftIsCurrent = left.fileName === currentFileName;
  const rightIsCurrent = right.fileName === currentFileName;
  if (leftIsCurrent !== rightIsCurrent) return leftIsCurrent ? -1 : 1;
  if (left.fileName.length !== right.fileName.length) return left.fileName.length - right.fileName.length;
  return left.fileName.localeCompare(right.fileName);
}

function deriveFocusSectors(name: string, rawFocusSectors: unknown, holdings: RawHolding[]): string[] {
  const ranked = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let order = 0;
  const add = (value: unknown, weight = 1) => {
    if (typeof value !== "string") return;
    for (const item of splitSectorText(value)) {
      if (!firstSeen.has(item)) firstSeen.set(item, order++);
      ranked.set(item, (ranked.get(item) || 0) + weight);
    }
  };
  for (const theme of inferThemesFromName(name)) add(theme, 5);
  if (Array.isArray(rawFocusSectors)) {
    for (const sector of rawFocusSectors) add(sector, 4);
  }
  for (const holding of holdings) {
    add(holding.type, 1);
    add(holding.sector, 3);
    add(holding.industry, 3);
    add(holding.theme, 3);
    add(holding.category, 2);
    for (const theme of inferThemesFromName(holding.name)) add(theme, 2);
  }
  return [...ranked.entries()]
    .filter(([sector]) => !isGenericSector(sector))
    .sort((a, b) => b[1] - a[1] || (firstSeen.get(a[0]) ?? 0) - (firstSeen.get(b[0]) ?? 0))
    .map(([sector]) => sector)
    .slice(0, 5);
}

function summarizePortfolio(name: string, holdings: RawHolding[], focusSectors: string[]): { strategy: string; riskTag: string } {
  const themes = focusSectors.filter((sector) => sector !== "现金防御").slice(0, 3);
  const hasCash = holdings.some((fund) => fund.code === "_CASH_" || /现金|货币|cash/i.test(fund.name));
  const strategy = themes.length > 0
    ? `${themes.join(" / ")}`
    : inferThemesFromName(name).slice(0, 3).join(" / ") || "未标注主题";
  const riskTag = hasCash
    ? "含现金防御"
    : themes.length <= 1
      ? "主题集中"
      : themes.length <= 3
        ? "适度分散"
        : "均衡分散";
  return { strategy, riskTag };
}

function splitSectorText(value: string): string[] {
  return value
    .split(/[、,，/|;；\s]+/)
    .map((item) => normalizeTheme(item))
    .filter((item) => item.length > 0);
}

function inferThemesFromName(name: string): string[] {
  const text = name.trim();
  const themes: string[] = [];
  const add = (theme: string, pattern: RegExp) => {
    if (pattern.test(text) && !themes.includes(theme)) themes.push(theme);
  };
  add("半导体", /半导体|芯片|集成电路|电子/i);
  add("AI", /人工智能|\bAI\b|智能|算力|大模型/i);
  add("通信/光模块", /通信|光模块|CPO|光通信|5G/i);
  add("机器人", /机器人|自动化/i);
  add("科创50", /科创50|科创板/i);
  add("创业板", /创业板|创成长/i);
  add("宽基指数", /沪深300|中证500|中证1000|中证A500|上证50|宽基|指数/i);
  add("海外科技", /纳斯达克|标普|全球|海外|QDII|港股|恒生科技/i);
  add("医药", /医药|医疗|生物|创新药/i);
  add("新能源", /新能源|光伏|电池|锂电|储能|电动车/i);
  add("消费", /消费|白酒|食品|家电/i);
  add("金融", /银行|证券|金融|保险/i);
  add("军工", /军工|国防|航天|航空/i);
  add("现金防御", /现金|货币|短债|债券/i);
  return themes;
}

function normalizeTheme(value: string): string {
  const text = value.trim();
  if (!text) return "";
  if (/半导体|芯片|集成电路|电子/i.test(text)) return "半导体";
  if (/人工智能|\bAI\b|智能|算力|大模型/i.test(text)) return "AI";
  if (/通信|光模块|CPO|光通信|5G/i.test(text)) return "通信/光模块";
  if (/纳斯达克|标普|全球|海外|QDII|港股|恒生科技/i.test(text)) return "海外科技";
  if (/沪深300|中证500|中证1000|中证A500|上证50|宽基|指数/i.test(text)) return "宽基指数";
  return text;
}

function isGenericSector(value: string): boolean {
  return /^(基金|股票|混合|指数|index|QDII|ETF|联接|主动|主动管理|被动|灵活|灵活主动|发起式?)$/i.test(value);
}
