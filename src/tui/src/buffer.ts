/**
 * src/tui/buffer.ts — minimal zero-dependency TUI engine.
 *
 * A cell-grid frame buffer (like a tiny ratatui) with:
 *   • full-screen alternate buffer + raw mode + synchronized output
 *   • box widgets with the title embedded in the top border (CodeWhale style)
 *   • CJK-aware width handling (中文 = 2 cells)
 *   • one-shot full-frame flush (no flicker via DEC 2026 sync)
 *
 * The app draws into a Buffer each frame; regions never scroll independently
 * of one another, so a docked panel (e.g. Portfolio) stays put forever.
 */

const ESC = "\x1b";

export const ansi = {
  altOn: `${ESC}[?1049h`,
  altOff: `${ESC}[?1049l`,
  hideCursor: `${ESC}[?25l`,
  showCursor: `${ESC}[?25h`,
  clear: `${ESC}[2J`,
  home: `${ESC}[H`,
  reset: `${ESC}[0m`,
  syncOn: `${ESC}[?2026h`,
  syncOff: `${ESC}[?2026l`,
  /** Click, drag, wheel reporting (SGR coords). No 1003 — hover floods stdin during loading. */
  mouseOn: `${ESC}[?1000h${ESC}[?1002h${ESC}[?1006h`,
  mouseOff: `${ESC}[?1006l${ESC}[?1002l${ESC}[?1000l`,
  moveTo: (r: number, c: number) => `${ESC}[${r};${c}H`,
  fg: (hex: string) => {
    const n = hex.replace("#", "");
    const r = parseInt(n.slice(0, 2), 16);
    const g = parseInt(n.slice(2, 4), 16);
    const b = parseInt(n.slice(4, 6), 16);
    return `${ESC}[38;2;${r};${g};${b}m`;
  },
  bg: (hex: string) => {
    const n = hex.replace("#", "");
    const r = parseInt(n.slice(0, 2), 16);
    const g = parseInt(n.slice(2, 4), 16);
    const b = parseInt(n.slice(4, 6), 16);
    return `${ESC}[48;2;${r};${g};${b}m`;
  },
};

export interface Style {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function charWidth(ch: string): number {
  const c = ch.codePointAt(0)!;
  if (c === 0) return 0;
  if (c < 0x80) return 1;
  return (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0x303e) ||
    (c >= 0x3041 && c <= 0x33ff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0xa000 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6)
    ? 2
    : 1;
}

export function strWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch);
  return w;
}

/** Truncate a string to a max display width (CJK-aware), adding an ellipsis. */
export function truncate(s: string, maxW: number, ell = "…"): string {
  if (strWidth(s) <= maxW) return s;
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = charWidth(ch);
    if (w + cw + strWidth(ell) > maxW) break;
    out += ch;
    w += cw;
  }
  return out + ell;
}

interface Cell {
  ch: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  cont?: boolean; // right half of a wide glyph — skipped on render
}

export class Buffer {
  w: number;
  h: number;
  cells: Cell[] = [];

  constructor(w: number, h: number) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.clear();
  }

  clear(): void {
    this.cells = Array.from({ length: this.w * this.h }, () => ({ ch: " " }));
  }

  private idx(x: number, y: number) {
    return y * this.w + x;
  }
  private inb(x: number, y: number) {
    return x >= 0 && x < this.w && y >= 0 && y < this.h;
  }

  set(x: number, y: number, ch: string, st: Style = {}, xMax = this.w): void {
    if (!this.inb(x, y)) return;
    const cw = charWidth(ch);
    if (x + cw > xMax) return;
    this.cells[this.idx(x, y)] = { ch, fg: st.fg, bg: st.bg, bold: st.bold, dim: st.dim };
    if (cw === 2 && this.inb(x + 1, y) && x + 2 <= xMax) {
      this.cells[this.idx(x + 1, y)] = { ch: "", cont: true };
    }
  }

  /** Write a string; returns the x just past the last cell written. */
  text(x: number, y: number, s: string, st: Style = {}, maxW = Infinity, xEnd = this.w): number {
    let cx = x;
    let used = 0;
    for (const ch of s) {
      if (ch === "\n") break;
      const cw = charWidth(ch);
      if (used + cw > maxW) break;
      if (cx >= xEnd) break;
      if (cx + cw > xEnd) break;
      this.set(cx, y, ch, st);
      cx += cw;
      used += cw;
    }
    return cx;
  }

  /** Paint a solid rect (used to erase neighbor-panel bleed). */
  fillRect(r: Rect, st: Style = {}): void {
    const xMax = r.x + r.w;
    for (let dy = 0; dy < r.h; dy++) {
      for (let dx = 0; dx < r.w; dx++) {
        const cx = r.x + dx;
        if (cx >= xMax) break;
        this.set(cx, r.y + dy, " ", st, xMax);
      }
    }
  }

  /** Right-align text so it ends at xRight (inclusive edge). Optional xMin prevents left bleed. */
  textRight(xRight: number, y: number, s: string, st: Style = {}, xMin = 0): number {
    const x = xRight - strWidth(s);
    return this.text(Math.max(xMin, x), y, s, st, Infinity, xRight);
  }

  hline(x: number, y: number, len: number, ch = "─", st: Style = {}, xMax = this.w): void {
    for (let i = 0; i < len; i++) {
      const cx = x + i;
      if (cx >= xMax) break;
      this.set(cx, y, ch, st, xMax);
    }
  }
  vline(x: number, y: number, len: number, ch = "│", st: Style = {}, xMax = this.w): void {
    for (let i = 0; i < len; i++) this.set(x, y + i, ch, st, xMax);
  }

  /** Box with rounded corners and optional title in top border.
   *  Returns the inner content rect (1-col padding inside the border). */
  box(
    r: Rect,
    opts: {
      title?: string;
      titleRight?: string;
      border?: Style;
      titleStyle?: Style;
      titleRightStyle?: Style;
      clipEnd?: number;
    } = {},
  ): Rect {
    const { x, y, w, h } = r;
    const xMax = opts.clipEnd ?? this.w;
    const b = opts.border ?? {};
    this.set(x, y, "╭", b, xMax);
    this.set(x + w - 1, y, "╮", b, xMax);
    this.set(x, y + h - 1, "╰", b, xMax);
    this.set(x + w - 1, y + h - 1, "╯", b, xMax);
    this.hline(x + 1, y, w - 2, "─", b, xMax);
    this.hline(x + 1, y + h - 1, w - 2, "─", b, xMax);
    this.vline(x, y + 1, h - 2, "│", b, xMax);
    this.vline(x + w - 1, y + 1, h - 2, "│", b, xMax);
    if (opts.title) {
      this.text(x + 2, y, ` ${opts.title} `, opts.titleStyle ?? b, Infinity, xMax);
    }
    if (opts.titleRight) {
      const t = ` ${opts.titleRight} `;
      this.text(x + w - 2 - strWidth(t), y, t, opts.titleRightStyle ?? b, Infinity, xMax);
    }
    return { x: x + 2, y: y + 1, w: w - 4, h: h - 2 };
  }

  /** Render the whole buffer to a single ANSI string. */
  render(): string {
    let out = "";
    for (let y = 0; y < this.h; y++) {
      out += ansi.moveTo(y + 1, 1) + ansi.reset;
      let bold = false;
      let dim = false;
      let fg: string | undefined;
      let bg: string | undefined;
      for (let x = 0; x < this.w; x++) {
        const c = this.cells[this.idx(x, y)];
        if (c.cont) continue;
        const wantBold = !!c.bold;
        const wantDim = !!c.dim;
        const wantFg = c.fg;
        const wantBg = c.bg;
        if (wantBold !== bold || wantDim !== dim || wantFg !== fg || wantBg !== bg) {
          out += ansi.reset;
          bold = false;
          dim = false;
          fg = undefined;
          bg = undefined;
          if (wantDim) {
            out += `${ESC}[2m`;
            dim = true;
          }
          if (wantBold) {
            out += `${ESC}[1m`;
            bold = true;
          }
          if (wantFg) {
            out += ansi.fg(wantFg);
            fg = wantFg;
          }
          if (wantBg) {
            out += ansi.bg(wantBg);
            bg = wantBg;
          }
        }
        out += c.ch === "" ? " " : c.ch;
      }
      out += ansi.reset;
    }
    return out;
  }

  /** For testing: plain text rows (no ANSI). */
  toPlain(): string[] {
    const rows: string[] = [];
    for (let y = 0; y < this.h; y++) {
      let line = "";
      for (let x = 0; x < this.w; x++) {
        const c = this.cells[this.idx(x, y)];
        if (c.cont) continue;
        line += c.ch === "" ? " " : c.ch;
      }
      // Pad to full width: cont cells (from double-width chars) shorten the line
      while (line.length < this.w) line += " ";
      rows.push(line);
    }
    return rows;
  }
}

/** Strip ANSI + control chars that would hijack the terminal cursor during render. */
export function sanitizeTerminalText(s: string): string {
  return s
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

function breakLongToken(token: string, width: number): string[] {
  if (width < 1) width = 1;
  if (strWidth(token) <= width) return [token];
  const parts: string[] = [];
  let chunk = "";
  let w = 0;
  for (const ch of token) {
    const cw = charWidth(ch);
    if (w + cw > width && chunk) {
      parts.push(chunk);
      chunk = ch;
      w = cw;
    } else {
      chunk += ch;
      w += cw;
    }
  }
  if (chunk) parts.push(chunk);
  return parts;
}

/** Width-aware word wrap. */
export function wrap(text: string, width: number): string[] {
  if (width < 1) width = 1;
  const out: string[] = [];
  for (const para of sanitizeTerminalText(text).split("\n")) {
    if (para === "") { out.push(""); continue; }
    let line = "";
    let lineW = 0;
    for (const word of para.split(" ")) {
      if (word === "") continue;
      for (const piece of breakLongToken(word, width)) {
        const ww = strWidth(piece);
        if (lineW === 0) {
          line = piece;
          lineW = ww;
        } else if (lineW + 1 + ww <= width) {
          line += " " + piece;
          lineW += 1 + ww;
        } else {
          out.push(line);
          line = piece;
          lineW = ww;
        }
      }
    }
    out.push(line);
  }
  return out;
}

/** Terminal screen controller wrapping a Buffer. */
export class Screen {
  out: NodeJS.WriteStream;
  buf: Buffer;

  constructor(out: NodeJS.WriteStream = process.stdout) {
    this.out = out;
    this.buf = new Buffer(this.cols, this.rows);
  }
  get cols() { return (this.out as any).columns ?? 80; }
  get rows() { return (this.out as any).rows ?? 24; }
  enter(): void {
    this.out.write(ansi.altOn + ansi.hideCursor + ansi.mouseOn + ansi.clear);
    this.resize();
  }
  exit(): void { this.out.write(ansi.reset + ansi.showCursor + ansi.mouseOff + ansi.altOff); }
  resize(): void { this.buf = new Buffer(this.cols, this.rows); }
  flush(): void { this.out.write(ansi.syncOn + this.buf.render() + ansi.syncOff); }
}
