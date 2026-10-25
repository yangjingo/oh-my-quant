import { Buffer, truncate, wrap } from "./buffer.ts";
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
  editorLine?: string,
  editorActive = false,
): void {
  const { inner } = frame;
  const labels: Record<string, string> = {
    "Model": "Model 模型", "Market Data": "Market Data 行情", "Data Token": "Data Token 凭证",
    "Portfolios": "Portfolios 观察组合", "Auto Artifacts": "Auto Artifacts 报告",
  };
  const hints: Record<string, string> = {
    "Model": "模型：提供商 → 模型 → 凭证 → 保存并验证。",
    "Market Data": "行情：选择数据源，检查有效样本后保存。",
    "Data Token": "凭证：进入数据连接检查；凭证输入会遮蔽。",
    "Portfolios": "观察组合：管理关注标的和分组。",
    "Auto Artifacts": "自动报告：核验完成后生成；/artifact 查看。",
  };
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
    buf.text(inner.x, y, truncate(`${row.active ? "> " : "  "}${labels[row.label] ?? row.label}`, Math.max(10, inner.w - 22)), row.active ? S.goldB : S.cream);
    buf.textRight(inner.x + inner.w, y++, truncate(row.value, 20), valueStyle);
  }

  const selected = rows[selectedRow];
  const help = selected?.kind === "field" ? hints[selected.label] : undefined;
  buf.text(inner.x, frame.footerY, truncate(footer || help || "", inner.w), S.muted);
  buf.text(inner.x, frame.footerY - 1, truncate(editorActive ? "Enter 保存 · Esc 取消" : "↑↓ 选择 · Enter 修改 · Esc 关闭", inner.w), S.gold);
  if (editorLine) {
    const lines = wrap(editorLine, inner.w).slice(0, 2);
    const startY = frame.footerY - 1 - lines.length;
    for (const [index, line] of lines.entries()) {
      buf.text(inner.x, startY + index, truncate(line, inner.w), editorActive ? { fg: GOLD_HIGHLIGHT } : S.dim);
    }
  }
}

function renderEmptyPanelView(buf: Buffer, frame: PanelFrame, message: string, footer: string): void {
  for (const [index, line] of wrap(message, frame.inner.w).slice(0, frame.contentH).entries()) {
    buf.text(frame.inner.x, frame.contentY + index, line, index === 0 ? S.cream : S.dim);
  }
  buf.text(frame.inner.x, frame.footerY, truncate(footer, frame.inner.w), S.dim);
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
    emptyMessage?: string;
  },
): void {
  const { inner } = frame;
  let y = inner.y;

  if (data.meta) {
    buf.text(inner.x, y, truncate(data.meta.title, inner.w), S.code);
    y++;
    if (data.meta.usageBar) {
      buf.text(inner.x, y, truncate(data.meta.usageBar, inner.w), data.meta.usageCritical ? S.goldB : S.cream);
      y++;
    }
    if (data.meta.stats) {
      buf.text(inner.x, y, truncate(data.meta.stats, inner.w), S.dim);
      y++;
    }
    for (const line of data.meta.previewLines.slice(0, 3)) {
      buf.text(inner.x, y, truncate(line, inner.w), S.dim);
      y++;
    }
    y++;
  }

  if (data.items.length === 0) {
    renderEmptyPanelView(buf, frame, data.emptyMessage ?? "No saved sessions yet.", data.footer);
    return;
  }

  y = Math.max(frame.contentY, y);
  const listHeight = Math.max(1, frame.contentY + frame.contentH - y);
  const selectedIndex = Math.max(0, data.items.findIndex((item) => item.selected));
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(listHeight / 2), data.items.length - listHeight));
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

export interface ArtifactItemView {
  age: string;
  title: string;
  stats: string;
  selected: boolean;
}

export interface ArtifactMetaView {
  title: string;
  details: string;
  subdetails: string;
}

export function renderArtifactPanelView(
  buf: Buffer,
  frame: PanelFrame,
  data: {
    meta?: ArtifactMetaView;
    items: ArtifactItemView[];
    footer: string;
    emptyMessage?: string;
  },
): void {
  const { inner } = frame;
  let y = inner.y;

  if (data.meta) {
    buf.text(inner.x, y, truncate(data.meta.title, inner.w), S.code);
    y++;
    buf.text(inner.x, y, truncate(data.meta.details, inner.w), S.dim);
    y++;
    buf.text(inner.x, y, truncate(data.meta.subdetails, inner.w), S.dim);
    y++;
    y++;
  }

  if (data.items.length === 0) {
    renderEmptyPanelView(buf, frame, data.emptyMessage ?? "No artifacts yet.", data.footer);
    buf.text(inner.x, frame.footerY - 1, truncate("先开启 Auto Artifacts · Esc 关闭", inner.w), S.gold);
    return;
  }

  y = Math.max(frame.contentY, y);
  const listHeight = Math.max(1, frame.contentY + frame.contentH - y);
  const selectedIndex = Math.max(0, data.items.findIndex((item) => item.selected));
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(listHeight / 2), data.items.length - listHeight));
  for (const item of data.items.slice(start, start + listHeight)) {
    const prefix = item.selected ? "❯ " : "  ";
    const left = `${prefix}${item.age}  ${item.title}`;
    const right = truncate(item.stats, 18);
    buf.text(inner.x, y, truncate(left, Math.max(1, inner.w - right.length - 2)), item.selected ? S.goldB : S.cream);
    buf.textRight(inner.x + inner.w, y++, right, item.selected ? S.goldB : S.dim);
  }

  buf.text(inner.x, frame.footerY, truncate(data.footer, inner.w), S.dim);
  buf.text(inner.x, frame.footerY - 1, truncate("↑↓ 选择 · Enter 恢复并打开 · Esc 关闭", inner.w), S.gold);
}
export function renderHelpPanelView(
  buf: Buffer,
  frame: PanelFrame,
  data: {
    commands: { name: string; desc: string; selected: boolean }[];
    hotkeys: { key: string; desc: string }[];
    footer: string;
    section?: "commands" | "hotkeys";
    hotkeySelection?: number;
    controls?: string;
    actionHint?: string;
  },
): void {
  const { inner } = frame;
  const hotkeys = data.section === "hotkeys";
  const items = hotkeys ? data.hotkeys.map(item => ({ name: item.key, desc: item.desc })) : data.commands;
  const selected = hotkeys ? data.hotkeySelection ?? 0 : Math.max(0, data.commands.findIndex(item => item.selected));
  // One full-width list leaves both command meanings and shortcut labels readable.
  const count = Math.max(1, frame.footerY - inner.y - 3);
  const start = Math.max(0, Math.min(selected - Math.floor(count / 2), items.length - count));
  const labelWidth = hotkeys ? 18 : 13;
  buf.text(inner.x, inner.y, truncate(hotkeys ? "Commands / [Hotkeys]" : "[Commands] / Hotkeys", inner.w), S.creamB);
  for (const [offset, item] of items.slice(start, start + count).entries()) {
    const active = start + offset === selected;
    const y = inner.y + 1 + offset;
    buf.text(inner.x, y, truncate(`${active ? ">" : " "} ${item.name}`, labelWidth), active ? S.goldB : S.gold);
    buf.text(inner.x + labelWidth, y, truncate(item.desc, inner.w - labelWidth), active ? S.creamB : S.cream);
  }
  buf.text(inner.x, frame.footerY - 2, truncate(data.actionHint ?? "Enter run · ? usage", inner.w), S.gold);
  buf.text(inner.x, frame.footerY - 1, truncate(data.controls ?? "Up/Down select · Tab switch · Esc close", inner.w), S.dim);
  buf.text(inner.x, frame.footerY, truncate(data.footer, inner.w), S.dim);
}
