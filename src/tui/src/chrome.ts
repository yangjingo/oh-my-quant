import { Buffer, strWidth, truncate } from "./buffer.ts";
import { S, HEADER_H, COMPOSER_H, STATUS_H, DIVIDER_CHAR, UI_DENSITY, GOLD_HIGHLIGHT, GOLD, CASH_DARK, CASH_WARM, STEP_DIM } from "./styles.ts";
import { mixHex } from "./theme.ts";
import type { ComposerSuggestion } from "./input.ts";
import type { AppState } from "./types.ts";

const STEPS = "▁▃▅▇█";

function stepColor(activity: string, i: number, n: number): string {
  if (activity === "ready") {
    const t = n > 0 ? i / n : 0;
    return mixHex(CASH_DARK, GOLD, t);
  }
  const speed = activity === "starting" ? 500 : activity === "thinking" || activity === "compacting" ? 300 : 200;
  const pos = Math.floor(Date.now() / speed) % (n * 2);
  const wave = pos < n ? pos : n * 2 - pos;
  if (i === wave) return GOLD;
  if (i === wave - 1 || i === wave + 1) return CASH_WARM;
  return STEP_DIM;
}

export function drawHeader(buf: Buffer, st: AppState): void {
  const C = buf.w;
  const n = STEPS.length - 1;
  for (let i = 0; i < STEPS.length; i++) {
    buf.set(2 + i, 0, STEPS[i], { fg: stepColor(st.activity, i, n) });
  }
  const logoX = 2 + STEPS.length + 1;
  buf.text(logoX, 0, "WhyJ Quant", UI_DENSITY === "compact" ? S.cream : S.creamB);
  if (UI_DENSITY === "compact") {
    buf.text(logoX + 11, 0, `v${st.version}`, S.dim);
    buf.hline(0, 1, C, DIVIDER_CHAR, S.rule);
    return;
  }
  buf.text(2 + STEPS.length + 2, 1, `v${st.version}`, S.dim);
  buf.hline(0, 2, C, DIVIDER_CHAR, S.rule);
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
    titleRight: isCmd
      ? "↑↓ select · ↹ accept"
      : queueCount > 0
        ? `${queueCount} queued · ↵ send · / commands`
        : "Shift+drag copy · / commands · ↵ send",
    titleRightStyle: S.code,
    border: S.rule,
  });

  let row = inner.y;
  if (st.composerStatus) {
    const prefix = st.composerStatus.kind === "error" ? "ERR " : "";
    const style = st.composerStatus.kind === "error" ? S.goldB : S.cream;
    buf.text(inner.x, row, truncate(prefix + st.composerStatus.text.replace(/\s+/g, " "), inner.w), style);
    row++;
  }

  const inputRow = row;
  if (input) {
    if (isCmd) {
      buf.text(inner.x, inputRow, "/", S.goldB);
      buf.text(inner.x + 1, inputRow, input.slice(1), S.gold);
      buf.text(inner.x + 1 + strWidth(input.slice(1)), inputRow, "▏", S.gold);
    } else {
      buf.text(inner.x, inputRow, "›", S.gold);
      buf.text(inner.x + 2, inputRow, input, S.cream);
      buf.text(inner.x + 2 + strWidth(input), inputRow, "▏", S.cream);
    }
  } else {
    buf.text(inner.x, inputRow, "›", S.gold);
    const hint = "write a task, or just ask a question…";
    buf.text(inner.x + 2, inputRow, truncate(`${hint}▏`, inner.w - 2), S.dim);
  }
  row++;

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
  buf.hline(0, row - 1, width, DIVIDER_CHAR, S.rule);
  const source = st.source || "";
  const portfolio = st.activePortfolio ? ` · ${st.activePortfolio}` : "";
  const lead = `◆ ${st.model}`;
  const tail = ` · ${source}${portfolio}`;
  buf.text(0, row, lead, S.gold);
  buf.text(strWidth(lead), row, tail, S.dim);
}

export { HEADER_H, COMPOSER_H, STATUS_H };
