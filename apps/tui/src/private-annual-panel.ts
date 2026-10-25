import type { Key } from "node:readline";
import type { PrivateAnnualExportRequest } from "../../../src/types/private-annual-export.ts";
import { Buffer, truncate, wrap } from "./buffer.ts";
import { drawPanelFrame } from "./panel-chrome.ts";
import { S } from "./styles.ts";

type FieldName = "comparisonId" | "year" | "valuationCutoff" | "historyFile" | "output" | "decisionIds";
const FIELDS: { name: FieldName; label: string; hint: string; required: boolean }[] = [
  { name: "comparisonId", label: "Comparison ID", hint: "Saved public annual comparison ID", required: true },
  { name: "year", label: "Year", hint: "Report year, e.g. 2025", required: true },
  { name: "valuationCutoff", label: "Cutoff", hint: "YYYY-MM-DD", required: true },
  { name: "historyFile", label: "History file", hint: "Complete normalized AccountHistory v1 JSON, outside app state", required: true },
  { name: "output", label: "New HTML", hint: "Existing parent directory, new .html file outside app state", required: true },
  { name: "decisionIds", label: "Decisions", hint: "Optional IDs separated by commas", required: false },
];

export class PrivateAnnualPanel {
  private values: Record<FieldName, string> = { comparisonId: "", year: "", valuationCutoff: "", historyFile: "", output: "", decisionIds: "" };
  private selection = 0;
  private draft: string | null = null;
  private review = false;
  private reviewOffset = 0;
  private reviewMaximum = 0;
  private status = "";

  handleKey(input: string, key: Key): { close?: boolean; privateAnnualExport?: PrivateAnnualExportRequest } {
    if (this.draft !== null) {
      if (key.name === "escape") { this.draft = null; this.status = ""; return {}; }
      if (key.name === "backspace" || key.name === "delete") { this.draft = this.draft.slice(0, -1); return {}; }
      if (key.name === "return") {
        const field = FIELDS[this.selection]!;
        const value = this.draft.trim();
        if (field.required && !value) { this.status = `${field.label} is required.`; return {}; }
        this.values[field.name] = value;
        this.draft = null;
        this.status = "";
        return {};
      }
      if (!key.ctrl && !key.meta && input && !/[\x00-\x1f\x7f]/.test(input) && this.draft.length + input.length <= 4096) this.draft += input;
      return {};
    }
    if (this.review) {
      if (key.name === "escape") { this.review = false; this.reviewOffset = 0; return {}; }
      if (key.name === "up" || key.name === "down") {
        this.reviewOffset = Math.max(0, Math.min(this.reviewMaximum, this.reviewOffset + (key.name === "up" ? -1 : 1)));
        return {};
      }
      if (key.name === "return") return { privateAnnualExport: this.request(), close: true };
      return {};
    }
    if (key.name === "escape") return { close: true };
    if (key.name === "up" || key.name === "down") {
      this.selection = (this.selection + (key.name === "up" ? FIELDS.length : 1)) % (FIELDS.length + 1);
      return {};
    }
    if (key.name !== "return") return {};
    if (this.selection < FIELDS.length) {
      this.draft = this.values[FIELDS[this.selection]!.name];
      this.status = FIELDS[this.selection]!.hint;
      return {};
    }
    const missing = FIELDS.find(field => field.required && !this.values[field.name]);
    if (missing) { this.status = `${missing.label} is required.`; return {}; }
    if (!/^\d{4}$/.test(this.values.year)) { this.status = "Year must be four digits."; return {}; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.values.valuationCutoff)) { this.status = "Cutoff must be YYYY-MM-DD."; return {}; }
    if (!this.values.output.toLowerCase().endsWith(".html")) { this.status = "New HTML must end in .html."; return {}; }
    this.review = true;
    this.reviewOffset = 0;
    this.status = "";
    return {};
  }

  render(buf: Buffer): void {
    const frame = drawPanelFrame(buf, "Private annual export", this.review ? "Review" : "Local file", 3, 1);
    const { inner } = frame;
    buf.text(inner.x, inner.y, truncate("Public comparison is checked before reading the private history file.", inner.w), S.dim);
    if (this.review) {
      const lines = [
        `Comparison ${this.values.comparisonId} · ${this.values.year} · ${this.values.valuationCutoff}`,
        `History path: ${this.values.historyFile}`,
        `New HTML path: ${this.values.output}`,
        `Selected decisions ${this.decisionIds().length}`,
        "The new HTML contains private account values. It remains outside app state.",
      ];
      const rows = lines.flatMap(line => wrap(line, inner.w));
      this.reviewMaximum = Math.max(0, rows.length - frame.contentH);
      this.reviewOffset = Math.min(this.reviewOffset, this.reviewMaximum);
      rows.slice(this.reviewOffset, this.reviewOffset + frame.contentH).forEach((line, index) =>
        buf.text(inner.x, frame.contentY + index, line, S.cream));
      buf.text(inner.x, frame.footerY - 1, truncate(`Up/Down scroll · Enter export · Esc edit · ${this.reviewOffset + 1}-${Math.min(rows.length, this.reviewOffset + frame.contentH)}/${rows.length}`, inner.w), S.gold);
    } else {
      const rows = [...FIELDS.map(field => `${field.label}: ${this.values[field.name] || "<choose>"}`), "Review export"];
      rows.forEach((row, index) => {
        const value = this.draft !== null && index === this.selection ? `${FIELDS[index]!.label}: ${this.draft}|` : row;
        buf.text(inner.x, frame.contentY + index, truncate(`${index === this.selection ? ">" : " "} ${value}`, inner.w), index === this.selection ? S.goldB : S.cream);
      });
      buf.text(inner.x, frame.footerY - 1, truncate(this.status || (this.draft !== null ? "Enter save field · Esc cancel edit" : "Up/Down select · Enter edit/review · Esc close"), inner.w), this.status ? S.gold : S.dim);
    }
    buf.text(inner.x, frame.footerY, truncate("Account values stay in the chosen HTML; no Agent or report storage.", inner.w), S.dim);
  }

  private decisionIds(): string[] { return this.values.decisionIds.split(",").map(id => id.trim()).filter(Boolean); }
  private request(): PrivateAnnualExportRequest {
    return { comparisonId: this.values.comparisonId, year: Number(this.values.year), valuationCutoff: this.values.valuationCutoff,
      historyFile: this.values.historyFile, output: this.values.output, decisionIds: this.decisionIds() };
  }
}
