import { Buffer, charWidth, strWidth, truncate } from "./buffer.ts";
import { S, HEADER_H, COMPOSER_H, STATUS_H, DIVIDER_CHAR, GOLD_HIGHLIGHT } from "./styles.ts";
import { BRAND_MARK_ROWS, BRAND_NAME, thinkingBrandMark } from "./brand.ts";
import type { ComposerSuggestion } from "./input.ts";
import type { AppState } from "../../../src/types/ui.ts";

export function drawHeader(buf: Buffer, st: AppState, now = Date.now()): void {
  const C = buf.w;
  const mark = st.activity === "thinking" ? thinkingBrandMark(now - (st.researchStartedAt ?? 0)) : BRAND_MARK_ROWS[0];
  buf.text(2, 0, mark, S.gold);
  const logoX = 2 + strWidth(BRAND_MARK_ROWS[0]) + 1;
  buf.text(logoX, 0, BRAND_NAME, S.creamB);
  buf.text(logoX + strWidth(BRAND_NAME) + 1, 0, `v${st.version}`, S.dim);
  buf.hline(0, HEADER_H - 1, C, DIVIDER_CHAR, S.rule);
}

export function drawComposer(
  buf: Buffer,
  r: { x: number; y: number; w: number; h: number },
  st: AppState,
  input: string,
  suggestions: ComposerSuggestion[] = [],
  selectedIdx: number = -1,
  _conversation?: { x: number; w: number },
): void {
  const isCmd = input.startsWith("/");
  const queue = st.composerQueue ?? [];
  const queueCount = queue.length;
  const inner = buf.box(r, {
    title: "⌘ Composer",
    titleStyle: S.muted,
    titleRight: st.activity === "thinking" || st.activity === "running tool"
      ? `${st.activity === "running tool" ? "工具" : "推理"}${st.researchStartedAt ? ` ${Math.max(0, Math.floor((Date.now() - st.researchStartedAt) / 1000))}s` : ""}${st.researchInterruptKey ? ` · ${st.researchInterruptKey} 停止` : ""} · ↵ 排队`
      : isCmd || suggestions.length > 0
      ? "↑↓ select · ↹ accept"
      : queueCount > 0
        ? `${queueCount} queued · ↵ send · / commands`
        : "Shift+drag copy · ↵ send",
    titleRightStyle: S.code,
    border: S.rule,
  });
  // Accent the visible send/queue glyph without recoloring the helper text.
  for (let x = Math.max(0, r.x); x < Math.min(buf.w, r.x + r.w); x++) {
    if (buf.cells[r.y * buf.w + x]?.ch === "↵") buf.set(x, r.y, "↵", S.goldB);
  }

  let row = inner.y;
  if (st.composerStatus) {
    const prefix = st.composerStatus.kind === "error" ? "ERR " : "";
    const style = st.composerStatus.kind === "error" ? S.goldB : S.cream;
    buf.text(inner.x, row, truncate(prefix + st.composerStatus.text.replace(/\s+/g, " "), inner.w), style);
    row++;
  }

  const inputRow = row;
  if (input) {
    const inset = isCmd ? 0 : 2;
    const width = Math.max(1, inner.w - inset);
    const lines: string[] = [];
    let line = "", cells = 0;
    const displayInput = input.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
    for (const ch of displayInput + "▏") {
      if (ch === "\n") { lines.push(line); line = ""; cells = 0; continue; }
      const size = charWidth(ch);
      if (cells + size > width && line) { lines.push(line); line = ""; cells = 0; }
      line += ch;
      cells += size;
    }
    lines.push(line);
    const available = Math.max(0, inner.y + inner.h - row);
    if (!available) return;
    // Keep the insertion point visible while a long paste scrolls inside Composer.
    const visible = lines.slice(-available);
    if (!isCmd) buf.text(inner.x, row, lines.length > available ? "…" : "›", S.goldB);
    for (const text of visible) buf.text(inner.x + inset, row++, text, isCmd ? S.gold : S.cream, width);
    if (isCmd && lines.length <= available) buf.text(inner.x, inputRow, "/", S.goldB);
  } else {
    buf.text(inner.x, inputRow, "›", S.goldB);
    const hint = "Ask anything · @ to reference · / for commands";
    buf.text(inner.x + 2, inputRow, "▏", S.cream);
    buf.text(inner.x + 3, inputRow, truncate(hint, Math.max(0, inner.w - 3)), S.dim, Math.max(0, inner.w - 3));
    row++;
  }

  const remainingRows = Math.max(0, inner.y + inner.h - row);
  if (suggestions.length > 0) {
    const visibleRows = Math.min(suggestions.length, remainingRows, 8);
    if (visibleRows >= 1) {
      const start = Math.max(0, Math.min(selectedIdx - Math.floor(visibleRows / 2), suggestions.length - visibleRows));
      const visible = suggestions.slice(start, start + visibleRows);
      for (let i = 0; i < visible.length; i++) {
        const globalIdx = start + i;
        const active = globalIdx === selectedIdx;
        const item = visible[i];
        const prefix = active ? "> " : "  ";
        const style = active ? { fg: GOLD_HIGHLIGHT, bold: true } : S.dim;
        buf.text(inner.x, row + i, truncate(`${prefix}${item.label}`, inner.w), style);
      }
      const overflow = suggestions.length - visibleRows;
      if (overflow > 0 && row + visibleRows < inner.y + inner.h) {
        buf.text(inner.x, row + visibleRows, truncate(`  … ${overflow} more`, inner.w), S.dim);
      }
      return;
    }
  }

  const showQueueRows = Math.min(queueCount, remainingRows);
  const queueOverflow = queueCount - showQueueRows;
  for (let i = 0; i < showQueueRows; i++) {
    const item = queue[i];
    const prefix = `[${i + 1}] `;
    buf.text(inner.x, row, truncate(`${prefix}${item}`, inner.w), i === 0 ? S.cream : S.dim);
    row++;
  }
  if (queueOverflow > 0 && row < inner.y + inner.h) {
    buf.text(inner.x, row, truncate(`… +${queueOverflow} more`, inner.w), S.dim);
  }
}

export function drawStatus(buf: Buffer, row: number, width: number, st: AppState): void {
  width = Math.min(width, buf.w);
  if (width <= 0) return;
  let x = st.model ? buf.text(0, row, "◈ ", S.cream, width, width) : 0;
  const modelLimit = Math.max(0, Math.min(width - x, Math.max(12, Math.floor(width * 0.45)) - x));
  x = buf.text(x, row, modelLimit > 0 ? truncate(st.model, modelLimit) : "", S.muted, width - x, width);
  const displayedPortfolio = st.panel.find(section => section.kind === "group" || section.kind === "holdings")?.title ?? st.activePortfolio;
  for (const [value, style] of [[st.source, S.muted], [displayedPortfolio, S.cream]] as const) {
    if (!value) continue;
    const separator = x > 0 ? " · " : "";
    if (strWidth(separator + value) > width - x) continue;
    x = buf.text(x, row, separator, S.muted, width - x, width);
    x = buf.text(x, row, value, style, width - x, width);
  }
}

export { HEADER_H, COMPOSER_H, STATUS_H };





