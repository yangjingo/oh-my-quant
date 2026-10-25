import type { Key } from "node:readline";
import type { ResearchTaskSnapshot } from "../../../src/types/research-task.ts";
import { researchTaskLines } from "../../../src/runtime/workspace/research-task-view.ts";
import { Buffer, truncate, wrap } from "./buffer.ts";
import { drawPanelFrame } from "./panel-chrome.ts";
import { DEFAULT_APP_KEYBINDINGS } from "./model-settings-panel.ts";
import { S } from "./styles.ts";

type Bindings = Pick<typeof DEFAULT_APP_KEYBINDINGS, "previous" | "next" | "confirm" | "cancel">;

export class ResearchTaskPanel {
  private readonly lines: string[];
  private readonly status: string;
  private readonly bindings: Bindings;
  private offset = 0;
  private maximumOffset = 0;

  constructor(snapshot: ResearchTaskSnapshot, bindings: Partial<Bindings> = {}) {
    this.lines = researchTaskLines(snapshot);
    this.status = snapshot.task?.status ?? "no task";
    this.bindings = { ...DEFAULT_APP_KEYBINDINGS, ...bindings };
  }

  handleKey(input: string, key: Key): { close?: boolean; command?: string } {
    const chord = `${key.ctrl ? "ctrl+" : ""}${key.meta ? "meta+" : ""}${key.shift ? "shift+" : ""}${key.name || input.toLowerCase()}`;
    if (this.bindings.cancel.includes(chord)) return { close: true };
    if (this.bindings.confirm.includes(chord)) return { command: "/resume --task", close: true };
    if (this.bindings.previous.includes(chord)) this.offset = Math.max(0, this.offset - 1);
    if (this.bindings.next.includes(chord)) this.offset = Math.min(this.maximumOffset, this.offset + 1);
    return {};
  }

  render(buf: Buffer): void {
    const frame = drawPanelFrame(buf, "Research task", "", 2, 1);
    const rows = this.lines.flatMap(line => wrap(line, Math.max(1, frame.inner.w)));
    this.maximumOffset = Math.max(0, rows.length - frame.contentH);
    this.offset = Math.min(this.offset, this.maximumOffset);
    buf.text(frame.inner.x, frame.inner.y, truncate(`Snapshot · ${this.status}`, frame.inner.w), S.creamB);
    rows.slice(this.offset, this.offset + frame.contentH).forEach((line, index) => buf.text(frame.inner.x, frame.contentY + index, line, S.cream));
    buf.text(frame.inner.x, frame.footerY - 1, truncate(`${this.offset + 1}-${Math.min(rows.length, this.offset + frame.contentH)} / ${rows.length} lines · refresh to recheck evidence`, frame.inner.w), S.dim);
    buf.text(frame.inner.x, frame.footerY, truncate(`${this.bindings.previous[0]}/${this.bindings.next[0]} scroll · ${this.bindings.confirm[0]} refresh · ${this.bindings.cancel[0]} close`, frame.inner.w), S.gold);
  }
}
