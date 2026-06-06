/**
 * Region renderers for the r2 full-screen docked TUI.
 * Each function is pure: (Buffer, Rect, AppState) → void.
 */
import { Buffer } from "./buffer.ts";
import { S, pctStyle, fmtPrice, fmtPct } from "./styles.ts";
import { strWidth, truncate } from "./utils.ts";
import { HEADER_H, COMPOSER_H, STATUS_H, GUTTER, DIVIDER_CHAR } from "./tokens.ts";
import type { AppState, Layout, UIMessage, PanelSection, Holding, Quote } from "./types.ts";

// ── Layout computation (pure, testable) ──

export function layout(C: number, R: number): Layout {
  const panelW = Math.min(40, Math.max(30, Math.floor(C * 0.26)));
  const showPanel = C >= 78;
  const mainH = R - HEADER_H - COMPOSER_H - STATUS_H;
  const convW = showPanel ? C - panelW : C;
  return {
    conversation: { x: 1, y: HEADER_H, w: convW - 2, h: mainH },
    portfolio:    { x: convW, y: HEADER_H, w: panelW, h: mainH },
    composer:     { x: 0, y: R - COMPOSER_H - STATUS_H, w: C, h: COMPOSER_H },
    statusRow:    R - 1,
    showPanel,
  };
}

// ── Header ──

export function drawHeader(buf: Buffer, st: AppState): void {
  const C = buf.w;
  // Row 0: brand line
  buf.text(0, 0, "▌", S.goldB);
  buf.text(2, 0, "WhyJ", S.creamB);
  buf.text(7, 0, "Quant", S.creamB);
  const userModel = `${st.user} · ${st.model}`;
  buf.text(15, 0, userModel, S.muted);
  // Right side
  const right = `◆ ${st.activity} · v${st.version}`;
  buf.textRight(C - 1, 0, right, S.muted);
  // Row 1: hairline
  buf.hline(0, 1, C, DIVIDER_CHAR, S.rule);
}

// ── Conversation ──

export function drawConversation(buf: Buffer, r: { x: number; y: number; w: number; h: number }, msgs: UIMessage[]): void {
  // Render all lines, then show bottom h lines
  const lines: string[] = [];
  for (const msg of msgs) {
    lines.push(...renderMessage(msg, r.w));
    lines.push(""); // blank separator
  }
  const start = Math.max(0, lines.length - r.h);
  for (let i = start; i < lines.length && i - start < r.h; i++) {
    buf.text(r.x, r.y + i - start, lines[i]);
  }
}

function renderMessage(msg: UIMessage, width: number): string[] {
  const lines: string[] = [];
  const w = Math.max(10, width);
  if (msg.role === "user") {
    const text = msg.text ?? "";
    const wrapped = wrapText(text, w - 2);
    for (const line of wrapped) {
      bufText(lines, `\x1b[38;2;212;175;55m${GUTTER}\x1b[0m \x1b[1;38;2;212;175;55m${line}\x1b[0m`);
    }
  } else if (msg.role === "thinking") {
    const text = msg.text ?? "";
    const wrapped = wrapText(text, w - 2);
    bufText(lines, `\x1b[2;38;2;166;166;166m${GUTTER}\x1b[0m`);
    for (const line of wrapped) {
      bufText(lines, `\x1b[2;38;2;166;166;166m  ${line}\x1b[0m`);
    }
  } else if (msg.role === "tool") {
    const t = msg.tool!;
    const status = t.status === "running" ? "○" : t.status === "done" ? "✓" : "✗";
    const label = t.name.replace(/_/g, " ");
    const args = t.args ? ` · ${t.args}` : "";
    const elapsed = t.status === "running" ? `  ${formatElapsed(Date.now() - t.startedAt)}` : "";
    const indicator = t.status === "running" ? "\x1b[38;2;212;175;55m" : t.status === "error" ? "\x1b[38;2;212;175;55m" : "\x1b[38;2;212;175;55m";
    bufText(lines, `  ${indicator}${status}\x1b[0m \x1b[38;2;212;175;55m${label}\x1b[0m\x1b[2m${args}${elapsed}\x1b[0m [${t.status === "running" ? "+" : "-"}]`);
    if (t.result) {
      const preview = t.result.length > 120 ? t.result.slice(0, 120) + "..." : t.result;
      bufText(lines, `    \x1b[2m${preview}\x1b[0m`);
    }
  } else if (msg.role === "error") {
    bufText(lines, `\x1b[38;2;212;175;55m${GUTTER} ERR\x1b[0m \x1b[38;2;212;175;55m${msg.text ?? ""}\x1b[0m`);
  } else {
    // assistant
    const text = msg.text ?? "";
    const wrapped = wrapText(text, w - 2);
    for (let i = 0; i < wrapped.length; i++) {
      const gutter = i === 0 ? `\x1b[38;2;212;175;55m${GUTTER}\x1b[0m ` : `  `;
      bufText(lines, `${gutter}${wrapped[i]}`);
    }
  }
  return lines;
}

function bufText(lines: string[], s: string): void {
  lines.push(s);
}

// ── Portfolio dock ──

export function drawPortfolio(buf: Buffer, r: { x: number; y: number; w: number; h: number }, sections: PanelSection[]): void {
  const heldCount = sections
    .filter((s): s is { kind: "holdings"; title: string; rows: Holding[] } => s.kind === "holdings")
    .reduce((n, s) => n + s.rows.length, 0);
  const titleRight = heldCount > 0 ? `${heldCount} held` : undefined;
  const inner = buf.box({ x: r.x, y: r.y, w: r.w, h: r.h }, {
    title: "Portfolio", titleStyle: S.creamB, titleRightStyle: S.dim, border: S.rule,
    titleRight,
  });
  const x = inner.x;
  let y = inner.y + 1;
  for (const sec of sections) {
    y = drawSectionHeader(buf, x, y, inner.w, sec.title);
    if (sec.kind === "holdings") {
      for (const h of sec.rows) {
        y = drawHoldingRow(buf, x, y, inner.w, h);
      }
    } else if (sec.kind === "quotes") {
      for (const q of sec.rows) {
        y = drawQuoteRow(buf, x, y, inner.w, q);
      }
    }
    y += 1;
  }
}

function drawSectionHeader(buf: Buffer, x: number, y: number, w: number, title: string): number {
  buf.text(x, y, "▎", S.gold);
  buf.text(x + 2, y, title, S.creamB);
  buf.hline(x, y + 1, w, DIVIDER_CHAR, S.rule);
  return y + 3;
}

function drawHoldingRow(buf: Buffer, x: number, y: number, w: number, h: Holding): number {
  const right = x + w;
  // Line 1: code + name
  buf.text(x, y, h.code, S.code);
  const nameW = w - 8;
  buf.text(x + 7, y, truncate(h.name, nameW), S.cream);
  // Line 2: price + change%
  y++;
  const pct = fmtPct(h.pct);
  const price = fmtPrice(h.price);
  buf.textRight(right, y, price, S.creamB);
  buf.textRight(right - strWidth(pct) - 2, y, pct, pctStyle(h.pct));
  return y + 2;
}

function drawQuoteRow(buf: Buffer, x: number, y: number, w: number, q: Quote): number {
  const right = x + w;
  const pct = fmtPct(q.pct);
  const price = fmtPrice(q.price);
  buf.text(x, y, q.symbol, S.cream);
  buf.textRight(right, y, price, S.creamB);
  buf.textRight(right - strWidth(pct) - 2, y, pct, pctStyle(q.pct));
  return y + 1;
}

// ── Composer ──

export function drawComposer(buf: Buffer, r: { x: number; y: number; w: number; h: number }, input: string): void {
  const inner = buf.box(r, {
    title: "Composer", titleStyle: S.muted,
    titleRight: "/ commands · ↵ send · ^C quit", titleRightStyle: S.code,
    border: S.rule,
  });
  buf.text(inner.x, inner.y, "›", S.gold);
  const text = input || "write a task, or just ask a question…";
  const display = input ? text : text;
  buf.text(inner.x + 2, inner.y, input ? display : `\x1b[2m${text}\x1b[0m`, input ? S.cream : S.dim as any);
  if (input) buf.text(inner.x + 2 + [...input].length, inner.y, "▏", S.cream);
  else buf.text(inner.x + 2, inner.y, "▏", S.dim);
}

// ── Status bar ──

export function drawStatus(buf: Buffer, row: number, width: number, st: AppState): void {
  const left = `\x1b[1;38;2;212;175;55mWhyJ\x1b[0m\x1b[38;2;110;106;96m · ${st.model} · $${st.cost.toFixed(2)} · Activity: ${st.activity}\x1b[0m`;
  buf.text(0, row, left);
  // Cache hit footer
  const cacheColor = st.cacheHit >= 90 ? S.positive.fg! : st.cacheHit >= 70 ? S.gold.fg! : S.negative.fg!;
  const cacheText = `Cache ${st.cacheHit.toFixed(1)}% hit`;
  const ansiCache = `\x1b[38;2;${hexToRgb(cacheColor)}m${cacheText}\x1b[0m`;
  buf.textRight(width - 1, row, ansiCache);
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r};${g};${b}`;
}

// ── Helpers ──

function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/(\s+)/)) {
    if (word === "\n") { lines.push(line); line = ""; continue; }
    if (strWidth(line + word) <= width) { line += word; }
    else { if (line) lines.push(line); line = word.trimStart(); }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
