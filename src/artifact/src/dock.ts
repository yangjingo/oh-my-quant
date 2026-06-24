/**
 * Analytics dock panel — right sidebar assembly.
 * Renders session stats, market summary, risk metrics, benchmark, factors.
 */
import { esc } from "./template.ts";
import type { GenCtx, Card } from "./types.ts";
// Import renderers needed by dock
import { renderScoreTable, renderComparisonRadar, renderFactorRadar } from "./renderers.ts";
export function renderDock(ctx: GenCtx, quantModel: string, sourceUrls?: { label: string; url: string }[]): string {
  const sections: string[] = [];

  // ── Agent Stats ──
  sections.push(`<div class="dock-title">Session</div>`);
  const s = ctx.stats;
  const elapsed = s.firstTs && s.lastTs ? elapsedStr(s.firstTs, s.lastTs) : "-";
  sections.push(`<div class="mgrid st-grid"><div class="mcard"><div class="ml">Engine</div><div class="mv nt sm">${esc(quantModel)}</div></div><div class="mcard"><div class="ml">Model</div><div class="mv nt sm">${esc(ctx.model || "-")}</div></div><div class="mcard"><div class="ml">Turns</div><div class="mv nt">${s.turnCount}</div></div><div class="mcard"><div class="ml">Tools</div><div class="mv nt">${s.toolCallCount}</div></div><div class="mcard"><div class="ml">Time</div><div class="mv nt sm">${elapsed}</div></div></div>`);
  if (s.skillNames.length > 0) {
    sections.push(`<div class="mgrid st-grid"><div class="mcard"><div class="ml">Skills</div><div class="mv nt sm">${s.skillNames.map((n) => esc(n)).join(", ")}</div></div></div>`);
  }

  // ── Market ──
  if (ctx.klines.length > 0 || ctx.metrics.length > 0 || ctx.scores || ctx.factors.length > 0) {
    sections.push(`<div class="dock-title" style="margin-top:0.25rem">Market</div>`);
    if (ctx.klines.length > 0) {
      const k0 = ctx.klines[0]!;
      const last = k0.rows[k0.rows.length - 1]!;
      const prev = k0.rows[k0.rows.length - 2]!;
      const chg = ((last.close - prev.close) / prev.close * 100);
      const chgCls = chg >= 0 ? "up" : "dn";
      sections.push(`<div class="mgrid"><div class="mcard"><div class="ml">Last Price</div><div class="mv ${chgCls}">${last.close.toFixed(2)}</div></div><div class="mcard"><div class="ml">Change</div><div class="mv ${chgCls}">${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%</div></div><div class="mcard"><div class="ml">Volume</div><div class="mv nt">${last.vol ? (last.vol > 1e8 ? (last.vol/1e8).toFixed(1)+"亿" : (last.vol/1e4).toFixed(1)+"万") : "-"}</div></div><div class="mcard"><div class="ml">Candles</div><div class="mv nt">${k0.rows.length}</div></div></div>`);
    }
  }

  // ── Risk metrics ──
  if (ctx.metrics.length > 0) {
    sections.push(`<div class="dock-title" style="margin-top:0.25rem">Risk Metrics</div>`);
    sections.push(`<div class="mgrid">${ctx.metrics.map((c) => {
      const cls = c.num > 0.001 ? "pos" : c.num < -0.001 ? "neg" : "nt";
      return `<div class="mcard"><div class="ml">${esc(c.label)}</div><div class="mv ${cls}">${esc(c.value)}</div></div>`;
    }).join("")}</div>`);
  }

  // ── Benchmark ──
  if (ctx.scores) {
    sections.push(`<div class="dock-title" style="margin-top:0.25rem">Benchmark</div>`);
    sections.push(renderScoreTable(ctx.scores));
  }

  // ── Comparison radar ──
  if (ctx.compareFactors.length >= 2) {
    sections.push(`<div class="dock-title" style="margin-top:0.25rem">Comparison</div>`);
    sections.push(renderComparisonRadar(ctx.compareFactors));
  }

  // ── Factors ──
  if (ctx.factors.length > 0) {
    sections.push(`<div class="dock-title" style="margin-top:0.25rem">Factor Performance</div>`);
    sections.push(renderFactorRadar(ctx.factors));
  }

  // ── Data Sources ──
  if (sourceUrls && sourceUrls.length > 0) {
    sections.push(`<div class="dock-title" style="margin-top:0.25rem">Sources</div>`);
    sections.push(`<div class="mgrid">${sourceUrls.map(u =>
      `<a class="mcard src-card" href="${esc(u.url)}" target="_blank" rel="noopener"><div class="ml">${esc(u.label)} ↗</div><div class="mv nt sm">${esc(u.url.replace("https://",""))}</div></a>`
    ).join("")}</div>`);
  }

  return sections.join("\n");
}

export function elapsedStr(start: string, end: string): string {
  try {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms <= 0) return "-";
    const min = Math.round(ms / 60000);
    if (min < 1) return "<1m";
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60); const m = min % 60;
    return `${h}h ${m}m`;
  } catch { return "-"; }
}