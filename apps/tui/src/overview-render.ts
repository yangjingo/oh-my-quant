import { strWidth, truncate } from "./buffer.ts";
import { DIVIDER_CHAR, OVERVIEW_ROW_H, OVERVIEW_SECTION_H, S, pctStyle } from "./styles.ts";
import { fmtPct } from "./format.ts";
import type { PanelSection, Holding, Quote } from "../../../src/types/ui.ts";
import type { RenderLine } from "./render-lines.ts";
import type { ConversationView } from "./selection.ts";

type OverviewBlock =
  | { kind: "section-header"; title: string }
  | { kind: "group-header"; title: string; collapsed: boolean; symbolCount: number }
  | { kind: "holding"; row: Holding }
  | { kind: "quote"; row: Quote }
  | { kind: "keyvalue"; row: { label: string; value: string } }
  | { kind: "gap" }
  | { kind: "refresh"; lines: RenderLine[] };

function panelInner(r: { x: number; y: number; w: number; h: number }) {
  return { x: r.x + 2, y: r.y + 1, w: r.w - 4, h: r.h - 2 };
}

function buildOverviewBlocks(sections: PanelSection[]): OverviewBlock[] {
  const blocks: OverviewBlock[] = [];
  const refresh = sections.find(section => section.refresh)?.refresh;
  if (refresh) {
    const lines: RenderLine[] = [{ text: `Refresh: ${refresh.at ?? "--"}`, style: S.dim }];
    const cues = { idle: "Waiting for refresh", fetching: "Loading · ~ previous", success: "", partial: "", unavailable: "No data · ! old / -- missing", timeout: "Timeout · ! old / -- missing", error: "Failed · ! old / -- missing" };
    if (cues[refresh.status]) lines.push({ text: cues[refresh.status], style: S.dim });
    if (refresh.retryKey) lines.push({ text: `Retry failed: ${refresh.retryKey}`, style: S.dim });
    blocks.push({ kind: "refresh", lines }, { kind: "gap" });
  }
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (sec.kind === "group") {
      blocks.push({ kind: "group-header", title: sec.title, collapsed: sec.collapsed, symbolCount: sec.rows.length });
      if (!sec.collapsed) {
        for (const row of sec.rows) blocks.push({ kind: "holding", row });
      }
    } else {
      blocks.push({ kind: "section-header", title: sec.title });
      if (sec.kind === "holdings") {
        for (const row of sec.rows) blocks.push({ kind: "holding", row });
      } else if (sec.kind === "quotes") {
        for (const row of sec.rows) blocks.push({ kind: "quote", row });
      } else if (sec.kind === "keyvalue") {
        for (const row of sec.rows) blocks.push({ kind: "keyvalue", row });
      }
    }
    if (i < sections.length - 1) blocks.push({ kind: "gap" });
  }
  return blocks;
}

function overviewBlockHeight(block: OverviewBlock): number {
  switch (block.kind) {
    case "refresh": return block.lines.length;
    case "section-header": return OVERVIEW_SECTION_H;
    case "group-header": return OVERVIEW_SECTION_H;
    case "quote":
    case "holding": return OVERVIEW_ROW_H;
    case "keyvalue": return 1;
    case "gap": return 1;
  }
}

export function overviewContentHeight(sections: PanelSection[]): number {
  return buildOverviewBlocks(sections).reduce((n, b) => n + overviewBlockHeight(b), 0);
}

function overviewBlockToLines(block: OverviewBlock, w: number): RenderLine[] {
  switch (block.kind) {
    case "refresh": return block.lines.map(line => ({ ...line, text: truncate(line.text, w) }));
    case "section-header": {
      const lines: RenderLine[] = [
        {
          text: `▎ ${block.title}`,
          style: S.creamB,
          segments: [
            { text: "▎ ", style: S.gold },
            { text: block.title, style: S.creamB },
          ],
        },
        { text: DIVIDER_CHAR.repeat(Math.max(0, w)), style: S.rule },
      ];
      while (lines.length < overviewBlockHeight(block)) lines.push({ text: "" });
      return lines;
    }
    case "group-header": {
      const indicator = block.collapsed ? "▶" : "▼";
      const countTxt = `${block.symbolCount}`;
      const titleText = `${indicator} ${block.title}`;
      const lines: RenderLine[] = [
        {
          text: `▎ ${titleText}`,
          style: S.creamB,
          segments: [
            { text: "▎ ", style: S.gold },
            { text: indicator, style: S.dim },
            { text: ` ${block.title}`, style: S.creamB },
          ],
        },
        {
          text: DIVIDER_CHAR.repeat(Math.max(0, w)),
          style: S.rule,
          segments: [
            { text: DIVIDER_CHAR.repeat(Math.max(0, w - countTxt.length - 1)), style: S.rule },
            { text: ` ${countTxt}`, style: S.dim },
          ],
        },
      ];
      while (lines.length < overviewBlockHeight(block)) lines.push({ text: "" });
      return lines;
    }
    case "holding":
    case "quote":
      return overviewRowLines(block.row, w);
    case "keyvalue": {
      const label = truncate(block.row.label, Math.max(0, w - 1));
      const value = truncate(block.row.value, Math.max(0, w - strWidth(label) - 1));
      const gap = Math.max(1, w - strWidth(label) - strWidth(value));
      const pad = " ".repeat(gap);
      return [{
        text: `${label}${pad}${value}`,
        segments: [
          { text: label, style: S.dim },
          { text: `${pad}${value}`, style: S.tableValue },
        ],
      }];
    }
    case "gap":
      return [{ text: "" }];
  }
}

function overviewRowLines(row: Holding, w: number): RenderLine[] {
  const marker = row.refreshState === "refreshing" ? "~" : row.refreshState === "stale" || row.observation?.state === "outside-window" ? "!" : " ";
  const pctTxt = `${fmtPct(row.pct)}${marker}`;
  const code = truncate(row.observation?.symbol ?? row.code, Math.max(0, w - 8));
  const codePart = code.padEnd(Math.min(Math.max(8, strWidth(code) + 1), Math.max(0, w - 8)));
  const pctPart = pctTxt.padStart(8);
  const nameW = Math.max(0, w - strWidth(codePart) - strWidth(pctPart));
  const namePart = truncate(row.name, nameW);
  const pad = " ".repeat(Math.max(0, nameW - strWidth(namePart)));
  const lines: RenderLine[] = [{
    text: `${codePart}${namePart}${pad}${pctPart}`,
    segments: [
      { text: codePart, style: S.code },
      { text: namePart, style: S.cream },
      { text: pad, style: {} },
      { text: pctPart, style: pctStyle(row.pct) },
    ],
  }];
  while (lines.length < OVERVIEW_ROW_H) lines.push({ text: "" });
  return lines;
}

export function buildOverviewLines(sections: PanelSection[], innerW: number): RenderLine[] {
  if (sections.length === 0) {
    return [
      { text: "No tool result yet.", style: S.dim },
      { text: "Run a slash command or ask AI", style: S.dim },
      { text: "to update this panel.", style: S.dim },
    ];
  }
  const lines: RenderLine[] = [];
  for (const block of buildOverviewBlocks(sections)) {
    lines.push(...overviewBlockToLines(block, innerW));
  }
  return lines;
}

export function overviewMaxScrollTop(sections: PanelSection[], innerH: number): number {
  return Math.max(0, overviewContentHeight(sections) - innerH);
}

export function buildOverviewView(
  sections: PanelSection[],
  r: { x: number; y: number; w: number; h: number },
  scrollFromTop: number = 0,
): ConversationView {
  const inner = panelInner(r);
  const lines = buildOverviewLines(sections, inner.w);
  const maxTop = Math.max(0, lines.length - inner.h);
  const top = Math.min(Math.max(0, scrollFromTop), maxTop);
  return { inner, clipEnd: r.x + r.w, lines, startLineIdx: top };
}
