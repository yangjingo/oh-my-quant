import { PortfolioPanel } from "./portfolio-panel.ts";
import { ModelSettingsPanel } from "./model-settings-panel.ts";
import type { ModelOAuthOptions } from "../../../src/runtime/models/model-oauth.ts";
import { DataSettingsPanel } from "./data-settings-panel.ts";
import { ToolCapabilitiesPanel } from "./tool-capabilities-panel.ts";
import { ResearchTaskPanel } from "./research-task-panel.ts";
import { HelpPanel } from "./help-panel.ts";
import { PrivateAnnualPanel } from "./private-annual-panel.ts";
import type { PrivateAnnualExportRequest } from "../../../src/types/private-annual-export.ts";
import { DoctorPanel, type DoctorPanelView } from "./doctor-panel.ts";
import type { ResearchTaskSnapshot } from "../../../src/types/research-task.ts";
import { DEFAULT_APP_KEYBINDINGS } from "./model-settings-panel.ts";
import type { DataSettingsOptions } from "../../../src/runtime/data/data-settings.ts";
import { resolveConfiguredModel, configuredThinking, resolveCompactTriggerTokens } from "../../../src/runtime/models/model-settings.ts";
import { activePanelPortfolioName } from "../../../src/runtime/workspace/panel-service.ts";
import { settingsSaveError } from "../../../src/runtime/errors.ts";
import type * as readline from "node:readline";
import { Buffer } from "./buffer.ts";
import { drawPanelFrame, renderConfigHeaderInfo, type PanelFrame } from "./panel-chrome.ts";
import { renderArtifactPanelView, renderConfigPanelView, renderResumePanelView, type ConfigRowView } from "./panel-views.ts";
import { buildArtifactPanelData, buildConfigRowViews, buildResumePanelData } from "./panel-models.ts";
import { describeModelProtocol } from "../../../src/runtime/workspace/doctor-contract.ts";
import type { DoctorResult } from "../../../src/types/doctor.ts";
import { artifactReference, createStoragePanelDataService, type ArtifactMeta, type PanelDataService, type StoredSessionSummary, type WhyjEnvAliasKey } from "../../../src/runtime/workspace/panel-data.ts";
import type { DataSource, OhQuantSettings } from "../../../src/types/config.ts";
import { normalizeMarketColorScheme, type MarketColorScheme } from "../../../src/types/theme-colors.ts";

export type PanelResult = { command?: string; restoreArtifact?: string; privateAnnualExport?: PrivateAnnualExportRequest; close?: boolean; refreshPanel?: boolean };
type PanelMode = "config" | "doctor" | "resume" | "portfolio" | "help" | "artifact" | "research";

import type { CurrentSessionMeta } from "../../../src/types/ui.ts";
type ResumeFilter = "cwd" | "all";
type ResumeSort = "updated" | "created";

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
  refreshPanel?: boolean;
  validate?: (value: string) => string | undefined;
  hint?: string;
};

type Row = { section: string } | { field: Field; index: number };

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

const ENABLE_OPTIONS = ["on", "off"];
const MARKET_COLOR_OPTIONS = ["Red ↑ Green ↓", "Green ↑ Red ↓"];

function cloneSettings(settings: OhQuantSettings): OhQuantSettings {
  return JSON.parse(JSON.stringify(settings)) as OhQuantSettings;
}

export class PanelController {
  private readonly data: PanelDataService;
  private mode: PanelMode = "config";
  private cfg: OhQuantSettings | null = null;
  private recentSessions: StoredSessionSummary[] = [];
  private portfolioPanel: PortfolioPanel | null = null;
  private modelPanel: ModelSettingsPanel | null = null;
  private dataPanel: DataSettingsPanel | null = null;
  private capabilitiesPanel: ToolCapabilitiesPanel | null = null;
  private researchPanel: ResearchTaskPanel | null = null;
  private artifacts: ArtifactMeta[] = [];
  private doctor: DoctorResult | null = null;
  private readonly doctorPanel = new DoctorPanel();
  private doctorEditing = false;
  private resumeQuery = "";
  private resumeFilter: ResumeFilter = "cwd";
  private resumeSort: ResumeSort = "updated";
  private resumeSelection = 0;
  private cursor = 0;
  private draft: string | null = null;
  private status = "";
  private dirty = false;
  private currentSessionMeta: CurrentSessionMeta | null = null;
  private helpPanel: HelpPanel | null = null;
  private privateAnnualPanel: PrivateAnnualPanel | null = null;
  private artifactSelection = 0;

  constructor(data: PanelDataService = createStoragePanelDataService(), private readonly options: DataSettingsOptions & { onDoctorClose?: () => void; onConfigurationChange?: () => void; modelAuth?: Pick<ModelOAuthOptions, "signIn" | "signOut" | "openUrl"> } = {}) {
    this.data = data;
  }

  open(mode: PanelMode = "config"): void {
    this.doctorPanel.reset();
    this.researchPanel = null;
    this.capabilitiesPanel?.dispose();
    this.capabilitiesPanel = null;
    if (this.isDoctorMode()) this.options.onDoctorClose?.();
    this.dataPanel?.dispose();
    this.dataPanel = null;
    this.modelPanel?.dispose();
    this.modelPanel = null;
    this.mode = mode;
    this.cfg = this.data.loadSettings();
    this.doctor = null;
    this.doctorEditing = false;
    this.cursor = 0;
    this.draft = null;
    this.status = "";
    this.resumeQuery = "";
    this.resumeFilter = "cwd";
    this.resumeSort = "updated";
    this.resumeSelection = 0;
    this.helpPanel = mode === "help" ? new HelpPanel() : null;
    this.privateAnnualPanel = null;
    this.artifactSelection = 0;
    this.dirty = false;
    if (mode === "resume") this.refreshResumeSessions();
    if (mode === "portfolio") this.portfolioPanel = new PortfolioPanel(this.data);
    if (mode === "artifact") this.refreshArtifacts();
  }

  setCurrentSessionMeta(meta: CurrentSessionMeta): void {
    this.currentSessionMeta = meta;
  }

  setResearchSnapshot(snapshot: ResearchTaskSnapshot): void { this.researchPanel = new ResearchTaskPanel(snapshot); }

  isOpen(): boolean { return this.cfg !== null; }

  close(): void {
    this.doctorPanel.reset();
    this.helpPanel = null;
    this.privateAnnualPanel = null;
    this.researchPanel = null;
    this.capabilitiesPanel?.dispose();
    this.capabilitiesPanel = null;
    if (this.isDoctorMode()) this.options.onDoctorClose?.();
    this.dataPanel?.dispose();
    this.dataPanel = null;
    this.modelPanel?.dispose();
    this.modelPanel = null;
    this.cfg = null;
    this.draft = null;
    this.status = "";
    this.mode = "config";
    this.doctor = null;
    this.doctorEditing = false;
  }

  isDoctorMode(): boolean {
    return this.cfg !== null && this.mode === "doctor";
  }

  handleKey(input: string, key: readline.Key): PanelResult | null {
    try { return this.handlePanelKey(input, key); }
    catch (error) {
      if (this.mode !== "config" && this.mode !== "doctor") throw error;
      this.status = settingsSaveError(error);
      return {};
    }
  }

  private handlePanelKey(input: string, key: readline.Key): PanelResult | null {
    if (!this.cfg) return null;
    if (this.privateAnnualPanel) return this.privateAnnualPanel.handleKey(input, key);
    if (this.researchPanel) return this.researchPanel.handleKey(input, key);
    if (this.capabilitiesPanel) {
      if (this.capabilitiesPanel.handleKey(input, key).close) this.capabilitiesPanel = null;
      return {};
    }
    if (this.dataPanel) {
      const result = this.dataPanel.handleKey(input, key);
      if (result.saved) {
        try {
          this.data.saveSettings(result.saved);
          this.cfg = result.saved;
          this.status = "Verified data settings saved.";
        } catch (error) { this.dataPanel.setError(settingsSaveError(error)); return {}; }
        this.options.onConfigurationChange?.();
      }
      if (result.close) { this.dataPanel.dispose(); this.dataPanel = null; }
      return result.saved ? { refreshPanel: true } : {};
    }
    if (this.modelPanel) {
      const result = this.modelPanel.handleKey(input, key);
      if (result.saved) {
        try {
          const modelSettings = {
            provider: result.saved.provider, providers: result.saved.providers,
            model: result.saved.model, thinkingLevel: result.saved.thinkingLevel,
          };
          const saved = { ...this.cfg, ...modelSettings, revision: result.saved.revision };
          this.data.saveSettings(saved);
          this.cfg = saved;
          this.status = "Model settings saved. Applies to the next submitted prompt.";
        } catch (error) { this.modelPanel.setError(settingsSaveError(error)); return {}; }
        this.options.onConfigurationChange?.();
      }
      if (result.close) { this.modelPanel.dispose(); this.modelPanel = null; }
      if (result.verify && result.saved) return { command: "/doctor --phase model", close: true };
      return {};
    }
    if (this.mode === "resume") return this.handleResumeKey(input, key);
    if (this.mode === "portfolio") return this.portfolioPanel?.handleKey(input, key) ?? {};
    if (this.mode === "artifact") return this.handleArtifactKey(input, key);
    if (this.mode === "help") return this.helpPanel?.handleKey(input, key) ?? {};
    if (this.mode === "doctor") {
      const result = this.handleDoctorKey(input, key);
      if (result.command) this.doctorPanel.reset();
      return result;
    }

    const fields = this.fields();
    const field = fields[this.cursor];

    if (this.draft !== null) {
      return this.handleDraft(input, key, field);
    }

    if (key.name === "escape") return { close: true, refreshPanel: this.dirty };
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
    if (field.apply || field.set || field.prompt) { this.draft = ""; this.status = field.hint ?? ""; }
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


  private handleArtifactKey(_input: string, key: readline.Key): PanelResult {
    if (_input.toLowerCase() === "p" || key.name === "p") { this.privateAnnualPanel = new PrivateAnnualPanel(); return {}; }
    if (key.name === "escape") return { close: true };
    if (key.name === "up") {
      const items = this.artifacts;
      if (items.length > 0) this.artifactSelection = (this.artifactSelection - 1 + items.length) % items.length;
      return {};
    }
    if (key.name === "down") {
      const items = this.artifacts;
      if (items.length > 0) this.artifactSelection = (this.artifactSelection + 1) % items.length;
      return {};
    }
    if (key.name === "return") {
      const selected = this.artifacts[this.artifactSelection];
      if (!selected) return {};
      this.status = `Restoring ${selected.sessionId}...`;
      return { restoreArtifact: artifactReference(selected), close: true };
    }
    return {};
  }
  activePortfolioName(): string {
    return this.currentPortfolioName();
  }

  activeDataSource(): string {
    return this.currentSource();
  }

  showPortfolioPanel(): boolean {
    return this.cfg?.showPortfolioPanel !== false;
  }

  marketColorScheme(): MarketColorScheme {
    return normalizeMarketColorScheme(this.cfg?.preferences.marketColorScheme);
  }

  /** Name of the currently highlighted item in the panel list. */
  selectedPortfolioName(): string {
    return this.currentPortfolioName();
  }

  render(buf: Buffer): void {
    if (this.privateAnnualPanel) { this.privateAnnualPanel.render(buf); return; }
    if (this.researchPanel) { this.researchPanel.render(buf); return; }
    if (this.capabilitiesPanel) { this.capabilitiesPanel.render(buf); return; }
    if (!this.cfg) return;
    if (this.dataPanel) { this.dataPanel.render(buf); return; }
    if (this.modelPanel) { this.modelPanel.render(buf); return; }
    if (this.mode === "resume") {
      this.renderResumePanel(buf);
      return;
    }
    if (this.mode === "doctor") {
      this.renderDoctorPanel(buf);
      return;
    }
    if (this.mode === "portfolio") {
      this.portfolioPanel?.render(buf);
      return;
    }
    if (this.mode === "help") {
      this.helpPanel?.render(buf);
      return;
    }
    if (this.mode === "artifact") {
      this.renderArtifactPanel(buf);
      return;
    }
    const rows = this.rows();
    const fields = this.fields();
    const frame = this.drawPanelFrame(
      buf,
      "Settings",
      "",
      this.draft !== null ? 4 : 2,
      2,
    );

    this.renderConfigHeaderInfo(buf, frame);
    const footer = this.status;
    const rowViews: ConfigRowView[] = buildConfigRowViews(rows, this.cursor, this.draft, (field, active) => this.valueText(field as Field, active));
    const draftLine = this.draft !== null && fields[this.cursor]
      ? `${fields[this.cursor].label}: ${this.draftDisplay(fields[this.cursor])}|`
      : undefined;
    renderConfigPanelView(buf, frame, rowViews, footer, draftLine, this.draft !== null);
  }

  private renderResumePanel(buf: Buffer): void {
    const frame = this.drawPanelFrame(
      buf,
      "Resume a previous session",
      "",
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

  private renderDoctorPanel(buf: Buffer): void {
    if (this.doctor?.mode === "first_setup" || this.doctorEditing) {
      this.renderDoctorWizard(buf);
      return;
    }
    if (!this.doctor) {
      let model;
      try { model = resolveConfiguredModel(this.cfg!); } catch { /* the diagnostic will report invalid configuration */ }
      this.doctorPanel.render(buf, {
        title: "WhyJ Doctor",
        status: "running",
        mode: "diagnostic",
        model: model?.id ?? this.cfg?.model ?? "Configure model",
        baseUrl: model?.baseUrl ?? "",
        endpointMode: model ? describeModelProtocol(model.api) : "Configure connection",
        dataSource: this.currentSource(),
        settingsPath: "loading...",
        phases: [
          { phase: "model", status: "checking", detail: "Checking model..." },
          { phase: "tools", status: "checking", detail: "Checking tools..." },
          { phase: "data", status: "checking", detail: "Checking data..." },
        ],
        actions: [],
        hints: [],
      });
      return;
    }
    this.doctorPanel.render(buf, this.toDoctorPanelView(this.doctor));
  }

  private renderDoctorWizard(buf: Buffer): void {
    const frame = this.drawPanelFrame(
      buf,
      this.doctor?.mode === "first_setup" ? "Doctor · First Setup" : "Doctor · Configure",
      "",
      this.draft !== null ? 4 : 2,
      2,
    );
    const rows = this.doctorWizardRows();
    const fields = this.doctorWizardFields();
    const footer = this.status;
    const rowViews: ConfigRowView[] = buildConfigRowViews(rows, this.cursor, this.draft, (field, active) => this.valueText(field as Field, active));
    const draftLine = this.draft !== null && fields[this.cursor]
      ? `${fields[this.cursor].label}: ${this.draftDisplay(fields[this.cursor])}|`
      : undefined;
    renderConfigPanelView(buf, frame, rowViews, footer, draftLine, this.draft !== null);
  }

  private renderArtifactPanel(buf: Buffer): void {
    this.refreshArtifacts();
    const frame = this.drawPanelFrame(
      buf,
      "Artifacts",
      "P private annual export",
    );
    renderArtifactPanelView(buf, frame, buildArtifactPanelData({
      items: this.artifacts,
      selection: this.artifactSelection,
      status: this.status,
      formatRelativeAge,
    }));
  }
  private drawPanelFrame(buf: Buffer, title: string, titleRight: string, footerRows?: number, headerRows?: number): PanelFrame {
    return drawPanelFrame(buf, title, titleRight, footerRows, headerRows);
  }

  private renderConfigHeaderInfo(buf: Buffer, frame: PanelFrame): void {
    if (!this.cfg) return;
    let model = this.cfg.model;
    let thinking = this.cfg.thinkingLevel;
    try { model = resolveConfiguredModel(this.cfg).id; thinking = configuredThinking(this.cfg); } catch { /* keep invalid settings editable */ }
    renderConfigHeaderInfo(buf, frame, {
      model,
      thinking,
      overview: this.cfg.showPortfolioPanel === false ? "off" : "on",
      artifactAuto: this.cfg.artifactGeneration.auto ? "on" : "off",
      activePortfolio: this.currentPortfolioName(),
      source: this.currentSource(),
    });
  }

  private handleDraft(input: string, key: readline.Key, field: Field | undefined): PanelResult {
    if (key.name === "escape") { this.draft = null; return {}; }
    if (key.name === "backspace" || key.name === "delete") { this.draft = this.draft!.slice(0, -1); return {}; }
    if (key.name === "return") {
      const value = this.draft!.trim();
      if (!field || !value) { this.draft = null; return {}; }
      const invalid = field.validate?.(value);
      if (invalid) { this.status = invalid; return {}; }
      if (field.apply) {
        this.status = field.apply(value);
        this.draft = null;
        const ok = this.status.startsWith("Added") || this.status.startsWith("Imported") ||
                   this.status.startsWith("Created") || this.status.startsWith("Renamed") ||
                   this.status.startsWith("Deleted");
        return ok ? { refreshPanel: true } : {};
      }
      if (field.prompt) {
        this.draft = null;
        const command = field.prompt + value;
        this.status = `Running: ${command}`;
        return { command, close: true };
      }
      const previous = cloneSettings(this.cfg!);
      field.set?.(value);
      try { this.data.saveSettings(this.cfg!); }
      catch (error) { this.cfg = previous; throw error; }
      this.draft = null;
      this.status = `${field.label} saved.`;
      this.options.onConfigurationChange?.();
      return {};
    }
    if (input && !key.ctrl && !key.meta) this.draft += input;
    return {};
  }

  private handleDoctorKey(input: string, key: readline.Key): PanelResult {
    const chord = `${key.ctrl ? "ctrl+" : ""}${key.meta ? "meta+" : ""}${key.name || input.toLowerCase()}`;
    if (DEFAULT_APP_KEYBINDINGS.capabilities.includes(chord) && this.doctor?.capabilities) {
      this.capabilitiesPanel = new ToolCapabilitiesPanel(this.doctor.capabilities, undefined, { settings: this.cfg!,
        market: this.doctor.config.dataRequest?.market ?? "A", processEnv: this.options.processEnv,
        timeoutMs: this.options.timeoutMs, onChange: this.options.onChange, probe: this.options.toolProbe });
      return {};
    }
    if (this.doctor?.mode !== "first_setup" && !this.doctorEditing) {
      const navigation = this.doctorPanel.handleKey(input, key);
      if (navigation) return navigation;
      if (key.name === "return" || input.toLowerCase() === "r") {
        if (!this.doctor) return {};
        this.status = "Re-running doctor...";
        this.doctor = null;
        return { command: "/doctor" };
      }
      if (input.toLowerCase() === "m") {
        this.status = "Re-running model checks...";
        this.doctor = null;
        return { command: "/doctor --phase model" };
      }
      if (input.toLowerCase() === "t") {
        this.status = "Re-running tools checks...";
        this.doctor = null;
        return { command: "/doctor --phase tools" };
      }
      if (input.toLowerCase() === "d") {
        this.status = "Re-running data checks...";
        this.doctor = null;
        return { command: "/doctor --phase data" };
      }
      if (input.toLowerCase() === "c") {
        this.doctorEditing = true;
        this.options.onDoctorClose?.();
        this.cursor = 0;
        this.draft = null;
        this.status = "Editing doctor settings draft.";
        return {};
      }
      return {};
    }

    const fields = this.doctorWizardFields();
    const field = fields[this.cursor];

    if (key.name === "escape") {
      if (this.doctor?.mode === "first_setup") return { close: true };
      this.doctorEditing = false;
      this.cursor = 0;
      this.status = "";
      return {};
    }
    if (key.name === "up" || key.name === "down") {
      const delta = key.name === "up" ? -1 : 1;
      this.cursor = (this.cursor + delta + fields.length) % fields.length;
      return {};
    }
    if (key.name !== "return" || !field) return {};

    if (field.action) {
      this.doctorEditing = false;
      this.doctor = null;
      return { command: field.action };
    }
    if (field.onEnter) { this.options.onDoctorClose?.(); this.status = field.onEnter(); }
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



  private dataSourceEnvKey(source: DataSource): WhyjEnvAliasKey | null {
    switch (source) {
      case "tushare":
        return "tushareToken";
      case "llmquant-data":
        return "llmquantApiKey";
      case "financial-datasets":
        return "financialDatasetsKey";
      default:
        return null;
    }
  }

  private dataSourceKeyLabel(source: DataSource): string {
    const envKey = this.dataSourceEnvKey(source);
    if (!envKey) return "○ no key needed";
    return this.data.hasWhyjEnvValue(this.cfg?.env || {}, envKey) ? "✓ configured" : "○ enter key";
  }

  private currentSource(): DataSource {
    return this.cfg?.preferences.source || "llmquant-data";
  }

  private currentPortfolioName(): string {
    try { return activePanelPortfolioName(this.data.loadPanelPortfolio(), "No portfolios"); }
    catch { return "Portfolio file unavailable"; }
  }



  private groups(): Array<{ label: string; fields: Field[] }> {
    if (!this.cfg) return [];
    return [
      {
        label: "Agent Runtime",
        fields: [
          {
            label: "Model",
            get: () => {
              try { const model = resolveConfiguredModel(this.cfg!); return `${model.provider} / ${model.id}`; }
              catch { return "Configure connection"; }
            },
            onEnter: () => { this.openModelPanel(); return ""; },
          },
        ],
      },
      {
        label: "Research Data",
        fields: [
          {
            label: "Market Data",
            get: () => this.currentSource(),
            onEnter: () => { this.dataPanel = new DataSettingsPanel(this.cfg!, this.options); return ""; },
          },
          {
            label: "Data Token",
            get: () => this.dataSourceKeyLabel(this.currentSource()),
            onEnter: () => { this.dataPanel = new DataSettingsPanel(this.cfg!, this.options, {}, true); return ""; },
          },
          {
            label: "Portfolios",
            get: () => this.currentPortfolioName(),
            action: "/portfolio",
          },
        ],
      },
      {
        label: "Workspace Experience",
        fields: [
          {
            label: "External Skills",
            refreshPanel: false,
            get: () => this.cfg?.skillIntegrations.external ? "on" : "off",
            set: (v) => { if (this.cfg) this.cfg.skillIntegrations.external = v !== "off"; },
            options: ENABLE_OPTIONS,
          },
          {
            label: "Overview Dock",
            get: () => this.cfg?.showPortfolioPanel === false ? "off" : "on",
            set: (v) => { if (this.cfg) this.cfg.showPortfolioPanel = v !== "off"; },
            options: ENABLE_OPTIONS,
          },
          {
            label: "Auto Artifacts",
            refreshPanel: false,
            get: () => this.cfg?.artifactGeneration.auto ? "on" : "off",
            set: (v) => { if (this.cfg) this.cfg.artifactGeneration.auto = v !== "off"; },
            options: ENABLE_OPTIONS,
          },
          {
            label: "Market Colors",
            refreshPanel: false,
            get: () => MARKET_COLOR_OPTIONS[this.marketColorScheme() === "green-up" ? 1 : 0]!,
            set: (v) => { if (this.cfg) this.cfg.preferences.marketColorScheme = v === MARKET_COLOR_OPTIONS[1] ? "green-up" : "red-up"; },
            options: MARKET_COLOR_OPTIONS,
          },
          {
            label: "Compact At", refreshPanel: false,
            hint: "Enter token count or auto; Esc cancels.",
            get: () => {
              try { return `${resolveCompactTriggerTokens(this.cfg!.env, resolveConfiguredModel(this.cfg!).contextWindow)} tokens`; }
              catch { return "Configure model"; }
            },
            validate: value => {
              if (value === "auto") return undefined;
              const limit = resolveConfiguredModel(this.cfg!).contextWindow;
              return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= limit
                ? undefined : `Use auto or 1..${limit} tokens.`;
            },
            set: value => { if (this.cfg) this.cfg.env.WHYJ_QUANT_COMPACT_TRIGGER_TOKENS = value; },
          },
        ],
      },
    ];
  }

  private valueText(field: Field, active: boolean): string {
    if (this.draft !== null && active) return `[${this.draftDisplay(field)}|]`;
    return `[${field.action ? ">" : ""}${field.pickRemove ? "▼ " : ""}${field.get()}]`;
  }

  private cycle(field: Field, direction: 1 | -1): void {
    if (!this.cfg || !field.set) return;
    const opts = this.fieldOptions(field);
    if (opts.length === 0) return;
    const idx = opts.indexOf(field.get());
    const previous = cloneSettings(this.cfg);
    field.set(opts[(idx + direction + opts.length) % opts.length]);
    try { this.data.saveSettings(this.cfg); }
    catch (error) { this.cfg = previous; throw error; }
    this.dirty ||= field.refreshPanel !== false;
    this.options.onConfigurationChange?.();
  }

  private draftDisplay(field: Field): string {
    if (this.draft === null) return "";
    if (!field.secret) return this.draft;
    return "•".repeat(Math.min(24, this.draft.length));
  }

  private doctorWizardRows(): Row[] {
    return this.doctorWizardFields().map((field, index) => ({ field, index }) as Row);
  }

  private openModelPanel(): void {
    const panel = new ModelSettingsPanel(this.cfg!, {}, {
      ...this.options.modelAuth,
      onChange: () => { if (this.modelPanel === panel) this.options.onChange?.(); },
      onSaved: saved => {
        if (this.modelPanel !== panel || !this.cfg) return;
        this.cfg = saved;
        this.status = "OAuth connection saved.";
        this.options.onConfigurationChange?.();
      },
    });
    this.modelPanel = panel;
  }

  private doctorWizardFields(): Field[] {
    return [
      {
        label: "Model connection",
        get: () => {
          try { const model = resolveConfiguredModel(this.cfg!); return `${model.provider} / ${model.id}`; }
          catch { return "Configure connection"; }
        },
        onEnter: () => { this.openModelPanel(); return ""; },
      },
      {
        label: "Market Data",
        get: () => this.currentSource(),
        onEnter: () => { this.dataPanel = new DataSettingsPanel(this.cfg!, this.options); return ""; },
      },
      {
        label: "Run diagnostics",
        get: () => "Check saved model, tools and data",
        action: "/doctor",
      },
    ];
  }

  private refreshResumeSessions(): void {
    this.recentSessions = this.data.listStoredSessions({
      cwd: this.data.cwd(),
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

  private refreshArtifacts(): void {
    this.artifacts = this.data.listArtifacts();
    this.artifactSelection = Math.max(0, Math.min(this.artifactSelection, this.artifacts.length - 1));
  }

  setDoctor(doctor: DoctorResult | null): void {
    if (!doctor) this.doctorPanel.reset();
    this.doctor = doctor;
    if (doctor?.capabilities) this.capabilitiesPanel?.update(doctor.capabilities);
    this.cursor = 0;
    this.draft = null;
    this.status = "";
  }

  private toDoctorPanelView(doctor: DoctorResult): DoctorPanelView {
    const actionItems = ["r Retry all"];
    if (doctor.phases.some((phase) => phase.phase === "model")) actionItems.push("m Model");
    if (doctor.phases.some((phase) => phase.phase === "tools")) actionItems.push("t Tools");
    if (doctor.phases.some((phase) => phase.phase === "data")) actionItems.push("d Data");
    actionItems.push("c Configure");
    if (doctor.capabilities) actionItems.push("v Capabilities");
    const unchecked = doctor.phases.filter(phase => phase.status === "pending").map(phase => phase.phase);
    const status = doctor.overall === "all_pass" && unchecked.length
      ? `${(doctor.requestedPhases ?? doctor.phases.filter(phase => phase.status === "pass").map(phase => phase.phase)).join("+")} pass · ${unchecked.join("+")} untested`
      : doctor.overall;
    return {
      title: "WhyJ Doctor",
      status,
      mode: doctor.mode,
      model: doctor.config.model,
      baseUrl: doctor.config.baseUrl,
      endpointMode: doctor.config.endpointMode,
      dataSource: doctor.config.dataSource,
      settingsPath: doctor.config.settingsPath,
      phases: doctor.phases.map((phase) => ({
        phase: phase.phase,
        status: phase.status,
        detail: phase.error || phase.detail,
        action: phase.action,
        warnings: phase.warnings,
      })),
      actions: actionItems,
      hints: doctor.hints,
      logPath: doctor.logPath,
    };
  }


}
