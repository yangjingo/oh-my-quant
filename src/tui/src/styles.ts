/** Style presets matching DESIGN.md palette. */
import type { Style } from "./buffer.ts";

export const GOLD = "#E8B339";
export const GOLD_HIGHLIGHT = "#F2C95A";
export const CASH = "#E8B339";
export const CASH_DARK = "#947618";
export const CASH_WARM = "#F4CD68";
export const CREAM = "#F2EEE6";
export const MUTED = "#9B968C";
export const BODY_COPY = "#A09880";
export const AUTHOR_COPY = "#8A8478";
export const HAIRLINE = "#2B2722";
export const STEP_DIM = "#3C3730";
export const POSITIVE = "#1E9F4D";
export const NEGATIVE = "#E5494D";
export const MARKET_UP = NEGATIVE;
export const MARKET_DOWN = POSITIVE;
export const CODE_DIM = "#7A7368";
export const THINKING = "#7F807D";
export const SHADOW = "#000000";
export const SELECTION_FG = "#0D0B0A";
export const SELECTION_BG = "#C9A227";
export const CANVAS = "#0B0B0C";

// ── Layout ──
/** `compact` (default) uses tighter rows; set WHYJ_UI_DENSITY=comfortable to restore spacious layout. */
export type UiDensity = "compact" | "comfortable";
export const UI_DENSITY: UiDensity =
  process.env.WHYJ_UI_DENSITY === "comfortable" ? "comfortable" : "compact";

export const HEADER_H = UI_DENSITY === "compact" ? 2 : 3;
export const COMPOSER_H = UI_DENSITY === "compact" ? 8 : 10;
export const STATUS_H = 2;
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
  dim:      { fg: MUTED, dim: true } as Style,
  muted:    { fg: MUTED } as Style,
  mutedB:   { fg: MUTED, bold: true } as Style,
  rule:     { fg: HAIRLINE } as Style,
  positive: { fg: POSITIVE } as Style,
  negative: { fg: NEGATIVE } as Style,
  code:     { fg: CODE_DIM } as Style,
  thinking: { fg: THINKING, dim: true } as Style,
  canvas:   { fg: CANVAS } as Style,
  selection:{ fg: SELECTION_FG, bg: SELECTION_BG, bold: true } as Style,

  // Structured text tokens. Keep renderers semantic so future themes only
  // need to remap these entries, not table/chart parsing logic.
  tableHeader:   { fg: GOLD, bold: true } as Style,
  tableKey:      { fg: GOLD } as Style,
  tableValue:    { fg: CREAM } as Style,
  tableStrong:   { fg: CREAM, bold: true } as Style,
  tableNote:     { fg: MUTED, dim: true } as Style,
  tableRule:     { fg: HAIRLINE } as Style,
  tableSpacing:  { fg: MUTED, dim: true } as Style,
  tablePositive: { fg: POSITIVE } as Style,
  tableNegative: { fg: NEGATIVE } as Style,
  tableGain:     { fg: MARKET_UP } as Style,
  tableLoss:     { fg: MARKET_DOWN } as Style,
  tableNeutral:  { fg: MUTED } as Style,
  chartTitle:    { fg: GOLD, bold: true } as Style,
  chartLine:     { fg: GOLD } as Style,
  chartUp:       { fg: MARKET_UP } as Style,
  chartDown:     { fg: MARKET_DOWN } as Style,
  chartAxis:     { fg: HAIRLINE } as Style,
  chartMuted:    { fg: MUTED, dim: true } as Style,
};

export function pctStyle(pct: number): Style {
  if (pct > 0.001) return { fg: MARKET_UP };
  if (pct < -0.001) return { fg: MARKET_DOWN };
  return S.muted;
}
