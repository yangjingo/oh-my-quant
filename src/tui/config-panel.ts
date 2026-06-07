import type * as readline from "node:readline";
import { Buffer, truncate } from "./buffer.ts";
import { S } from "./styles.ts";
import { GOLD, GOLD_HIGHLIGHT } from "./tokens.ts";
import { loadSettings, saveSettings } from "../storage/index.ts";
import type { OhQuantSettings } from "../types/config.ts";

interface Field {
  key: string;
  label: string;
  get: () => string;
  set?: (v: string) => void;
  isSecret?: boolean;
  options?: string[];
  action?: string;
  editAction?: string;
}

interface Group {
  label: string;
  fields: Field[];
}

type Row = { isSection: true; sectionLabel: string } | { isSection: false; field: Field; fieldIdx: number };

const MODEL_OPTIONS = ["sonnet", "opus", "haiku", "gpt-5.5"];
const THINKING_OPTIONS = ["off", "minimal", "low", "medium", "high", "xhigh"];

export class ConfigPanelController {
  private cfg: OhQuantSettings | null = null;
  private cursor = 0;
  private editing = false;
  private editValue = "";
  private statusMsg = "";

  open(): void {
    this.cfg = loadSettings();
    this.cursor = 0;
    this.editing = false;
    this.editValue = "";
    this.statusMsg = "";
  }

  isOpen(): boolean {
    return this.cfg !== null;
  }

  close(): void {
    this.cfg = null;
    this.editing = false;
    this.editValue = "";
    this.statusMsg = "";
  }

  handleKey(input: string, key: readline.Key): { command?: string; close?: boolean } | null {
    if (!this.cfg) return null;
    const { rows, fields } = this.buildRows();

    if (this.editing) {
      if (key.name === "return") {
        const field = fields[this.cursor];
        if (field?.editAction && this.editValue.trim()) {
          const command = field.editAction + this.editValue.trim();
          this.editing = false;
          this.editValue = "";
          this.statusMsg = `Running: ${command}`;
          return { command, close: true };
        }
        if (field?.set && this.editValue.trim()) {
          field.set(this.editValue.trim());
          saveSettings(this.cfg);
        }
        this.editing = false;
        this.editValue = "";
        return {};
      }
      if (key.name === "escape") {
        this.editing = false;
        this.editValue = "";
        return {};
      }
      if (key.name === "backspace" || key.name === "delete") {
        this.editValue = this.editValue.slice(0, -1);
        return {};
      }
      if (input && !key.ctrl && !key.meta) {
        this.editValue += input;
      }
      return {};
    }

    if (key.name === "up") {
      this.cursor = this.cursor > 0 ? this.cursor - 1 : fields.length - 1;
      return {};
    }
    if (key.name === "down") {
      this.cursor = this.cursor < fields.length - 1 ? this.cursor + 1 : 0;
      return {};
    }
    if (key.name === "left") {
      const field = fields[this.cursor];
      if (field?.options && !field.action) this.cycle(field, -1);
      return {};
    }
    if (key.name === "right") {
      const field = fields[this.cursor];
      if (field?.options && !field.action) this.cycle(field, 1);
      return {};
    }
    if (key.name === "escape") return { close: true };
    if (key.name === "return") {
      const field = fields[this.cursor];
      if (!field) return {};
      if (field.action) {
        if (field.editAction) {
          this.editing = true;
          this.editValue = "";
          return {};
        }
        return { command: field.action, close: true };
      }
      if (field.options) {
        this.cycle(field, 1);
        return {};
      }
      if (field.isSecret) {
        this.editing = true;
        this.editValue = "";
      }
      return {};
    }

    void rows;
    return {};
  }

  render(buf: Buffer): void {
    if (!this.cfg) return;
    const { rows, fields } = this.buildRows();
    const boxW = Math.min(76, buf.w - 6);
    const boxH = Math.min(buf.h - 6, Math.max(16, rows.length + 6));
    const boxX = Math.floor((buf.w - boxW) / 2);
    const boxY = Math.floor((buf.h - boxH) / 2);

    for (let y = boxY - 1; y < boxY + boxH + 1; y++) {
      for (let x = boxX - 1; x < boxX + boxW + 1; x++) {
        if (x >= 0 && y >= 0 && x < buf.w && y < buf.h) buf.set(x, y, " ", { fg: "#000000", dim: true });
      }
    }

    const inner = buf.box({ x: boxX, y: boxY, w: boxW, h: boxH }, {
      title: "Config",
      titleStyle: S.creamB,
      titleRight: "↑↓ select  ← → cycle  ↵ act  esc back",
      titleRightStyle: S.dim,
      border: S.rule,
    });

    const visibleRows = inner.h - 3;
    const selectedRowIndex = rows.findIndex((row) => !row.isSection && row.fieldIdx === this.cursor);
    const start = Math.max(0, Math.min(selectedRowIndex - Math.floor(visibleRows / 2), rows.length - visibleRows));
    const end = Math.min(rows.length, start + visibleRows);
    let y = inner.y;

    for (let i = start; i < end; i++) {
      const row = rows[i];
      if (row.isSection) {
        buf.text(inner.x, y, truncate(`-- ${row.sectionLabel} --`, inner.w), S.dim);
        y++;
        continue;
      }

      const field = row.field;
      const active = row.fieldIdx === this.cursor;
      const left = `${active ? "> " : "  "}${field.label}`;
      const value = this.editing && active
        ? `[${this.editValue}|]`
        : `[${field.action ? ">" : ""}${field.isSecret ? this.secretStatus(field) : field.get()}]`;
      buf.text(inner.x, y, truncate(left, Math.max(10, inner.w - 22)), active ? S.goldB : S.cream);
      buf.textRight(inner.x + inner.w, y, truncate(value, 20), this.editing && active ? { fg: GOLD_HIGHLIGHT } : field.action ? S.dim : { fg: GOLD });
      y++;
    }

    if (this.statusMsg) buf.text(inner.x, inner.y + inner.h - 1, truncate(this.statusMsg, inner.w), S.dim);
    if (this.editing) {
      const field = fields[this.cursor];
      buf.text(inner.x, inner.y + inner.h - 2, truncate(`${field.label}: ${this.editValue}|`, inner.w), { fg: GOLD_HIGHLIGHT });
    }
  }

  private buildRows(): { rows: Row[]; fields: Field[] } {
    const fields = this.buildGroups().flatMap((group) => group.fields);
    const rows: Row[] = [];
    let fieldIdx = 0;
    for (const group of this.buildGroups()) {
      rows.push({ isSection: true, sectionLabel: group.label });
      for (const field of group.fields) {
        rows.push({ isSection: false, field, fieldIdx });
        fieldIdx++;
      }
    }
    return { rows, fields };
  }

  private buildGroups(): Group[] {
    if (!this.cfg) return [];
    return [
      {
        label: "Settings",
        fields: [
          {
            key: "WHYJ_AUTH_TOKEN",
            label: "Auth token",
            get: () => this.secretStatusByKey("WHYJ_AUTH_TOKEN"),
            set: (v) => { if (this.cfg) this.cfg.env.WHYJ_AUTH_TOKEN = v; },
            isSecret: true,
          },
          {
            key: "TUSHARE_TOKEN",
            label: "Tushare token",
            get: () => this.secretStatusByKey("TUSHARE_TOKEN"),
            set: (v) => { if (this.cfg) this.cfg.env.TUSHARE_TOKEN = v; },
            isSecret: true,
          },
          {
            key: "model",
            label: "Model",
            get: () => this.cfg?.model || "sonnet",
            set: (v) => { if (this.cfg) this.cfg.model = v; },
            options: MODEL_OPTIONS,
          },
          {
            key: "thinking",
            label: "Thinking",
            get: () => this.cfg?.thinkingLevel || "off",
            set: (v) => { if (this.cfg) this.cfg.thinkingLevel = v; },
            options: THINKING_OPTIONS,
          },
        ],
      },
      {
        label: "Data",
        fields: [
          { key: "fetch", label: "Fetch bars", get: () => "enter symbol", action: "/data", editAction: "/data download --symbol " },
          { key: "claw", label: "Snapshot", get: () => "enter symbol", action: "/claw", editAction: "/claw --code " },
        ],
      },
      {
        label: "Tools",
        fields: [
          { key: "skills", label: "Skills", get: () => "list all", action: "/skill" },
          { key: "benchmark", label: "Benchmarks", get: () => "view dashboard", action: "/benchmark" },
          { key: "mcp_status", label: "MCP status", get: () => "server list", action: "/mcp" },
          { key: "mcp_connect", label: "MCP connect", get: () => "connect all", action: "/mcp connect" },
        ],
      },
      {
        label: "Watchlist",
        fields: [
          { key: "watch", label: "Watch fund", get: () => "enter code", action: "/watch", editAction: "/watch " },
          { key: "watchlist", label: "Show list", get: () => "view all", action: "/watch" },
        ],
      },
      {
        label: "Session",
        fields: [
          { key: "help", label: "Help", get: () => "commands list", action: "/help" },
          { key: "clear", label: "Clear chat", get: () => "reset history", action: "/clear" },
        ],
      },
    ];
  }

  private cycle(field: Field, direction: 1 | -1): void {
    if (!this.cfg || !field.options?.length || !field.set) return;
    const current = field.get();
    const idx = field.options.indexOf(current);
    const next = (idx + direction + field.options.length) % field.options.length;
    field.set(field.options[next]);
    saveSettings(this.cfg);
  }

  private secretStatus(field: Field): string {
    return field.get() !== "not set" ? "configured" : "not set";
  }

  private secretStatusByKey(key: string): string {
    if (!this.cfg) return "not set";
    return this.cfg.env[key] ? "configured" : "not set";
  }
}
