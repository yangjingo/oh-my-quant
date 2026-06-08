/**
 * Region renderers for the r2 full-screen docked TUI.
 * Each function is pure: (Buffer, Rect, AppState) → void.
 */
import { Buffer, wrap, strWidth, truncate, sanitizeTerminalText } from "./buffer.ts";
import type { Style } from "./buffer.ts";
import { S, pctStyle, fmtPrice, fmtPct, HEADER_H, COMPOSER_H, STATUS_H, DIVIDER_CHAR, CANVAS, UI_DENSITY, OVERVIEW_ROW_H, OVERVIEW_SECTION_H } from "./styles.ts";
import type { ComposerSuggestion } from "./input.ts";
import type { AppState, Layout, UIMessage, PanelSection, Holding, Quote } from "./types.ts";

interface RenderLine {
  text: string;
  style?: Style;
}

type OverviewBlock =
  | { kind: "section-header"; title: string }
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
export function conversationMaxScrollUp(msgs: UIMessage[], innerW: number, innerH: number): number {
  const lines = buildConversationLines(msgs, innerW);
  return Math.max(0, lines.length - innerH);
}

function buildOverviewBlocks(sections: PanelSection[]): OverviewBlock[] {
  const blocks: OverviewBlock[] = [];
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    blocks.push({ kind: "section-header", title: sec.title });
    if (sec.kind === "holdings") {
      for (const row of sec.rows) blocks.push({ kind: "holding", row });
    } else if (sec.kind === "quotes") {
      for (const row of sec.rows) blocks.push({ kind: "quote", row });
    } else if (sec.kind === "keyvalue") {
      for (const row of sec.rows) blocks.push({ kind: "keyvalue", row });
    }
    if (i < sections.length - 1) blocks.push({ kind: "gap" });
  }
  return blocks;
}

function overviewBlockHeight(block: OverviewBlock): number {
  switch (block.kind) {
    case "section-header": return OVERVIEW_SECTION_H;
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
export function overviewMaxScrollTop(sections: PanelSection[], innerH: number): number {
  return Math.max(0, overviewContentHeight(sections) - innerH);
}

// ── Layout computation (pure, testable) ──

export function layout(C: number, R: number): Layout {
  const panelW = Math.min(48, Math.max(36, Math.floor(C * 0.312)));
  const showPanel = C >= 78;
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
  const speed = activity === "starting" ? 500 : activity === "thinking" ? 300 : 200;
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
    const tag = `  Research. Backtest. Invest.  v${st.version}`;
    buf.text(logoX + 11, 0, truncate(tag, Math.max(0, C - logoX - 12)), S.dim);
    buf.hline(0, 1, C, DIVIDER_CHAR, S.rule);
    return;
  }
  buf.text(2 + STEPS.length + 2, 1, `Research. Backtest. Invest.  v${st.version}`, S.dim);
  buf.hline(0, 2, C, DIVIDER_CHAR, S.rule);
}

// ── Conversation ──

function conversationClipEnd(mainPane: { x: number; w: number }): number {
  return mainPane.x + mainPane.w;
}

export function drawConversation(
  buf: Buffer,
  r: { x: number; y: number; w: number; h: number },
  msgs: UIMessage[],
  activity: string = "ready",
  mainPane?: { x: number; y: number; w: number; h: number },
  scrollUpFromBottom: number = 0,
): void {
  const panelRect = mainPane ?? r;
  const clipEnd = conversationClipEnd(panelRect);
  buf.fillRect(panelRect, { fg: CANVAS });
  const scrollHint = scrollUpFromBottom > 0 ? "···" : undefined;
  const inner = buf.box(panelRect, {
    title: "◉ Conversation",
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

  const lines = buildConversationLines(msgs, inner.w);
  const maxUp = Math.max(0, lines.length - inner.h);
  const up = Math.min(Math.max(0, scrollUpFromBottom), maxUp);
  const start = Math.max(0, lines.length - inner.h - up);
  for (let i = start; i < lines.length && i - start < inner.h; i++) {
    const line = lines[i];
    buf.text(inner.x, inner.y + i - start, line.text, line.style ?? {}, inner.w, clipEnd);
  }
}

const LOADING_LINES: Record<string, string[]> = {
  starting: ["Connecting data sources", "Loading portfolio snapshot", "Initializing agent"],
  thinking: ["Processing request", "Consulting models", "Analyzing data"],
  "running tool": ["Running tool", "Waiting for result"],
};

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
  const lines = LOADING_LINES[activity] || LOADING_LINES.starting;
  const TREND = "▁▃▅▇█ WhyJ Quant";
  const n = TREND.length;

  const minY = main.y;
  const maxY = main.y + main.h - 1;
  const cy = main.y + Math.floor(main.h / 2);
  const lineGap = 1;
  const stairGap = 1;
  const textBlockH = lines.length + Math.max(0, lines.length - 1) * lineGap;
  const totalH = 1 + stairGap + textBlockH;
  let textStartY = cy - Math.floor(totalH / 2) + 1 + stairGap;
  textStartY = Math.max(minY, Math.min(textStartY, maxY - textBlockH + 1));

  const stairY = textStartY - 1 - stairGap;
  if (stairY >= minY && stairY <= maxY) {
    const stairX = centerInMain(main, TREND);
    for (let i = 0; i < n; i++) {
      const s = (Math.sin(t * 3 + i * 0.6) + 1) / 2;
      const sr = Math.round(60 + (212 - 60) * s).toString(16).padStart(2, "0");
      const sg = Math.round(55 + (175 - 55) * s).toString(16).padStart(2, "0");
      const sb = Math.round(48 + (55 - 48) * s).toString(16).padStart(2, "0");
      const style = { fg: `#${sr}${sg}${sb}`, bold: true };
      buf.set(stairX + i, stairY, TREND[i], style, clipEnd);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const y = textStartY + i * (1 + lineGap);
    if (y > maxY) break;
    const phase = t * 2 + i * 2.1;
    const color = stepHex(phase);
    const style = { fg: color, bold: true };
    const text = lines[i];
    const lx = centerInMain(main, text);
    buf.text(lx, y, text, style, main.w, clipEnd);
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
    const text = msg.text?.trim();
    if (!text) return lines;
    const prefix = "▏ ";
    for (const line of wrap(sanitizeTerminalText(text), Math.max(1, w - strWidth(prefix)))) {
      lines.push({ text: `${prefix}${line}`, style: S.thinking });
    }
  } else if (msg.role === "tool") {
    const t = msg.tool!;
    const status = t.status === "running" ? "○" : t.status === "done" ? "✓" : "✗";
    const label = t.name.replace(/_/g, " ");
    const args = t.args ? ` · ${t.args}` : "";
    const elapsed = t.status === "running" ? `  ${fmtElapsed(Date.now() - t.startedAt)}` : "";
    const prefix = `  ${status} `;
    const body = `${label}${args}${elapsed}`;
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
      const preview = t.result.length > 120 ? t.result.slice(0, 120) + "..." : t.result;
      const resultPrefix = "    ";
      for (const line of wrap(preview, Math.max(1, w - strWidth(resultPrefix)))) {
        lines.push({ text: `${resultPrefix}${line}`, style: S.dim });
      }
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

// ── Portfolio dock ──

export function drawPortfolio(
  buf: Buffer,
  r: { x: number; y: number; w: number; h: number },
  sections: PanelSection[],
  loading: boolean,
  scrollFromTop: number = 0,
): void {
  const itemCount = sections.reduce((n, sec) => n + sec.rows.length, 0);
  const innerPreview = panelInner(r);
  const maxTop = overviewMaxScrollTop(sections, innerPreview.h);
  const top = Math.min(Math.max(0, scrollFromTop), maxTop);
  let titleRight = loading ? undefined : itemCount > 0 ? `${itemCount} items` : "no data";
  if (maxTop > 0 && top > 0) {
    titleRight = titleRight ? `${titleRight} · ···` : "···";
  }
  buf.fillRect(r, { fg: CANVAS });
  const inner = buf.box(r, {
    title: "◫ Overview", titleStyle: S.creamB,
    titleRight, titleRightStyle: S.dim, border: S.rule,
  });
  const x = inner.x;
  const minY = inner.y;
  const maxY = inner.y + inner.h - 1;

  if (loading) {
    const frames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
    const frame = frames[Math.floor(Date.now() / 80) % frames.length];
    const phase = Date.now() / 1000 * 2;
    const color = stepHex(phase);
    buf.text(x + 2, minY + 2, frame, { fg: color, bold: true });
    buf.text(x + 4, minY + 2, "Waiting for market data...", { fg: color });
    return;
  }

  if (sections.length === 0) {
    buf.text(x + 2, minY + 2, "No tool result yet.", S.dim);
    buf.text(x + 2, minY + 3, "Run a slash command or ask AI", S.dim);
    buf.text(x + 2, minY + 4, "to update this panel.", S.dim);
    return;
  }

  const blocks = buildOverviewBlocks(sections);
  let virtualY = 0;
  for (const block of blocks) {
    const h = overviewBlockHeight(block);
    if (virtualY + h <= top) {
      virtualY += h;
      continue;
    }
    if (virtualY - top >= inner.h) break;
    const drawY = inner.y + virtualY - top;
    drawOverviewBlock(buf, block, x, drawY, inner.w, minY, maxY);
    virtualY += h;
  }
}

function drawOverviewBlock(
  buf: Buffer,
  block: OverviewBlock,
  x: number,
  y: number,
  w: number,
  minY: number,
  maxY: number,
): void {
  switch (block.kind) {
    case "section-header":
      drawSecHeader(buf, x, y, w, block.title, minY, maxY);
      break;
    case "holding":
      drawHoldingRow(buf, x, y, w, block.row, minY, maxY);
      break;
    case "quote":
      drawQuoteRow(buf, x, y, w, block.row, minY, maxY);
      break;
    case "keyvalue":
      drawKeyValueRow(buf, x, y, w, block.row, minY, maxY);
      break;
    case "gap":
      break;
  }
}

function secHeader(buf: Buffer, x: number, y: number, w: number, title: string, minY: number, maxY: number): void {
  if (y >= minY && y <= maxY) {
    buf.text(x, y, "▎", S.gold);
    buf.text(x + 2, y, title, S.creamB);
  }
  if (y + 1 >= minY && y + 1 <= maxY) buf.hline(x, y + 1, w, DIVIDER_CHAR, S.rule);
}

function drawSecHeader(buf: Buffer, x: number, y: number, w: number, title: string, minY: number, maxY: number): void {
  secHeader(buf, x, y, w, title, minY, maxY);
}

function drawHoldingRow(buf: Buffer, x: number, y: number, w: number, h: Holding, minY: number, maxY: number): void {
  const right = x + w;
  if (UI_DENSITY === "compact") {
    if (y < minY || y > maxY) return;
    const pctTxt = fmtPct(h.pct);
    const priceTxt = fmtPrice(h.price);
    const rightBlockW = strWidth(priceTxt) + 2 + strWidth(pctTxt);
    const nameW = Math.max(0, w - 7 - rightBlockW);
    buf.text(x, y, h.code, S.code);
    buf.text(x + 7, y, truncate(h.name, nameW), S.cream);
    buf.textRight(right, y, pctTxt, pctStyle(h.pct));
    buf.textRight(right - strWidth(pctTxt) - 2, y, priceTxt, S.creamB);
    return;
  }
  if (y >= minY && y <= maxY) {
    buf.text(x, y, h.code, S.code);
    buf.text(x + 7, y, truncate(h.name, w - 8), S.cream);
  }
  const y2 = y + 1;
  if (y2 >= minY && y2 <= maxY) {
    const pctTxt = fmtPct(h.pct);
    buf.textRight(right, y2, fmtPrice(h.price), S.creamB);
    buf.textRight(right - strWidth(pctTxt) - 2, y2, pctTxt, pctStyle(h.pct));
  }
}

function drawQuoteRow(buf: Buffer, x: number, y: number, w: number, q: Quote, minY: number, maxY: number): void {
  drawHoldingRow(buf, x, y, w, q, minY, maxY);
}

function drawKeyValueRow(
  buf: Buffer,
  x: number,
  y: number,
  w: number,
  kv: { label: string; value: string },
  minY: number,
  maxY: number,
): void {
  if (y < minY || y > maxY) return;
  buf.text(x, y, kv.label, S.code);
  buf.textRight(x + w, y, kv.value, S.dim);
}

export function drawComposer(
  buf: Buffer,
  r: { x: number; y: number; w: number; h: number },
  st: AppState,
  input: string,
  suggestions: ComposerSuggestion[] = [],
  selectedIdx: number = -1,
): void {
  const isCmd = input.startsWith("/");
  const inner = buf.box(r, {
    title: "⌘ Composer", titleStyle: S.muted,
    titleRight: isCmd ? "↑↓ select · ↹ accept" : "/ commands · ↵ send · ^C quit", titleRightStyle: S.code,
    border: S.rule,
  });
  const inputY = inner.y;
  const statusY = inner.y + 1;

  if (st.composerStatus) {
    const prefix = st.composerStatus.kind === "error" ? "ERR " : "";
    const style = st.composerStatus.kind === "error" ? S.goldB : S.cream;
    buf.text(inner.x, statusY, truncate(prefix + st.composerStatus.text.replace(/\s+/g, " "), inner.w), style);
  }

  if (input) {
    if (isCmd) {
      buf.text(inner.x, inputY, "/", S.goldB);
      buf.text(inner.x + 1, inputY, input.slice(1), S.gold);
      buf.text(inner.x + 1 + strWidth(input.slice(1)), inputY, "▏", S.gold);
    } else {
      buf.text(inner.x, inputY, ">", S.gold);
      buf.text(inner.x + 2, inputY, input, S.cream);
      buf.text(inner.x + 2 + strWidth(input), inputY, "▏", S.cream);
    }
  } else {
    buf.text(inner.x, inputY, ">", S.gold);
    buf.text(inner.x + 2, inputY, "write a task, or just ask a question…▏", S.dim);
  }

  if (suggestions.length > 0) {
    const reservedRows = st.composerStatus ? 2 : 1;
    const suggestionStartY = inner.y + reservedRows;
    const maxRows = Math.max(1, inner.h - reservedRows);
    const visible = suggestions.slice(0, maxRows);
    for (let i = 0; i < visible.length; i++) {
      const suggestion = visible[i];
      const y = suggestionStartY + i;
      if (y > inner.y + inner.h - 1) break;
      const active = i === selectedIdx;
      const prefix = active ? "/ " : "  ";
      buf.text(inner.x, y, prefix, active ? S.goldB : S.dim);
      const label = truncate(suggestion.label, inner.w - 3);
      buf.text(inner.x + 2, y, label, active ? S.creamB : S.dim);
    }
  }
}

// ── Status bar ──

export function drawStatus(buf: Buffer, row: number, width: number, st: AppState): void {
  buf.hline(0, row - 1, width, DIVIDER_CHAR, S.rule);
  buf.text(
    0,
    row,
    `\x1b[38;2;212;175;55m◆ ${st.model}\x1b[0m\x1b[2m · .ohquant market-cache only · portfolio live-only\x1b[0m`,
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
