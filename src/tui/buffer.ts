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
  moveTo: (r: number, c: number) => `${ESC}[${r};${c}H`,
  fg: (hex: string) => {
    const n = hex.replace("#", "");
    const r = parseInt(n.slice(0, 2), 16);
    const g = parseInt(n.slice(2, 4), 16);
    const b = parseInt(n.slice(4, 6), 16);
    return `${ESC}[38;2;${r};${g};${b}m`;
  },
};

export interface Style {
  fg?: string;
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

/** Display width when each glyph is drawn at N× (N×N cells for ASCII). */
export function scaleVisualWidth(s: string, scale: number): number {
  let w = 0;
  for (const ch of s) {
    const cw = charWidth(ch);
    w += cw === 1 ? scale : cw;
  }
  return w;
}

/** @deprecated use scaleVisualWidth(s, 2) */
export function scale2VisualWidth(s: string): number {
  return scaleVisualWidth(s, 2);
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

  set(x: number, y: number, ch: string, st: Style = {}): void {
    if (!this.inb(x, y)) return;
    this.cells[this.idx(x, y)] = { ch, fg: st.fg, bold: st.bold, dim: st.dim };
    if (charWidth(ch) === 2 && this.inb(x + 1, y)) {
      this.cells[this.idx(x + 1, y)] = { ch: "", cont: true };
    }
  }

  /** Draw one glyph at N× size (N×N cells for ASCII, N rows for CJK). */
  setScale(x: number, y: number, ch: string, scale: number, st: Style = {}): void {
    const cw = charWidth(ch);
    if (cw === 1) {
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) this.set(x + dx, y + dy, ch, st);
      }
    } else {
      for (let dy = 0; dy < scale; dy++) this.set(x, y + dy, ch, st);
    }
  }

  /** Write a string at N× font-size; returns x past the last cell column used. */
  textScale(x: number, y: number, s: string, scale: number, st: Style = {}, maxVisualW = Infinity): number {
    let cx = x;
    let used = 0;
    for (const ch of s) {
      if (ch === "\n") break;
      const cw = charWidth(ch);
      const visualW = cw === 1 ? scale : cw;
      if (used + visualW > maxVisualW) break;
      this.setScale(cx, y, ch, scale, st);
      cx += visualW;
      used += visualW;
    }
    return cx;
  }

  /** @deprecated use textScale(..., 2, ...) */
  setScale2(x: number, y: number, ch: string, st: Style = {}): void {
    this.setScale(x, y, ch, 2, st);
  }

  /** @deprecated use textScale(..., 2, ...) */
  textScale2(x: number, y: number, s: string, st: Style = {}, maxVisualW = Infinity): number {
    return this.textScale(x, y, s, 2, st, maxVisualW);
  }

  /** Write a string; returns the x just past the last cell written. */
  text(x: number, y: number, s: string, st: Style = {}, maxW = Infinity): number {
    let cx = x;
    let used = 0;
    for (const ch of s) {
      if (ch === "\n") break;
      const cw = charWidth(ch);
      if (used + cw > maxW) break;
      this.set(cx, y, ch, st);
      cx += cw;
      used += cw;
    }
    return cx;
  }

  /** Right-align text so it ends at xRight (inclusive edge). */
  textRight(xRight: number, y: number, s: string, st: Style = {}): number {
    const x = xRight - strWidth(s);
    return this.text(x, y, s, st);
  }

  hline(x: number, y: number, len: number, ch = "─", st: Style = {}): void {
    for (let i = 0; i < len; i++) this.set(x + i, y, ch, st);
  }
  vline(x: number, y: number, len: number, ch = "│", st: Style = {}): void {
    for (let i = 0; i < len; i++) this.set(x, y + i, ch, st);
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
    } = {},
  ): Rect {
    const { x, y, w, h } = r;
    const b = opts.border ?? {};
    this.set(x, y, "╭", b);
    this.set(x + w - 1, y, "╮", b);
    this.set(x, y + h - 1, "╰", b);
    this.set(x + w - 1, y + h - 1, "╯", b);
    this.hline(x + 1, y, w - 2, "─", b);
    this.hline(x + 1, y + h - 1, w - 2, "─", b);
    this.vline(x, y + 1, h - 2, "│", b);
    this.vline(x + w - 1, y + 1, h - 2, "│", b);
    if (opts.title) {
      this.text(x + 2, y, ` ${opts.title} `, opts.titleStyle ?? b);
    }
    if (opts.titleRight) {
      const t = ` ${opts.titleRight} `;
      this.text(x + w - 2 - strWidth(t), y, t, opts.titleRightStyle ?? b);
    }
    return { x: x + 2, y: y + 1, w: w - 4, h: h - 2 };
  }

  /** Render the whole buffer to a single ANSI string. */
  render(): string {
    let out = "";
    for (let y = 0; y < this.h; y++) {
      out += ansi.moveTo(y + 1, 1) + ansi.reset;
      for (let x = 0; x < this.w; x++) {
        const c = this.cells[this.idx(x, y)];
        if (c.cont) continue;
        let seg = "";
        if (c.dim) seg += `${ESC}[2m`;
        if (c.bold) seg += `${ESC}[1m`;
        if (c.fg) seg += ansi.fg(c.fg);
        seg += c.ch === "" ? " " : c.ch;
        out += seg;
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
      rows.push(line);
    }
    return rows;
  }
}

/** Width-aware word wrap. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (para === "") { out.push(""); continue; }
    let line = "";
    let lineW = 0;
    for (const word of para.split(" ")) {
      const ww = strWidth(word);
      if (lineW === 0) {
        line = word;
        lineW = ww;
      } else if (lineW + 1 + ww <= width) {
        line += " " + word;
        lineW += 1 + ww;
      } else {
        out.push(line);
        line = word;
        lineW = ww;
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
  enter(): void { this.out.write(ansi.altOn + ansi.hideCursor + ansi.clear); this.resize(); }
  exit(): void { this.out.write(ansi.reset + ansi.showCursor + ansi.altOff); }
  resize(): void { this.buf = new Buffer(this.cols, this.rows); }
  flush(): void { this.out.write(ansi.syncOn + this.buf.render() + ansi.syncOff); }
}
