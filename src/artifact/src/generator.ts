/**
 * Session JSONL -> Dual-column artifact generator.
 *
 * Dashboard (left): conversation timeline, structured data detection,
 *   K-line charts, metric cards, score tables, factor performance.
 * Trajectory (right tab): structured agent execution trace with
 *   Compact/Audit/Raw view modes (per docs/artifacts-design.md).
 *
 * Detection: paragraph-level (split by \n\n), first match wins:
 *   K-line (OHLC) > Compare factors > Factor bars > Metrics > Score table > Data table > Plain text
 */

import { readFileSync } from "node:fs";
import { esc, renderArtifactTemplate, type ArtifactTemplateInput } from "./template.ts";
import { readWhyjEnvValue } from "../../storage/src/env-keys.ts";
import type { GenerateArtifactInput, GenerateArtifactResult, GenCtx, RawEntry, ContentBlock } from "./types.ts";
export type { GenerateArtifactInput, GenerateArtifactResult } from "./types.ts";
import { tryKline, tryNavChart, tryMetrics, tryScoreTable, tryDataTable, tryFactorBars, tryCompareFactors, renderDataTable } from "./detectors.ts";
import { renderEchartsKline, renderNavEcharts, renderEchartsBars, renderFactorMatrix, renderMetricCards, renderScoreTable, highlight } from "./renderers.ts";
import { renderDock } from "./dock.ts";
import { buildTrajectoryFromSession } from "./trajectory.ts";
import { renderTrajectoryDocument } from "./trajectory-renderer.ts";

function resolveQuantModel(): string {
  return readWhyjEnvValue(process.env as Record<string, string | undefined>, "model") || "whyj-quant";
}

export function generateArtifact(input: GenerateArtifactInput): GenerateArtifactResult | null {
  const raw = readSessionFile(input.sessionPath);
  if (!raw) return null;
  const entries = raw.lines;
  const messageCount = entries.filter((e) => e.type === "message").length;

  const ctx = createGenCtx(entries);
  const quantModel = resolveQuantModel();

  // Build structured trajectory from session entries
  const trajDoc = buildTrajectoryFromSession(
    entries,
    String(raw.header.id ?? "unknown"),
    `run_${Date.now()}`,
  );

  // Auto-detect source URLs from final title + session content
  const finalTitle = input.title || ctx.title;
  const sourceUrls = detectSourceUrls(finalTitle, entries);

  const templateInput: ArtifactTemplateInput = {
    title: input.title || ctx.title,
    sessionId: String(raw.header.id ?? "unknown"),
    model: ctx.model,
    quantModel,
    messageCount,
    createdAt: String(raw.header.timestamp ?? new Date().toISOString()),
    bodyHtml: ctx.dashBody.join("\n"),
    dockHtml: renderDock(ctx, quantModel, sourceUrls),
    trajectoryHtml: renderTrajectoryDocument(trajDoc),
    generatedAt: new Date().toISOString(),
    sourceUrls,
  };

  return {
    html: renderArtifactTemplate(templateInput),
    title: templateInput.title,
    sessionId: templateInput.sessionId,
    messageCount,
  };
}

// ── JSONL ──

function readSessionFile(path: string): { header: Record<string, unknown>; lines: RawEntry[] } | null {
  try {
    const raw = readFileSync(path, "utf-8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return null;
    const h = JSON.parse(lines[0]!) as Record<string, unknown>;
    if (h.type !== "session" || h.version !== 3) return null;
    return { header: h, lines: lines.slice(1).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as RawEntry[] };
  } catch { return null; }
}

// ── Context building ──

function createGenCtx(entries: RawEntry[]): GenCtx {
  const ctx: GenCtx = {
    title: "Untitled", dashBody: [], trajBody: [], metrics: [], scores: null, factors: [], klines: [], compareFactors: [],
    stats: { turnCount: 0, toolCallCount: 0, skillNames: [], firstTs: "", lastTs: "" },
  };

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = entry.message as Record<string, unknown> | undefined;
    if (!msg || typeof msg.role !== "string") continue;
    const role = normalizeRole(msg.role);
    if (!role) continue;

    const ts = typeof entry.timestamp === "string" ? entry.timestamp : "";
    if (ts) {
      if (!ctx.stats.firstTs) ctx.stats.firstTs = ts;
      ctx.stats.lastTs = ts;
    }

    if (role === "assistant" && !ctx.model && typeof msg.model === "string") ctx.model = msg.model;
    if (role === "assistant") ctx.stats.turnCount++;

    renderMessage(ctx, msg, role);
  }

  // Auto-title: extract fund/stock code + name from first user message
  if (ctx.title === "Untitled") {
    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const msg = entry.message as Record<string, unknown> | undefined;
      if (msg?.role !== "user" && msg?.role !== "displayUser") continue;
      const t = extractText(msg.content);
      if (!t || t.trimStart().startsWith("<skill")) continue;
      // Detect fund: "000123" or "OF000123" pattern
      const fundCode = t.match(/\b(\d{6})\b/)?.[1];
      // Detect stock: "300308" or "000001.SZ" pattern
      const stockCode = t.match(/\b(\d{6}\.(?:SZ|SH|BJ))\b/i)?.[1];
      // Detect name: Chinese name + optional suffix, or standalone stock name
      const nameMatch = t.match(/([一-龥]{2,8}(?:ETF|指数|基金|科技|医药|消费|新能源|半导体|机器人|银行|证券|军工|汽车|光伏|芯片|AI|联接[AC]?|股票[AC]?))/)
        // Standalone stock name: 2-4 Chinese chars followed by 6-digit code
        || t.match(/分析\s*([一-龥]{2,4})\s*\d{6}/);
      // Detect sector/keywords (only if no name match)
      const sectorMatch = nameMatch ? null : t.match(/(半导体|机器人|AI|人工智能|新能源|医药|消费|银行|证券|军工|科技|科创|创业|沪深300|中证500)/);
      const code = fundCode || stockCode;
      const name = nameMatch?.[1];
      const sector = sectorMatch?.[1];
      if (code && name) {
        ctx.title = `${name} (${code})`;
      } else if (code && sector) {
        ctx.title = `${sector} — ${code}`;
      } else if (name) {
        ctx.title = name;
      } else if (code) {
        ctx.title = `基金 ${code}`;
      } else {
        ctx.title = cleanPreview(t);
      }
      break;
    }
  }

  return ctx;
}

// ── Message rendering ──

const SKILL_NAME_RE = /<skill\s+name\s*=\s*"([^"]+)"/;

function renderMessage(ctx: GenCtx, msg: Record<string, unknown>, role: string): void {
  const dParts: string[] = [];
  const tParts: string[] = [];
  const content = msg.content;

  if (role === "tool") {
    const text = extractText(content);
    if (text) {
      const toolName = typeof msg.toolName === "string" ? msg.toolName : "";
      const truncated = text.length > 8000 ? text.slice(0, 8000) + "\n… (truncated)" : text;
      tParts.push(`<details class="tr"><summary><span class="tr-dot"></span>${esc(toolName)}</summary><pre>${esc(truncated)}</pre></details>`);
    }
  } else if (role === "assistant" && Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if (block.type === "thinking") {
        const th = String(block.thinking || "").slice(0, 3000);
        tParts.push(`<details class="th"><summary>Thinking</summary><div class="th-body">${esc(th)}</div></details>`);
      } else if (block.type === "text") {
        const text = String(block.text || "");
        if (text) {
          dParts.push(...processText(ctx, text));
          tParts.push(...trajectoryText(text));
        }
      } else if (block.type === "toolCall") {
        ctx.stats.toolCallCount++;
        const name = String(block.name || "");
        const args = formatToolArgs(block.arguments);
        const isSkill = name === "Skill" || name.includes("skill");
        let skillName = "";
        if (name === "Skill") {
          const sm = String(args).match(SKILL_NAME_RE);
          if (sm) { skillName = sm[1]!; if (!ctx.stats.skillNames.includes(skillName)) ctx.stats.skillNames.push(skillName); }
        }
        if (isSkill && skillName) {
          tParts.push(`<div class="tc skill"><span class="tc-dot"></span>Skill: <span class="tc-name">${esc(skillName)}</span></div>`);
        } else {
          const argHtml = args ? `<div class="tc-args">${esc(args)}</div>` : "";
          tParts.push(`<details class="tc"><summary><span class="tc-dot"></span>${esc(name)}</summary>${argHtml}</details>`);
        }
      }
    }
  } else {
    const text = extractText(content);
    if (text) {
      const sm = text.match(SKILL_NAME_RE);
      if (sm) {
        if (!ctx.stats.skillNames.includes(sm[1]!)) ctx.stats.skillNames.push(sm[1]!);
        tParts.push(`<div class="tc skill"><span class="tc-dot"></span>Skill: <span class="tc-name">${esc(sm[1])}</span></div>`);
      }
      let clean = text.replace(/<skill\b[\s\S]*?(?:<\/skill>|\/?>)/g, "").replace(/^[\s\S]*?<\/skill>\s*/g, "");
      const commentIdx = clean.indexOf("<!--");
      if (commentIdx > 0) clean = clean.slice(0, commentIdx);
      clean = clean.trim();
      if (clean && !clean.startsWith("<skill")) {
        dParts.push(...processText(ctx, clean));
        tParts.push(...trajectoryText(clean));
      }
    }
  }

  if (dParts.length > 0) {
    const label = role === "user" ? "User" : "WhyJ Quant";
    const cls = role === "user" ? "user" : "assistant";
    ctx.dashBody.push(`<div class="msg"><div class="msg-role ${cls}"><span class="dot"></span>${label}</div><div class="msg-body">${dParts.join("\n")}</div></div>`);
  }
  if (tParts.length > 0) {
    const label = roleLabels[role] || role;
    const cls = role === "user" ? "user" : role === "assistant" ? "assistant" : "tool";
    ctx.trajBody.push(`<div class="msg"><div class="msg-role ${cls}"><span class="dot"></span>${label}</div><div class="msg-body">${tParts.join("\n")}</div></div>`);
  }
}

const roleLabels: Record<string, string> = { user: "User", assistant: "WhyJ Quant", tool: "Tool" };

// ── Text paragraph detection ──

function processText(ctx: GenCtx, text: string): string[] {
  const parts: string[] = [];
  const paras = text.split(/\n{2,}/);
  for (const para of paras) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    const navChart = tryNavChart(trimmed);
    if (navChart) {
      parts.push(renderNavEcharts(navChart));
      continue;
    }
    const klines = tryKline(trimmed);
    if (klines && klines.length > 0) {
      for (const kl of klines) {
        if (!ctx.klines.some((x) => x.timeframe === kl.timeframe)) ctx.klines.push(kl);
      }
      parts.push(renderEchartsKline(ctx.klines));
      continue;
    }
    const comp = tryCompareFactors(trimmed);
    if (comp) {
      for (const s of comp) { if (!ctx.compareFactors.some((x) => x.name === s.name)) ctx.compareFactors.push(s); }
      continue;
    }
    const bars = tryFactorBars(trimmed);
    if (bars) {
      for (const b of bars) { if (!ctx.factors.some((x) => x.label === b.label)) ctx.factors.push(b); }
      parts.push(bars.length > 8 ? renderFactorMatrix(bars) : renderEchartsBars(bars));
      continue;
    }
    const metrics = tryMetrics(trimmed);
    if (metrics) {
      for (const m of metrics) { if (!ctx.metrics.some((x) => x.label === m.label)) ctx.metrics.push(m); }
      parts.push(renderMetricCards(metrics));
      continue;
    }
    const scores = tryScoreTable(trimmed);
    if (scores) {
      if (!ctx.scores) ctx.scores = scores;
      parts.push(renderScoreTable(scores));
      continue;
    }
    const dataTbl = tryDataTable(trimmed);
    if (dataTbl) {
      parts.push(renderDataTable(dataTbl));
      continue;
    }
    parts.push(`<p>${highlight(esc(trimmed)).replace(/\n/g, "<br>")}</p>`);
  }
  return parts;
}

// ── Trajectory text: tables -> HTML, rest -> raw ──

function trajectoryText(text: string): string[] {
  const parts: string[] = [];
  const paras = text.split(/\n{2,}/);
  for (const para of paras) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    const tbl = tryDataTable(trimmed);
    if (tbl) {
      parts.push(renderDataTable(tbl));
    } else {
      parts.push(`<div class="traj-raw">${esc(trimmed).replace(/\n/g, "<br>")}</div>`);
    }
  }
  return parts;
}

// ── Helpers ──

function formatToolArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  const entries = Object.entries(a);
  if (entries.length === 0) return "";
  if (entries.length === 1) return String(entries[0]![1]);
  return entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n");
}

export function normalizeRole(r: string): "user" | "assistant" | "tool" | null {
  if (r === "user" || r === "displayUser") return "user";
  if (r === "assistant") return "assistant";
  if (r === "toolResult") return "tool";
  return null;
}

export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Array<{ type?: string; text?: string }>)
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text).join("\n\n");
}

function detectSourceUrls(title: string, entries: RawEntry[]): { label: string; url: string }[] {
  const urls: { label: string; url: string }[] = [];
  // Search title and all user messages for codes
  const texts = [title];
  for (const e of entries) {
    if (e.type !== "message") continue;
    const msg = e.message as Record<string, unknown> | undefined;
    if (msg?.role === "user" || msg?.role === "displayUser") {
      texts.push(extractText(msg.content));
    }
  }
  const combined = texts.join(" ");

  // Detect any 6-digit code (fund/ETF or stock)
  const anyCode = combined.match(/\b(\d{6})\b/)?.[1];
  const isFund = anyCode && /ETF|基金|联接|指数/.test(combined);
  const isStock = anyCode && !isFund && /^[36]/.test(anyCode);

  if (anyCode) {
    if (isFund || (!isStock && /^[0158]/.test(anyCode))) {
      urls.push({ label: "雪球", url: `https://danjuanfunds.com/funding/${anyCode}` });
      urls.push({ label: "同花顺", url: `https://fund.10jqka.com.cn/${anyCode}/` });
    } else if (isStock) {
      urls.push({ label: "雪球", url: `https://xueqiu.com/S/${anyCode}` });
      urls.push({ label: "同花顺", url: `https://stockpage.10jqka.com.cn/${anyCode}/` });
    }
  }
  return urls;
}

function cleanPreview(text: string): string {
  let clean = text.replace(/<skill\s[\s\S]*?\/skill>/g, "");
  const commentIdx = clean.indexOf("<!--");
  if (commentIdx > 0) clean = clean.slice(0, commentIdx);
  clean = clean.replace(/\s+/g, " ").trim();
  if (!clean) return "Untitled";
  return clean.length > 80 ? clean.slice(0, 80) + "…" : clean;
}
