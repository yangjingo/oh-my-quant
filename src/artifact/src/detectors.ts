/**
 * Content detection — structured data extraction from LLM text output.
 * Pure functions: no GenCtx dependency, operate on raw text only.
 */
import { esc } from "./template.ts";
import type { KlineData, OhlcRow, Card, ScoreTable, FactorBar, FactorSeries } from "./types.ts";

// ── K-line detection (multi-timeframe) ──

export const KL_PATTERNS = [
  { keys: ["日期","开盘","最高","最低","收盘"], cols: [0,1,2,3,4] as const },
  { keys: ["date","open","high","low","close"], cols: [0,1,2,3,4] as const },
  { keys: ["周","开盘","最高","最低","收盘"], cols: [0,1,2,3,4] as const },
  { keys: ["月","开盘","最高","最低","收盘"], cols: [0,1,2,3,4] as const },
  { keys: ["季","开盘","最高","最低","收盘"], cols: [0,1,2,3,4] as const },
];

const TF_LABEL_RE = /[─━]*\s*(日K|周K|月K|季K|年K|Daily|Weekly|Monthly|Quarterly|Yearly)\s*[─━]*/i;
const TF_LABELS: Record<string, string> = { "日k": "日K", "周k": "周K", "月k": "月K", "季k": "季K", "年k": "年K", "daily": "日K", "weekly": "周K", "monthly": "月K", "quarterly": "季K", "yearly": "年K" };

export function tryKline(text: string): KlineData[] | null {
  // Multi-section format: sections separated by "─── 日K ───" style headers
  const lines = text.split("\n");
  const sections: { tf: string; lines: string[] }[] = [];
  let curTf = "";
  let curLines: string[] = [];

  for (const line of lines) {
    const tfm = line.trim().match(TF_LABEL_RE);
    if (tfm && !line.includes("开盘") && !line.includes("最高")) {
      if (curLines.length > 0 && curTf) sections.push({ tf: curTf, lines: curLines });
      const raw = tfm[1]!.toLowerCase();
      curTf = TF_LABELS[raw] || tfm[1]!;
      curLines = [];
      continue;
    }
    curLines.push(line);
  }
  if (curLines.length > 0 && curTf) sections.push({ tf: curTf, lines: curLines });

  // If sections found, parse each
  if (sections.length >= 2) {
    const results: KlineData[] = [];
    for (const sec of sections) {
      const kd = parseKlineTable(sec.lines.join("\n"));
      if (kd) { kd.timeframe = sec.tf; results.push(kd); }
    }
    return results.length > 0 ? results : null;
  }

  // Fallback: parse as single table, try to infer timeframe from header
  const kd = parseKlineTable(text);
  if (!kd) return null;
  // Infer timeframe from first header column
  const h0 = kd.header[0]?.toLowerCase() || "";
  if (h0.includes("周") || h0.includes("week")) kd.timeframe = "周K";
  else if (h0.includes("月") || h0.includes("month")) kd.timeframe = "月K";
  else kd.timeframe = "日K";
  return [kd];
}

export function parseKlineTable(text: string): KlineData | null {
  const lines = text.split("\n")
    .filter((l) => l.trim())
    .filter((l) => !TF_LABEL_RE.test(l.trim()));
  if (lines.length < 3) return null;
  const sep = detectSep(lines);
  if (!sep) return null;
  const rows = lines.map((l) => splitCols(l, sep));
  const nCols = rows[0]!.length;
  if (nCols < 5 || !rows.every((r) => r.length === nCols)) return null;
  const header = rows[0]!.map((c) => c.trim());
  const data = rows.slice(1).map((r) => r.map((c) => c.trim()));

  for (const pat of KL_PATTERNS) {
    const h = header.map((c) => c.toLowerCase().replace(/\s/g, ""));
    let matched = 0;
    for (const key of pat.keys) {
      if (h.findIndex((c) => c === key.toLowerCase() || c.includes(key.toLowerCase())) >= 0) matched++;
    }
    if (matched >= 5) {
      const ohlcRows: OhlcRow[] = [];
      for (const d of data) {
        const r: OhlcRow = { date: d[0] ?? "", open: parseFloat(d[1] ?? ""), high: parseFloat(d[2] ?? ""), low: parseFloat(d[3] ?? ""), close: parseFloat(d[4] ?? "") };
        if (isNaN(r.open) || isNaN(r.high) || isNaN(r.low) || isNaN(r.close)) continue;
        if (nCols >= 6) { const v = parseFloat(d[5] ?? ""); if (!isNaN(v)) r.vol = v; }
        ohlcRows.push(r);
      }
      if (ohlcRows.length >= 2) return { header, rows: ohlcRows };
    }
  }
  return null;
}

// ── Metrics detection ──

export function tryMetrics(text: string): Card[] | null {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 3) return null;
  const cards: Card[] = [];
  for (const line of lines) {
    const m = /^(.{1,40}?)\s*[:：]\s*(-?[\d.,]+%?)\s*$/.exec(line.trim())
           || /^(.{1,20}?)\s{2,}(-?[\d.,]+%?)\s*$/.exec(line.trim());
    if (!m) continue;
    const num = parseFloat(m[2]!.replace(/[%,]/g, ""));
    if (isNaN(num)) continue;
    cards.push({ label: m[1]!.trim(), value: m[2]!, num });
  }
  return cards.length >= 3 ? cards : null;
}

// ── Score table detection ──

export function tryScoreTable(text: string): ScoreTable | null {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 3) return null;
  const sep = detectSep(lines);
  if (!sep) return null;
  const rows = lines.map((l) => splitCols(l, sep));
  const nCols = rows[0]!.length;
  if (nCols < 3 || !rows.every((r) => r.length === nCols)) return null;
  const h = rows[0]!;
  const isScore = h.some((c) => /收益|风险|稳健|得分|score|rating|总分|综合/i.test(c));
  if (!isScore) return null;
  return { header: h.map((c) => c.trim()), data: rows.slice(1).map((r) => r.map((c) => c.trim())) };
}

// ── General data table detection ──

export function tryDataTable(text: string): ScoreTable | null {
  // Split by newlines, skip separator lines (───, ===, etc.)
  const lines = text.split("\n").filter((l) => {
    const t = l.trim();
    if (!t) return false;
    if (/^[─━═━▁▔▀▄]{4,}$/.test(t)) return false;
    return true;
  });
  if (lines.length < 3) return null;
  const sep = detectSep(lines);
  if (!sep) return null;
  const rows = lines.map((l) => splitCols(l, sep));
  const nCols = rows[0]!.length;
  if (nCols < 3 || !rows.every((r) => r.length === nCols)) return null;
  const dataRows = rows.slice(1);
  // At least 2 numeric cells in data to qualify as a data table
  let numCells = 0;
  for (const row of dataRows) {
    for (const cell of row) {
      if (/^-?[\d.,]+%?$/.test(cell.trim())) numCells++;
    }
  }
  if (numCells < 3) return null;
  return { header: rows[0]!.map((c) => c.trim()), data: dataRows.map((r) => r.map((c) => c.trim())) };
}

export function renderDataTable(st: ScoreTable): string {
  const header = st.header;
  const data = st.data;
  const nCols = header.length;

  // Determine which columns are numeric
  const numCols = new Set<number>();
  for (let i = 0; i < nCols; i++) {
    const vals = data.map((r) => r[i] ?? "").filter((v) => v !== "" && v !== "-").map((v) => parseFloat(v.replace(/[%,+¥$]/g, "")));
    if (vals.length > 0 && vals.every((v) => !isNaN(v))) numCols.add(i);
  }

  const th = header.map((c, i) =>
    `<th>${esc(c)}</th>`
  ).join("");

  const tb = data.map((row) =>
    `<tr>${row.map((c, i) => {
      if (!numCols.has(i)) return `<td>${esc(c)}</td>`;
      const v = parseFloat(c.replace(/[%,+¥$]/g, ""));
      if (isNaN(v)) return `<td class="n">${esc(c)}</td>`;
      const cls = v > 0.001 ? " p" : v < -0.001 ? " ng" : " m";
      return `<td class="n${cls}">${esc(c)}</td>`;
    }).join("")}</tr>`
  ).join("");

  return `<div class="tw"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`;
}

// ── Factor bar detection ──

export function tryFactorBars(text: string): FactorBar[] | null {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return null;
  const bars: FactorBar[] = [];
  for (const line of lines) {
    const m = line.trim().match(/^(.{1,30}?)\s{2,}((?:[█▓▒░▏▎▍▌▋▊▉▁]){3,})\s*(\d+(?:\.\d+)?%?)$/);
    if (!m) continue;
    const pct = parseFloat(m[3]!.replace("%", ""));
    if (isNaN(pct)) continue;
    bars.push({ label: m[1]!.trim(), pct: Math.min(100, Math.abs(pct)), value: m[3]!, up: pct >= 0 });
  }
  return bars.length >= 2 ? bars : null;
}

// ── Compare factors detection ──
// Format: "NAME: factor1=XX factor2=YY ..." per line, 2+ lines

export function tryCompareFactors(text: string): FactorSeries[] | null {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return null;
  const series: FactorSeries[] = [];
  for (const line of lines) {
    const m = line.trim().match(/^(.{1,20}?)\s*:\s*(.+)$/);
    if (!m) return null;
    const name = m[1]!.trim();
    const factors: FactorBar[] = [];
    const pairs = m[2]!.split(/\s+/);
    for (const pair of pairs) {
      const pm = pair.match(/^(.+?)=(\d+(?:\.\d+)?)$/);
      if (!pm) continue;
      const pct = parseFloat(pm[2]!);
      if (isNaN(pct) || pct < 0 || pct > 100) continue;
      factors.push({ label: pm[1]!, pct, value: pm[2]! + "%", up: pct >= 50 });
    }
    if (factors.length < 3) return null;
    series.push({ name, factors });
  }
  return series.length >= 2 ? series : null;
}

// ── Column separator ──

export function detectSep(lines: string[]): string | null {
  if (lines.every((l) => l.includes("|"))) return "|";
  if (lines.every((l) => /\s{2,}/.test(l))) return "ws";
  return null;
}
export function splitCols(line: string, sep: string): string[] {
  if (sep === "|") return line.split("|").map((c) => c.trim()).filter((c, i, a) => !(i === 0 && !c) && !(i === a.length - 1 && !c));
  return line.split(/\s{2,}/).map((c) => c.trim()).filter((c) => c.length > 0);
}

// ── Fund NAV line chart detection ──
// Matches tables with columns like "日期 | 净值" or "日期 | 净值 | 基准 | 沪深300"
// Used for 雪球-style fund performance line charts (not candlestick)

export interface NavLineData { header: string[]; rows: NavRow[] }
export interface NavRow { date: string; nav: number; bm?: number; hs300?: number }

export function tryNavChart(text: string): NavLineData | null {
  const lines = text.split("\n").filter((l) => l.trim())
    .filter((l) => !TF_LABEL_RE.test(l.trim()) && !/^[─━═]{4,}$/.test(l.trim()));
  if (lines.length < 3) return null;
  const sep = detectSep(lines);
  if (!sep) return null;
  const rows = lines.map((l) => splitCols(l, sep));
  const nCols = rows[0]!.length;
  if (nCols < 2 || !rows.every((r) => r.length === nCols)) return null;
  const header = rows[0]!.map((c) => c.trim());
  const hLower = header.map((c) => c.toLowerCase());

  // Must have date + nav columns
  const dateIdx = hLower.findIndex((c) => c === "日期" || c === "date");
  const navIdx = hLower.findIndex((c) => c === "净值" || c === "nav" || c === "单位净值");
  if (dateIdx < 0 || navIdx < 0) return null;

  const bmIdx = hLower.findIndex((c) => c === "基准" || c === "benchmark" || c === "业绩基准");
  const hsIdx = hLower.findIndex((c) => c === "沪深300");

  const data = rows.slice(1);
  const navRows: NavRow[] = [];
  for (const d of data) {
    const nav = parseFloat((d[navIdx] ?? "").replace(/,/g, ""));
    if (isNaN(nav)) continue;
    navRows.push({
      date: (d[dateIdx] ?? "").trim(),
      nav,
      bm: bmIdx >= 0 ? parseFloat((d[bmIdx] ?? "").replace(/,/g, "")) || undefined : undefined,
      hs300: hsIdx >= 0 ? parseFloat((d[hsIdx] ?? "").replace(/,/g, "")) || undefined : undefined,
    });
  }
  return navRows.length >= 3 ? { header, rows: navRows } : null;
}
