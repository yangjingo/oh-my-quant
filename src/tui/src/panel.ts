import type * as readline from "node:readline";
import { Buffer, truncate } from "./buffer.ts";
import { S, GOLD, GOLD_HIGHLIGHT } from "./styles.ts";
import { loadSettings, saveSettings } from "../../storage/index.ts";
import {
  importLegacyHoldings,
  loadPanelPortfolio,
  savePanelPortfolio,
  type PanelPortfolioFile,
} from "../../storage/panel-portfolio.ts";
import type { OhQuantSettings } from "../../types/config.ts";

export type PanelResult = { command?: string; close?: boolean; refreshPanel?: boolean };

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

const MODEL_OPTIONS = ["sonnet", "opus", "haiku", "gpt-5.5"];
const THINKING_OPTIONS = ["off", "minimal", "low", "medium", "high", "xhigh"];

export class PanelController {
  private cfg: OhQuantSettings | null = null;
  private panelSymbols: PanelPortfolioFile = { updated: "", symbols: [] };
  private cursor = 0;
  private draft: string | null = null;
  private removePick = 0;
  private status = "";

  open(): void {
    this.cfg = loadSettings();
    this.panelSymbols = loadPanelPortfolio();
    this.cursor = 0;
    this.draft = null;
    this.removePick = 0;
    this.status = "";
  }

  isOpen(): boolean { return this.cfg !== null; }

  close(): void {
    this.cfg = null;
    this.draft = null;
    this.status = "";
  }

  handleKey(input: string, key: readline.Key): PanelResult | null {
    if (!this.cfg) return null;
    const fields = this.fields();
    const field = fields[this.cursor];
    let refreshPanel = false;

    if (this.draft !== null) {
      const result = this.handleDraft(input, key, field);
      return result;
    }

    if (key.name === "escape") return { close: true };
    if (key.name === "up" || key.name === "down") {
      const delta = key.name === "up" ? -1 : 1;
      this.cursor = (this.cursor + delta + fields.length) % fields.length;
      return {};
    }
    if (key.name === "left" || key.name === "right") {
      if (field?.pickRemove) {
        const opts = this.fieldOptions(field);
        if (opts.length > 0) {
          const delta = key.name === "left" ? -1 : 1;
          this.removePick = (this.removePick + delta + opts.length) % opts.length;
        }
        return {};
      }
      if (field?.options && !field.action) this.cycle(field, key.name === "left" ? -1 : 1);
      return {};
    }
    if (key.name !== "return" || !field) return {};

    if (field.pickRemove) {
      const msg = this.removeSelectedSymbol();
      this.status = msg;
      refreshPanel = msg.startsWith("Removed");
      return refreshPanel ? { refreshPanel } : {};
    }
    if (field.onEnter) {
      this.status = field.onEnter();
      return this.status.startsWith("Imported") ? { refreshPanel: true } : {};
    }
    if (field.action && !field.prompt) return { command: field.action, close: true };
    if (field.options) this.cycle(field, 1);
    else if (field.apply || field.set || field.prompt) this.draft = "";
    return {};
  }

  render(buf: Buffer): void {
    if (!this.cfg) return;
    const rows = this.rows();
    const fields = this.fields();
    const boxW = Math.min(76, buf.w - 6);
    const boxH = Math.min(buf.h - 6, Math.max(16, rows.length + 6));
    const boxX = Math.floor((buf.w - boxW) / 2);
    const boxY = Math.floor((buf.h - boxH) / 2);

    buf.fillRect({ x: boxX - 1, y: boxY - 1, w: boxW + 2, h: boxH + 2 }, { fg: "#000000", dim: true });
    const inner = buf.box({ x: boxX, y: boxY, w: boxW, h: boxH }, {
      title: "Config",
      titleStyle: S.creamB,
      titleRight: "↑↓ select  ←→ cycle  ↵ act  esc back",
      titleRightStyle: S.dim,
      border: S.rule,
    });

    const visible = inner.h - 3;
    const selectedRow = rows.findIndex((row) => "field" in row && row.index === this.cursor);
    const start = Math.max(0, Math.min(selectedRow - Math.floor(visible / 2), rows.length - visible));
    let y = inner.y;

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

    if (this.status) buf.text(inner.x, inner.y + inner.h - 1, truncate(this.status, inner.w), S.dim);
    if (this.draft !== null && fields[this.cursor]) {
      const hint = fields[this.cursor].apply ? "code or code name" : "";
      const prefix = hint ? `${fields[this.cursor].label} (${hint}): ` : `${fields[this.cursor].label}: `;
      buf.text(inner.x, inner.y + inner.h - 2, truncate(`${prefix}${this.draft}|`, inner.w), { fg: GOLD_HIGHLIGHT });
    }
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
        const ok = this.status.startsWith("Added") || this.status.startsWith("Imported");
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

  private addPanelSymbol(raw: string): string {
    const parts = raw.trim().split(/\s+/);
    const code = parts[0];
    if (!code) return "Enter a symbol code.";
    const name = parts.slice(1).join(" ") || code;
    if (this.panelSymbols.symbols.some((entry) => entry.code === code)) {
      return `${code} already in panel portfolio.`;
    }
    this.panelSymbols.symbols.push({
      code,
      name,
      added: new Date().toISOString().slice(0, 10),
    });
    savePanelPortfolio(this.panelSymbols);
    return `Added ${name} (${code}).`;
  }

  private removeSelectedSymbol(): string {
    const symbols = this.panelSymbols.symbols;
    if (symbols.length === 0) return "Panel portfolio is empty.";
    const idx = this.removePick % symbols.length;
    const removed = symbols[idx];
    if (!removed) return "Panel portfolio is empty.";
    this.panelSymbols.symbols = symbols.filter((_, i) => i !== idx);
    this.removePick = Math.max(0, Math.min(this.removePick, this.panelSymbols.symbols.length - 1));
    savePanelPortfolio(this.panelSymbols);
    return `Removed ${removed.code}.`;
  }

  private removeLabel(): string {
    const symbols = this.panelSymbols.symbols;
    if (symbols.length === 0) return "empty";
    const entry = symbols[this.removePick % symbols.length];
    return entry ? `${entry.code} · ${entry.name}` : "empty";
  }

  private importLegacyPanel(): string {
    const imported = importLegacyHoldings();
    if (imported.symbols.length === 0) return "No legacy holdings.json found.";
    this.panelSymbols = imported;
    savePanelPortfolio(imported);
    this.removePick = 0;
    return `Imported ${imported.symbols.length} symbols from holdings.json.`;
  }

  private panelSummaryLabel(): string {
    const symbols = this.panelSymbols.symbols;
    if (symbols.length === 0) return "empty";
    const preview = symbols.slice(0, 2).map((s) => s.code).join(", ");
    const suffix = symbols.length > 2 ? ` +${symbols.length - 2}` : "";
    return `${symbols.length} · ${preview}${suffix}`;
  }

  private panelCountLabel(): string {
    const n = this.panelSymbols.symbols.length;
    return n === 0 ? "empty" : `${n} symbol${n === 1 ? "" : "s"}`;
  }

  private fieldOptions(field: Field): string[] {
    return field.optionsFn?.() ?? field.options ?? [];
  }

  private rows(): Row[] {
    let index = 0;
    return this.groups().flatMap((group) => [
      { section: group.label } as Row,
      ...group.fields.map((field) => ({ field, index: index++ }) as Row),
    ]);
  }

  private fields(): Field[] {
    return this.groups().flatMap((group) => group.fields);
  }

  private groups(): Array<{ label: string; fields: Field[] }> {
    if (!this.cfg) return [];
    const env = this.cfg.env;
    return [
      {
        label: "Settings",
        fields: [
          { label: "Auth token", get: () => env.WHYJ_AUTH_TOKEN ? "configured" : "not set", set: (v) => { env.WHYJ_AUTH_TOKEN = v; }, secret: true },
          { label: "Tushare token", get: () => env.TUSHARE_TOKEN ? "configured" : "not set", set: (v) => { env.TUSHARE_TOKEN = v; }, secret: true },
          { label: "Model", get: () => this.cfg?.model || "sonnet", set: (v) => { if (this.cfg) this.cfg.model = v; }, options: MODEL_OPTIONS },
          { label: "Thinking", get: () => this.cfg?.thinkingLevel || "off", set: (v) => { if (this.cfg) this.cfg.thinkingLevel = v; }, options: THINKING_OPTIONS },
        ],
      },
      {
        label: "Panel Portfolio",
        fields: [
          { label: "Symbols", get: () => this.panelSummaryLabel() },
          {
            label: "Import legacy",
            get: () => "holdings.json · Enter",
            onEnter: () => this.importLegacyPanel(),
          },
          {
            label: "Add symbol",
            get: () => "type code + name",
            apply: (v) => this.addPanelSymbol(v),
          },
          {
            label: "Remove symbol",
            get: () => this.removeLabel(),
            pickRemove: true,
            optionsFn: () => this.panelSymbols.symbols.map((entry) => entry.code),
          },
        ],
      },
      {
        label: "Data",
        fields: [
          { label: "Fetch bars", get: () => "enter symbol", action: "/data", prompt: "/data download --symbol " },
          { label: "Snapshot", get: () => "enter symbol", action: "/claw", prompt: "/claw --code " },
        ],
      },
      {
        label: "Tools",
        fields: [
          { label: "Skills", get: () => "list all", action: "/skill" },
          { label: "Benchmarks", get: () => "view dashboard", action: "/benchmark" },
          { label: "MCP status", get: () => "server list", action: "/mcp" },
          { label: "MCP connect", get: () => "connect all", action: "/mcp connect" },
        ],
      },
      {
        label: "Watchlist",
        fields: [
          { label: "Watch fund", get: () => "enter code", action: "/watch", prompt: "/watch " },
          { label: "Show list", get: () => "view all", action: "/watch" },
        ],
      },
      {
        label: "Session",
        fields: [
          { label: "Help", get: () => "commands list", action: "/help" },
          { label: "Clear chat", get: () => "reset history", action: "/clear" },
        ],
      },
    ];
  }

  private valueText(field: Field, active: boolean): string {
    if (this.draft !== null && active) return `[${this.draft}|]`;
    if (field.pickRemove && this.panelSymbols.symbols.length > 0) return `[←→ ${field.get()}]`;
    return `[${field.action ? ">" : ""}${field.secret ? field.get() : field.get()}]`;
  }

  private cycle(field: Field, direction: 1 | -1): void {
    if (!this.cfg || !field.options?.length || !field.set) return;
    const idx = field.options.indexOf(field.get());
    field.set(field.options[(idx + direction + field.options.length) % field.options.length]);
    saveSettings(this.cfg);
  }
}
