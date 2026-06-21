import { Buffer, strWidth, truncate } from "./buffer.ts";
import { S, SHADOW } from "./styles.ts";

export type PanelFrame = {
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
  inner: { x: number; y: number; w: number; h: number };
  contentY: number;
  contentH: number;
  footerY: number;
};

const PANEL_W = 96;
const PANEL_H = 22;
const PANEL_HEADER_INFO_H = 3;
const PANEL_FOOTER_H = 2;

export function drawPanelFrame(buf: Buffer, title: string, titleRight: string): PanelFrame {
  const boxW = Math.min(PANEL_W, buf.w - 4);
  const boxH = Math.min(PANEL_H, buf.h - 4);
  const boxX = Math.floor((buf.w - boxW) / 2);
  const boxY = Math.floor((buf.h - boxH) / 2);

  buf.fillRect({ x: boxX - 1, y: boxY - 1, w: boxW + 2, h: boxH + 2 }, { fg: SHADOW, dim: true });
  const inner = buf.box({ x: boxX, y: boxY, w: boxW, h: boxH }, {
    title,
    titleStyle: S.creamB,
    titleRight,
    titleRightStyle: S.dim,
    border: S.rule,
  });
  const contentY = inner.y + PANEL_HEADER_INFO_H;
  const footerY = inner.y + inner.h - 1;
  const contentH = Math.max(1, footerY - contentY - (PANEL_FOOTER_H - 1));
  return { boxX, boxY, boxW, boxH, inner, contentY, contentH, footerY };
}

export function renderConfigHeaderInfo(
  buf: Buffer,
  frame: PanelFrame,
  info: { model: string; thinking: string; panel: "on" | "off"; activePortfolio: string },
): void {
  const left = `Model: ${info.model}    Thinking: ${info.thinking}`;
  const right = `Panel: ${info.panel}`;
  buf.text(frame.inner.x, frame.inner.y, truncate(left, frame.inner.w - Math.min(frame.inner.w - 20, strWidth(right) + 2)), S.cream);
  buf.textRight(frame.inner.x + frame.inner.w, frame.inner.y, truncate(right, Math.floor(frame.inner.w * 0.4)), S.dim, frame.inner.x + Math.floor(frame.inner.w * 0.45));
  buf.text(frame.inner.x, frame.inner.y + 1, truncate(`Active portfolio: ${info.activePortfolio}`, frame.inner.w), S.dim);
  buf.text(frame.inner.x, frame.inner.y + 2, truncate("Local settings panel.", frame.inner.w), S.dim);
}
