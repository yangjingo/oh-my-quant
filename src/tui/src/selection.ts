import { strWidth } from "./buffer.ts";
import type { Style } from "./buffer.ts";
import type { UIMessage } from "./types.ts";

export interface ConversationPoint {
  lineIdx: number;
  col: number;
}

export interface ConversationSelection {
  anchor: ConversationPoint;
  cursor: ConversationPoint;
}

export interface ConversationLine {
  text: string;
  style?: Style;
  segments?: { text: string; style?: Style }[];
}

export interface ConversationView {
  inner: { x: number; y: number; w: number; h: number };
  clipEnd: number;
  lines: ConversationLine[];
  startLineIdx: number;
  topPadding?: number;
  visibleH?: number;
}

export function conversationPanelInner(
  panelRect: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  return { x: panelRect.x + 2, y: panelRect.y + 1, w: panelRect.w - 4, h: panelRect.h - 2 };
}

export function conversationPointFromScreen(
  col: number,
  row: number,
  view: ConversationView,
): ConversationPoint | null {
  const { inner, lines, startLineIdx } = view;
  if (col < inner.x || col >= inner.x + inner.w) return null;
  if (row < inner.y || row >= inner.y + inner.h) return null;
  const screenLine = row - inner.y - (view.topPadding ?? 0);
  if (screenLine < 0 || screenLine >= (view.visibleH ?? inner.h)) return null;
  const lineIdx = startLineIdx + screenLine;
  if (lineIdx < 0 || lineIdx >= lines.length) return null;
  const line = lines[lineIdx]?.text ?? "";
  const colInLine = Math.max(0, Math.min(col - inner.x, strWidth(line)));
  return { lineIdx, col: colInLine };
}

/** During drag, clamp pointer to panel edges so selection can extend to line boundaries. */
export function conversationPointFromScreenClamped(
  col: number,
  row: number,
  view: ConversationView,
): ConversationPoint | null {
  const { inner } = view;
  const clampedCol = Math.max(inner.x, Math.min(col, inner.x + inner.w - 1));
  const clampedRow = Math.max(inner.y, Math.min(row, inner.y + inner.h - 1));
  return conversationPointFromScreen(clampedCol, clampedRow, view);
}

function normalizeSelection(sel: ConversationSelection): [ConversationPoint, ConversationPoint] {
  const a = sel.anchor;
  const b = sel.cursor;
  if (a.lineIdx < b.lineIdx || (a.lineIdx === b.lineIdx && a.col <= b.col)) return [a, b];
  return [b, a];
}

function sliceLineByDisplayCols(text: string, startCol: number, endCol: number): string {
  if (endCol <= startCol) return "";
  let out = "";
  let w = 0;
  for (const ch of text) {
    const cw = strWidth(ch);
    const next = w + cw;
    if (next <= startCol) {
      w = next;
      continue;
    }
    if (w >= endCol) break;
    out += ch;
    w = next;
  }
  return out;
}

export function extractConversationSelection(view: ConversationView, sel: ConversationSelection): string {
  const [start, end] = normalizeSelection(sel);
  const parts: string[] = [];
  for (let lineIdx = start.lineIdx; lineIdx <= end.lineIdx; lineIdx++) {
    const text = view.lines[lineIdx]?.text ?? "";
    if (lineIdx === start.lineIdx && lineIdx === end.lineIdx) {
      parts.push(sliceLineByDisplayCols(text, start.col, end.col));
    } else if (lineIdx === start.lineIdx) {
      parts.push(sliceLineByDisplayCols(text, start.col, strWidth(text)));
    } else if (lineIdx === end.lineIdx) {
      parts.push(sliceLineByDisplayCols(text, 0, end.col));
    } else {
      parts.push(text);
    }
  }
  return parts.join("\n").replace(/\s+$/g, "");
}

export function isConversationCellSelected(
  lineIdx: number,
  col: number,
  sel: ConversationSelection | null | undefined,
): boolean {
  if (!sel) return false;
  const [start, end] = normalizeSelection(sel);
  if (lineIdx < start.lineIdx || lineIdx > end.lineIdx) return false;
  if (start.lineIdx === end.lineIdx) return col >= start.col && col < end.col;
  if (lineIdx === start.lineIdx) return col >= start.col;
  if (lineIdx === end.lineIdx) return col < end.col;
  return true;
}

export function lastAssistantPlainText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "assistant" && msg.text?.trim()) return msg.text.trim();
  }
  return "";
}
