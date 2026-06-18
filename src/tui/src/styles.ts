/** Style presets matching DESIGN.md palette. */
import type { Style } from "./buffer.ts";

export const GOLD = "#D4AF37";
export const GOLD_HIGHLIGHT = "#E2BE4D";
export const CREAM = "#F5F5F5";
export const MUTED = "#A6A6A6";
export const HAIRLINE = "#242424";
export const POSITIVE = "#6FB06A";
export const NEGATIVE = "#CF5B4A";
export const CODE_DIM = "#6E6A60";
export const CANVAS = "#0B0B0C";

// ── Layout ──
/** `compact` (default) uses tighter rows; set WHYJ_UI_DENSITY=comfortable to restore spacious layout. */
export type UiDensity = "compact" | "comfortable";
export const UI_DENSITY: UiDensity =
  process.env.WHYJ_UI_DENSITY === "comfortable" ? "comfortable" : "compact";

export const HEADER_H = UI_DENSITY === "compact" ? 2 : 3;
export const COMPOSER_H = UI_DENSITY === "compact" ? 6 : 8;
export const STATUS_H = 2;
export const OVERVIEW_ROW_H = UI_DENSITY === "compact" ? 1 : 2;
export const OVERVIEW_SECTION_H = UI_DENSITY === "compact" ? 2 : 3;
export const DIVIDER_CHAR = "─";

export const S = {
  gold:     { fg: GOLD } as Style,
  goldB:    { fg: GOLD, bold: true } as Style,
  goldDim:  { fg: GOLD, dim: true } as Style,
  cream:    { fg: CREAM } as Style,
  creamB:   { fg: CREAM, bold: true } as Style,
  dim:      { fg: MUTED, dim: true } as Style,
  muted:    { fg: MUTED } as Style,
  mutedB:   { fg: MUTED, bold: true } as Style,
  rule:     { fg: HAIRLINE } as Style,
  positive: { fg: POSITIVE } as Style,
  negative: { fg: NEGATIVE } as Style,
  code:     { fg: CODE_DIM } as Style,
  thinking: { fg: "#8A8A8A", dim: true } as Style,
  canvas:   { fg: CANVAS } as Style,
};

export function pctStyle(pct: number): Style {
  if (pct > 0.001) return { fg: NEGATIVE };
  if (pct < -0.001) return { fg: POSITIVE };
  return S.muted;
}

export function fmtPrice(p: number): string {
  if (p >= 10000) return p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(2);
}

export function fmtPct(p: number): string {
  if (Math.abs(p) < 0.001) return "0.00%";
  return `${p > 0 ? "+" : ""}${p.toFixed(2)}%`;
}
