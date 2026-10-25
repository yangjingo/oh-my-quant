import type { Key } from "node:readline";
import type { PanelDataService, PanelPortfolioFile, PortfolioEdit } from "../../../src/runtime/workspace/panel-data.ts";
import { Buffer, truncate } from "./buffer.ts";
import { drawPanelFrame } from "./panel-chrome.ts";
import { S } from "./styles.ts";
import type { PanelResult } from "./panel.ts";

type Action = { label: string; group?: string; edit?: PortfolioEdit; draft?: "create" | "add" | "rename" };

/** Local preference editor. Quotes are refreshed by AppRuntime after a save. */
export class PortfolioPanel {
  private file: PanelPortfolioFile;
  private group: string | undefined;
  private selection = 0;
  private draft: { type: "create" | "add" | "rename"; text: string } | null = null;
  private confirmation: PortfolioEdit | null = null;
  private status = "";

  private readonly data: Pick<PanelDataService, "loadPanelPortfolio" | "editPortfolio">;

  constructor(data: Pick<PanelDataService, "loadPanelPortfolio" | "editPortfolio">) {
    this.data = data;
    this.file = data.loadPanelPortfolio();
  }

  private actions(): Action[] {
    const group = this.file.groups.find(group => group.id === this.group);
    if (!group) return [
      { label: "+ Create portfolio", draft: "create" },
      ...this.file.groups.map(item => ({ label: `${item.name}  ·  ${item.symbolCodes.length} symbols`, group: item.id })),
    ];
    return [
      { label: "+ Add symbol", draft: "add" },
      { label: "Rename portfolio", draft: "rename" },
      ...group.symbolCodes.map(code => ({
        label: `Remove ${code}  ${this.file.symbols.find(item => item.code === code)?.name || ""}`,
        edit: { type: "remove" as const, group: group.id, code },
      })),
      { label: "Delete portfolio", edit: { type: "delete", group: group.id } },
      { label: "Research this portfolio", edit: { type: "select", group: group.id } },
    ];
  }

  handleKey(input: string, key: Key): PanelResult {
    if (key.name === "escape") {
      if (this.draft || this.confirmation) { this.draft = null; this.confirmation = null; this.status = ""; return {}; }
      if (this.group) { this.group = undefined; this.selection = 0; return {}; }
      return { close: true };
    }
    if (this.confirmation) {
      if (key.name !== "return") return {};
      return this.save(this.confirmation);
    }
    if (this.draft) {
      if (key.name === "backspace" || key.name === "delete") this.draft.text = [...this.draft.text].slice(0, -1).join("");
      else if (key.name === "return") {
        const text = this.draft.text.trim();
        if (this.draft.type === "create") return this.save({ type: "create", name: text });
        if (this.draft.type === "rename") return this.save({ type: "rename", group: this.group!, name: text });
        const [code = "", ...name] = text.split(/\s+/);
        return this.save({ type: "add", group: this.group!, code, name: name.join(" ") });
      } else if (input && !key.ctrl && !key.meta) this.draft.text += input.replace(/[\x00-\x1f\x7f]/g, "");
      return {};
    }
    const actions = this.actions();
    if (key.name === "up" || key.name === "down") {
      this.selection = (this.selection + (key.name === "up" ? -1 : 1) + actions.length) % actions.length;
    } else if (key.name === "return") {
      const action = actions[this.selection];
      if (action?.group) { this.group = action.group; this.selection = 0; this.status = ""; }
      if (action?.draft) this.draft = { type: action.draft, text: action.draft === "rename" ? this.file.groups.find(group => group.id === this.group)!.name : "" };
      if (action?.edit?.type === "delete") this.confirmation = action.edit;
      else if (action?.edit) return this.save(action.edit);
    }
    return {};
  }

  private save(edit: PortfolioEdit): PanelResult {
    try {
      this.file = this.data.editPortfolio(edit);
      this.draft = null;
      this.confirmation = null;
      if (edit.type === "create") { this.group = this.file.groups.at(-1)?.id; this.selection = 0; }
      if (edit.type === "delete") { this.group = undefined; this.selection = 0; }
      this.selection = Math.min(this.selection, this.actions().length - 1);
      this.status = "Saved.";
      return { refreshPanel: true };
    } catch (error) {
      this.status = error instanceof Error ? error.message : String(error);
      return {};
    }
  }

  render(buf: Buffer): void {
    const group = this.file.groups.find(group => group.id === this.group);
    const frame = drawPanelFrame(buf, group?.name || "Portfolios", "", 2, 2);
    const { inner } = frame;
    buf.text(inner.x, inner.y, truncate(group ? `${group.symbolCodes.length} symbols · daily quotes update automatically` : `${this.file.groups.length} portfolios`, inner.w), S.dim);
    if (this.confirmation) {
      buf.text(inner.x, frame.contentY, truncate(`Delete ${group?.name}? Enter to confirm, Esc to cancel.`, inner.w), S.goldB);
    } else if (this.draft) {
      const label = this.draft.type === "add" ? "Symbol and optional name" : "Portfolio name";
      buf.text(inner.x, frame.contentY, truncate(label, inner.w), S.creamB);
      buf.text(inner.x, frame.contentY + 1, truncate(`${this.draft.text}▏`, inner.w), S.goldB);
      if (this.draft.type === "add") buf.text(inner.x, frame.contentY + 3, truncate("000001.SZ · 022364.OF (fund) · AAPL · 00700.HK", inner.w), S.dim);
    } else {
      const actions = this.actions();
      const start = Math.max(0, Math.min(this.selection - Math.floor(frame.contentH / 2), actions.length - frame.contentH));
      actions.slice(start, start + frame.contentH).forEach((action, index) => {
        const selected = start + index === this.selection;
        buf.text(inner.x, frame.contentY + index, truncate(`${selected ? "❯" : " "} ${action.label}`, inner.w), selected ? S.goldB : S.cream);
      });
    }
    buf.text(inner.x, frame.footerY, truncate(this.status, inner.w), S.dim);
  }
}
