import { strWidth, truncate } from "./buffer.ts";
import { DIVIDER_CHAR, OVERVIEW_ROW_H, OVERVIEW_SECTION_H, S, pctStyle } from "./styles.ts";
import { fmtPct } from "./format.ts";
import type { PanelSection, Holding, Quote } from "./types.ts";
import type { RenderLine } from "./render-lines.ts";
import type { ConversationView } from "./selection.ts";

type OverviewBlock =
  | { kind: "section-header"; title: string }
  | { kind: "group-header"; title: string; collapsed: boolean; symbolCount: number }
  | { kind: "holding"; row: Holding }
  | { kind: "quote"; row: Quote }
  | { kind: "keyvalue"; row: { label: string; value: string } }
  | { kind: "gap" };

function panelInner(r: { x: number; y: number; w: number; h: number }) {
  return { x: r.x + 2, y: r.y + 1, w: r.w - 4, h: r.h - 2 };
}

function buildOverviewBlocks(sections: PanelSection[]): OverviewBlock[] {
  const blocks: OverviewBlock[] = [];
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
      const gap = Math.max(1, w - strWidth(block.row.label) - strWidth(block.row.value));
      const pad = " ".repeat(gap);
      return [{
        text: `${block.row.label}${pad}${block.row.value}`,
        segments: [
          { text: block.row.label, style: S.dim },
          { text: `${pad}${block.row.value}`, style: S.tableValue },
        ],
      }];
    }
    case "gap":
      return [{ text: "" }];
  }
}

function overviewRowLines(row: Holding, w: number): RenderLine[] {
  const pctTxt = fmtPct(row.pct);
  const code = row.code.split(".")[0] || row.code;
  const codePart = code.padEnd(8);
  const pctPart = pctTxt.padStart(8);
  const nameW = Math.max(0, w - strWidth(codePart) - strWidth(pctPart));
  const namePart = truncate(row.name, nameW);
  const pad = " ".repeat(Math.max(0, nameW - strWidth(namePart)));
  return [{
    text: `${codePart}${namePart}${pad}${pctPart}`,
    segments: [
      { text: codePart, style: S.code },
      { text: namePart, style: S.cream },
      { text: pad, style: {} },
      { text: pctPart, style: pctStyle(row.pct) },
    ],
  }];
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
