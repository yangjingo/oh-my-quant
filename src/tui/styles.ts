/** Style presets matching DESIGN.md palette. */
import type { Style } from "./buffer.ts";

export const GOLD = "#D4AF37";
export const CREAM = "#F5F5F5";
export const MUTED = "#A6A6A6";
export const HAIRLINE = "#242424";
export const POSITIVE = "#6FB06A";
export const NEGATIVE = "#CF5B4A";
export const CODE_DIM = "#6E6A60";

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
  canvas:   { fg: "#0B0B0C" } as Style,
};

export function pctStyle(pct: number): Style {
  if (pct > 0.001) return S.positive;
  if (pct < -0.001) return S.negative;
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
