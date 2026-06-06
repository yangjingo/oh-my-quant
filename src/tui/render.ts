/**
 * Region renderers for the r2 full-screen docked TUI.
 * Each function is pure: (Buffer, Rect, AppState) → void.
 */
import { Buffer, wrap, strWidth, truncate } from "./buffer.ts";
import { S, pctStyle, fmtPrice, fmtPct } from "./styles.ts";
import { HEADER_H, COMPOSER_H, STATUS_H, DIVIDER_CHAR } from "./tokens.ts";
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
  buf.text(0, 0, "▌", S.goldB);
  buf.text(2, 0, "WhyJ", S.creamB);
  buf.text(7, 0, "Quant", S.creamB);
  buf.text(15, 0, `${st.user} · ${st.model}`, S.muted);
  const right = `◆ ${st.activity} · v${st.version}`;
  buf.textRight(C - 1, 0, right, S.muted);
  buf.hline(0, 1, C, DIVIDER_CHAR, S.rule);
}

// ── Conversation ──

export function drawConversation(buf: Buffer, r: { x: number; y: number; w: number; h: number }, msgs: UIMessage[]): void {
  const lines: string[] = [];
  for (const msg of msgs) {
    lines.push(...renderMsg(msg, r.w));
    lines.push("");
  }
  const start = Math.max(0, lines.length - r.h);
  for (let i = start; i < lines.length && i - start < r.h; i++) {
    buf.text(r.x, r.y + i - start, lines[i]);
  }
}

function renderMsg(msg: UIMessage, width: number): string[] {
  const lines: string[] = [];
  const w = Math.max(10, width);
  if (msg.role === "user") {
    for (const line of wrap(msg.text ?? "", w - 2)) {
      lines.push(`${S.gold.fg ? `\x1b[38;2;${hexRgb(S.gold.fg!)}m` : ""}▏\x1b[0m \x1b[1m${line}\x1b[0m`);
    }
  } else if (msg.role === "thinking") {
    lines.push(`\x1b[2m▏\x1b[0m`);
    for (const line of wrap(msg.text ?? "", w - 2)) {
      lines.push(`\x1b[2m  ${line}\x1b[0m`);
    }
  } else if (msg.role === "tool") {
    const t = msg.tool!;
    const status = t.status === "running" ? "○" : t.status === "done" ? "✓" : "✗";
    const label = t.name.replace(/_/g, " ");
    const args = t.args ? ` · ${t.args}` : "";
    const elapsed = t.status === "running" ? `  ${fmtElapsed(Date.now() - t.startedAt)}` : "";
    const gold = S.gold.fg ? `\x1b[38;2;${hexRgb(S.gold.fg!)}m` : "";
    lines.push(`  ${gold}${status}\x1b[0m ${gold}${label}\x1b[0m\x1b[2m${args}${elapsed}\x1b[0m`);
    if (t.result) {
      const preview = t.result.length > 120 ? t.result.slice(0, 120) + "..." : t.result;
      lines.push(`    \x1b[2m${preview}\x1b[0m`);
    }
  } else if (msg.role === "error") {
    lines.push(`▏ \x1b[38;2;212;175;55mERR\x1b[0m ${msg.text ?? ""}`);
  } else {
    for (const line of wrap(msg.text ?? "", w - 2)) {
      lines.push(`▏ ${line}`);
    }
  }
  return lines;
}

// ── Portfolio dock ──

export function drawPortfolio(buf: Buffer, r: { x: number; y: number; w: number; h: number }, sections: PanelSection[]): void {
  const heldCount = sections
    .filter((s): s is { kind: "holdings"; title: string; rows: Holding[] } => s.kind === "holdings")
    .reduce((n, s) => n + s.rows.length, 0);
  const inner = buf.box(r, {
    title: "Portfolio", titleStyle: S.creamB,
    titleRight: heldCount > 0 ? `${heldCount} held` : undefined,
    titleRightStyle: S.dim, border: S.rule,
  });
  const x = inner.x;
  let y = inner.y + 1;
  for (const sec of sections) {
    y = secHeader(buf, x, y, inner.w, sec.title);
    if (sec.kind === "holdings") {
      for (const h of sec.rows) y = holdingRow(buf, x, y, inner.w, h);
    } else if (sec.kind === "quotes") {
      for (const q of sec.rows) y = quoteRow(buf, x, y, inner.w, q);
    }
    y += 1;
  }
}

function secHeader(buf: Buffer, x: number, y: number, w: number, title: string): number {
  buf.text(x, y, "▎", S.gold);
  buf.text(x + 2, y, title, S.creamB);
  buf.hline(x, y + 1, w, DIVIDER_CHAR, S.rule);
  return y + 3;
}

function holdingRow(buf: Buffer, x: number, y: number, w: number, h: Holding): number {
  const right = x + w;
  buf.text(x, y, h.code, S.code);
  buf.text(x + 7, y, truncate(h.name, w - 8), S.cream);
  y++;
  const pctTxt = fmtPct(h.pct);
  buf.textRight(right, y, fmtPrice(h.price), S.creamB);
  buf.textRight(right - strWidth(pctTxt) - 2, y, pctTxt, pctStyle(h.pct));
  return y + 2;
}

function quoteRow(buf: Buffer, x: number, y: number, w: number, q: Quote): number {
  const right = x + w;
  const pctTxt = fmtPct(q.pct);
  buf.text(x, y, q.symbol, S.cream);
  buf.textRight(right, y, fmtPrice(q.price), S.creamB);
  buf.textRight(right - strWidth(pctTxt) - 2, y, pctTxt, pctStyle(q.pct));
  return y + 1;
}

// ── Composer ──

export function drawComposer(buf: Buffer, r: { x: number; y: number; w: number; h: number }, input: string): void {
  const inner = buf.box(r, {
    title: "Composer", titleStyle: S.muted,
    titleRight: "/ commands · ↵ send · ^C quit", titleRightStyle: S.code,
    border: S.rule,
  });
  if (input) {
    buf.text(inner.x, inner.y, "›", S.gold);
    buf.text(inner.x + 2, inner.y, input, S.cream);
    buf.text(inner.x + 2 + strWidth(input), inner.y, "▏", S.cream);
  } else {
    buf.text(inner.x, inner.y, "›  write a task, or just ask a question…▏", S.dim);
  }
}

// ── Status bar ──

export function drawStatus(buf: Buffer, row: number, width: number, st: AppState): void {
  const left = `\x1b[1;38;2;212;175;55mWhyJ\x1b[0m\x1b[38;2;110;106;96m · ${st.model} · $${st.cost.toFixed(2)} · Activity: ${st.activity}\x1b[0m`;
  buf.text(0, row, left);
  const cacheColor = st.cacheHit >= 90 ? "#6FB06A" : st.cacheHit >= 70 ? "#D4AF37" : "#CF5B4A";
  const cacheText = `Cache ${st.cacheHit.toFixed(1)}% hit`;
  buf.textRight(width - 1, row, `\x1b[38;2;${hexRgb(cacheColor)}m${cacheText}\x1b[0m`);
}

// ── Helpers ──

function hexRgb(hex: string): string {
  const n = hex.replace("#", "");
  return `${parseInt(n.slice(0, 2), 16)};${parseInt(n.slice(2, 4), 16)};${parseInt(n.slice(4, 6), 16)}`;
}

export function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
