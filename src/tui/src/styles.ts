/** Style presets matching DESIGN.md palette. */
import type { Style } from "./buffer.ts";
import { marketColors, WHYJ_THEME, type MarketColorScheme } from "../../types/theme-colors.ts";
import { displayedMovement } from "../../types/metric-semantics.ts";

export const GOLD = WHYJ_THEME.gold;
export const GOLD_HIGHLIGHT = WHYJ_THEME.goldHighlight;
export const CASH = WHYJ_THEME.gold;
export const CASH_DARK = WHYJ_THEME.cashDark;
export const CASH_WARM = WHYJ_THEME.cashWarm;
export const CREAM = WHYJ_THEME.cream;
export const MUTED = WHYJ_THEME.muted;
export const BODY_COPY = "#B8B4A8";
export const AUTHOR_COPY = WHYJ_THEME.authorCopy;
export const HAIRLINE = WHYJ_THEME.hairline;
export const STEP_DIM = WHYJ_THEME.stepDim;
export const POSITIVE = WHYJ_THEME.positive;
export const NEGATIVE = WHYJ_THEME.negative;
export const MARKET_UP = WHYJ_THEME.marketUp;
export const MARKET_DOWN = WHYJ_THEME.marketDown;
export const CODE_DIM = WHYJ_THEME.codeDim;
export const THINKING = "#8F8A7B";
export const SHADOW = "#000000";
export const SELECTION_FG = WHYJ_THEME.selectionFg;
export const SELECTION_BG = WHYJ_THEME.selectionBg;
export const CANVAS = WHYJ_THEME.canvas;

// ── Layout ──
/** `compact` (default) uses tighter rows; set WHYJ_UI_DENSITY=comfortable to restore spacious layout. */
export type UiDensity = "compact" | "comfortable";
export const UI_DENSITY: UiDensity =
  process.env.WHYJ_UI_DENSITY === "comfortable" ? "comfortable" : "compact";

export const HEADER_H = 4;
export const COMPOSER_H = UI_DENSITY === "compact" ? 5 : 8;
export const STATUS_H = 1;
export const OVERVIEW_ROW_H = UI_DENSITY === "compact" ? 1 : 2;
export const OVERVIEW_SECTION_H = UI_DENSITY === "compact" ? 2 : 3;
export const DIVIDER_CHAR = "─";

export const S = {
  gold:     { fg: GOLD } as Style,
  goldB:    { fg: GOLD, bold: true } as Style,
  goldDim:  { fg: GOLD, dim: true } as Style,
  cash:     { fg: CASH } as Style,
  cream:    { fg: CREAM } as Style,
  creamB:   { fg: CREAM, bold: true } as Style,
  dim:      { fg: MUTED } as Style,
  muted:    { fg: MUTED } as Style,
  mutedB:   { fg: MUTED, bold: true } as Style,
  rule:     { fg: HAIRLINE } as Style,
  positive: { fg: POSITIVE } as Style,
  negative: { fg: NEGATIVE } as Style,
  code:     { fg: MUTED } as Style,
  body:     { fg: BODY_COPY } as Style,
  thinking: { fg: THINKING } as Style,
  canvas:   { fg: CANVAS } as Style,
  selection:{ fg: SELECTION_FG, bg: SELECTION_BG, bold: true } as Style,

  // Structured text tokens. Keep renderers semantic so future themes only
  // need to remap these entries, not table/chart parsing logic.
  tableHeader:   { fg: CREAM, bold: true } as Style,
  tableKey:      { fg: BODY_COPY } as Style,
  tableValue:    { fg: BODY_COPY } as Style,
  tableStrong:   { fg: CREAM, bold: true } as Style,
  tableNote:     { fg: MUTED } as Style,
  tableRule:     { fg: HAIRLINE } as Style,
  tableSpacing:  { fg: MUTED, dim: true } as Style,
  tablePositive: { fg: POSITIVE } as Style,
  tableNegative: { fg: NEGATIVE } as Style,
  tableGain:     { fg: MARKET_UP, fgRole: "market-up" } as Style,
  tableLoss:     { fg: MARKET_DOWN, fgRole: "market-down" } as Style,
  tableNeutral:  { fg: MUTED } as Style,
  chartTitle:    { fg: GOLD, bold: true } as Style,
  chartLine:     { fg: GOLD } as Style,
  chartUp:       { fg: MARKET_UP, fgRole: "market-up" } as Style,
  chartDown:     { fg: MARKET_DOWN, fgRole: "market-down" } as Style,
  chartAxis:     { fg: HAIRLINE } as Style,
  chartMuted:    { fg: MUTED } as Style,
};

export function pctStyle(pct: number): Style {
  const tone = displayedMovement(pct).tone;
  if (tone === "up") return S.tableGain;
  if (tone === "down") return S.tableLoss;
  return S.muted;
}

export function marketForegrounds(scheme?: MarketColorScheme): Readonly<Record<string, string>> {
  const colors = marketColors(scheme);
  return { "market-up": colors.up, "market-down": colors.down };
}

