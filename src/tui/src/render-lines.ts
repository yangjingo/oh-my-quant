import { charWidth, sanitizeTerminalText, strWidth, wrap } from "./buffer.ts";
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
  if (looksLikeCompactReceipt(text)) {
    return renderCompactReceipt(text, width);
  }
  const prefix = "▏ ";
  return wrap(text, Math.max(1, width - strWidth(prefix))).map((line) => ({ text: `▏ ${line}`, style: S.cream }));
}

function looksLikeCompactReceipt(text: string): boolean {
  return text.startsWith("Compacted\n") && text.includes("retention map");
}

function renderCompactReceipt(text: string, width: number): RenderLine[] {
  const lines: RenderLine[] = [];
  const prefix = "▏ ";
  const bodyWidth = Math.max(1, width - strWidth(prefix));
  let mode: "metrics" | "quant" | "retention" | "summary" = "metrics";
  for (const rawLine of sanitizeTerminalText(text).replace(/\r\n/g, "\n").split("\n")) {
    if (rawLine.startsWith("## ")) mode = "summary";
    else if (rawLine === "quant context kept") mode = "quant";
    else if (rawLine === "retention map") mode = "retention";
    const rendered = renderCompactReceiptLine(rawLine, mode);
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

function wrapRenderLine(line: RenderLine, maxWidth: number): RenderLine[] {
  const plain = line.text;
  if (strWidth(plain) <= maxWidth || !line.segments || line.segments.length === 0) return [line];
  const wrapped = wrap(plain, maxWidth);
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

function renderCompactReceiptLine(
  rawLine: string,
  mode: "metrics" | "quant" | "retention" | "summary",
): RenderLine {
  if (!rawLine) return { text: "", style: S.cream };
  if (rawLine === "Compacted" || rawLine === "quant context kept" || rawLine === "retention map") {
    return { text: rawLine, style: S.goldB };
  }
  if (/^-{3,}(  -{3,})*$/.test(rawLine)) {
    return { text: rawLine, style: S.rule };
  }
  if (rawLine.startsWith("## ")) {
    return { text: rawLine, style: S.goldB };
  }
  if (rawLine.startsWith("### ")) {
    return { text: rawLine, style: S.gold };
  }
  if (mode === "retention" && rawLine.includes("█")) {
    return renderRetentionMapLine(rawLine);
  }
  if (rawLine.includes("  ")) {
    if (rawLine.trimStart().startsWith("metric") || rawLine.trimStart().startsWith("field")) {
      return renderHeaderTableLine(rawLine);
    }
    if (mode === "metrics") return renderMetricTableLine(rawLine);
    if (mode === "quant") return renderQuantTableLine(rawLine);
  }
  if (/^- /.test(rawLine) || /^\d+\./.test(rawLine)) {
    return { text: rawLine, style: S.cream };
  }
  return { text: rawLine, style: S.cream };
}

function renderHeaderTableLine(line: string): RenderLine {
  const parts = line.split(/\s{2,}/);
  return joinStyledColumns(parts.map((part) => ({ text: part, style: S.goldB })));
}

function renderMetricTableLine(line: string): RenderLine {
  const parts = line.split(/\s{2,}/);
  const [label = "", value = "", note = ""] = parts;
  return joinStyledColumns([
    { text: label, style: S.gold },
    { text: value, style: /K|M|\d+\/\d+/.test(value) ? S.creamB : S.cream },
    { text: note, style: S.dim },
  ]);
}

function renderQuantTableLine(line: string): RenderLine {
  const parts = line.split(/\s{2,}/);
  const [field = "", status = "", detail = ""] = parts;
  const statusStyle = status.trim() === "kept" ? S.positive : S.negative;
  return joinStyledColumns([
    { text: field, style: S.gold },
    { text: status, style: statusStyle },
    { text: detail, style: S.cream },
  ]);
}

function renderRetentionMapLine(line: string): RenderLine {
  const match = /^(.+?)\s{2,}([█░]+)\s{2,}(.+)$/.exec(line);
  if (!match) return { text: line, style: S.cream };
  const [, label, meter, status] = match;
  const lower = status.toLowerCase();
  const meterStyle =
    lower.includes("missing") ? S.negative
      : lower.includes("kept") ? S.positive
        : S.gold;
  const statusStyle =
    lower.includes("missing") ? S.negative
      : lower.includes("kept") ? S.positive
        : S.goldB;
  return joinStyledColumns([
    { text: label, style: S.gold },
    { text: meter, style: meterStyle },
    { text: status, style: statusStyle },
  ]);
}

function joinStyledColumns(columns: { text: string; style?: Style }[]): RenderLine {
  const segments: { text: string; style?: Style }[] = [];
  columns.forEach((column, idx) => {
    segments.push({ text: column.text, style: column.style });
    if (idx < columns.length - 1) segments.push({ text: "  ", style: S.dim });
  });
  return {
    text: columns.map((column) => column.text).join("  "),
    segments,
  };
}

function renderToolResultPreview(result: string, width: number): RenderLine[] {
  const maxLines = 3;
  const maxChars = 900;
  const clipped = result.length > maxChars ? `${result.slice(0, maxChars)}...` : result;
  const rawLines = sanitizeTerminalText(clipped).replace(/\r\n/g, "\n").split("\n");
  const diffLike = rawLines.some(isDiffLine);
  const visible = rawLines.slice(0, maxLines);
  const out: RenderLine[] = [];
  for (let i = 0; i < visible.length; i++) {
    const raw = visible[i] || "";
    const prefix = i === 0 ? "  ⎿ " : "    ";
    const style = diffLike ? diffLineStyle(raw) : S.dim;
    const wrapped = wrap(raw, Math.max(1, width - strWidth(prefix)));
    if (wrapped.length === 0) {
      out.push({ text: prefix.trimEnd(), style });
      continue;
    }
    for (let j = 0; j < wrapped.length; j++) {
      out.push({ text: `${j === 0 ? prefix : "    "}${wrapped[j]}`, style });
    }
  }
  if (rawLines.length > maxLines) {
    out.push({ text: `    ... ${rawLines.length - maxLines} more lines`, style: S.dim });
  }
  return out;
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
