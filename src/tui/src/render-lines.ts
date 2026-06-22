import { charWidth, sanitizeTerminalText, strWidth, truncate, wrap } from "./buffer.ts";
import type { Style } from "./buffer.ts";
import { S } from "./styles.ts";
import { fmtElapsed } from "./format.ts";
import type { UIMessage } from "./types.ts";
import { formatToolLine } from "../../tools/catalog.ts";

export interface RenderLine {
  text: string;
  style?: Style;
  segments?: { text: string; style?: Style }[];
}

export function buildConversationLines(msgs: UIMessage[], width: number): RenderLine[] {
  const lines: RenderLine[] = [];
  for (const msg of msgs) {
    lines.push(...renderMsg(msg, width));
    lines.push({ text: "" });
  }
  return lines;
}

function renderMsg(msg: UIMessage, width: number): RenderLine[] {
  const lines: RenderLine[] = [];
  const w = Math.max(10, width);
  if (msg.role === "user") {
    const prefix = "▏ ";
    for (const line of wrap(msg.text ?? "", Math.max(1, w - strWidth(prefix)))) {
      lines.push({ text: `▏ ${line}`, style: S.creamB });
    }
  } else if (msg.role === "thinking") {
    const bodyPrefix = "  ";
    const body = sanitizeTerminalText(msg.text ?? "").trim();
    if (body) {
      for (const line of wrap(body, Math.max(1, w - strWidth(bodyPrefix)))) {
        lines.push({ text: `${bodyPrefix}${line}`, style: S.thinking });
      }
    }
  } else if (msg.role === "tool") {
    const t = msg.tool!;
    const status = t.status === "running" ? "●" : t.status === "done" ? "●" : "✗";
    const lineLabel = t.label || formatToolLine(t.name, t.args);
    const elapsed = t.status === "running" ? `  ${fmtElapsed(Date.now() - t.startedAt)}` : "";
    const prefix = `${status} `;
    const body = `${lineLabel}${elapsed}`;
    const wrapped = wrap(body, Math.max(1, w - strWidth(prefix)));
    if (wrapped.length > 0) {
      lines.push({ text: `${prefix}${wrapped[0]}`, style: S.gold });
      for (let i = 1; i < wrapped.length; i++) {
        lines.push({ text: `${" ".repeat(strWidth(prefix))}${wrapped[i]}`, style: S.gold });
      }
    } else {
      lines.push({ text: prefix.trimEnd(), style: S.gold });
    }
    if (t.result) {
      lines.push(...renderToolResultPreview(t.result, w));
    }
  } else if (msg.role === "skill") {
    const sk = msg.skill!;
    const status = sk.status === "running" ? "⚡" : sk.status === "done" ? "⚡" : "✗";
    const elapsed = sk.status === "running" ? `  ${fmtElapsed(Date.now() - sk.startedAt)}` : "";
    const prefix = `${status} `;
    const body = `${sk.label}${elapsed}`;
    const wrapped = wrap(body, Math.max(1, w - strWidth(prefix)));
    if (wrapped.length > 0) {
      lines.push({ text: `${prefix}${wrapped[0]}`, style: S.gold });
      for (let i = 1; i < wrapped.length; i++) {
        lines.push({ text: `${" ".repeat(strWidth(prefix))}${wrapped[i]}`, style: S.gold });
      }
    } else {
      lines.push({ text: prefix.trimEnd(), style: S.gold });
    }
  } else if (msg.role === "error") {
    const prefix = "▏ ERR ";
    for (const line of wrap(msg.text ?? "", Math.max(1, w - strWidth(prefix)))) {
      lines.push({ text: `${prefix}${line}`, style: S.gold });
    }
  } else if (msg.role === "assistant") {
    lines.push(...renderAssistantMessage(msg.text ?? "", w));
  }
  return lines;
}

function renderAssistantMessage(text: string, width: number): RenderLine[] {
  if (looksLikeDoctorReport(text)) {
    return renderDoctorReport(text, width);
  }
  if (looksLikeCompactReceipt(text)) {
    return renderCompactReceipt(text, width);
  }
  return renderStructuredText(text, width);
}

function looksLikeDoctorReport(text: string): boolean {
  return text.startsWith("WhyJ Doctor\n") && text.includes("Credentials");
}

function renderDoctorReport(text: string, width: number): RenderLine[] {
  const lines: RenderLine[] = [];
  const prefix = "▏ ";
  const bodyWidth = Math.max(1, width - strWidth(prefix));
  let mode: "summary" | "credentials" | "hints" = "summary";
  for (const rawLine of sanitizeTerminalText(text).replace(/\r\n/g, "\n").split("\n")) {
    if (rawLine === "Credentials") mode = "credentials";
    else if (rawLine === "Hints") mode = "hints";
    const rendered = renderDoctorReportLine(rawLine, mode);
    for (const row of wrapRenderLine(rendered, bodyWidth)) {
      lines.push({
        text: `${prefix}${row.text}`,
        segments: [
          { text: prefix, style: S.cream },
          ...(row.segments ?? [{ text: row.text, style: row.style ?? S.cream }]),
        ],
      });
    }
  }
  return lines;
}

function renderDoctorReportLine(rawLine: string, mode: "summary" | "credentials" | "hints"): RenderLine {
  if (!rawLine) return { text: "", style: S.cream };
  if (rawLine === "WhyJ Doctor" || rawLine === "Credentials" || rawLine === "Hints") {
    return { text: rawLine, style: S.goldB };
  }
  if (/^-{3,}(  -{3,})*$/.test(rawLine)) {
    return { text: rawLine, style: S.rule };
  }
  if (rawLine.startsWith("- ")) {
    return { text: rawLine, style: S.dim };
  }
  if (rawLine.includes("  ")) {
    const parts = rawLine.split(/\s{2,}/);
    if (mode === "summary") {
      if (parts[0] === "item") return renderHeaderTableLine(rawLine);
      const [item = "", value = ""] = parts;
      return joinStyledColumns([
        { text: item, style: S.gold },
        { text: value, style: item === "status" && value === "ready" ? S.positive : S.cream },
      ]);
    }
    if (mode === "credentials") {
      if (parts[0] === "key") return renderHeaderTableLine(rawLine);
      const [key = "", status = "", source = "", value = ""] = parts;
      const statusStyle = status === "OK" ? S.positive : S.negative;
      return joinStyledColumns([
        { text: key, style: S.gold },
        { text: status, style: statusStyle },
        { text: source, style: source === "missing" ? S.dim : S.cream },
        { text: value, style: value === "-" ? S.dim : S.creamB },
      ]);
    }
  }
  return { text: rawLine, style: S.cream };
}

function looksLikeCompactReceipt(text: string): boolean {
  return text.startsWith("Compacted\n") && text.includes("retention map");
}

function renderCompactReceipt(text: string, width: number): RenderLine[] {
  return renderStructuredText(text, width, renderCompactReceiptLine);
}

type LineRenderer = (rawLine: string) => RenderLine;

function renderStructuredText(
  text: string,
  width: number,
  lineRenderer: LineRenderer = renderStructuredPlainLine,
): RenderLine[] {
  const lines: RenderLine[] = [];
  const prefix = "▏ ";
  const bodyWidth = Math.max(1, width - strWidth(prefix));
  const rawLines = sanitizeTerminalText(text).replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < rawLines.length;) {
    const table = collectTableBlock(rawLines, i);
    if (table) {
      for (const row of renderTableBlock(table.rows, bodyWidth)) {
        pushPrefixedRenderLine(lines, prefix, row, bodyWidth);
      }
      i = table.nextIndex;
      continue;
    }

    const rendered = lineRenderer(rawLines[i] ?? "");
    pushPrefixedRenderLine(lines, prefix, rendered, bodyWidth);
    i++;
  }
  return lines;
}

function pushPrefixedRenderLine(lines: RenderLine[], prefix: string, rendered: RenderLine, bodyWidth: number): void {
  for (const row of wrapRenderLine(rendered, bodyWidth)) {
    lines.push({
      text: `${prefix}${row.text}`,
      segments: [
        { text: prefix, style: S.cream },
        ...(row.segments ?? [{ text: row.text, style: row.style ?? S.cream }]),
      ],
    });
  }
}

function renderStructuredPlainLine(rawLine: string): RenderLine {
  if (!rawLine) return { text: "", style: S.cream };
  if (isSectionTitle(rawLine)) return { text: rawLine, style: S.chartTitle };
  if (/^-{3,}$/.test(rawLine.trim())) return { text: rawLine, style: S.tableRule };
  if (containsChartGlyph(rawLine)) return renderChartGlyphLine(rawLine);
  return { text: rawLine, style: S.cream };
}

function isSectionTitle(rawLine: string): boolean {
  const line = rawLine.trim();
  return /^(⌁|┃|▥|line chart|sparkline|trend|equity|curve|benchmark|alpha|excess|bar chart|bars|histogram|volume|exposure|allocation|drawdown|underwater|走势|曲线|基准|超额|柱状图|柱形图|直方图|成交量|暴露|配置|回撤|k-line|kline|candlestick|candle|ohlc|k线|K线)(?:\s|:|$)/i.test(line);
}

interface ParsedTableRow {
  cells: string[];
  divider: boolean;
}

interface ParsedTableBlock {
  rows: ParsedTableRow[];
  nextIndex: number;
}

function collectTableBlock(rawLines: string[], startIndex: number): ParsedTableBlock | null {
  const rows: ParsedTableRow[] = [];
  let index = startIndex;
  while (index < rawLines.length) {
    const rawLine = rawLines[index] ?? "";
    if (!rawLine.trim()) break;
    const parsed = parseTableRow(rawLine);
    if (!parsed) break;
    rows.push(parsed);
    index++;
  }

  if (rows.length < 2) return null;
  const nonDivider = rows.filter((row) => !row.divider);
  if (nonDivider.length < 2) return null;
  const maxCols = Math.max(...nonDivider.map((row) => row.cells.length));
  if (maxCols < 2) return null;
  const consistentRows = nonDivider.filter((row) => row.cells.length >= Math.min(2, maxCols));
  if (consistentRows.length < 2) return null;
  const hasDivider = rows.some((row) => row.divider);
  const hasChartGlyph = rawLines.slice(startIndex, index).some((line) => containsChartGlyph(line));
  if (!hasDivider && hasChartGlyph) return null;

  return { rows, nextIndex: index };
}

function parseTableRow(rawLine: string): ParsedTableRow | null {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (trimmed.includes("|")) {
    const cells = trimmed
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell, index, all) => cell || (index > 0 && index < all.length - 1));
    if (cells.length < 2) return null;
    return { cells, divider: cells.every(isDividerCell) };
  }
  if (!/\S\s{2,}\S/.test(rawLine)) return null;
  const cells = trimmed.split(/\s{2,}/).map((cell) => cell.trim());
  if (cells.length < 2) return null;
  return { cells, divider: cells.every(isDividerCell) };
}

function isDividerCell(cell: string): boolean {
  return /^:?-{3,}:?$/.test(cell) || /^[─-]{3,}$/.test(cell);
}

function renderTableBlock(rows: ParsedTableRow[], maxWidth: number): RenderLine[] {
  const colCount = Math.max(...rows.map((row) => row.cells.length));
  const widths = fitTableWidths(
    Array.from({ length: colCount }, (_, col) =>
      Math.max(1, ...rows
        .filter((row) => !row.divider)
        .map((row) => strWidth(row.cells[col] ?? ""))),
    ),
    maxWidth,
  );
  const firstContentIndex = rows.findIndex((row) => !row.divider);
  const explicitHeaderIndex = firstContentIndex >= 0 && rows[firstContentIndex + 1]?.divider ? firstContentIndex : -1;
  const contentRows = rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => !row.divider);
  const header = explicitHeaderIndex >= 0
    ? contentRows.find(({ rowIndex }) => rowIndex === explicitHeaderIndex) ?? contentRows[0]
    : contentRows[0];
  if (!header) return [];
  const headerCells = header.row.cells;
  const bodyRows = contentRows.filter(({ rowIndex }) => rowIndex !== header.rowIndex);
  const out: RenderLine[] = [
    renderTableRule(widths),
    renderTableContentRow(header.row, widths, headerCells, true),
    renderTableRule(widths),
  ];
  for (const { row } of bodyRows) {
    out.push(renderTableContentRow(row, widths, headerCells, false));
  }
  out.push(renderTableRule(widths));
  return out;
}

function fitTableWidths(widths: number[], maxWidth: number): number[] {
  const fitted = widths.map((width) => Math.max(1, width));
  const minLastWidth = Math.min(18, Math.max(8, maxWidth - (fitted.length - 1) * 4));
  while (tableWidth(fitted) > maxWidth && fitted.length > 0) {
    let idx = fitted.length - 1;
    for (let i = fitted.length - 1; i >= 0; i--) {
      if (fitted[i] > fitted[idx]) idx = i;
    }
    const minWidth = idx === fitted.length - 1 ? minLastWidth : 4;
    if (fitted[idx] <= minWidth) break;
    fitted[idx]--;
  }
  return fitted;
}

function tableWidth(widths: number[]): number {
  return widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * 2;
}

function renderTableRule(widths: number[]): RenderLine {
  const text = "─".repeat(tableWidth(widths));
  return { text, style: S.tableRule };
}

function renderTableContentRow(
  row: ParsedTableRow,
  widths: number[],
  headerCells: string[],
  isHeader: boolean,
): RenderLine {
  const columns = widths.map((width, colIndex) => {
    const raw = row.cells[colIndex] ?? "";
    return {
      text: padDisplayRight(truncate(raw, width), width),
      style: tableCellStyle(raw, headerCells[colIndex] ?? "", colIndex, isHeader),
    };
  });
  return joinStyledColumnsWithExactSpacing(columns);
}

function padDisplayRight(value: string, width: number): string {
  const pad = Math.max(0, width - strWidth(value));
  return `${value}${" ".repeat(pad)}`;
}

function joinStyledColumnsWithExactSpacing(columns: { text: string; style?: Style }[]): RenderLine {
  const segments: { text: string; style?: Style }[] = [];
  columns.forEach((column, idx) => {
    segments.push({ text: column.text, style: column.style });
    if (idx < columns.length - 1) segments.push({ text: "  ", style: S.tableSpacing });
  });
  return {
    text: columns.map((column) => column.text).join("  "),
    segments,
  };
}

function tableCellStyle(cell: string, header: string, colIndex: number, isHeader: boolean): Style {
  if (isHeader) return S.tableHeader;
  const semantic = semanticCellStyle(cell, header);
  if (semantic) return semantic;
  if (colIndex === 0) return S.tableKey;
  if (containsChartGlyph(cell)) return chartGlyphStyle(cell);
  if (/^[A-D][+-]?$/.test(cell.trim())) return S.tableHeader;
  return S.tableValue;
}

function semanticCellStyle(cell: string, header: string): Style | null {
  const text = cell.trim();
  if (!text) return S.tableNote;
  const lower = text.toLowerCase();
  const headerLower = header.toLowerCase();
  if (/^(ok|ready|kept|pass|passed|healthy|valid|buy|long|up)$/.test(lower)) return S.tablePositive;
  if (/^(missing|error|failed|fail|invalid|breach|risk|sell|short|down)$/.test(lower)) return S.tableNegative;
  if (/[▲↑]/.test(text) || /^\+\d/.test(text)) return S.tableGain;
  if (/[▼↓]/.test(text) || /^-\d/.test(text)) return S.tableLoss;
  if (/(dd|drawdown|var|cvar|loss|breach|risk|回撤|风险)/i.test(headerLower) && /^-?\d/.test(text)) return S.tableLoss;
  if (/(score|grade|sharpe|cagr|return|收益|评分|夏普)/i.test(headerLower) && /^[-+]?\d/.test(text)) {
    if (/(score|grade|sharpe|评分|夏普)/i.test(headerLower)) {
      return /^-/.test(text) ? S.tableNegative : S.tablePositive;
    }
    return /^-/.test(text) ? S.tableLoss : S.tableGain;
  }
  if (/^(n\/a|-)$/.test(lower)) return S.tableNote;
  return null;
}

const SPARK_CHARS = "▁▂▃▄▅▆▇█";
const BAR_CHARS = "░▒▓▏▎▍▌▋▊▉";
const CANDLE_CHARS = "▮▯┃│╽╿┼╷╵▲▼△▽─";
const FIGURE_ICON_CHARS = "⌁▥α⊥σ";

function containsChartGlyph(text: string): boolean {
  return [...text].some((ch) => SPARK_CHARS.includes(ch) || BAR_CHARS.includes(ch) || CANDLE_CHARS.includes(ch) || FIGURE_ICON_CHARS.includes(ch));
}

function chartGlyphStyle(text: string): Style {
  if (/[▼▽↓]/.test(text) || /^-\d/.test(text.trim())) return S.chartDown;
  if (/[▲△↑]/.test(text) || /^\+\d/.test(text.trim())) return S.chartUp;
  return S.chartLine;
}

function renderChartGlyphLine(rawLine: string): RenderLine {
  const segments: { text: string; style?: Style }[] = [];
  const parts = rawLine.match(/\s+|\S+/g) ?? [];
  for (const part of parts) {
    segments.push({ text: part, style: chartTokenStyle(part) });
  }
  return { text: rawLine, segments };
}

function chartTokenStyle(token: string): Style {
  if (/^\s+$/.test(token)) return S.tableSpacing;
  if ([...token].some((ch) => SPARK_CHARS.includes(ch))) return S.chartLine;
  if ([...token].some((ch) => BAR_CHARS.includes(ch))) return S.chartLine;
  if (/[▲△↑]/.test(token) || /^\+\d/.test(token)) return S.chartUp;
  if (/[▼▽↓]/.test(token) || /^-\d/.test(token)) return S.chartDown;
  if ([...token].some((ch) => CANDLE_CHARS.includes(ch))) return S.chartLine;
  if (/^(⌁|▥|α|EQ|NAV|PX|RET)$/i.test(token)) return S.chartLine;
  if (/^(BM|IDX|BENCH|DD|VOL|σ|⊥)$/i.test(token)) return S.chartMuted;
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return S.chartMuted;
  return S.tableValue;
}

function renderCompactReceiptLine(rawLine: string): RenderLine {
  if (!rawLine) return { text: "", style: S.cream };
  if (rawLine === "Compacted" || rawLine === "quant context kept" || rawLine === "retention map") {
    return { text: rawLine, style: S.tableHeader };
  }
  if (rawLine.startsWith("## ") || rawLine.startsWith("### ")) {
    return { text: rawLine, style: S.tableHeader };
  }
  if (rawLine.includes("█")) return renderRetentionMapLine(rawLine);
  return renderStructuredPlainLine(rawLine);
}

function wrapRenderLine(line: RenderLine, maxWidth: number): RenderLine[] {
  const plain = line.text;
  if (strWidth(plain) <= maxWidth) return [line];
  const wrapped = wrap(plain, maxWidth);
  if (!line.segments || line.segments.length === 0) {
    return wrapped.map((text) => ({ text, style: line.style }));
  }
  const out: RenderLine[] = [];
  let offset = 0;
  for (const chunk of wrapped) {
    const chunkWidth = strWidth(chunk);
    out.push({ text: chunk, segments: sliceSegmentsByWidth(line.segments, offset, chunkWidth) });
    offset += chunkWidth;
  }
  return out;
}

function sliceSegmentsByWidth(
  segments: { text: string; style?: Style }[],
  startWidth: number,
  takeWidth: number,
): { text: string; style?: Style }[] {
  let skipped = 0;
  let taken = 0;
  const out: { text: string; style?: Style }[] = [];
  for (const seg of segments) {
    let segText = "";
    let segWidth = 0;
    for (const ch of seg.text) {
      const cw = charWidth(ch);
      if (skipped + segWidth + cw <= startWidth) {
        segWidth += cw;
        continue;
      }
      if (taken + cw > takeWidth) break;
      segText += ch;
      segWidth += cw;
      taken += cw;
    }
    skipped += strWidth(seg.text);
    if (segText) out.push({ text: segText, style: seg.style });
    if (taken >= takeWidth) break;
  }
  return out;
}

function renderHeaderTableLine(line: string): RenderLine {
  const parts = line.split(/\s{2,}/);
  return joinStyledColumns(parts.map((part) => ({ text: part, style: S.tableHeader })));
}

function renderMetricTableLine(line: string): RenderLine {
  const parts = line.split(/\s{2,}/);
  const [label = "", value = "", note = ""] = parts;
  return joinStyledColumns([
    { text: label, style: S.tableKey },
    { text: value, style: /K|M|\d+\/\d+/.test(value) ? S.tableStrong : S.tableValue },
    { text: note, style: S.tableNote },
  ]);
}

function renderQuantTableLine(line: string): RenderLine {
  const parts = line.split(/\s{2,}/);
  const [field = "", status = "", detail = ""] = parts;
  const statusStyle = status.trim() === "kept" ? S.tablePositive : S.tableNegative;
  return joinStyledColumns([
    { text: field, style: S.tableKey },
    { text: status, style: statusStyle },
    { text: detail, style: S.tableValue },
  ]);
}

function renderRetentionMapLine(line: string): RenderLine {
  const match = /^(.+?)\s{2,}([█░]+)\s{2,}(.+)$/.exec(line);
  if (!match) return { text: line, style: S.cream };
  const [, label, meter, status] = match;
  const lower = status.toLowerCase();
  const meterStyle =
    lower.includes("missing") ? S.tableNegative : S.chartLine;
  const statusStyle =
    lower.includes("missing") ? S.tableNegative
      : lower.includes("kept") ? S.tablePositive
        : S.tableHeader;
  return joinStyledColumns([
    { text: label, style: S.tableKey },
    { text: meter, style: meterStyle },
    { text: status, style: statusStyle },
  ]);
}

function joinStyledColumns(columns: { text: string; style?: Style }[]): RenderLine {
  const segments: { text: string; style?: Style }[] = [];
  columns.forEach((column, idx) => {
    segments.push({ text: column.text, style: column.style });
    if (idx < columns.length - 1) segments.push({ text: "  ", style: S.tableSpacing });
  });
  return {
    text: columns.map((column) => column.text).join("  "),
    segments,
  };
}

function renderToolResultPreview(result: string, width: number): RenderLine[] {
  const maxChars = 900;
  const clipped = result.length > maxChars ? `${result.slice(0, maxChars)}...` : result;
  const rawLines = sanitizeTerminalText(clipped).replace(/\r\n/g, "\n").split("\n");
  const diffLike = rawLines.some(isDiffLine);
  const chartLike = rawLines.some((line) => containsChartGlyph(line) || isSectionTitle(line));
  const maxLines = chartLike ? 12 : 3;
  const visible = rawLines.slice(0, maxLines);
  const out: RenderLine[] = [];
  for (let i = 0; i < visible.length; i++) {
    const raw = visible[i] || "";
    const prefix = i === 0 ? "  ⎿ " : "    ";
    const rendered = renderToolPreviewLine(raw, diffLike);
    const wrapped = wrapRenderLine(rendered, Math.max(1, width - strWidth(prefix)));
    if (wrapped.length === 0) out.push({ text: prefix.trimEnd(), style: S.dim });
    for (let j = 0; j < wrapped.length; j++) {
      const row = wrapped[j]!;
      const rowPrefix = j === 0 ? prefix : "    ";
      out.push({
        text: `${rowPrefix}${row.text}`,
        segments: [
          { text: rowPrefix, style: S.dim },
          ...(row.segments ?? [{ text: row.text, style: row.style ?? S.dim }]),
        ],
      });
    }
  }
  if (rawLines.length > maxLines) {
    out.push({ text: `    ... ${rawLines.length - maxLines} more lines`, style: S.dim });
  }
  return out;
}

function renderToolPreviewLine(raw: string, diffLike: boolean): RenderLine {
  if (diffLike) return { text: raw, style: diffLineStyle(raw) };
  if (containsChartGlyph(raw) || isSectionTitle(raw)) return renderStructuredPlainLine(raw);
  return { text: raw, style: S.dim };
}

function isDiffLine(line: string): boolean {
  return /^(diff --git|index |--- |\+\+\+ |@@ |[+-])/.test(line);
}

function diffLineStyle(line: string): Style {
  if (/^\+/.test(line) && !/^\+\+\+ /.test(line)) return S.positive;
  if (/^-/.test(line) && !/^--- /.test(line)) return S.negative;
  if (/^@@ /.test(line)) return S.gold;
  if (/^(diff --git|index |--- |\+\+\+ )/.test(line)) return S.goldDim;
  return S.dim;
}
