import { expect, it } from "bun:test";
import { Buffer } from "../src/buffer.ts";
import { WHYJ_THEME } from "../../types/theme-colors.ts";
import { S } from "../src/styles.ts";

it("prints necessary muted text at the DESIGN palette color without terminal faint attributes", () => {
  const buffer = new Buffer(60, 6);
  for (const [index, style] of [S.dim, S.thinking, S.code, S.tableNote, S.chartMuted].entries()) {
    buffer.text(0, index, "研究说明 / 数据日期", style);
    const cell = buffer.cells[index * buffer.w]!;
    expect(cell.fg).toBe(WHYJ_THEME.muted);
    expect(cell.dim).not.toBe(true);
  }
  expect(buffer.render()).not.toContain("\x1b[2m");
});

function luminance(hex: string): number {
  const [r, g, b] = hex.slice(1).match(/../g)!.map(value => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

it("keeps essential warm text and semantic values readable on all workspace surfaces", () => {
  for (const background of [WHYJ_THEME.canvas, WHYJ_THEME.surface, WHYJ_THEME.surfaceHigh]) {
    for (const foreground of [WHYJ_THEME.cream, WHYJ_THEME.muted, WHYJ_THEME.gold, WHYJ_THEME.positive, WHYJ_THEME.negative]) {
      const contrast = (luminance(foreground) + 0.05) / (luminance(background) + 0.05);
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
  }
  expect((luminance(WHYJ_THEME.selectionBg) + 0.05) / (luminance(WHYJ_THEME.selectionFg) + 0.05)).toBeGreaterThanOrEqual(4.5);
});
