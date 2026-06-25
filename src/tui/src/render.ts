/**
 * Region renderers for the r2 full-screen docked TUI.
 * Each function is pure: (Buffer, Rect, AppState) → void.
 */
import { Buffer, truncate, sanitizeTerminalText, charWidth } from "./buffer.ts";
import type { Style } from "./buffer.ts";
import { S, HEADER_H, COMPOSER_H, STATUS_H, DIVIDER_CHAR, CANVAS } from "./styles.ts";
import { fmtElapsed } from "./format.ts";
import { drawHeader as drawHeaderChrome, drawComposer as drawComposerChrome, drawStatus as drawStatusChrome } from "./chrome.ts";
import type { AppState, Layout, UIMessage, PanelSection } from "./types.ts";
import { getQuotes } from "../../quant/insight.ts";
import { buildConversationLines, type RenderLine } from "./render-lines.ts";
import { buildOverviewLines, buildOverviewView, overviewContentHeight, overviewMaxScrollTop } from "./overview-render.ts";
import { drawLoadingOverlay, thinkingBannerStyle } from "./loading-overlay.ts";
import {
  conversationPanelInner,
  isConversationCellSelected,
  type ConversationSelection,
  type ConversationView,
} from "./selection.ts";

/** Lines scrolled up from the bottom (0 = stick to latest). */
export function conversationMaxScrollUp(msgs: UIMessage[], innerW: number, innerH: number, reservedBottomRows: number = 0): number {
  const lines = buildConversationLines(msgs, innerW);
  return Math.max(0, lines.length - Math.max(0, innerH - reservedBottomRows));
}

/** Cap holdings/quotes rows to `max` total across all sections. */
export function capSections(sections: PanelSection[], max: number): PanelSection[] {
  let remaining = max;
  return sections.map(sec => {
    // Market quotes and keyvalue always visible
    if (sec.kind === "quotes" || sec.kind === "keyvalue") return sec;
    if (remaining <= 0) return null;
    if (sec.rows.length <= remaining) {
      remaining -= sec.rows.length;
      return sec;
    }
    const capped = { ...sec, rows: sec.rows.slice(0, remaining) };
    remaining = 0;
    return capped;
  }).filter((s): s is PanelSection => s !== null);
}


export function layout(C: number, R: number, showPortfolioPanel?: boolean): Layout {
  const panelW = Math.min(48, Math.max(36, Math.floor(C * 0.312)));
  const showPanel = C >= 78 && showPortfolioPanel !== false;
  const mainH = R - HEADER_H - COMPOSER_H - STATUS_H;
  const mainW = showPanel ? C - panelW : C;
  return {
    mainPane:     { x: 0, y: HEADER_H, w: mainW, h: mainH },
    conversation: { x: 1, y: HEADER_H, w: mainW - 2, h: mainH },
    portfolio:    { x: mainW, y: HEADER_H, w: panelW, h: mainH },
    composer:     { x: 0, y: R - COMPOSER_H - STATUS_H, w: C, h: COMPOSER_H },
    statusRow:    R - 1,
    showPanel,
  };
}

export const drawHeader = drawHeaderChrome;

// ── Conversation ──

function conversationClipEnd(mainPane: { x: number; w: number }): number {
  return mainPane.x + mainPane.w;
}

export function buildConversationView(
  msgs: UIMessage[],
  r: { x: number; y: number; w: number; h: number },
  scrollUpFromBottom: number,
  mainPane?: { x: number; y: number; w: number; h: number },
  reservedBottomRows: number = 0,
): ConversationView {
  const panelRect = mainPane ?? r;
  const inner = conversationPanelInner(panelRect);
  const lines = buildConversationLines(msgs, inner.w);
  const visibleH = Math.max(0, inner.h - reservedBottomRows);
  const maxUp = Math.max(0, lines.length - visibleH);
  const up = Math.min(Math.max(0, scrollUpFromBottom), maxUp);
  const startLineIdx = Math.max(0, lines.length - visibleH - up);
  const visibleLineCount = Math.min(visibleH, Math.max(0, lines.length - startLineIdx));
  const topPadding = Math.max(0, visibleH - visibleLineCount);
  return { inner, clipEnd: conversationClipEnd(panelRect), lines, startLineIdx, topPadding, visibleH };
}

const SELECTION_STYLE: Style = S.selection;

function drawSelectableLine(
  buf: Buffer,
  x: number,
  y: number,
  line: RenderLine,
  maxW: number,
  clipEnd: number,
  lineIdx: number,
  selection?: ConversationSelection | null,
): void {
  const parts = line.segments ?? [{ text: line.text, style: line.style ?? {} }];
  let cx = x;
  let used = 0;
  for (const seg of parts) {
    for (const ch of seg.text) {
      const cw = charWidth(ch);
      if (used + cw > maxW) return;
      if (cx + cw > clipEnd) return;
      const baseStyle = seg.style ?? line.style ?? {};
      const cellStyle = isConversationCellSelected(lineIdx, used, selection) ? SELECTION_STYLE : baseStyle;
      buf.set(cx, y, ch, cellStyle, clipEnd);
      cx += cw;
      used += cw;
    }
  }
}

function drawConversationLine(
  buf: Buffer,
  x: number,
  y: number,
  text: string,
  style: Style,
  maxW: number,
  clipEnd: number,
  lineIdx: number,
  selection?: ConversationSelection | null,
): void {
  drawSelectableLine(buf, x, y, { text, style }, maxW, clipEnd, lineIdx, selection);
}

export function drawConversation(
  buf: Buffer,
  r: { x: number; y: number; w: number; h: number },
  msgs: UIMessage[],
  activity: string = "ready",
  mainPane?: { x: number; y: number; w: number; h: number },
  scrollUpFromBottom: number = 0,
  selection?: ConversationSelection | null,
): void {
  const panelRect = mainPane ?? r;
  const clipEnd = conversationClipEnd(panelRect);
  buf.fillRect(panelRect, { fg: CANVAS });
  const thinkBarH = activeConversationStatusRows(activity, msgs);
  const view = buildConversationView(msgs, r, scrollUpFromBottom, mainPane, thinkBarH);
  const scrollHint = scrollUpFromBottom > 0 ? "···" : undefined;
  const inner = buf.box(panelRect, {
    title: "◉ Analyzing",
    titleStyle: S.creamB,
    titleRight: scrollHint,
    titleRightStyle: S.dim,
    border: S.rule,
    clipEnd,
  });

  if (msgs.length === 0 && activity !== "ready" && activity !== "compacting") {
    drawLoadingOverlay(buf, inner, activity, clipEnd, LOADING_INSIGHTS, activityVerb);
    return;
  }

  const visibleH = view.visibleH ?? inner.h;
  const topPadding = view.topPadding ?? 0;
  for (let i = view.startLineIdx; i < view.lines.length && i - view.startLineIdx < visibleH; i++) {
    const line = view.lines[i];
    const y = inner.y + topPadding + i - view.startLineIdx;
    drawSelectableLine(buf, inner.x, y, line, inner.w, clipEnd, i, selection);
  }

  if (thinkBarH > 0) {
    const statusY = inner.y + inner.h - thinkBarH;
    const elapsed = latestThinkingStartedAt(msgs);
    const tokenCount = activeThinkingTokenCount(msgs);
    const meta = [
      elapsed ? fmtShortElapsed(Date.now() - elapsed) : undefined,
      `${tokenCount.toLocaleString()} tokens`,
    ].filter(Boolean).join(" · ");
    const status = truncate(`${oraFrame()} ${activityLabel(activity)}... (${meta})`, inner.w - 2);
    buf.text(inner.x + 1, statusY, status, thinkingBannerStyle(), inner.w - 2, inner.x + inner.w);
    if (thinkBarH > 1) {
      const tip = truncate(`Tip: ${conversationTip(msgs)}`, inner.w - 4);
      buf.text(inner.x + 3, statusY + 1, tip, S.dim, inner.w - 4, inner.x + inner.w);
    }
  }
}

export function activeConversationStatusRows(activity: string, msgs: UIMessage[], innerH: number = 2): number {
  if (activity === "compacting") return Math.min(2, innerH);
  return activity !== "ready" && msgs.length > 0 ? Math.min(2, innerH) : 0;
}

const LOADING_INSIGHTS = getQuotes();
const ORA_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function oraFrame(): string {
  return ORA_FRAMES[Math.floor(Date.now() / 80) % ORA_FRAMES.length];
}

function thinkingQuote(): string {
  const idx = Math.floor(Date.now() / 5000) % LOADING_INSIGHTS.length;
  const q = LOADING_INSIGHTS[idx];
  return `"${q.quote}" — ${q.author}`;
}

function conversationTip(msgs: UIMessage[]): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    if (msg.role === "error" && msg.text?.trim()) {
      return oneLine(`Error: ${msg.text}`);
    }
    if (msg.role === "tool" && msg.tool?.status === "error" && msg.tool.result?.trim()) {
      return oneLine(`Error: ${msg.tool.result}`);
    }
  }
  return thinkingQuote();
}

function latestThinkingStartedAt(msgs: UIMessage[]): number | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    if (msg.role === "thinking" && msg.thinkingLive && msg.startedAt) return msg.startedAt;
  }
  return undefined;
}

function activeThinkingTokenCount(msgs: UIMessage[]): number {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    if (msg.role === "thinking" && msg.thinkingLive) return estimateTokens(msg.text ?? "");
  }
  return 0;
}

function estimateTokens(text: string): number {
  const compact = text.trim();
  if (!compact) return 0;
  return Math.max(1, Math.ceil(compact.length / 4));
}

function fmtShortElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}m ${seconds}s`;
}

function oneLine(text: string): string {
  return sanitizeTerminalText(text).replace(/\s+/g, " ").trim();
}

function activityLabel(activity: string): string {
  switch (activity) {
    case "starting": return "Starting";
    case "running tool": return "Running tool";
    case "compacting": return "Compacting";
    case "thinking": return "Thinking";
    default: return "Working";
  }
}

function activityVerb(activity: string): string {
  switch (activity) {
    case "compacting": return "compacting";
    case "running tool": return "running tools";
    case "starting": return "starting";
    case "thinking": return "thinking";
    default: return "working";
  }
}

// ── Portfolio dock ──

export function drawPortfolio(
  buf: Buffer,
  r: { x: number; y: number; w: number; h: number },
  sections: PanelSection[],
  loading: boolean,
  scrollFromTop: number = 0,
  selection?: ConversationSelection | null,
): void {
  const capped = sections;
  const innerPreview = { x: r.x + 2, y: r.y + 1, w: r.w - 4, h: r.h - 2 };
  const maxTop = overviewMaxScrollTop(capped, innerPreview.h);
  const top = Math.min(Math.max(0, scrollFromTop), maxTop);
  buf.fillRect(r, { fg: CANVAS });
  const inner = buf.box(r, {
    title: "◫ Overview", titleStyle: S.creamB,
    titleRight: maxTop > 0 ? `scroll ${top + 1}/${maxTop + 1}` : undefined,
    titleRightStyle: S.dim, border: S.rule,
  });

  if (loading && sections.length === 0) {
    const frames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
    const frame = frames[Math.floor(Date.now() / 80) % frames.length];
    const color = thinkingBannerStyle().fg!;
    buf.text(inner.x + 2, inner.y + 2, frame, { fg: color, bold: true });
    buf.text(inner.x + 4, inner.y + 2, "Waiting for market data...", { fg: color });
    return;
  }

  const view = buildOverviewView(capped, r, scrollFromTop);
  for (let i = view.startLineIdx; i < view.lines.length && i - view.startLineIdx < inner.h; i++) {
    const line = view.lines[i];
    const y = inner.y + i - view.startLineIdx;
    drawSelectableLine(buf, inner.x, y, line, inner.w, view.clipEnd, i, selection);
  }
}

export const drawComposer = drawComposerChrome;
export const drawStatus = drawStatusChrome;
export { fmtElapsed };
export { buildOverviewLines, buildOverviewView, overviewContentHeight, overviewMaxScrollTop };
