import type { Key } from "node:readline";
import { ToolProbeDraft, type ToolProbeContext } from "../../../src/runtime/data/tool-probe-draft.ts";
import { Buffer, strWidth, truncate, wrap } from "./buffer.ts";
import { drawPanelFrame } from "./panel-chrome.ts";
import { DEFAULT_APP_KEYBINDINGS, DEFAULT_EDITOR_KEYBINDINGS } from "./model-settings-panel.ts";
import { S } from "./styles.ts";

/** A source request editor. It never executes the tool or persists data/settings. */
export class ToolProbePanel {
  private readonly draft: ToolProbeDraft;
  private selection = 0;
  private editor: { value: string; cursor: number } | null = null;
  constructor(tool: string, context: ToolProbeContext,
    private readonly bindings: Record<keyof typeof DEFAULT_APP_KEYBINDINGS | keyof typeof DEFAULT_EDITOR_KEYBINDINGS, readonly string[]> =
      { ...DEFAULT_APP_KEYBINDINGS, ...DEFAULT_EDITOR_KEYBINDINGS }) { this.draft = new ToolProbeDraft(tool, context); }
  dispose(): void { this.draft.dispose(); }
  handleKey(input: string, key: Key): { close?: boolean } {
    const chord = `${key.ctrl ? "ctrl+" : ""}${key.meta ? "meta+" : ""}${key.name ?? ""}`;
    const action = Object.entries(this.bindings).find(([, chords]) => chords.includes(chord))?.[0];
    try {
      if (this.editor) {
        const editor = this.editor, chars = [...editor.value];
        if (action === "cancel") { this.editor = null; return {}; }
        if (action === "confirm") { this.draft.setParams(editor.value); this.editor = null; return {}; }
        if (action === "left") editor.cursor = Math.max(0, editor.cursor - 1);
        else if (action === "right") editor.cursor = Math.min(chars.length, editor.cursor + 1);
        else if (action === "home") editor.cursor = 0;
        else if (action === "end") editor.cursor = chars.length;
        else if (action === "delete") chars.splice(editor.cursor, 1);
        else if (action === "backspace" && editor.cursor) chars.splice(--editor.cursor, 1);
        else if (input && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(input)) { chars.splice(editor.cursor, 0, ...input); editor.cursor += [...input].length; }
        editor.value = chars.join(""); return {};
      }
      if (action === "cancel") { if (this.draft.checking) this.draft.cancel(); else { this.dispose(); return { close: true }; } }
      if (action === "previous" || action === "next") this.selection = (this.selection + (action === "previous" ? -1 : 1) + 3) % 3;
      if (action === "confirm") {
        const request = this.draft.request;
        if (!request) return {};
        if (this.selection === 0) this.draft.select((this.draft.choices.findIndex(choice => choice.provider === request.provider && choice.endpoint === request.endpoint) + 1) % this.draft.choices.length);
        else if (this.selection === 1) { this.draft.cancel(); const value = JSON.stringify(request.params); this.editor = { value, cursor: [...value].length }; }
        else if (this.draft.checking) this.draft.cancel(); else void this.draft.verify();
      }
    } catch (error) { this.draft.setError(error instanceof Error ? error.message : "Check endpoint parameters."); }
    return {};
  }
  render(buffer: Buffer): void {
    const frame = drawPanelFrame(buffer, "Endpoint check", "No save", 2, 4), { inner } = frame, request = this.draft.request, result = this.draft.result;
    buffer.text(inner.x, inner.y, truncate(request?.tool ?? "No public data probe for this tool / market", inner.w), S.gold);
    buffer.text(inner.x, inner.y + 1, "One request only; other tool permissions unchecked", S.dim);
    if (request) {
      const rows = [`Endpoint    ${request.provider} / ${request.endpoint}`, `Parameters  ${JSON.stringify(request.params)}`,
        `Check       ${this.draft.checking ? "Cancel request" : "Run this endpoint"}`];
      rows.forEach((row, index) => buffer.text(inner.x, frame.contentY + index, truncate(`${this.selection === index ? ">" : " "} ${row}`, inner.w), this.selection === index ? S.goldB : S.cream));
      const schema: Record<string, unknown> = { ...this.draft.choices.find(choice => choice.provider === request.provider && choice.endpoint === request.endpoint)?.parameters };
      const required = Array.isArray(schema?.required) ? schema.required as string[] : [];
      const properties = schema?.properties as Record<string, { description?: string; type?: string }> | undefined;
      const help = [`Market: ${request.market}`, `Required: ${required.join(", ") || (properties ? "none" : "endpoint-dependent; review its API arguments")}`,
        ...Object.entries(properties ?? {}).map(([name, value]) => `${name} (${value.type ?? "value"}): ${value.description ?? ""}`)].flatMap(line => wrap(line, inner.w));
      help.slice(0, Math.max(0, frame.contentH - 4)).forEach((line, index) => buffer.text(inner.x, frame.contentY + 4 + index, line, S.dim));
    }
    if (this.editor) {
      const chars = [...this.editor.value], before = chars.slice(0, this.editor.cursor);
      while (strWidth(before.join("")) > inner.w - 1) before.shift();
      buffer.text(inner.x, frame.footerY - 3, truncate(`${before.join("")}|${chars.slice(this.editor.cursor).join("")}`, inner.w), S.gold);
    } else buffer.text(inner.x, frame.footerY - 3, truncate(result ? `${result.status} · ${result.rowCount} rows · ${result.observedAt}` : this.draft.status, inner.w), S.cream);
    const message = this.editor ? this.draft.status : result?.action ?? this.draft.status;
    wrap(message, inner.w).slice(0, 2).forEach((line, i) => buffer.text(inner.x, frame.footerY - 2 + i, line, S.dim));
    buffer.text(inner.x, frame.footerY, truncate(this.editor ? "JSON parameters · Enter apply · Esc discard" : "Up/Down · Enter select/check · Esc cancel/back", inner.w), S.dim);
  }
}
