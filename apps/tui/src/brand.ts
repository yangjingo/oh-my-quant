// Compact 4 x 4 dot outline of docs/assets/logo-mark.svg.
// Leave the center open so the circle and lower-right tail survive at this size.
// Two Braille cells keep the original JQ header footprint (2 columns x 1 row).
// Requires a Unicode monospace terminal; no Nerd Font or image protocol is needed.
export const BRAND_MARK_ROWS = ["⢎⣵"] as const;

// A single gap travels around the ring; the inner hook and Q tail stay fixed.
// All frames retain two cells and reuse the TUI's existing animation clock.
const THINKING_RING = [[0, 8], [1, 1], [1, 16], [1, 32], [1, 64], [0, 128], [0, 4], [0, 2]] as const;
export function thinkingBrandMark(elapsedMs: number): string {
  const dots = [...BRAND_MARK_ROWS[0]].map(char => char.codePointAt(0)! - 0x2800);
  const [cell, bit] = THINKING_RING[Math.floor(Math.max(0, elapsedMs) / 160) % THINKING_RING.length]!;
  dots[cell] = dots[cell]! & ~bit;
  return String.fromCodePoint(...dots.map(bits => 0x2800 + bits));
}

export const BRAND_NAME = "WhyJ Quant";
export const BRAND_LABEL = BRAND_NAME;
