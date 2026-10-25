import type { Key } from "node:readline";
import { Buffer, strWidth, truncate, wrap, type Style } from "./buffer.ts";
import { drawPanelFrame } from "./panel-chrome.ts";
import { DEFAULT_APP_KEYBINDINGS, DEFAULT_EDITOR_KEYBINDINGS } from "./model-settings-panel.ts";
import { S } from "./styles.ts";

export interface DoctorPanelView {
  title: string;
  status: string;
  mode: string;
  model: string;
  baseUrl: string;
  endpointMode: string;
  dataSource: string;
  settingsPath: string;
  phases: { phase: string; status: string; detail: string; action?: string; warnings?: string[] }[];
  actions?: string[];
  hints: string[];
  logPath?: string;
}

type Bindings = Pick<typeof DEFAULT_APP_KEYBINDINGS, "previous" | "next" | "doctorPageUp" | "doctorPageDown" | "cancel">
  & Pick<typeof DEFAULT_EDITOR_KEYBINDINGS, "home" | "end">;

function controlRows(items: string[], width: number): string[] {
  const rows: string[] = [];
  for (const item of items) {
    const last = rows.at(-1);
    if (last && strWidth(`${last}  ·  ${item}`) <= width) rows[rows.length - 1] = `${last}  ·  ${item}`;
    else rows.push(...wrap(item, width));
  }
  return rows;
}

/** Read-only report viewport. Command dispatch and diagnostic cancellation remain in PanelController. */
export class DoctorPanel {
  private offset = 0;
  private maximumOffset = 0;
  private pageSize = 1;
  private readonly bindings: Bindings;

  constructor(bindings: Partial<Bindings> = {}) { this.bindings = { ...DEFAULT_APP_KEYBINDINGS, ...DEFAULT_EDITOR_KEYBINDINGS, ...bindings }; }
  reset(): void { this.offset = 0; this.maximumOffset = 0; }

  handleKey(input: string, key: Key): { close?: boolean } | undefined {
    const chord = `${key.ctrl ? "ctrl+" : ""}${key.meta ? "meta+" : ""}${key.shift ? "shift+" : ""}${key.name || input.toLowerCase()}`;
    if (this.bindings.cancel.includes(chord)) return { close: true };
    if (this.bindings.previous.includes(chord)) this.offset--;
    else if (this.bindings.next.includes(chord)) this.offset++;
    else if (this.bindings.doctorPageUp.includes(chord)) this.offset -= this.pageSize;
    else if (this.bindings.doctorPageDown.includes(chord)) this.offset += this.pageSize;
    else if (this.bindings.home.includes(chord)) this.offset = 0;
    else if (this.bindings.end.includes(chord)) this.offset = this.maximumOffset;
    else return undefined;
    this.offset = Math.max(0, Math.min(this.maximumOffset, this.offset));
    return {};
  }

  render(buf: Buffer, data: DoctorPanelView): void {
    const frame = drawPanelFrame(buf, "Doctor", "", 1, 2);
    const width = Math.max(1, frame.inner.w);
    const actions = controlRows(data.actions ?? [], width);
    const controls = controlRows([`${this.bindings.previous[0]}/${this.bindings.next[0]} scroll`, `${this.bindings.doctorPageUp[0]}/${this.bindings.doctorPageDown[0]} page`, `${this.bindings.cancel[0]} close`], width);
    frame.contentH = Math.max(1, frame.contentH - actions.length - controls.length);
    const rows: { text: string; style: Style }[] = [];
    const add = (text: string, style: Style = S.dim) => { for (const line of wrap(text, frame.inner.w)) rows.push({ text: line, style }); };
    const priority: Record<string, number> = { fail: 0, checking: 1, pending: 2, pass: 3 };
    for (const phase of [...data.phases].sort((a, b) => (priority[a.status] ?? 4) - (priority[b.status] ?? 4))) {
      const prefix = phase.status === "pass" ? "✓" : phase.status === "fail" ? "✗" : phase.status === "checking" ? "⟳" : "○";
      add(`${prefix} ${phase.phase}`, phase.status === "fail" ? S.negative : phase.status === "pass" ? S.positive : S.creamB);
      if (phase.detail) add(phase.detail);
      if (phase.action) add(`Fix · ${phase.action}`, S.gold);
      for (const warning of phase.warnings ?? []) add(`Warn · ${warning}`, S.gold);
      add("");
    }
    add("Connection", S.creamB);
    add(`mode ${data.mode}`);
    add(`model ${data.model}`);
    add(`base ${data.baseUrl || "(not set)"}${data.endpointMode ? ` · ${data.endpointMode}` : ""}`);
    add(`data ${data.dataSource}`);
    add(`path ${data.settingsPath}`);
    if (data.logPath) add(`Logs · ${data.logPath}`);
    if (data.hints.length) { add("Hints", S.creamB); for (const hint of data.hints) add(`- ${hint}`); }
    this.pageSize = frame.contentH;
    this.maximumOffset = Math.max(0, rows.length - this.pageSize);
    this.offset = Math.min(this.offset, this.maximumOffset);
    buf.text(frame.inner.x, frame.inner.y, truncate(`${data.title} · ${data.status}`, frame.inner.w), S.creamB);
    buf.text(frame.inner.x, frame.inner.y + 1, truncate(data.phases.map(phase => `${phase.phase} ${phase.status}`).join(" · "), frame.inner.w), S.cream);
    for (const [index, row] of rows.slice(this.offset, this.offset + this.pageSize).entries()) {
      buf.text(frame.inner.x, frame.contentY + index, row.text, row.style, frame.inner.w);
    }
    const footer = [...actions.map(text => ({ text, style: S.gold })), ...controls.map(text => ({ text, style: S.dim })),
      { text: `${this.offset + 1}-${Math.min(rows.length, this.offset + this.pageSize)} / ${rows.length} lines · ${this.bindings.home[0]}/${this.bindings.end[0]} top/end`, style: S.dim }];
    for (const [index, row] of footer.entries()) buf.text(frame.inner.x, frame.footerY - footer.length + 1 + index, truncate(row.text, frame.inner.w), row.style);
  }
}
