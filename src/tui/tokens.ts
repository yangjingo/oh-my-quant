/**
 * WhyJ Quant — TUI Design Tokens (r2 full-screen docked layout)
 * Single source of truth for all visual constants. Reference: DESIGN.md.
 */

// ── Palette ──
export const GOLD = "#D4AF37";
export const GOLD_HIGHLIGHT = "#E2BE4D";
export const PRIMARY_ON_DARK = "#F0D77A";
export const INK = "#F5F5F5";
export const MUTED = "#A6A6A6";
export const CANVAS = "#0B0B0C";
export const SURFACE = "#111111";
export const SURFACE_ELEVATED = "#171717";
export const SURFACE_TERMINAL = "#000000";
export const DIVIDER_SOFT = "#1A1A1A";
export const HAIRLINE = "#242424";
export const POSITIVE = "#6FB06A";
export const NEGATIVE = "#CF5B4A";
export const CODE_DIM = "#6E6A60";

// ── Layout (r2 docked) ──
export const SIDEBAR_WIDTH = 34;           // kept for Ink compatibility
export const HEADER_H = 2;                 // header row + hairline
export const COMPOSER_H = 3;               // composer box height
export const STATUS_H = 1;                 // status bar
export const MAIN_WIDTH = 50;              // nominal
export const DIVIDER_CHAR = "─";
export const SECTION_ACCENT = "▎ ";
export const BOX_CHARS = { tl: "╭", tr: "╮", bl: "╰", br: "╯", v: "│", h: "─" } as const;
export const GUTTER = "▏";
