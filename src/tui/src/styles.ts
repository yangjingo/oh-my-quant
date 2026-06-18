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
};

export function hexToRgb(hex: string): [number, number, number] {
  const n = hex.replace("#", "");
  return [
    parseInt(n.slice(0, 2), 16),
    parseInt(n.slice(2, 4), 16),
    parseInt(n.slice(4, 6), 16),
  ];
}

export function mixHex(from: string, to: string, t: number): string {
  const [fr, fg, fb] = hexToRgb(from);
  const [tr, tg, tb] = hexToRgb(to);
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t).toString(16).padStart(2, "0");
  return `#${lerp(fr, tr)}${lerp(fg, tg)}${lerp(fb, tb)}`;
}

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
