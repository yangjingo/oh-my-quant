/**
 * Cell-grid frame buffer for terminal rendering.
 * Pattern: deepseek-tui / ratatui Buffer.
 */
import { strWidth, ansi } from "./utils.ts";

export interface Cell {
  char: string;
  style: Style;
}

export interface Style {
  fg?: string;      // hex color
  bold?: boolean;
  dim?: boolean;
}

export class Buffer {
  cells: Cell[][];
  w: number;
  h: number;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.cells = Array.from({ length: h }, () =>
      Array.from({ length: w }, () => ({ char: " ", style: {} }))
    );
  }

  clear(): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        this.cells[y][x] = { char: " ", style: {} };
      }
    }
  }

  set(x: number, y: number, char: string, style: Style = {}): void {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    this.cells[y][x] = { char, style };
  }

  text(x: number, y: number, text: string, style: Style = {}): void {
    let col = x;
    for (const ch of [...text]) {
      if (col >= this.w) break;
      if (ch === "\n") { y++; col = x; continue; }
      this.set(col, y, ch, style);
      col++;
    }
  }

  textRight(x: number, y: number, text: string, style: Style = {}): void {
    const w = strWidth(text);
    this.text(x - w + 1, y, text, style);
  }

  hline(x: number, y: number, len: number, char: string, style: Style = {}): void {
    for (let i = 0; i < len; i++) this.set(x + i, y, char, style);
  }

  vline(x: number, y: number, len: number, char: string, style: Style = {}): void {
    for (let i = 0; i < len; i++) this.set(x, y + i, char, style);
  }

  box(r: { x: number; y: number; w: number; h: number }, o: {
    title?: string; titleRight?: string;
    border?: Style; titleStyle?: Style; titleRightStyle?: Style;
  } = {}): { x: number; y: number; w: number; h: number } {
    const { x, y, w, h } = r;
    const b = o.border ?? {};
    const ts = o.titleStyle ?? b;
    const trs = o.titleRightStyle ?? b;
    this.set(x, y, "╭", b);            this.set(x + w - 1, y, "╮", b);
    this.set(x, y + h - 1, "╰", b);    this.set(x + w - 1, y + h - 1, "╯", b);
    this.hline(x + 1, y, w - 2, "─", b);
    this.hline(x + 1, y + h - 1, w - 2, "─", b);
    this.vline(x, y + 1, h - 2, "│", b);
    this.vline(x + w - 1, y + 1, h - 2, "│", b);
    if (o.title) this.text(x + 2, y, ` ${o.title} `, ts);
    if (o.titleRight) {
      const t = ` ${o.titleRight} `;
      this.text(x + w - 2 - strWidth(t), y, t, trs);
    }
    return { x: x + 2, y: y + 1, w: w - 4, h: h - 2 };
  }

  /** Render to ANSI string with diff against previous frame for minimal output. */
  render(prev?: string[]): string {
    const lines: string[] = [];
    let lastStyle = "";
    for (let y = 0; y < this.h; y++) {
      let line = "";
      let currentStyle: Style = {};
      for (let x = 0; x < this.w; x++) {
        const cell = this.cells[y][x];
        if (x === 0 || !styleEq(cell.style, currentStyle)) {
          currentStyle = cell.style;
          line += styleToAnsi(cell.style);
        }
        line += cell.char;
      }
      line += ansi.reset;
      lines.push(line);
    }
    return lines.join("\n");
  }

  toPlain(): string {
    let out = "";
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) out += this.cells[y][x].char;
      if (y < this.h - 1) out += "\n";
    }
    return out;
  }
}

export function styleEq(a: Style, b: Style): boolean {
  return a.fg === b.fg && a.bold === b.bold && a.dim === b.dim;
}

export function styleToAnsi(s: Style): string {
  let code = "";
  if (s.dim) code += ansi.dim;
  if (s.bold) code += ansi.bold;
  if (s.fg) code += `\x1b[38;2;${hexToRgb(s.fg)}m`;
  return code;
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r};${g};${b}`;
}
