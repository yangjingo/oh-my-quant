/**
 * Region renderers for the r2 full-screen docked TUI.
 * Each function is pure: (Buffer, Rect, AppState) → void.
 */
import { Buffer, wrap, strWidth, truncate, sanitizeTerminalText, charWidth } from "./buffer.ts";
import type { Style } from "./buffer.ts";
import { S, pctStyle, fmtPct, HEADER_H, COMPOSER_H, STATUS_H, DIVIDER_CHAR, CANVAS, UI_DENSITY, OVERVIEW_ROW_H, OVERVIEW_SECTION_H, GOLD_HIGHLIGHT } from "./styles.ts";
import type { ComposerSuggestion } from "./input.ts";
import type { AppState, Layout, UIMessage, PanelSection, Holding, Quote } from "./types.ts";
import { formatToolLine } from "../../tools/catalog.ts";
import { getQuotes } from "../../quant/insight.ts";
import {
  conversationPanelInner,
  isConversationCellSelected,
  type ConversationSelection,
  type ConversationView,
} from "./selection.ts";

interface RenderLine {
  text: string;
  style?: Style;
  segments?: { text: string; style?: Style }[];
}

type OverviewBlock =
  | { kind: "section-header"; title: string }
  | { kind: "group-header"; title: string; collapsed: boolean; symbolCount: number }
  | { kind: "holding"; row: Holding }
  | { kind: "quote"; row: Quote }
  | { kind: "keyvalue"; row: { label: string; value: string } }
  | { kind: "gap" };

function panelInner(r: { x: number; y: number; w: number; h: number }) {
  return { x: r.x + 2, y: r.y + 1, w: r.w - 4, h: r.h - 2 };
}

function buildConversationLines(msgs: UIMessage[], width: number): RenderLine[] {
  const lines: RenderLine[] = [];
  for (const msg of msgs) {
    lines.push(...renderMsg(msg, width));
    lines.push({ text: "" });
  }
  return lines;
}

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

function buildOverviewBlocks(sections: PanelSection[]): OverviewBlock[] {
  const blocks: OverviewBlock[] = [];
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (sec.kind === "group") {
      blocks.push({ kind: "group-header", title: sec.title, collapsed: sec.collapsed, symbolCount: sec.rows.length });
      if (!sec.collapsed) {
        for (const row of sec.rows) blocks.push({ kind: "holding", row });
      }
    } else {
      blocks.push({ kind: "section-header", title: sec.title });
      if (sec.kind === "holdings") {
        for (const row of sec.rows) blocks.push({ kind: "holding", row });
      } else if (sec.kind === "quotes") {
        for (const row of sec.rows) blocks.push({ kind: "quote", row });
      } else if (sec.kind === "keyvalue") {
        for (const row of sec.rows) blocks.push({ kind: "keyvalue", row });
      }
    }
    if (i < sections.length - 1) blocks.push({ kind: "gap" });
  }
  return blocks;
}

function overviewBlockHeight(block: OverviewBlock): number {
  switch (block.kind) {
    case "section-header": return OVERVIEW_SECTION_H;
    case "group-header": return OVERVIEW_SECTION_H;
    case "quote":
    case "holding": return OVERVIEW_ROW_H;
    case "keyvalue": return 1;
    case "gap": return 1;
  }
}

export function overviewContentHeight(sections: PanelSection[]): number {
  return buildOverviewBlocks(sections).reduce((n, b) => n + overviewBlockHeight(b), 0);
}

/** Max scroll offset from top of overview content. */
function overviewBlockToLines(block: OverviewBlock, w: number): RenderLine[] {
  switch (block.kind) {
    case "section-header": {
      const lines: RenderLine[] = [
        {
          text: `▎ ${block.title}`,
          style: S.creamB,
          segments: [
            { text: "▎ ", style: S.gold },
            { text: block.title, style: S.creamB },
          ],
        },
        { text: DIVIDER_CHAR.repeat(Math.max(0, w)), style: S.rule },
      ];
      while (lines.length < overviewBlockHeight(block)) lines.push({ text: "" });
      return lines;
    }
    case "group-header": {
      const indicator = block.collapsed ? "▶" : "▼";
      const countTxt = `${block.symbolCount}`;
      const titleText = `${indicator} ${block.title}`;
      const lines: RenderLine[] = [
        {
          text: `▎ ${titleText}`,
          style: S.creamB,
          segments: [
            { text: "▎ ", style: S.gold },
            { text: indicator, style: S.dim },
            { text: ` ${block.title}`, style: S.creamB },
          ],
        },
        {
          text: DIVIDER_CHAR.repeat(Math.max(0, w)),
          style: S.rule,
          segments: [
            { text: DIVIDER_CHAR.repeat(Math.max(0, w - countTxt.length - 1)), style: S.rule },
            { text: ` ${countTxt}`, style: S.dim },
          ],
        },
      ];
      while (lines.length < overviewBlockHeight(block)) lines.push({ text: "" });
      return lines;
    }
    case "holding":
    case "quote":
      return overviewRowLines(block.row, w);
    case "keyvalue": {
      const gap = Math.max(1, w - strWidth(block.row.label) - strWidth(block.row.value));
      const pad = " ".repeat(gap);
      return [{
        text: `${block.row.label}${pad}${block.row.value}`,
        segments: [
          { text: block.row.label, style: S.code },
          { text: `${pad}${block.row.value}`, style: S.dim },
        ],
      }];
    }
    case "gap":
      return [{ text: "" }];
  }
}

function overviewRowLines(row: Holding, w: number): RenderLine[] {
  const pctTxt = fmtPct(row.pct);
  const code = row.code.split(".")[0] || row.code;
  const codePart = code.padEnd(8);
  const pctPart = pctTxt.padStart(8);
  const nameW = Math.max(0, w - strWidth(codePart) - strWidth(pctPart));
  const namePart = truncate(row.name, nameW);
  const pad = " ".repeat(Math.max(0, nameW - strWidth(namePart)));
  return [{
    text: `${codePart}${namePart}${pad}${pctPart}`,
    segments: [
      { text: codePart, style: S.code },
      { text: namePart, style: S.cream },
      { text: pad, style: {} },
      { text: pctPart, style: pctStyle(row.pct) },
    ],
  }];
}

export function buildOverviewLines(sections: PanelSection[], innerW: number): RenderLine[] {
  if (sections.length === 0) {
    return [
      { text: "No tool result yet.", style: S.dim },
      { text: "Run a slash command or ask AI", style: S.dim },
      { text: "to update this panel.", style: S.dim },
    ];
  }
  const lines: RenderLine[] = [];
  for (const block of buildOverviewBlocks(sections)) {
    lines.push(...overviewBlockToLines(block, innerW));
  }
  return lines;
}

/** Max scroll offset from top of overview content. */
export function overviewMaxScrollTop(sections: PanelSection[], innerH: number): number {
  return Math.max(0, overviewContentHeight(sections) - innerH);
}

export function buildOverviewView(
  sections: PanelSection[],
  r: { x: number; y: number; w: number; h: number },
  scrollFromTop: number = 0,
): ConversationView {
  const inner = panelInner(r);
  const lines = buildOverviewLines(sections, inner.w);
  const maxTop = Math.max(0, lines.length - inner.h);
  const top = Math.min(Math.max(0, scrollFromTop), maxTop);
  return { inner, clipEnd: r.x + r.w, lines, startLineIdx: top };
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

// ── Header ──

const STEPS = "▁▃▅▇█";
const GOLD_DARK: [number, number, number] = [212, 175, 55];
const GOLD_LIGHT: [number, number, number] = [240, 215, 122];
const GOLD_WARM: [number, number, number] = [226, 190, 77];

const DIM_STEP: [number, number, number] = [60, 55, 48];

function stepColor(activity: string, i: number, n: number): [number, number, number] {
  if (activity === "ready") {
    const t = n > 0 ? i / n : 0;
    return [
      Math.round(GOLD_DARK[0] + (GOLD_LIGHT[0] - GOLD_DARK[0]) * t),
      Math.round(GOLD_DARK[1] + (GOLD_LIGHT[1] - GOLD_DARK[1]) * t),
      Math.round(GOLD_DARK[2] + (GOLD_LIGHT[2] - GOLD_DARK[2]) * t),
    ];
  }
  // Animated wave: one lit step sweeps across, ora-style
  const speed = activity === "starting" ? 500 : activity === "thinking" || activity === "compacting" ? 300 : 200;
  const pos = Math.floor(Date.now() / speed) % (n * 2);
  const wave = pos < n ? pos : n * 2 - pos; // bounce back
  if (i === wave) return GOLD_LIGHT;
  if (i === wave - 1 || i === wave + 1) return GOLD_WARM;
  return DIM_STEP;
}

export function drawHeader(buf: Buffer, st: AppState): void {
  const C = buf.w;
  const n = STEPS.length - 1;
  for (let i = 0; i < STEPS.length; i++) {
    const [r, g, b] = stepColor(st.activity, i, n);
    buf.set(2 + i, 0, STEPS[i], { fg: `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}` });
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

const SELECTION_STYLE: Style = { fg: "#0D0B0A", bg: "#C9A227", bold: true };

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

  if (msgs.length === 0 && activity !== "ready") {
    drawLoadingOverlay(buf, inner, activity, clipEnd);
    return;
  }

  const visibleH = view.visibleH ?? inner.h;
  const topPadding = view.topPadding ?? 0;
  for (let i = view.startLineIdx; i < view.lines.length && i - view.startLineIdx < visibleH; i++) {
    const line = view.lines[i];
    const y = inner.y + topPadding + i - view.startLineIdx;
    drawConversationLine(buf, inner.x, y, line.text, line.style ?? {}, inner.w, clipEnd, i, selection);
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
  return activity !== "ready" && msgs.length > 0 ? Math.min(2, innerH) : 0;
}

const ORA_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const LOADING_INSIGHTS = getQuotes();

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

function thinkingBannerStyle(): Style {
  return { fg: stepHex(Date.now() / 500), bold: true };
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

function stepHex(phase: number): string {
  const t = (Math.sin(phase) + 1) / 2;
  const r = Math.round(212 + (240 - 212) * t).toString(16).padStart(2, "0");
  const g = Math.round(175 + (215 - 175) * t).toString(16).padStart(2, "0");
  const b = Math.round(55 + (122 - 55) * t).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

function centerInMain(main: { x: number; w: number }, text: string): number {
  const textW = strWidth(text);
  const centerX = main.x + Math.floor(main.w / 2);
  const minX = main.x;
  const maxX = main.x + main.w - textW;
  const ideal = centerX - Math.floor(textW / 2);
  return Math.max(minX, Math.min(ideal, maxX));
}

function drawLoadingOverlay(
  buf: Buffer,
  main: { x: number; y: number; w: number; h: number },
  activity: string,
  clipEnd: number,
): void {
  const t = Date.now() / 1000;
  const TREND = "▁▃▅▇█ WhyJ Quant";
  const n = TREND.length;
  const stepSec = 5;
  const idx = Math.floor(t / stepSec) % LOADING_INSIGHTS.length;
  const insight = LOADING_INSIGHTS[idx];
  const maxLineW = Math.min(main.w - 6, 56);
  const cnLines = wrap(`"${insight.quote}"`, maxLineW);
  const enLines = wrap(insight.en, maxLineW);
  const authorText = `— ${insight.author}`;
  const spinnerLine = ` ${oraFrame()} WhyJ is ${activityVerb(activity)}…`;
  const blockH = 1 + 1 + cnLines.length + enLines.length + 1; // spinner + cn quote + en quote + author

  const minY = main.y;
  const maxY = main.y + main.h - 1;
  const cy = main.y + Math.floor(main.h / 2);
  let textStartY = cy - Math.floor(blockH / 2);
  textStartY = Math.max(minY, Math.min(textStartY, maxY - blockH + 1));

  // Spinner line
  buf.text(centerInMain(main, spinnerLine), textStartY, spinnerLine, S.goldB, main.w, clipEnd);
  textStartY++;

  // Staircase below spinner
  const stairY = textStartY;
  if (stairY >= minY && stairY <= maxY) {
    const stairX = centerInMain(main, TREND);
    for (let i = 0; i < n; i++) {
      const s = (Math.sin(t * 3 + i * 0.6) + 1) / 2;
      const sr = Math.round(60 + (212 - 60) * s).toString(16).padStart(2, "0");
      const sg = Math.round(55 + (175 - 55) * s).toString(16).padStart(2, "0");
      const sb = Math.round(48 + (55 - 48) * s).toString(16).padStart(2, "0");
      buf.set(stairX + i, stairY, TREND[i], { fg: `#${sr}${sg}${sb}`, bold: true }, clipEnd);
    }
  }

  let row = textStartY;
  // Chinese quote
  for (let i = 0; i < cnLines.length; i++) {
    if (row > maxY) break;
    buf.text(centerInMain(main, cnLines[i]), row, cnLines[i], { fg: stepHex(t * 1.5 + i) }, main.w, clipEnd);
    row++;
  }
  // English quote
  for (let i = 0; i < enLines.length; i++) {
    if (row > maxY) break;
    buf.text(centerInMain(main, enLines[i]), row, enLines[i], { fg: "#A09880" }, main.w, clipEnd);
    row++;
  }
  // Author
  if (row <= maxY) {
    buf.text(centerInMain(main, authorText), row, authorText, { fg: "#8A8478", dim: true }, main.w, clipEnd);
  }
}

function renderMsg(msg: UIMessage, width: number): RenderLine[] {
  const lines: RenderLine[] = [];
  const w = Math.max(10, width);
  if (msg.role === "user") {
    const prefix = "▏ ";
    for (const line of wrap(msg.text ?? "", Math.max(1, w - strWidth(prefix)))) {
      lines.push({ text: `▏ ${line}`, style: S.creamB });
    }
  } else if (msg.role === "thinking") {
    const bodyPrefix = "  ";
    const body = sanitizeTerminalText(msg.text ?? "").trim();
    if (body) {
      for (const line of wrap(body, Math.max(1, w - strWidth(bodyPrefix)))) {
        lines.push({ text: `${bodyPrefix}${line}`, style: S.thinking });
      }
    }
  } else if (msg.role === "tool") {
    const t = msg.tool!;
    const status = t.status === "running" ? "●" : t.status === "done" ? "●" : "✗";
    const lineLabel = t.label || formatToolLine(t.name, t.args);
    const elapsed = t.status === "running" ? `  ${fmtElapsed(Date.now() - t.startedAt)}` : "";
    const prefix = `${status} `;
    const body = `${lineLabel}${elapsed}`;
    const wrapped = wrap(body, Math.max(1, w - strWidth(prefix)));
    if (wrapped.length > 0) {
      lines.push({ text: `${prefix}${wrapped[0]}`, style: S.gold });
      for (let i = 1; i < wrapped.length; i++) {
        lines.push({ text: `${" ".repeat(strWidth(prefix))}${wrapped[i]}`, style: S.gold });
      }
    } else {
      lines.push({ text: prefix.trimEnd(), style: S.gold });
    }
    if (t.result) {
      lines.push(...renderToolResultPreview(t.result, w));
    }
  } else if (msg.role === "skill") {
    const sk = msg.skill!;
    const status = sk.status === "running" ? "⚡" : sk.status === "done" ? "⚡" : "✗";
    const elapsed = sk.status === "running" ? `  ${fmtElapsed(Date.now() - sk.startedAt)}` : "";
    const prefix = `${status} `;
    const body = `${sk.label}${elapsed}`;
    const wrapped = wrap(body, Math.max(1, w - strWidth(prefix)));
    if (wrapped.length > 0) {
      lines.push({ text: `${prefix}${wrapped[0]}`, style: S.gold });
      for (let i = 1; i < wrapped.length; i++) {
        lines.push({ text: `${" ".repeat(strWidth(prefix))}${wrapped[i]}`, style: S.gold });
      }
    } else {
      lines.push({ text: prefix.trimEnd(), style: S.gold });
    }
  } else if (msg.role === "error") {
    const prefix = "▏ ERR ";
    for (const line of wrap(msg.text ?? "", Math.max(1, w - strWidth(prefix)))) {
      lines.push({ text: `${prefix}${line}`, style: S.gold });
    }
  } else if (msg.role === "assistant") {
    const prefix = "▏ ";
    for (const line of wrap(msg.text ?? "", Math.max(1, w - strWidth(prefix)))) {
      lines.push({ text: `▏ ${line}`, style: S.cream });
    }
  }
  return lines;
}

function renderToolResultPreview(result: string, width: number): RenderLine[] {
  const maxLines = 8;
  const maxChars = 900;
  const clipped = result.length > maxChars ? `${result.slice(0, maxChars)}...` : result;
  const rawLines = sanitizeTerminalText(clipped).replace(/\r\n/g, "\n").split("\n");
  const diffLike = rawLines.some(isDiffLine);
  const visible = rawLines.slice(0, maxLines);
  const out: RenderLine[] = [];
  for (let i = 0; i < visible.length; i++) {
    const raw = visible[i] || "";
    const prefix = i === 0 ? "  ⎿ " : "    ";
    const style = diffLike ? diffLineStyle(raw) : S.dim;
    const wrapped = wrap(raw, Math.max(1, width - strWidth(prefix)));
    if (wrapped.length === 0) {
      out.push({ text: prefix.trimEnd(), style });
      continue;
    }
    for (let j = 0; j < wrapped.length; j++) {
      out.push({ text: `${j === 0 ? prefix : "    "}${wrapped[j]}`, style });
    }
  }
  if (rawLines.length > maxLines) {
    out.push({ text: `    ... ${rawLines.length - maxLines} more lines`, style: S.dim });
  }
  return out;
}

function isDiffLine(line: string): boolean {
  return /^(diff --git|index |--- |\+\+\+ |@@ |[+-])/.test(line);
}

function diffLineStyle(line: string): Style {
  if (/^\+/.test(line) && !/^\+\+\+ /.test(line)) return S.positive;
  if (/^-/.test(line) && !/^--- /.test(line)) return S.negative;
  if (/^@@ /.test(line)) return S.gold;
  if (/^(diff --git|index |--- |\+\+\+ )/.test(line)) return S.goldDim;
  return S.dim;
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
  const innerPreview = panelInner(r);
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
    const phase = Date.now() / 1000 * 2;
    const color = stepHex(phase);
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

export function drawComposer(
  buf: Buffer,
  r: { x: number; y: number; w: number; h: number },
  st: AppState,
  input: string,
  suggestions: ComposerSuggestion[] = [],
  selectedIdx: number = -1,
  conversation?: { x: number; w: number },
): void {
  const isCmd = input.startsWith("/");
  const queue = st.composerQueue ?? [];
  const queueCount = queue.length;
  const statusRows = st.composerStatus ? 1 : 0;
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

  // Queue rows
  const maxQueueRows = Math.max(0, inner.y + inner.h - row);
  const showQueueRows = Math.min(queueCount, maxQueueRows);
  const queueOverflow = queueCount - showQueueRows;

  for (let i = 0; i < showQueueRows; i++) {
    const item = queue[i];
    const prefix = `[${i + 1}] `;
    buf.text(inner.x, row, truncate(`${prefix}${item}`, inner.w), i === 0 ? S.cream : S.dim);
    row++;
  }
  if (queueOverflow > 0) {
    buf.text(inner.x, row, truncate(`… +${queueOverflow} more`, inner.w), S.dim);
  }

  // Dropdown panel above composer
  if (suggestions.length > 0) {
    const availAbove = r.y;
    const ddH = Math.min(suggestions.length + 2, availAbove, 12);
    if (ddH >= 3) {
      const visibleRows = ddH - 2;
      // Scroll window to keep selectedIdx visible
      const start = Math.max(0, Math.min(selectedIdx - Math.floor(visibleRows / 2), suggestions.length - visibleRows));
      const visible = suggestions.slice(start, start + visibleRows);
      const ddX = conversation ? conversation.x : r.x + 2;
      const ddW = conversation ? conversation.w : r.w - 2;
      const ddY = r.y - ddH;
      const dd = buf.box({ x: ddX, y: ddY, w: ddW, h: ddH }, {
        title: `/ Commands (${selectedIdx + 1}/${suggestions.length})`,
        titleStyle: S.code,
        border: { fg: GOLD_HIGHLIGHT },
      });
      for (let i = 0; i < visible.length; i++) {
        const globalIdx = start + i;
        const active = globalIdx === selectedIdx;
        const item = visible[i];
        buf.text(dd.x, dd.y + i, truncate(active ? `▶ ${item.label}` : `  ${item.label}`, dd.w - 1),
          active ? { fg: GOLD_HIGHLIGHT } : S.cream);
      }
    }
  }
}

// ── Status bar ──

export function drawStatus(buf: Buffer, row: number, width: number, st: AppState): void {
  buf.hline(0, row - 1, width, DIVIDER_CHAR, S.rule);
  const source = st.source || "";
  const portfolio = st.activePortfolio ? ` · ${st.activePortfolio}` : "";
  buf.text(
    0,
    row,
    `\x1b[38;2;212;175;55m◆ ${st.model}\x1b[0m\x1b[2m · ${source}${portfolio}\x1b[0m`,
  );
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
