/**
 * Terminal utilities: string width, ANSI helpers.
 */

/** Measure visible width. CJK characters count as 2. */
export function strWidth(s: string): number {
  let w = 0;
  for (const ch of [...s]) {
    const cp = ch.codePointAt(0)!;
    w += isCJK(cp) ? 2 : 1;
  }
  return w;
}

function isCJK(cp: number): boolean {
  return (
    (cp >= 0x4E00 && cp <= 0x9FFF) ||   // CJK Unified
    (cp >= 0x3400 && cp <= 0x4DBF) ||   // CJK Extension A
    (cp >= 0x20000 && cp <= 0x2A6DF) ||   // CJK Extension B
    (cp >= 0xF900 && cp <= 0xFAFF) ||   // CJK Compatibility
    (cp >= 0x2F800 && cp <= 0x2FA1F) ||   // CJK Compatibility Supplement
    (cp >= 0x3000 && cp <= 0x303F) ||   // CJK Symbols
    (cp >= 0xFF00 && cp <= 0xFFEF)      // Halfwidth/Fullwidth
  );
}

/** Truncate to max visible width, appending "…" if needed. */
export function truncate(s: string, maxW: number): string {
  if (strWidth(s) <= maxW) return s;
  let w = 0;
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    const cw = isCJK(chars[i].codePointAt(0)!) ? 2 : 1;
    if (w + cw + 1 > maxW) return chars.slice(0, i).join("") + "…";
    w += cw;
  }
  return s;
}

export const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  syncOn: "\x1b[?2026h",
  syncOff: "\x1b[?2026l",
  altScreen: "\x1b[?1049h",
  normalScreen: "\x1b[?1049l",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  cursorTo(x: number, y: number): string { return `\x1b[${y + 1};${x + 1}H`; },
};
