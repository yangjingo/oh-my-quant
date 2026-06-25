import { Buffer, truncate } from "./buffer.ts";
import { S, GOLD, GOLD_HIGHLIGHT } from "./styles.ts";
import type { PanelFrame } from "./panel-chrome.ts";

export type ConfigRowView =
  | { kind: "section"; label: string }
  | { kind: "field"; label: string; value: string; active: boolean; editing: boolean; action: boolean };

export function renderConfigPanelView(
  buf: Buffer,
  frame: PanelFrame,
  rows: ConfigRowView[],
  footer: string,
  draftLine?: string,
): void {
  const { inner } = frame;
  const visible = frame.contentH;
  const selectedRow = rows.findIndex((row) => row.kind === "field" && row.active);
  const start = Math.max(0, Math.min(selectedRow - Math.floor(visible / 2), rows.length - visible));
  let y = frame.contentY;

  for (const row of rows.slice(start, start + visible)) {
    if (row.kind === "section") {
      buf.text(inner.x, y++, truncate(`-- ${row.label} --`, inner.w), S.dim);
      continue;
    }
    const valueStyle = row.editing ? { fg: GOLD_HIGHLIGHT } : row.action ? S.dim : { fg: GOLD };
    buf.text(inner.x, y, truncate(`${row.active ? "> " : "  "}${row.label}`, Math.max(10, inner.w - 22)), row.active ? S.goldB : S.cream);
    buf.textRight(inner.x + inner.w, y++, truncate(row.value, 20), valueStyle);
  }

  buf.text(inner.x, frame.footerY, truncate(footer, inner.w), S.dim);
  if (draftLine) {
    buf.text(inner.x, frame.footerY - 1, truncate(draftLine, inner.w), { fg: GOLD_HIGHLIGHT });
  }
}

export interface ResumeListItemView {
  age: string;
  preview: string;
  selected: boolean;
  secondary?: string;
  legacy?: boolean;
}

export interface ResumeMetaView {
  title: string;
  usageBar?: string;
  usageCritical?: boolean;
  stats?: string;
  previewLines: string[];
}

export function renderResumePanelView(
  buf: Buffer,
  frame: PanelFrame,
  data: {
    meta?: ResumeMetaView;
    items: ResumeListItemView[];
    footer: string;
  },
): void {
  const { inner } = frame;
  let y = inner.y;
  let metaRows = 0;

  if (data.meta) {
    buf.text(inner.x, y, truncate(data.meta.title, inner.w), S.code);
    y++; metaRows++;
    if (data.meta.usageBar) {
      buf.text(inner.x, y, data.meta.usageBar, data.meta.usageCritical ? S.goldB : S.cream);
      y++; metaRows++;
    }
    if (data.meta.stats) {
      buf.text(inner.x, y, truncate(data.meta.stats, inner.w), S.dim);
      y++; metaRows++;
    }
    for (const line of data.meta.previewLines.slice(0, 3)) {
      buf.text(inner.x, y, truncate(line, inner.w), S.dim);
      y++; metaRows++;
    }
    y++;
    metaRows++;
  }

  if (data.items.length === 0) {
    buf.text(inner.x, frame.contentY, "No saved sessions yet.", S.dim);
    buf.text(inner.x, frame.footerY, truncate(data.footer, inner.w), S.dim);
    return;
  }

  const listHeight = Math.max(1, frame.contentH - metaRows);
  const selectedIndex = Math.max(0, data.items.findIndex((item) => item.selected));
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(listHeight / 2), data.items.length - listHeight));
  y = Math.max(frame.contentY, y);
  for (const item of data.items.slice(start, start + listHeight)) {
    const prefix = item.selected ? "❯ " : "  ";
    const divider = " ─ ";
    const secondary = item.secondary ? ` · ${item.secondary}` : "";
    const marker = item.legacy ? "[legacy] " : "";
    const text = `${prefix}${item.age}${divider}${marker}${item.preview}${secondary}`;
    buf.text(inner.x, y++, truncate(text, inner.w), item.selected ? S.goldB : S.cream);
  }

  buf.text(inner.x, frame.footerY, truncate(data.footer, inner.w), S.dim);
}

export interface PortfolioItemView {
  age: string;
  name: string;
  selected: boolean;
  active: boolean;
}

export interface PortfolioMetaView {
  title: string;
  details: string;
  subdetails: string;
}

export function renderPortfolioPanelView(
  buf: Buffer,
  frame: PanelFrame,
  data: {
    meta?: PortfolioMetaView;
    items: PortfolioItemView[];
    footer: string;
  },
): void {
  const { inner } = frame;
  let y = inner.y;
  let metaRows = 0;

  if (data.meta) {
    buf.text(inner.x, y, truncate(data.meta.title, inner.w), S.code);
    y++; metaRows++;
    buf.text(inner.x, y, truncate(data.meta.details, inner.w), S.dim);
    y++; metaRows++;
    buf.text(inner.x, y, truncate(data.meta.subdetails, inner.w), S.dim);
    y++; metaRows++;
    y++;
    metaRows++;
  }

  if (data.items.length === 0) {
    buf.text(inner.x, frame.contentY, "No local portfolios yet.", S.dim);
    buf.text(inner.x, frame.footerY, truncate(data.footer, inner.w), S.dim);
    return;
  }

  const listHeight = Math.max(1, frame.contentH - metaRows);
  const selectedIndex = Math.max(0, data.items.findIndex((item) => item.selected));
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(listHeight / 2), data.items.length - listHeight));
  y = Math.max(frame.contentY, y);
  for (const item of data.items.slice(start, start + listHeight)) {
    const prefix = item.selected ? "❯ " : "  ";
    const marker = item.active ? " ●" : "  ";
    const text = `${prefix}${item.age}${marker}  ${item.name}`;
    buf.text(inner.x, y++, truncate(text, inner.w), item.selected ? S.goldB : S.cream);
  }

  buf.text(inner.x, frame.footerY, truncate(data.footer, inner.w), S.dim);
}

export function renderHelpPanelView(
  buf: Buffer,
  frame: PanelFrame,
  data: {
    commands: { name: string; desc: string; selected: boolean }[];
    hotkeys: { key: string; desc: string }[];
    footer: string;
  },
): void {
  const { inner } = frame;
  const midX = inner.x + Math.floor(inner.w / 2);
  const leftW = midX - inner.x - 1;
  const rightW = inner.x + inner.w - midX - 1;

  buf.text(inner.x, inner.y, "Commands", S.creamB);
  let y = inner.y + 1;
  for (const cmd of data.commands) {
    if (y >= frame.footerY) break;
    const prefix = cmd.selected ? "▶" : " ";
    buf.text(inner.x, y, `${prefix}${truncate(cmd.name, 11)}`, S.goldB);
    buf.text(inner.x + 13, y, truncate(cmd.desc, leftW - 13), cmd.selected ? S.creamB : S.cream);
    y++;
  }

  for (let r = inner.y; r < frame.footerY; r++) {
    buf.set(midX, r, "│", S.rule);
  }

  buf.text(midX + 1, inner.y, "Hotkeys", S.creamB);
  y = inner.y + 1;
  for (const item of data.hotkeys) {
    if (y >= frame.footerY) break;
    buf.text(midX + 1, y, truncate(item.key, 16), S.goldB);
    buf.text(midX + 18, y, truncate(item.desc, rightW - 18), S.cream);
    y++;
  }
  buf.text(inner.x, frame.footerY, truncate(data.footer, inner.w), S.dim);
}
