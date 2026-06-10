import type * as readline from "node:readline";
import { Buffer, truncate } from "./buffer.ts";
import { S, GOLD, GOLD_HIGHLIGHT } from "./styles.ts";
import { loadSettings, saveSettings } from "../../storage/index.ts";
import {
  loadPanelPortfolio,
  savePanelPortfolio,
  createGroup,
  renameGroup,
  deleteGroup,
  addSymbolToGroup,
  removeSymbolFromGroup,
  addSymbol,
  removeSymbol,
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
const ENABLE_OPTIONS = ["on", "off"];

export class PanelController {
  private cfg: OhQuantSettings | null = null;
  private panelSymbols: PanelPortfolioFile = { updated: "", symbols: [], groups: [] };
  private cursor = 0;
  private draft: string | null = null;
  private removePick = 0;
  private groupPick = 0;
  private symbolPick = 0;
  private status = "";

  open(): void {
    this.cfg = loadSettings();
    this.panelSymbols = loadPanelPortfolio();
    this.cursor = 0;
    this.draft = null;
    this.removePick = 0;
    this.groupPick = 0;
    this.symbolPick = 0;
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
          if (field.label === "Selected group") {
            this.groupPick = (this.groupPick + delta + opts.length) % opts.length;
          } else if (field.label === "Remove from group") {
            this.symbolPick = (this.symbolPick + delta + opts.length) % opts.length;
          } else {
            this.removePick = (this.removePick + delta + opts.length) % opts.length;
          }
        }
        return {};
      }
      if (field?.options && !field.action) this.cycle(field, key.name === "left" ? -1 : 1);
      return {};
    }
    if (key.name !== "return" || !field) return {};

    if (field.pickRemove) {
      let msg: string;
      if (field.label === "Remove from group") {
        msg = this.removeSymbolFromSelectedGroup();
      } else {
        msg = this.removeSelectedSymbol();
      }
      this.status = msg;
      refreshPanel = msg.startsWith("Removed") || msg.startsWith("Deleted");
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
    if (this.draft === null) {
      this.panelSymbols = loadPanelPortfolio();
    }
    const rows = this.rows();
    const fields = this.fields();
    const boxW = Math.min(62, buf.w - 6);
    const boxH = Math.min(buf.h - 6, Math.max(14, rows.length + 6));
    const boxX = Math.floor((buf.w - boxW) / 2);
    const boxY = Math.floor((buf.h - boxH) / 2);

    buf.fillRect({ x: boxX - 1, y: boxY - 1, w: boxW + 2, h: boxH + 2 }, { fg: "#000000", dim: true });
    const inner = buf.box({ x: boxX, y: boxY, w: boxW, h: boxH }, {
      title: "Config",
      titleStyle: S.creamB,
      titleRight: "↑↓ move  ←→ toggle  ↵ edit  esc close",
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

    const footer = this.status || "Use slash commands for data, watchlist, MCP, and session actions.";
    buf.text(inner.x, inner.y + inner.h - 1, truncate(footer, inner.w), S.dim);
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

  private createNewGroup(name: string): string {
    if (!name.trim()) return "Enter a group name.";
    const { id, data } = createGroup(this.panelSymbols, name.trim());
    this.panelSymbols = data;
    savePanelPortfolio(this.panelSymbols);
    return `Created group "${name.trim()}" (${id}).`;
  }

  private selectedGroupLabel(): string {
    const groups = this.panelSymbols.groups;
    if (groups.length === 0) return "no groups";
    const group = groups[this.groupPick % groups.length];
    return group ? group.name : "no groups";
  }

  private groupSymbolLabel(): string {
    const groups = this.panelSymbols.groups;
    if (groups.length === 0) return "no groups";
    const group = groups[this.groupPick % groups.length];
    if (!group) return "no groups";
    if (group.symbolCodes.length === 0) return "empty";
    const code = group.symbolCodes[this.symbolPick % group.symbolCodes.length];
    return code ?? "empty";
  }

  private renameSelectedGroup(newName: string): string {
    const groups = this.panelSymbols.groups;
    if (groups.length === 0) return "No groups to rename.";
    if (!newName.trim()) return "Enter a group name.";
    const group = groups[this.groupPick % groups.length];
    if (!group) return "No groups to rename.";
    this.panelSymbols = renameGroup(this.panelSymbols, group.id, newName.trim());
    savePanelPortfolio(this.panelSymbols);
    return `Renamed group to "${newName.trim()}".`;
  }

  private deleteSelectedGroup(): string {
    const groups = this.panelSymbols.groups;
    if (groups.length === 0) return "No groups to delete.";
    const group = groups[this.groupPick % groups.length];
    if (!group) return "No groups to delete.";
    this.panelSymbols = deleteGroup(this.panelSymbols, group.id);
    this.groupPick = Math.max(0, Math.min(this.groupPick, this.panelSymbols.groups.length - 1));
    savePanelPortfolio(this.panelSymbols);
    return `Deleted group "${group.name}".`;
  }

  private addSymbolToSelectedGroup(code: string): string {
    const groups = this.panelSymbols.groups;
    if (groups.length === 0) return "No groups to add to.";
    const group = groups[this.groupPick % groups.length];
    if (!group) return "No groups to add to.";
    if (!code.trim()) return "Enter a symbol code.";
    this.panelSymbols = addSymbolToGroup(this.panelSymbols, group.id, code.trim());
    savePanelPortfolio(this.panelSymbols);
    return `Added ${code.trim()} to "${group.name}".`;
  }

  private removeSymbolFromSelectedGroup(): string {
    const groups = this.panelSymbols.groups;
    if (groups.length === 0) return "No groups configured.";
    const group = groups[this.groupPick % groups.length];
    if (!group) return "No groups configured.";
    if (group.symbolCodes.length === 0) return `Group "${group.name}" is empty.`;
    const code = group.symbolCodes[this.symbolPick % group.symbolCodes.length];
    if (!code) return `Group "${group.name}" is empty.`;
    this.panelSymbols = removeSymbolFromGroup(this.panelSymbols, group.id, code);
    this.symbolPick = Math.max(0, Math.min(this.symbolPick, group.symbolCodes.length - 2));
    savePanelPortfolio(this.panelSymbols);
    return `Removed ${code} from "${group.name}".`;
  }

  private removeLabel(): string {
    const symbols = this.panelSymbols.symbols;
    if (symbols.length === 0) return "empty";
    const entry = symbols[this.removePick % symbols.length];
    return entry ? `${entry.code} · ${entry.name}` : "empty";
  }

  private panelSummaryLabel(): string {
    const symbols = this.panelSymbols.symbols;
    if (symbols.length === 0) return "empty";
    const preview = symbols.slice(0, 2).map((s) => s.code).join(", ");
    const suffix = symbols.length > 2 ? ` +${symbols.length - 2}` : "";
    return `${symbols.length} · ${preview}${suffix}`;
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
    return [
      {
        label: "Basic",
        fields: [
          { label: "Model", get: () => this.cfg?.model || "sonnet", set: (v) => { if (this.cfg) this.cfg.model = v; }, options: MODEL_OPTIONS },
          { label: "Thinking", get: () => this.cfg?.thinkingLevel || "off", set: (v) => { if (this.cfg) this.cfg.thinkingLevel = v; }, options: THINKING_OPTIONS },
          { label: "Insight", get: () => this.cfg?.insightEnabled === false ? "off" : "on", set: (v) => { if (this.cfg) this.cfg.insightEnabled = v !== "off"; }, options: ENABLE_OPTIONS },
        ],
      },
      {
        label: "Overview",
        fields: [
          { label: "Symbols", get: () => this.panelSummaryLabel() },
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
        label: "Groups",
        fields: [
          {
            label: "Selected group",
            get: () => this.selectedGroupLabel(),
            pickRemove: true,
            optionsFn: () => this.panelSymbols.groups.map((g) => g.name),
          },
          {
            label: "Create group",
            get: () => "type name",
            apply: (v) => this.createNewGroup(v),
          },
          {
            label: "Rename group",
            get: () => "type new name",
            apply: (v) => this.renameSelectedGroup(v),
          },
          {
            label: "Delete group",
            get: () => "confirm",
            onEnter: () => this.deleteSelectedGroup(),
          },
          {
            label: "Add to group",
            get: () => "type code",
            apply: (v) => this.addSymbolToSelectedGroup(v),
          },
          {
            label: "Remove from group",
            get: () => this.groupSymbolLabel(),
            pickRemove: true,
            optionsFn: () => {
              const groups = this.panelSymbols.groups;
              if (groups.length === 0) return [];
              const group = groups[this.groupPick % groups.length];
              return group?.symbolCodes ?? [];
            },
          },
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
