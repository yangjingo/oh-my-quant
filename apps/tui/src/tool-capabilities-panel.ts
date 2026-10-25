import type { Key } from "node:readline";
import type { ToolReadiness } from "../../../src/types/tool-capabilities.ts";
import { capabilityInputSummary, listBuiltinToolCapabilities } from "../../../src/runtime/data/tool-readiness.ts";
import { DEFAULT_APP_KEYBINDINGS, DEFAULT_EDITOR_KEYBINDINGS } from "./model-settings-panel.ts";
import { Buffer, truncate, wrap } from "./buffer.ts";
import { drawPanelFrame } from "./panel-chrome.ts";
import { S } from "./styles.ts";
import { ToolProbePanel } from "./tool-probe-panel.ts";
import type { ToolProbeContext } from "../../../src/runtime/data/tool-probe-draft.ts";

type CapabilityBindings = Record<keyof typeof DEFAULT_APP_KEYBINDINGS | keyof typeof DEFAULT_EDITOR_KEYBINDINGS, readonly string[]>;

/** Read-only inspection. Enter shows requirements; it never executes the selected tool. */
export class ToolCapabilitiesPanel {
  private selection = 0;
  private query = "";
  private details = false;
  private scroll = 0;
  private readonly manifest = listBuiltinToolCapabilities();
  private probe: ToolProbePanel | null = null;
  constructor(private entries: ToolReadiness[], private readonly bindings: CapabilityBindings = { ...DEFAULT_APP_KEYBINDINGS, ...DEFAULT_EDITOR_KEYBINDINGS },
    private readonly probeContext?: ToolProbeContext) {}
  dispose(): void { this.probe?.dispose(); this.probe = null; }
  update(entries: ToolReadiness[]): void { this.entries = entries; }
  private matches(): ToolReadiness[] { return this.entries.filter(entry => `${entry.name} ${entry.label} ${entry.capability} ${entry.status}`.toLowerCase().includes(this.query.toLowerCase())); }
  handleKey(input: string, key: Key): { close?: boolean } {
    if (this.probe) { if (this.probe.handleKey(input, key).close) this.probe = null; return {}; }
    const chord = `${key.ctrl ? "ctrl+" : ""}${key.meta ? "meta+" : ""}${key.name ?? ""}`;
    const action = Object.entries(this.bindings).find(([, chords]) => chords.includes(chord))?.[0];
    if (this.details && action === "probeEndpoint" && this.probeContext) {
      const selected = this.matches()[this.selection];
      if (selected) this.probe = new ToolProbePanel(selected.name, this.probeContext, this.bindings);
      return {};
    }
    if (action === "cancel") { if (this.details) { this.details = false; return {}; } return { close: true }; }
    if (action === "confirm") { this.details = !this.details; this.scroll = 0; return {}; }
    if (action === "previous" || action === "next") {
      const delta = action === "previous" ? -1 : 1;
      if (this.details) this.scroll = Math.max(0, this.scroll + delta);
      else this.selection = Math.max(0, Math.min(this.matches().length - 1, this.selection + delta));
    } else if (!this.details) {
      if (action === "backspace") this.query = [...this.query].slice(0, -1).join("");
      else if (input && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(input)) this.query += input;
      this.selection = 0;
    }
    return {};
  }
  render(buf: Buffer): void {
    if (this.probe) { this.probe.render(buf); return; }
    const frame = drawPanelFrame(buf, "Tool capabilities", "Read only", 2, 2), { inner } = frame;
    const matches = this.matches(); this.selection = Math.min(this.selection, Math.max(0, matches.length - 1));
    const selected = matches[this.selection], manifest = this.manifest.find(item => item.name === selected?.name);
    buf.text(inner.x, inner.y, truncate(`Search: ${this.query}| · ${matches.length} tools`, inner.w), S.gold);
    buf.text(inner.x, inner.y + 1, truncate("Sample-verified = input only; tool not executed", inner.w), S.dim);
    if (this.details && selected && manifest) {
      const lines = [selected.name, manifest.description, `Capability: ${selected.capability} · ${selected.status}`, capabilityInputSummary(manifest),
        `Effects: ${manifest.requirements.effects.join(", ")}`,
        ...selected.routes.flatMap(route => {
          const requirement = manifest.requirements.routes.find(item => item.provider === route.provider)!;
          return [`${route.provider} · ${route.status}`, route.reason, route.action,
            `Markets: ${requirement.markets.join(", ")} · dependencies: ${requirement.dependencies.join(", ") || "none"}`,
            ...(requirement.endpoints ? [`Endpoints: ${requirement.endpoints.join(", ")}`] : [])];
        }), selected.limitations,
        ...(selected.sample ? [`Sample: ${selected.sample.symbol} · ${selected.sample.start} to ${selected.sample.end}`, `As-of: ${selected.sample.asOfDate} · observed ${selected.sample.observedAt}`] : []),
      ].flatMap(line => wrap(line, inner.w));
      this.scroll = Math.min(this.scroll, Math.max(0, lines.length - frame.contentH));
      for (const [i, line] of lines.slice(this.scroll, this.scroll + frame.contentH).entries()) buf.text(inner.x, frame.contentY + i, line, S.cream);
    } else {
      const count = Math.max(1, Math.floor(frame.contentH / 2));
      const start = Math.max(0, Math.min(this.selection - Math.floor(count / 2), matches.length - count));
      for (const [i, entry] of matches.slice(start, start + count).entries()) {
        buf.text(inner.x, frame.contentY + i * 2, truncate(`${start + i === this.selection ? ">" : " "} ${entry.name}`, inner.w), start + i === this.selection ? S.goldB : S.cream);
        buf.text(inner.x + 2, frame.contentY + i * 2 + 1, truncate(`${entry.status} · ${entry.capability}`, inner.w - 2), S.dim);
      }
      if (!matches.length) buf.text(inner.x, frame.contentY, "No matches. Backspace to change search.", S.dim);
    }
    buf.text(inner.x, frame.footerY - 1, truncate(selected?.routes.find(route => route.status === "blocked")?.reason ?? selected?.limitations ?? "No tool selected", inner.w), S.dim);
    buf.text(inner.x, frame.footerY, truncate(this.details ? `${this.probeContext ? "p Check endpoint · " : ""}Up/Down scroll · Esc back` : "Type search · Up/Down · Enter details · Esc back", inner.w), S.dim);
  }
}
