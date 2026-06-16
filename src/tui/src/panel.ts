import type * as readline from "node:readline";
import { Buffer, strWidth, truncate } from "./buffer.ts";
import { S, GOLD, GOLD_HIGHLIGHT } from "./styles.ts";
import { COMMAND_CATALOG } from "../../cli/catalog.ts";
import { loadSettings, saveSettings } from "../../storage/index.ts";
import { listStoredSessions, type StoredSessionSummary } from "../../storage/sessions.ts";
import { listLocalPortfolios, type LocalPortfolioSummary } from "../../storage/local-portfolios.ts";
import type { AShareSource, GlobalSource, OhQuantSettings } from "../../types/config.ts";

export type PanelResult = { command?: string; close?: boolean; refreshPanel?: boolean };
type PanelMode = "config" | "resume" | "portfolio" | "help";

export interface CurrentSessionMeta {
  id: string;
  createdAt: string;
  usage: { tokens: number; contextWindow: number; percent: number | null } | null;
  entryCount: { messages: number; compactions: number; branches: number };
}
type ResumeFilter = "cwd" | "all";
type ResumeSort = "updated" | "created";
type PortfolioFilter = "current" | "all";
type PortfolioSort = "updated" | "name";
type PanelFrame = {
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
  inner: { x: number; y: number; w: number; h: number };
  contentY: number;
  contentH: number;
  footerY: number;
};

type Field = {
  label: string;
  get: () => string;
  set?: (v: string) => void;
  apply?: (v: string) => string;
  secret?: boolean;
  options?: string[];
  optionsFn?: () => string[];
  pickRemove?: boolean;
  onEnter?: () => string;
  action?: string;
  prompt?: string;
};

type Row = { section: string } | { field: Field; index: number };
type PortfolioAssessment = {
  strategy: string;
  styleTag: string;
  riskTag: string;
};

const MODEL_SHORT_NAMES = ["sonnet", "opus", "haiku"];

function resolveModelId(shortName: string): string {
  const envKey = `WHYJ_DEFAULT_${shortName.toUpperCase()}_MODEL`;
  const fromEnv = process.env[envKey];
  if (fromEnv) return fromEnv;
  switch (shortName) {
    case "sonnet": return "deepseek-v4-pro";
    case "opus": return "deepseek-v4-pro";
    case "haiku": return "deepseek-v4-flash";
    default: return shortName;
  }
}

function buildModelOptions(): string[] {
  return MODEL_SHORT_NAMES.map((name) => resolveModelId(name));
}

function formatRelativeAge(value: string): string {
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMins = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMs / 3600000);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function normalizeSearch(text: string): string {
  return text.trim().toLowerCase();
}

function wrapLine(text: string, width: number): string {
  return truncate(text, Math.max(1, width));
}

function currentPortfolioOption(fileName: string, name: string): string {
  return `${name} · ${fileName}`;
}

function containsCashHolding(portfolio: LocalPortfolioSummary): boolean {
  return portfolio.holdings.some((fund) => fund.code === "_CASH_" || /现金|货币|cash/i.test(fund.name));
}

function detectTheme(portfolio: LocalPortfolioSummary): string {
  const haystack = `${portfolio.name} ${portfolio.focusSectors.join(" ")} ${portfolio.holdings.map((fund) => fund.name).join(" ")}`;
  if (/半导体|芯片/i.test(haystack)) return "Semiconductor focus";
  if (/科创50|创业板|成长|AI|机器人|CPO/i.test(haystack)) return "Growth and innovation";
  if (/指数|宽基|沪深300|中证500|中证1000|中证A500|上证50|创业板指|科创50/i.test(haystack)) return "Broad index allocation";
  return portfolio.count <= 4 ? "High-conviction selection" : "Thematic allocation";
}

function assessPortfolio(portfolio: LocalPortfolioSummary): PortfolioAssessment {
  const theme = detectTheme(portfolio);
  const sectors = portfolio.focusSectors;
  const sectorCount = sectors.length;
  const hasCash = containsCashHolding(portfolio);
  return {
    strategy: theme,
    styleTag: theme.replace(" and ", " & ").replace(" allocation", "").replace(" selection", ""),
    riskTag: sectorCount <= 1 && !hasCash ? "High" : sectorCount <= 2 ? "Medium" : "Balanced",
  };
}

const THINKING_OPTIONS = ["off", "minimal", "low", "medium", "high", "xhigh"];
const ENABLE_OPTIONS = ["on", "off"];
const A_SHARE_SOURCE_OPTIONS: AShareSource[] = ["akshare", "tushare"];
const GLOBAL_SOURCE_OPTIONS: GlobalSource[] = ["llmquant-data", "financial-datasets"];
const PANEL_W = 96;
const PANEL_H = 22;
const PANEL_HEADER_INFO_H = 3;
const PANEL_FOOTER_H = 2;

export class PanelController {
  private mode: PanelMode = "config";
  private cfg: OhQuantSettings | null = null;
  private recentSessions: StoredSessionSummary[] = [];
  private localPortfolios: LocalPortfolioSummary[] = [];
  private resumeQuery = "";
  private resumeFilter: ResumeFilter = "cwd";
  private resumeSort: ResumeSort = "updated";
  private resumeSelection = 0;
  private portfolioQuery = "";
  private portfolioFilter: PortfolioFilter = "all";
  private portfolioSort: PortfolioSort = "updated";
  private portfolioSelection = 0;
  private cursor = 0;
  private draft: string | null = null;
  private status = "";
  private currentSessionMeta: CurrentSessionMeta | null = null;
  private helpSelection = 0;

  open(mode: PanelMode = "config"): void {
    this.mode = mode;
    this.cfg = loadSettings();
    this.cursor = 0;
    this.draft = null;
    this.status = "";
    this.resumeQuery = "";
    this.resumeFilter = "cwd";
    this.resumeSort = "updated";
    this.resumeSelection = 0;
    this.portfolioQuery = "";
    this.portfolioFilter = "all";
    this.portfolioSort = "updated";
    this.portfolioSelection = 0;
    this.helpSelection = 0;
    this.refreshResumeSessions();
    this.refreshLocalPortfolios();
  }

  setCurrentSessionMeta(meta: CurrentSessionMeta): void {
    this.currentSessionMeta = meta;
  }

  isOpen(): boolean { return this.cfg !== null; }

  close(): void {
    this.cfg = null;
    this.draft = null;
    this.status = "";
    this.mode = "config";
  }

  handleKey(input: string, key: readline.Key): PanelResult | null {
    if (!this.cfg) return null;
    if (this.mode === "resume") return this.handleResumeKey(input, key);
    if (this.mode === "portfolio") return this.handlePortfolioKey(input, key);
    if (this.mode === "help") {
      if (key.name === "escape") return { close: true };
      const total = COMMAND_CATALOG.length;
      if (key.name === "up") { this.helpSelection = (this.helpSelection - 1 + total) % total; return {}; }
      if (key.name === "down") { this.helpSelection = (this.helpSelection + 1) % total; return {}; }
      if (key.name === "return") {
        const cmd = COMMAND_CATALOG[this.helpSelection];
        if (cmd) return { command: cmd.name, close: true };
      }
      return {};
    }

    const fields = this.fields();
    const field = fields[this.cursor];

    if (this.draft !== null) {
      return this.handleDraft(input, key, field);
    }

    if (key.name === "escape") return { close: true };
    if (key.name === "up" || key.name === "down") {
      const delta = key.name === "up" ? -1 : 1;
      this.cursor = (this.cursor + delta + fields.length) % fields.length;
      return {};
    }
    if (key.name !== "return" || !field) return {};

    if (field.onEnter) {
      this.status = field.onEnter();
      return this.status.startsWith("Imported") ? { refreshPanel: true } : {};
    }
    if (field.action && !field.prompt) return { command: field.action, close: true };
    if (this.fieldOptions(field).length > 0) { this.cycle(field, 1); return {}; }
    if (field.apply || field.set || field.prompt) this.draft = "";
    return {};
  }

  private handleResumeKey(_input: string, key: readline.Key): PanelResult {
    if (key.name === "escape") return { close: true };
    if (key.name === "up") {
      const items = this.filteredResumeSessions();
      if (items.length > 0) this.resumeSelection = (this.resumeSelection - 1 + items.length) % items.length;
      return {};
    }
    if (key.name === "down") {
      const items = this.filteredResumeSessions();
      if (items.length > 0) this.resumeSelection = (this.resumeSelection + 1) % items.length;
      return {};
    }
    if (key.name === "return") {
      const selected = this.filteredResumeSessions()[this.resumeSelection];
      if (!selected) return {};
      this.status = `Resuming ${selected.id}...`;
      return { command: `/resume ${selected.id}`, close: true };
    }
    return {};
  }

  private handlePortfolioKey(_input: string, key: readline.Key): PanelResult {
    if (key.name === "escape") return { close: true };
    if (key.name === "up") {
      const items = this.filteredPortfolioItems();
      if (items.length > 0) this.portfolioSelection = (this.portfolioSelection - 1 + items.length) % items.length;
      return {};
    }
    if (key.name === "down") {
      const items = this.filteredPortfolioItems();
      if (items.length > 0) this.portfolioSelection = (this.portfolioSelection + 1) % items.length;
      return {};
    }
    return {};
  }

  render(buf: Buffer): void {
    if (!this.cfg) return;
    if (this.mode === "resume") {
      this.renderResumePanel(buf);
      return;
    }
    if (this.mode === "portfolio") {
      this.renderPortfolioPanel(buf);
      return;
    }
    if (this.mode === "help") {
      this.renderHelpPanel(buf);
      return;
    }
    const rows = this.rows();
    const fields = this.fields();
    const frame = this.drawPanelFrame(
      buf,
      "Config",
      "↑↓ move  ↵ toggle/edit  esc close",
    );
    const { inner } = frame;

    this.renderConfigHeaderInfo(buf, frame);

    const visible = frame.contentH;
    const selectedRow = rows.findIndex((row) => "field" in row && row.index === this.cursor);
    const start = Math.max(0, Math.min(selectedRow - Math.floor(visible / 2), rows.length - visible));
    let y = frame.contentY;

    for (const row of rows.slice(start, start + visible)) {
      if ("section" in row) {
        buf.text(inner.x, y++, truncate(`-- ${row.section} --`, inner.w), S.dim);
        continue;
      }
      const active = row.index === this.cursor;
      const field = row.field;
      const value = this.valueText(field, active);
      buf.text(inner.x, y, truncate(`${active ? "> " : "  "}${field.label}`, Math.max(10, inner.w - 22)), active ? S.goldB : S.cream);
      buf.textRight(inner.x + inner.w, y++, truncate(value, 20), this.draft !== null && active ? { fg: GOLD_HIGHLIGHT } : field.action ? S.dim : { fg: GOLD });
    }

    const footer = this.status || "↑↓ move  ↵ toggle/edit  esc close";
    buf.text(inner.x, frame.footerY, truncate(footer, inner.w), S.dim);
    if (this.draft !== null && fields[this.cursor]) {
      const hint = fields[this.cursor].apply ? "code or code name" : "";
      const prefix = hint ? `${fields[this.cursor].label} (${hint}): ` : `${fields[this.cursor].label}: `;
      buf.text(inner.x, frame.footerY - 1, truncate(`${prefix}${this.draft}|`, inner.w), { fg: GOLD_HIGHLIGHT });
    }
  }

  private renderResumePanel(buf: Buffer): void {
    const frame = this.drawPanelFrame(
      buf,
      "Resume a previous session",
      "↑↓ move  ↵ resume  esc close",
    );
    const { inner } = frame;

    let y = inner.y;

    // Selected session preview stats
    const sessions = this.filteredResumeSessions();
    const selected = sessions[this.resumeSelection];
    const meta = this.currentSessionMeta;
    const isCurrent = selected && meta && selected.id === meta.id;
    let metaRows = 0;
    if (selected) {
      const label = isCurrent ? "Current" : "Selected";
      buf.text(inner.x, y, truncate(`${label}: ${isCurrent ? meta!.id : selected.id}  ·  ${isCurrent ? meta!.createdAt : selected.createdAt}`, inner.w), S.code);
      y++; metaRows++;
      if (isCurrent && meta!.usage) {
        const u = meta!.usage;
        const pct = u.percent ?? (u.contextWindow > 0 ? (u.tokens / u.contextWindow * 100) : 0);
        const barW = Math.min(30, inner.w - 25);
        const filled = Math.round(barW * pct / 100);
        const bar = "█".repeat(Math.min(filled, barW)) + "░".repeat(Math.max(0, barW - filled));
        buf.text(inner.x, y, `${bar}  ${u.tokens.toLocaleString()}/${u.contextWindow.toLocaleString()} (${pct.toFixed(0)}%)`, pct > 80 ? S.goldB : S.cream);
        y++; metaRows++;
      }
      if (isCurrent && meta!.entryCount) {
        const ec = meta!.entryCount;
        buf.text(inner.x, y, truncate(`Msgs ${ec.messages}  Comps ${ec.compactions}  Branches ${ec.branches}`, inner.w), S.dim);
        y++; metaRows++;
      }
      if (!isCurrent) {
        buf.text(inner.x, y, truncate(selected.preview, inner.w), S.dim);
        y++; metaRows++;
      }
      y++;
      metaRows++;
    }
    const footerText = this.status
      || (sessions.length === 0
        ? "No saved sessions found."
        : `Showing ${sessions.length} session${sessions.length === 1 ? "" : "s"} · enter to resume`);

    if (sessions.length === 0) {
      buf.text(inner.x, frame.contentY, "No saved sessions found.", S.dim);
      buf.text(inner.x, frame.footerY, truncate(footerText, inner.w), S.dim);
      return;
    }

    const listHeight = Math.max(1, frame.contentH - metaRows);
    const start = Math.max(0, Math.min(this.resumeSelection - Math.floor(listHeight / 2), sessions.length - listHeight));
    y = Math.max(frame.contentY, y);
    for (const [offset, session] of sessions.slice(start, start + listHeight).entries()) {
      const index = start + offset;
      const selected = index === this.resumeSelection;
      const age = formatRelativeAge(this.resumeSort === "updated" ? session.updatedAt : session.createdAt).padEnd(10);
      const prefix = selected ? "❯ " : "  ";
      const divider = " ─ ";
      const secondary = this.resumeFilter === "all" ? ` · ${session.cwd}` : "";
      const text = `${prefix}${age}${divider}${session.preview}${secondary}`;
      buf.text(inner.x, y++, truncate(text, inner.w), selected ? S.goldB : S.cream);
    }

    buf.text(inner.x, frame.footerY, truncate(footerText, inner.w), S.dim);
  }

  private renderPortfolioPanel(buf: Buffer): void {
    this.refreshLocalPortfolios();
    const frame = this.drawPanelFrame(
      buf,
      "Local portfolios",
      "↑↓ move  esc close",
    );
    const { inner } = frame;

    let y = inner.y;
    const items = this.filteredPortfolioItems();
    const selected = items[this.portfolioSelection];

    // Selected portfolio preview
    let metaRows = 0;
    if (selected) {
      const a = assessPortfolio(selected);
      buf.text(inner.x, y, truncate(`Active: ${this.currentPortfolioName()}`, inner.w), S.code);
      y++; metaRows++;
      buf.text(inner.x, y, truncate(`${a.styleTag}  Risk: ${a.riskTag}  ·  ${selected.fileName}`, inner.w), S.dim);
      y++; metaRows++;
      y++;
      metaRows++;
    }

    if (items.length === 0) {
      buf.text(inner.x, frame.contentY, "No local portfolios found.", S.dim);
      buf.text(inner.x, frame.footerY, truncate("esc close", inner.w), S.dim);
      return;
    }

    const listHeight = Math.max(1, frame.contentH - metaRows);
    const start = Math.max(0, Math.min(this.portfolioSelection - Math.floor(listHeight / 2), items.length - listHeight));
    y = Math.max(frame.contentY, y);
    for (const [offset, item] of items.slice(start, start + listHeight).entries()) {
      const index = start + offset;
      const sel = index === this.portfolioSelection;
      const age = item.updated ? formatRelativeAge(item.updated) : "-";
      const prefix = sel ? "❯ " : "  ";
      const divider = " ─ ";
      const text = `${prefix}${age.padEnd(10)}${divider}${item.name}`;
      buf.text(inner.x, y++, truncate(text, inner.w), sel ? S.goldB : S.cream);
    }

    const footer = this.status || `Showing ${items.length} portfolio${items.length === 1 ? "" : "s"}`;
    buf.text(inner.x, frame.footerY, truncate(footer, inner.w), S.dim);
  }

  private renderHelpPanel(buf: Buffer): void {
    const frame = this.drawPanelFrame(buf, "Help", "↑↓ select  ↵ run  esc close");
    const { inner } = frame;
    const midX = inner.x + Math.floor(inner.w / 2);
    const leftW = midX - inner.x - 1;
    const rightW = inner.x + inner.w - midX - 1;

    // Left: Commands
    buf.text(inner.x, inner.y, "Commands", S.creamB);
    let y = inner.y + 1;
    const total = COMMAND_CATALOG.length;
    this.helpSelection = Math.min(this.helpSelection, total - 1);
    for (let i = 0; i < total; i++) {
      if (y >= frame.footerY) break;
      const cmd = COMMAND_CATALOG[i];
      const sel = i === this.helpSelection;
      const prefix = sel ? "▶" : " ";
      const nameStyle = sel ? S.goldB : S.goldB;
      const descStyle = sel ? S.creamB : S.cream;
      buf.text(inner.x, y, `${prefix}${truncate(cmd.name, 11)}`, nameStyle);
      buf.text(inner.x + 13, y, truncate(cmd.desc, leftW - 13), descStyle);
      y++;
    }

    // Divider
    for (let r = inner.y; r < frame.footerY; r++) {
      buf.set(midX, r, "│", S.rule);
    }

    // Right: Hotkeys
    buf.text(midX + 1, inner.y, "Hotkeys", S.creamB);
    y = inner.y + 1;
    const keys = [
      ["Ctrl+P", "Open settings"],
      ["Enter", "Submit input"],
      ["Tab", "Accept suggestion"],
      ["Esc", "Clear / close panel"],
      ["Ctrl+C", "Clear input or quit"],
      ["PgUp/Down", "Scroll conversation"],
      ["Shift+PgUp/Down", "Scroll overview"],
      ["Ctrl+Shift+C", "Copy selection"],
      ["↑↓", "Navigate / history"],
      ["1-9", "Quick-select"],
      ["/", "Slash command mode"],
    ];
    for (const [key, desc] of keys) {
      if (y >= frame.footerY) break;
      buf.text(midX + 1, y, truncate(key, 16), S.goldB);
      buf.text(midX + 18, y, truncate(desc, rightW - 18), S.cream);
      y++;
    }
    buf.text(inner.x, frame.footerY, truncate("↑↓ select  ↵ run  esc close", inner.w), S.dim);
  }

  private drawPanelFrame(buf: Buffer, title: string, titleRight: string): PanelFrame {
    const boxW = Math.min(PANEL_W, buf.w - 4);
    const boxH = Math.min(PANEL_H, buf.h - 4);
    const boxX = Math.floor((buf.w - boxW) / 2);
    const boxY = Math.floor((buf.h - boxH) / 2);

    buf.fillRect({ x: boxX - 1, y: boxY - 1, w: boxW + 2, h: boxH + 2 }, { fg: "#000000", dim: true });
    const inner = buf.box({ x: boxX, y: boxY, w: boxW, h: boxH }, {
      title,
      titleStyle: S.creamB,
      titleRight,
      titleRightStyle: S.dim,
      border: S.rule,
    });
    const contentY = inner.y + PANEL_HEADER_INFO_H;
    const footerY = inner.y + inner.h - 1;
    const contentH = Math.max(1, footerY - contentY - (PANEL_FOOTER_H - 1));
    return { boxX, boxY, boxW, boxH, inner, contentY, contentH, footerY };
  }

  private renderConfigHeaderInfo(buf: Buffer, frame: PanelFrame): void {
    if (!this.cfg) return;
    const left = `Model: ${this.cfg.model || "sonnet"}    Thinking: ${this.cfg.thinkingLevel || "high"}`;
    const right = `Insight: ${this.cfg.insightEnabled === false ? "off" : "on"}`;
    buf.text(frame.inner.x, frame.inner.y, truncate(left, frame.inner.w - Math.min(frame.inner.w - 20, strWidth(right) + 2)), S.cream);
    buf.textRight(frame.inner.x + frame.inner.w, frame.inner.y, truncate(right, Math.floor(frame.inner.w * 0.4)), S.dim, frame.inner.x + Math.floor(frame.inner.w * 0.45));
    buf.text(frame.inner.x, frame.inner.y + 1, truncate(`Active portfolio: ${this.currentPortfolioName()}`, frame.inner.w), S.dim);
    buf.text(frame.inner.x, frame.inner.y + 2, truncate("Local settings panel.", frame.inner.w), S.dim);
  }

  private handleDraft(input: string, key: readline.Key, field: Field | undefined): PanelResult {
    if (key.name === "escape") { this.draft = null; return {}; }
    if (key.name === "backspace" || key.name === "delete") { this.draft = this.draft!.slice(0, -1); return {}; }
    if (key.name === "return") {
      const value = this.draft!.trim();
      this.draft = null;
      if (!field || !value) return {};
      if (field.apply) {
        this.status = field.apply(value);
        const ok = this.status.startsWith("Added") || this.status.startsWith("Imported") ||
                   this.status.startsWith("Created") || this.status.startsWith("Renamed") ||
                   this.status.startsWith("Deleted");
        return ok ? { refreshPanel: true } : {};
      }
      if (field.prompt) {
        const command = field.prompt + value;
        this.status = `Running: ${command}`;
        return { command, close: true };
      }
      field.set?.(value);
      saveSettings(this.cfg!);
      return {};
    }
    if (input && !key.ctrl && !key.meta) this.draft += input;
    return {};
  }

  private fieldOptions(field: Field): string[] {
    return field.optionsFn?.() ?? field.options ?? [];
  }

  private rows(): Row[] {
    const groups = this.groups();
    if (groups.length === 1) {
      let index = 0;
      return groups[0]!.fields.map((field) => ({ field, index: index++ }) as Row);
    }
    let index = 0;
    return groups.flatMap((group) => [
      { section: group.label } as Row,
      ...group.fields.map((field) => ({ field, index: index++ }) as Row),
    ]);
  }

  private fields(): Field[] {
    return this.groups().flatMap((group) => group.fields);
  }

  private providerFromModel(model: string): { name: string; envVar: string } {
    const prefix = model.split("/")[0] || "";
    const map: Record<string, { name: string; envVar: string }> = {
      deepseek: { name: "DeepSeek", envVar: "DEEPSEEK_API_KEY" },
      zai: { name: "智谱 Z.AI", envVar: "ZAI_API_KEY" },
      moonshotai: { name: "Moonshot", envVar: "MOONSHOT_API_KEY" },
      minimax: { name: "MiniMax", envVar: "MINIMAX_CN_API_KEY" },
      "minimax-cn": { name: "MiniMax", envVar: "MINIMAX_CN_API_KEY" },
    };
    return map[prefix] || { name: prefix, envVar: `${prefix.toUpperCase()}_API_KEY` };
  }

  private providerKeyLabel(): string {
    const p = this.providerFromModel(this.cfg?.model || "");
    const env = (this.cfg?.env || {}) as Record<string, string | undefined>;
    return env[p.envVar] ? "✓ configured" : "○ enter key";
  }

  private dataSourceEnvVar(source: AShareSource | GlobalSource): string | null {
    switch (source) {
      case "tushare":
        return "TUSHARE_TOKEN";
      case "llmquant-data":
        return "LLMQUANT_API_KEY";
      case "financial-datasets":
        return "FINANCIAL_DATASETS_KEY";
      default:
        return null;
    }
  }

  private dataSourceKeyLabel(source: AShareSource | GlobalSource): string {
    const envVar = this.dataSourceEnvVar(source);
    if (!envVar) return "○ no key needed";
    const env = (this.cfg?.env || {}) as Record<string, string | undefined>;
    return env[envVar] ? "✓ configured" : "○ enter key";
  }

  private currentAShareSource(): AShareSource {
    return this.cfg?.preferences.aShareSource || "akshare";
  }

  private currentGlobalSource(): GlobalSource {
    return this.cfg?.preferences.globalSource || "llmquant-data";
  }

  private currentPortfolioLabel(): string {
    const fileName = this.cfg?.preferences.currentPortfolioFile || "holdings.json";
    const match = this.localPortfolios.find((item) => item.fileName === fileName);
    return match ? currentPortfolioOption(match.fileName, match.name) : fileName;
  }

  private currentPortfolioOptions(): string[] {
    if (this.localPortfolios.length === 0) return [this.currentPortfolioLabel()];
    return this.localPortfolios.map((item) => currentPortfolioOption(item.fileName, item.name));
  }

  private currentPortfolioName(): string {
    const fileName = this.cfg?.preferences.currentPortfolioFile || "holdings.json";
    const match = this.localPortfolios.find((item) => item.fileName === fileName);
    return match?.name || fileName;
  }

  private setCurrentPortfolio(value: string): void {
    if (!this.cfg) return;
    const fileName = value.split(" · ")[1] || value;
    this.cfg.preferences.currentPortfolioFile = fileName;
  }

  private saveProviderKey(raw: string): string {
    const p = this.providerFromModel(this.cfg?.model || "");
    const key = raw.trim();
    if (!key) return "Enter an API key.";
    if (!this.cfg) return "Config not loaded.";
    this.cfg.env = { ...(this.cfg.env || {}), [p.envVar]: key };
    saveSettings(this.cfg);
    return `Saved ${p.envVar}.`;
  }

  private saveDataSourceKey(source: AShareSource | GlobalSource, raw: string): string {
    const envVar = this.dataSourceEnvVar(source);
    if (!envVar) return `${source} does not require a key.`;
    const key = raw.trim();
    if (!key) return `Enter ${envVar}.`;
    if (!this.cfg) return "Config not loaded.";
    this.cfg.env = { ...(this.cfg.env || {}), [envVar]: key };
    saveSettings(this.cfg);
    return `Saved ${envVar}.`;
  }

  private groups(): Array<{ label: string; fields: Field[] }> {
    if (!this.cfg) return [];
    return [
      {
        label: "Basic",
        fields: [
          { label: "Model", get: () => this.cfg?.model || "sonnet", set: (v) => { if (this.cfg) this.cfg.model = v; }, optionsFn: buildModelOptions },
          { label: "Thinking", get: () => this.cfg?.thinkingLevel || "high", set: (v) => { if (this.cfg) this.cfg.thinkingLevel = v; }, options: THINKING_OPTIONS },
          {
            label: "Set active portfolio",
            get: () => this.currentPortfolioLabel(),
            set: (v) => this.setCurrentPortfolio(v),
            optionsFn: () => this.currentPortfolioOptions(),
          },
          {
            label: "API Key",
            get: () => this.providerKeyLabel(),
            apply: (v) => this.saveProviderKey(v),
          },
          {
            label: "A Source",
            get: () => this.currentAShareSource(),
            set: (v) => { if (this.cfg) this.cfg.preferences.aShareSource = v as AShareSource; },
            options: [...A_SHARE_SOURCE_OPTIONS],
          },
          {
            label: "A Key",
            get: () => this.dataSourceKeyLabel(this.currentAShareSource()),
            apply: (v) => this.saveDataSourceKey(this.currentAShareSource(), v),
          },
          {
            label: "US/HK Source",
            get: () => this.currentGlobalSource(),
            set: (v) => { if (this.cfg) this.cfg.preferences.globalSource = v as GlobalSource; },
            options: [...GLOBAL_SOURCE_OPTIONS],
          },
          {
            label: "US/HK Key",
            get: () => this.dataSourceKeyLabel(this.currentGlobalSource()),
            apply: (v) => this.saveDataSourceKey(this.currentGlobalSource(), v),
          },
          { label: "Insight", get: () => this.cfg?.insightEnabled === false ? "off" : "on", set: (v) => { if (this.cfg) this.cfg.insightEnabled = v !== "off"; }, options: ENABLE_OPTIONS },
        ],
      },
    ];
  }

  private valueText(field: Field, active: boolean): string {
    if (this.draft !== null && active) return `[${this.draft}|]`;
    return `[${field.action ? ">" : ""}${field.pickRemove ? "▼ " : ""}${field.get()}]`;
  }

  private cycle(field: Field, direction: 1 | -1): void {
    if (!this.cfg || !field.set) return;
    const opts = this.fieldOptions(field);
    if (opts.length === 0) return;
    const idx = opts.indexOf(field.get());
    field.set(opts[(idx + direction + opts.length) % opts.length]);
    saveSettings(this.cfg);
  }

  private refreshResumeSessions(): void {
    this.recentSessions = listStoredSessions({
      cwd: process.cwd(),
      limit: 200,
      scope: this.resumeFilter,
      sort: this.resumeSort,
    });
    this.clampResumeSelection();
  }

  private filteredResumeSessions(): StoredSessionSummary[] {
    const query = normalizeSearch(this.resumeQuery);
    if (!query) return this.recentSessions;
    return this.recentSessions.filter((session) => {
      const haystack = normalizeSearch([session.preview, session.sessionName, session.id, session.cwd].filter(Boolean).join(" "));
      return haystack.includes(query);
    });
  }

  private clampResumeSelection(): void {
    const items = this.filteredResumeSessions();
    this.resumeSelection = Math.max(0, Math.min(this.resumeSelection, items.length - 1));
  }

  private filteredPortfolioItems(): LocalPortfolioSummary[] {
    const query = normalizeSearch(this.portfolioQuery);
    const currentFile = this.cfg?.preferences.currentPortfolioFile || "holdings.json";
    const scopedItems = this.portfolioFilter === "current"
      ? this.localPortfolios.filter((item) => item.fileName === currentFile)
      : this.localPortfolios;
    const items = [...scopedItems];
    return query
      ? items.filter((item) => normalizeSearch(`${item.name} ${item.fileName} ${item.focusSectors.join(" ")} ${item.holdings.map((fund) => `${fund.code} ${fund.name}`).join(" ")}`).includes(query))
      : items;
  }

  private clampPortfolioSelection(): void {
    const items = this.filteredPortfolioItems();
    this.portfolioSelection = Math.max(0, Math.min(this.portfolioSelection, items.length - 1));
  }

  private refreshLocalPortfolios(): void {
    const portfolios = listLocalPortfolios();
    this.localPortfolios = portfolios.sort((a, b) => {
      if (this.portfolioSort === "name") return a.name.localeCompare(b.name, "zh-CN");
      return new Date(b.updated || 0).getTime() - new Date(a.updated || 0).getTime();
    });
    this.clampPortfolioSelection();
  }
}
