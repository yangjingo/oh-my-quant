import type * as readline from "node:readline";
import { Buffer } from "./buffer.ts";
import { S } from "./styles.ts";
import { drawPanelFrame, renderConfigHeaderInfo, type PanelFrame } from "./panel-chrome.ts";
import { renderConfigPanelView, renderHelpPanelView, renderPortfolioPanelView, renderResumePanelView, type ConfigRowView } from "./panel-views.ts";
import { buildConfigRowViews, buildHelpPanelData, buildPortfolioPanelData, buildResumePanelData } from "./panel-models.ts";
import { COMMAND_CATALOG } from "../../cli/catalog.ts";
import { loadSettings, saveSettings } from "../../storage/index.ts";
import { listStoredSessions, type StoredSessionSummary } from "../../storage/sessions.ts";
import { listLocalPortfolios, type LocalPortfolioSummary } from "../../storage/local-portfolios.ts";
import { syncPanelPortfolioFromLocalPortfolio } from "../../storage/portfolio.ts";
import type { DataSource, OhQuantSettings } from "../../types/config.ts";

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

function currentPortfolioOption(fileName: string, name: string): string {
  return `${name} · ${fileName}`;
}

const THINKING_OPTIONS = ["off", "minimal", "low", "medium", "high", "xhigh"];
const ENABLE_OPTIONS = ["on", "off"];
const SOURCE_OPTIONS: DataSource[] = ["akshare", "tushare", "llmquant-data", "financial-datasets"];

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
      if (selected.format === "markdown") {
        this.status = "Unsupported legacy session archive. Resume uses JSONL sessions only.";
        return {};
      }
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
    if (key.name === "return") {
      const selected = this.filteredPortfolioItems()[this.portfolioSelection];
      if (!selected || !this.cfg) return {};
      this.cfg.preferences.currentPortfolioFile = selected.fileName;
      saveSettings(this.cfg);
      syncPanelPortfolioFromLocalPortfolio(selected.fileName);
      return { close: true, refreshPanel: true };
    }
    return {};
  }

  activePortfolioName(): string {
    return this.currentPortfolioName();
  }

  showPortfolioPanel(): boolean {
    return this.cfg?.showPortfolioPanel !== false;
  }

  /** Name of the currently highlighted item in the panel list. */
  selectedPortfolioName(): string {
    const items = this.filteredPortfolioItems();
    return items[this.portfolioSelection]?.name || this.currentPortfolioName();
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
    const footer = this.status || "↑↓ move  ↵ toggle/edit  esc close";
    const rowViews: ConfigRowView[] = buildConfigRowViews(rows, this.cursor, this.draft, (field, active) => this.valueText(field as Field, active));
    const draftLine = this.draft !== null && fields[this.cursor]
      ? `${fields[this.cursor].label}${fields[this.cursor].apply ? " (code or code name)" : ""}: ${this.draft}|`
      : undefined;
    renderConfigPanelView(buf, frame, rowViews, footer, draftLine);
  }

  private renderResumePanel(buf: Buffer): void {
    const frame = this.drawPanelFrame(
      buf,
      "Resume a previous session",
      "↑↓ move  ↵ resume  esc close",
    );
    const sessions = this.filteredResumeSessions();
    renderResumePanelView(buf, frame, buildResumePanelData({
      sessions,
      selection: this.resumeSelection,
      currentSessionMeta: this.currentSessionMeta,
      resumeFilter: this.resumeFilter,
      resumeSort: this.resumeSort,
      status: this.status,
      innerWidth: frame.inner.w,
      formatRelativeAge,
    }));
  }

  private renderPortfolioPanel(buf: Buffer): void {
    this.refreshLocalPortfolios();
    const frame = this.drawPanelFrame(
      buf,
      "Local portfolios",
      "↑↓ move  esc close",
    );
    const items = this.filteredPortfolioItems();
    const activeFile = this.cfg?.preferences.currentPortfolioFile || "holdings.json";
    renderPortfolioPanelView(buf, frame, buildPortfolioPanelData({
      items,
      selection: this.portfolioSelection,
      activeFile,
      status: this.status,
      formatRelativeAge,
    }));
  }

  private renderHelpPanel(buf: Buffer): void {
    const frame = this.drawPanelFrame(buf, "Help", "↑↓ select  ↵ run  esc close");
    const total = COMMAND_CATALOG.length;
    this.helpSelection = Math.min(this.helpSelection, total - 1);
    renderHelpPanelView(buf, frame, buildHelpPanelData(this.helpSelection));
  }

  private drawPanelFrame(buf: Buffer, title: string, titleRight: string): PanelFrame {
    return drawPanelFrame(buf, title, titleRight);
  }

  private renderConfigHeaderInfo(buf: Buffer, frame: PanelFrame): void {
    if (!this.cfg) return;
    renderConfigHeaderInfo(buf, frame, {
      model: this.cfg.model || "sonnet",
      thinking: this.cfg.thinkingLevel || "high",
      panel: this.cfg.showPortfolioPanel === false ? "off" : "on",
      activePortfolio: this.currentPortfolioName(),
    });
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

  private dataSourceEnvVar(source: DataSource): string | null {
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

  private dataSourceKeyLabel(source: DataSource): string {
    const envVar = this.dataSourceEnvVar(source);
    if (!envVar) return "○ no key needed";
    const env = (this.cfg?.env || {}) as Record<string, string | undefined>;
    return env[envVar] ? "✓ configured" : "○ enter key";
  }

  private currentSource(): DataSource {
    return this.cfg?.preferences.source || "llmquant-data";
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
    syncPanelPortfolioFromLocalPortfolio(fileName);
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

  private saveDataSourceKey(source: DataSource, raw: string): string {
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
            label: "Portfolio",
            get: () => this.currentPortfolioLabel(),
            set: (v) => this.setCurrentPortfolio(v),
            optionsFn: () => this.currentPortfolioOptions(),
          },
          {
            label: "Key",
            get: () => this.providerKeyLabel(),
            apply: (v) => this.saveProviderKey(v),
          },
          {
            label: "Source",
            get: () => this.currentSource(),
            set: (v) => { if (this.cfg) this.cfg.preferences.source = v as DataSource; },
            options: [...SOURCE_OPTIONS],
          },
          {
            label: "Token",
            get: () => this.dataSourceKeyLabel(this.currentSource()),
            apply: (v) => this.saveDataSourceKey(this.currentSource(), v),
          },
          { label: "Panel", get: () => this.cfg?.showPortfolioPanel === false ? "off" : "on", set: (v) => { if (this.cfg) this.cfg.showPortfolioPanel = v !== "off"; }, options: ENABLE_OPTIONS },
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
