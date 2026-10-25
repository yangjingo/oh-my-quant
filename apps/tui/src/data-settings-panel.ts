import type { Key } from "node:readline";
import type { OhQuantSettings } from "../../../src/types/config.ts";
import { DATA_MARKETS, dataSourcesForMarket } from "../../../src/runtime/data/data-readiness.ts";
import { DataSettingsDraft, validateDataEndpoint, type DataSettingsOptions } from "../../../src/runtime/data/data-settings.ts";
import { DEFAULT_APP_KEYBINDINGS, DEFAULT_EDITOR_KEYBINDINGS } from "./model-settings-panel.ts";
import { Buffer, strWidth, truncate } from "./buffer.ts";
import { drawPanelFrame } from "./panel-chrome.ts";
import { S } from "./styles.ts";
import { ToolCapabilitiesPanel } from "./tool-capabilities-panel.ts";

type Bindings = Record<keyof typeof DEFAULT_APP_KEYBINDINGS | keyof typeof DEFAULT_EDITOR_KEYBINDINGS, readonly string[]>;
type Editor = { label: string; value: string; cursor: number; secret: boolean; apply(value: string): void };
type Row = { label: string; value: string; run(): void };
export interface DataSettingsResult { close?: boolean; saved?: OhQuantSettings }

/** Settings and Doctor share this editor; only their parent can persist the verified draft. */
export class DataSettingsPanel {
  private readonly draft: DataSettingsDraft;
  private readonly bindings: Bindings;
  private selection = 0;
  private editor: Editor | null = null;
  private capabilities: ToolCapabilitiesPanel | null = null;
  private result: DataSettingsResult = {};

  constructor(settings: OhQuantSettings, options: DataSettingsOptions = {}, bindings: Partial<Bindings> = {}, focusKey = false) {
    this.draft = new DataSettingsDraft(settings, options);
    this.bindings = { ...DEFAULT_APP_KEYBINDINGS, ...DEFAULT_EDITOR_KEYBINDINGS, ...bindings };
    if (focusKey) { this.selection = 2; this.editKey(); }
  }
  dispose(): void { this.draft.dispose(); this.editor = null; this.capabilities?.dispose(); this.capabilities = null; }
  setError(message: string): void { this.draft.setError(message); }
  private edit(label: string, value: string, apply: Editor["apply"], secret = false): void {
    this.draft.cancel();
    this.editor = { label, value, cursor: [...value].length, secret, apply };
    this.draft.setError(secret ? "Blank keeps key · Esc discards edit" : "Enter applies draft · Esc discards edit");
  }
  private editKey(): void {
    if (this.draft.request.source === "akshare") { this.draft.setError("AKShare needs Python 3 and akshare; no key."); return; }
    this.edit("API key", "", value => this.draft.setKey(value), true);
  }
  private safeEndpoint(): string {
    try { return validateDataEndpoint(this.draft.endpoint()); } catch { return ""; }
  }
  private rows(): Row[] {
    const request = this.draft.request, sources = dataSourcesForMarket(request.market);
    return [
      { label: "Market", value: request.market, run: () => this.draft.setMarket(DATA_MARKETS[(DATA_MARKETS.indexOf(request.market) + 1) % DATA_MARKETS.length]!) },
      { label: "Source", value: request.source, run: () => this.draft.setSource(sources[(sources.indexOf(request.source) + 1) % sources.length]!) },
      { label: "API key", value: this.draft.credentialLabel(), run: () => this.editKey() },
      { label: "Endpoint", value: request.source === "akshare" ? "Python adapter" : this.safeEndpoint() || (this.draft.endpoint() ? "Invalid endpoint · edit" : "Provider default"),
        run: () => { if (request.source !== "akshare") this.edit("Endpoint", this.safeEndpoint(), value => this.draft.setEndpoint(value)); } },
      ...(["symbol", "start", "end"] as const).map(field => ({ label: field === "symbol" ? "Symbol" : field === "start" ? "Start" : "End", value: request[field],
        run: () => this.edit(field, request[field], value => this.draft.setSample(field, value)) })),
      { label: "Check data", value: this.draft.checking ? "Cancel current check" : "Verify this sample", run: () => {
        if (this.draft.checking) this.draft.cancel(); else void this.draft.verify();
      } },
      { label: "Save verified", value: this.draft.canSave ? "Apply data settings" : "Successful check required", run: () => {
        this.result = { saved: this.draft.prepareSave(), close: true };
      } },
      { label: "Remove saved key", value: "Use environment key instead", run: () => this.draft.removeKey() },
      { label: "Tool capabilities", value: "Inspect dependencies and permissions", run: () => { this.capabilities = new ToolCapabilitiesPanel(this.draft.capabilities(), this.bindings, this.draft.toolProbeContext()); } },
    ];
  }
  handleKey(input: string, key: Key): DataSettingsResult {
    if (this.capabilities) {
      if (this.capabilities.handleKey(input, key).close) this.capabilities = null;
      return {};
    }
    this.result = {};
    const chord = `${key.ctrl ? "ctrl+" : ""}${key.meta ? "meta+" : ""}${key.name ?? ""}`;
    const action = Object.entries(this.bindings).find(([, chords]) => chords.includes(chord))?.[0];
    try {
      if (this.editor) {
        const editor = this.editor, chars = [...editor.value];
        if (action === "cancel") { this.editor = null; return {}; }
        if (action === "confirm") { editor.apply(editor.value.trim()); this.editor = null; return {}; }
        if (action === "left") editor.cursor = Math.max(0, editor.cursor - 1);
        else if (action === "right") editor.cursor = Math.min(chars.length, editor.cursor + 1);
        else if (action === "home") editor.cursor = 0;
        else if (action === "end") editor.cursor = chars.length;
        else if (action === "delete") chars.splice(editor.cursor, 1);
        else if (action === "backspace" && editor.cursor > 0) chars.splice(--editor.cursor, 1);
        else if (input && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(input)) { chars.splice(editor.cursor, 0, ...input); editor.cursor += [...input].length; }
        editor.value = chars.join("");
        return {};
      }
      if (action === "cancel") {
        if (this.draft.checking) { this.draft.cancel(); return {}; }
        return { close: true };
      }
      const rows = this.rows();
      if (action === "previous" || action === "next") this.selection = (this.selection + (action === "previous" ? -1 : 1) + rows.length) % rows.length;
      else if (action === "confirm") rows[this.selection]?.run();
    } catch (error) { this.draft.setError(error instanceof Error ? error.message : "Check data settings."); }
    return this.result;
  }
  render(buf: Buffer): void {
    if (this.capabilities) { this.capabilities.update(this.draft.capabilities()); this.capabilities.render(buf); return; }
    const frame = drawPanelFrame(buf, "Data connection", "Draft", 4, 2), { inner } = frame;
    const request = this.draft.request, readiness = this.draft.readiness;
    buf.text(inner.x, inner.y, truncate(`Sources for ${request.market}: ${dataSourcesForMarket(request.market).join(", ")}`, inner.w), S.cream);
    const dependency = readiness?.dependency;
    const requirement = request.source === "akshare" ? dependency ? `Python ${dependency.python ?? "missing"} · akshare ${dependency.akshare ?? "missing"}` : "Requires Python 3 + akshare · no key"
      : "Requires provider key and permission for this sample";
    buf.text(inner.x, inner.y + 1, truncate(requirement, inner.w), S.dim);
    const rows = this.rows(), count = frame.contentH;
    const start = Math.max(0, Math.min(this.selection - Math.floor(count / 2), rows.length - count));
    for (const [offset, row] of rows.slice(start, start + count).entries()) {
      const active = start + offset === this.selection;
      buf.text(inner.x, frame.contentY + offset, truncate(`${active ? ">" : " "} ${row.label.padEnd(18)} ${row.value}`, inner.w), active ? S.goldB : S.cream);
    }
    if (this.editor) {
      const label = `${this.editor.label}: `, chars = [...this.editor.value].map(char => this.editor!.secret ? "•" : char);
      const before = chars.slice(0, this.editor.cursor);
      while (strWidth(before.join("")) > Math.max(1, inner.w - strWidth(label) - 2)) before.shift();
      buf.text(inner.x, frame.footerY - 3, truncate(`${label}${before.join("")}|${chars.slice(this.editor.cursor).join("")}`, inner.w), S.gold);
    } else buf.text(inner.x, frame.footerY - 3, truncate(`${request.symbol} · ${request.start} → ${request.end}`, inner.w), S.cream);
    buf.text(inner.x, frame.footerY - 2, truncate(this.draft.status, inner.w), S.dim);
    buf.text(inner.x, frame.footerY - 1, truncate(readiness?.action ?? "Only this daily-series sample is checked.", inner.w), S.dim);
    buf.text(inner.x, frame.footerY, truncate("Up/Down · Enter select · Esc cancel / back", inner.w), S.dim);
  }
}
