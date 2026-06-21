import { Buffer, strWidth, wrap } from "./buffer.ts";
import type { Style } from "./buffer.ts";
import { AUTHOR_COPY, BODY_COPY, CASH_DARK, CASH_WARM, S } from "./styles.ts";
import { mixHex } from "./theme.ts";

const ORA_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function oraFrame(): string {
  return ORA_FRAMES[Math.floor(Date.now() / 80) % ORA_FRAMES.length];
}

function centerInMain(main: { x: number; w: number }, text: string): number {
  const textW = strWidth(text);
  const centerX = main.x + Math.floor(main.w / 2);
  const minX = main.x;
  const maxX = main.x + main.w - textW;
  const ideal = centerX - Math.floor(textW / 2);
  return Math.max(minX, Math.min(ideal, maxX));
}

function stepHex(phase: number): string {
  const t = (Math.sin(phase) + 1) / 2;
  return mixHex(CASH_DARK, CASH_WARM, t);
}

export function thinkingBannerStyle(): Style {
  return { fg: stepHex(Date.now() / 500), bold: true };
}

export function drawLoadingOverlay(
  buf: Buffer,
  main: { x: number; y: number; w: number; h: number },
  activity: string,
  clipEnd: number,
  insights: { quote: string; en: string; author: string }[],
  activityVerb: (activity: string) => string,
): void {
  const safeInsights = insights.length > 0
    ? insights
    : [{ quote: "保持耐心。", en: "Stay patient.", author: "WhyJ Quant" }];
  const t = Date.now() / 1000;
  const trend = "▁▃▅▇█ WhyJ Quant";
  const n = trend.length;
  const stepSec = 5;
  const idx = Math.floor(t / stepSec) % safeInsights.length;
  const insight = safeInsights[idx];
  const maxLineW = Math.min(main.w - 6, 56);
  const cnLines = wrap(`"${insight.quote}"`, maxLineW);
  const enLines = wrap(insight.en, maxLineW);
  const authorText = `— ${insight.author}`;
  const spinnerLine = ` ${oraFrame()} WhyJ is ${activityVerb(activity)}…`;
  const blockH = 1 + 1 + cnLines.length + enLines.length + 1;

  const minY = main.y;
  const maxY = main.y + main.h - 1;
  const cy = main.y + Math.floor(main.h / 2);
  let textStartY = cy - Math.floor(blockH / 2);
  textStartY = Math.max(minY, Math.min(textStartY, maxY - blockH + 1));

  buf.text(centerInMain(main, spinnerLine), textStartY, spinnerLine, S.goldB, main.w, clipEnd);
  textStartY++;

  const stairY = textStartY;
  if (stairY >= minY && stairY <= maxY) {
    const stairX = centerInMain(main, trend);
    for (let i = 0; i < n; i++) {
      const s = (Math.sin(t * 3 + i * 0.6) + 1) / 2;
      const sr = Math.round(60 + (212 - 60) * s).toString(16).padStart(2, "0");
      const sg = Math.round(55 + (175 - 55) * s).toString(16).padStart(2, "0");
      const sb = Math.round(48 + (55 - 48) * s).toString(16).padStart(2, "0");
      buf.set(stairX + i, stairY, trend[i], { fg: `#${sr}${sg}${sb}`, bold: true }, clipEnd);
    }
  }

  let row = textStartY;
  for (let i = 0; i < cnLines.length; i++) {
    if (row > maxY) break;
    buf.text(centerInMain(main, cnLines[i]), row, cnLines[i], { fg: stepHex(t * 1.5 + i) }, main.w, clipEnd);
    row++;
  }
  for (let i = 0; i < enLines.length; i++) {
    if (row > maxY) break;
    buf.text(centerInMain(main, enLines[i]), row, enLines[i], { fg: BODY_COPY }, main.w, clipEnd);
    row++;
  }
  if (row <= maxY) {
    buf.text(centerInMain(main, authorText), row, authorText, { fg: AUTHOR_COPY, dim: true }, main.w, clipEnd);
  }
}
