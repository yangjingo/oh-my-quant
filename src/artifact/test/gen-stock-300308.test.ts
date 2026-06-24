/**
 * Integration test: 中际旭创 (300308.SZ) stock analysis
 * Real data from Jun 2026, AI optical transceiver leader
 */
import { HS300_MONTHLY, CYB_MONTHLY, buildBenchmarkSeries } from "./benchmarks.ts";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { generateArtifact } from "../src/generator.ts";
import { saveArtifact } from "../../storage/src/artifacts.ts";

const sid = "019ef013-stock-300308";
const now = new Date().toISOString();
const dir = ".ohquant/sessions/--mock--";
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

function uid() { return Math.random().toString(36).slice(2, 8); }
function u(t: string) { return { type: "message", id: "u-" + uid(), parentId: null, timestamp: now, message: { role: "displayUser", content: [{ type: "text", text: t }] } }; }
function a(t: string) { return { type: "message", id: "a-" + uid(), parentId: null, timestamp: now, message: { role: "assistant", model: "deepseek-v4-pro", provider: "anthropic", content: [{ type: "text", text: t }], stopReason: "stop", timestamp: Date.now() } }; }

interface Bar { t: string; o: number; h: number; l: number; c: number; v: number }

// ── Real Jun 2026 daily data from 东方财富/同花顺 ──
const JUN_DATA: Bar[] = [
  { t: "2026-06-01", o: 1161.00, h: 1183.61, l: 1113.90, c: 1130.00, v: 269800 }, { t: "2026-06-02", o: 1153.60, h: 1205.58, l: 1140.01, c: 1191.81, v: 290100 }, { t: "2026-06-03", o: 1220.00, h: 1320.00, l: 1220.00, c: 1275.00, v: 345300 }, { t: "2026-06-04", o: 1250.00, h: 1290.00, l: 1241.36, c: 1280.00, v: 217100 }, { t: "2026-06-05", o: 1273.20, h: 1301.51, l: 1160.00, c: 1179.99, v: 474700 }, { t: "2026-06-08", o: 1132.79, h: 1179.45, l: 1132.00, c: 1154.99, v: 336100 }, { t: "2026-06-09", o: 1140.97, h: 1196.16, l: 1126.90, c: 1180.00, v: 398900 }, { t: "2026-06-10", o: 1150.00, h: 1174.00, l: 1128.80, c: 1147.00, v: 229000 }, { t: "2026-06-11", o: 1136.00, h: 1174.90, l: 1093.00, c: 1124.00, v: 305900 }, { t: "2026-06-12", o: 1182.00, h: 1188.50, l: 1128.18, c: 1149.00, v: 346900 }, { t: "2026-06-15", o: 1175.00, h: 1245.00, l: 1122.00, c: 1245.00, v: 342200 }, { t: "2026-06-16", o: 1240.00, h: 1273.68, l: 1232.46, c: 1248.09, v: 232800 }, { t: "2026-06-17", o: 1228.00, h: 1276.13, l: 1220.05, c: 1276.11, v: 217600 }, { t: "2026-06-18", o: 1270.00, h: 1368.50, l: 1268.73, c: 1367.88, v: 285500 }, { t: "2026-06-22", o: 1367.78, h: 1416.88, l: 1343.38, c: 1382.33, v: 280300 }, { t: "2026-06-23", o: 1395.00, h: 1395.00, l: 1300.00, c: 1310.01, v: 291800 },
];

// ── May 2026 (reconstructed from monthly trend + Jun early data) ──
const MAY_DATA: Bar[] = (() => {
  const bars: Bar[] = [];
  let o = 860, c = 1130; // May open ~860, close ~1130 (+31.4%)
  const days = 20;
  for (let i = 0; i < days; i++) {
    const t = new Date(2026, 4, 5 + i);
    if (t.getDay() === 0 || t.getDay() === 6) continue;
    const ret = Math.pow(c / o, 1 / days) - 1;
    c = o * (1 + ret + (Math.random() - 0.5) * 0.04);
    const h = c * (1 + Math.random() * 0.03);
    const l = c * (1 - Math.random() * 0.03);
    bars.push({ t: t.toISOString().slice(0, 10), o: +o.toFixed(2), h: +h.toFixed(2), l: +l.toFixed(2), c: +c.toFixed(2), v: ((Math.random() * 30 + 15) | 0) * 10000 });
    o = c;
  }
  return bars;
})();

const allBars = [...MAY_DATA, ...JUN_DATA];

// ── 创业板指 benchmark (normalized) ──
// Real benchmarks
const dateList = allBars.map(b => b.t);
const firstPrice = allBars[0]!.c;
const cybSeries = buildBenchmarkSeries(dateList, CYB_MONTHLY, firstPrice);
const hsSeries = buildBenchmarkSeries(dateList, HS300_MONTHLY, firstPrice);

// ── K-line ──
function col(s: string, w: number): string { return String(s).length >= w ? String(s) + "   " : String(s).padEnd(w, " ") + "   "; }

function agg(bars: Bar[], gf: (b: Bar) => string, min: number): Bar[] {
  const m = new Map<string, Bar[]>();
  for (const b of bars) { const k = gf(b); if (!m.has(k)) m.set(k, []); m.get(k)!.push(b); }
  return [...m.entries()].filter(([, g]) => g.length >= min).map(([, g]) => ({ t: g[0]!.t + (g.length > 1 ? "/" + g[g.length - 1]!.t.slice(5) : ""), o: g[0]!.o, c: g[g.length - 1]!.c, h: Math.max(...g.map(b => b.h)), l: Math.min(...g.map(b => b.l)), v: g.reduce((s, b) => s + b.v, 0) }));
}

function renderKline(): string {
  return [
    renderTf(allBars, "日K", "日期"),
    renderTf(agg(allBars, b => { const d = new Date(b.t + "T00:00:00+08:00"); const day = d.getUTCDay(); const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1)); return mon.toISOString().slice(0, 10); }, 2), "周K", "周"),
    renderTf(agg(allBars, b => b.t.slice(0, 7), 3), "月K", "月"),
  ].join("\n");
}
function renderTf(bars: Bar[], tf: string, hdr: string): string {
  const lines = [`─── ${tf} ───`, col(hdr, 14) + col("开盘", 10) + col("最高", 10) + col("最低", 10) + col("收盘", 10) + "成交量"];
  for (const b of bars) lines.push(col(b.t, 14) + col(b.o.toFixed(2), 10) + col(b.h.toFixed(2), 10) + col(b.l.toFixed(2), 10) + col(b.c.toFixed(2), 10) + (b.v / 10000).toFixed(1) + "万手");
  return lines.join("\n");
}

// ── Candle analysis ──
function candleAnalysis(): string {
  const n = allBars.length;
  const body = (i: number) => Math.abs(allBars[i]!.c - allBars[i]!.o);
  const us = (i: number) => allBars[i]!.h - Math.max(allBars[i]!.c, allBars[i]!.o);
  const ls = (i: number) => Math.min(allBars[i]!.c, allBars[i]!.o) - allBars[i]!.l;
  const rng = (i: number) => allBars[i]!.h - allBars[i]!.l;
  const bull = (i: number) => allBars[i]!.c > allBars[i]!.o;

  const recentHigh = Math.max(...allBars.slice(-10).map(b => b.h));
  const recentLow = Math.min(...allBars.slice(-10).map(b => b.l));

  const ma = (p: number): (number | null)[] => {
    const r: (number | null)[] = [];
    for (let i = 0; i < n; i++) { if (i < p - 1) { r.push(null); continue; } let s = 0; for (let j = i - p + 1; j <= i; j++) s += allBars[j]!.c; r.push(s / p); }
    return r;
  };
  const m5 = ma(5), m10 = ma(10), m20 = ma(20);

  let e12 = allBars[0]!.c, e26 = allBars[0]!.c;
  const dif: number[] = [];
  for (let i = 0; i < n; i++) { const c = allBars[i]!.c; e12 = c * (2 / 13) + e12 * (1 - 2 / 13); e26 = c * (2 / 27) + e26 * (1 - 2 / 27); dif.push(e12 - e26); }
  let eDea = dif[25] || 0;
  const dea: number[] = [], macd: number[] = [];
  for (let i = 0; i < n; i++) { eDea = dif[i]! * (2 / 10) + eDea * (1 - 2 / 10); dea.push(eDea); macd.push((dif[i]! - eDea) * 2); }

  const findings: string[] = [];
  for (let i = Math.max(5, n - 10); i < n; i++) {
    const bd = body(i), u = us(i), l = ls(i), r = rng(i), dt = allBars[i]!.t;
    if (r === 0) continue;
    const pos = +((allBars[i]!.c - recentLow) / (recentHigh - recentLow) * 100).toFixed(0);
    if (bull(i) && bd / r > 0.6 && l / r < 0.15 && u / r < 0.15) findings.push(dt + "  大阳线 强势买盘,区间" + pos + "%");
    else if (!bull(i) && bd / r > 0.6 && u / r < 0.15 && l / r < 0.15) findings.push(dt + "  大阴线 卖盘压制,区间" + pos + "%");
    else if (bd / r < 0.1) findings.push(dt + "  十字星(Doji) 多空平衡");
    if (l / r > 0.35 && bd / r < 0.35) findings.push(dt + (pos < 30 ? "  锤子线(Hammer) 低位看涨反转" : "  锤子形态 长下影(" + (l / r * 100).toFixed(0) + "%)"));
    if (u / r > 0.35 && bd / r < 0.35) findings.push(dt + (pos > 70 ? "  射击之星(Shooting Star) 高位抛压" : "  长上影线(" + (u / r * 100).toFixed(0) + "%)"));
  }

  // Candle table
  const tbl = ["K线逐日分类:", "", "日期          涨跌  实体%  上影%  下影%  形态"];
  const last10 = allBars.slice(-10);
  for (let i = 0; i < last10.length; i++) {
    const idx = n - 10 + i;
    const bd = body(idx), u = us(idx), l = ls(idx), r = rng(idx);
    const tp = bull(idx) ? "阳" : "阴";
    let sh = ""; if (bd / r < 0.1) sh = "十字星"; else if (l / r > 0.35 && bd / r < 0.35) sh = "锤子"; else if (bd / r > 0.6) sh = bull(idx) ? "大阳线" : "大阴线"; else sh = bull(idx) ? "阳线" : "阴线";
    tbl.push(last10[i]!.t + "  " + tp + "   " + (bd / r * 100).toFixed(0) + "%  " + (u / r * 100).toFixed(0) + "%  " + (l / r * 100).toFixed(0) + "%  " + sh);
  }

  const totalRet = (allBars[n - 1]!.c / allBars[0]!.c - 1) * 100;
  const ytdRet = ((allBars[n - 1]!.c - allBars[0]!.c) / allBars[0]!.c * 100);
  const align = (m5[n - 1] ?? 0) > (m10[n - 1] ?? 0) && (m10[n - 1] ?? 0) > (m20[n - 1] ?? 0) ? "多头排列(看涨)" : (m5[n - 1] ?? 0) < (m10[n - 1] ?? 0) ? "空头排列(看跌)" : "均线缠绕(震荡)";

  return [
    "中际旭创 (300308) 技术分析",
    "",
    "═══ 关键指标 ═══",
    "最新价: 1310.01  |  日涨跌: -5.23%  |  总市值: 1.46万亿  |  动态PE: 63.69",
    "",
    "═══ 趋势结构 ═══",
    "区间: " + allBars[0]!.t + " → " + allBars[n - 1]!.t + "  (" + n + "交易日)",
    "累计涨跌: " + (totalRet > 0 ? "+" : "") + totalRet.toFixed(1) + "%",
    "均线: MA5 " + formatMaybeNumber(m5[n - 1]) + "  MA10 " + formatMaybeNumber(m10[n - 1]) + "  MA20 " + formatMaybeNumber(m20[n - 1]),
    "排列: " + align,
    "52周高: 1416.88 (06-22)  |  距高点: " + ((1310.01 / 1416.88 - 1) * 100).toFixed(1) + "%",
    "",
    "═══ MACD ═══",
    "DIF: " + dif[n - 1]!.toFixed(2) + "  DEA: " + dea[n - 1]!.toFixed(2) + "  MACD柱: " + (macd[n - 1]! > 0 ? "+" : "") + macd[n - 1]!.toFixed(2),
    "DIF在DEA" + (dif[n - 1]! > dea[n - 1]! ? "上方(偏多)" : "下方(偏空)"),
    "",
    ...tbl,
    "",
    "═══ 形态识别 ═══",
    ...(findings.length > 0 ? findings : ["  无显著经典形态"]),
    "",
    "═══ 综合研判 ═══",
    "AI光模块龙头，6月从1130涨至1416(+25.4%)后回落至1310(-7.5%),高位震荡。",
    "MACD仍金叉但柱体收窄,短期需观察1300支撑。6/23大阴线-5.23%放量,主力资金连续流出。",
    "中期趋势未破(MA20=1200仍在上行),但短线追高风险加大。",
  ].join("\n");
}

// ── Generate ──
const entries = [
  { type: "session", version: 3, id: sid, timestamp: now, cwd: "/mock" },
  u("分析 中际旭创 300308 近期走势，K线形态，对比创业板指"),
  a(renderKline()),
  a(candleAnalysis()),
];

const sp = dir + "/" + sid + ".jsonl";
writeFileSync(sp, entries.map(e => JSON.stringify(e)).join("\n"), "utf-8");

const result = generateArtifact({ sessionPath: sp, title: "中际旭创 (300308) 技术分析" });
if (!result) { console.log("FAILED"); process.exit(1); }

// Inject bm/bm2
let html = result.html;
const tdIdx = html.indexOf("var tfData=");
if (tdIdx > 0) {
  const objStart = tdIdx + "var tfData=".length;
  let depth = 0;
  for (let i = objStart; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") {
      depth--;
      if (depth === 0) {
        const cyb = allBars.map(b => +(cybSeries[b.t] ?? 0).toFixed(2));
        const hs = allBars.map(b => +(hsSeries[b.t] ?? 0).toFixed(2));
        html = html.slice(0, i) + `,"bm":{"label":"创业板指 (399006)","closes":[${cyb.join(",")}]},"bm2":{"label":"沪深300 (000300)","closes":[${hs.join(",")}]}` + html.slice(i);
        break;
      }
    }
  }
}

saveArtifact(sid, html, { title: result.title, messageCount: result.messageCount });
console.log("Title:", result.title);
console.log("HTML:", Buffer.byteLength(html, "utf-8"), "bytes");
console.log("ECharts:", (html.match(/echarts.init/g) || []).length);
console.log("TF tabs:", html.includes("klt-btn on"));
console.log("Benchmarks:", html.includes("创业板指") && html.includes("沪深300"));
console.log("Path:", ".ohquant/artifacts/" + sid + ".html");

function formatMaybeNumber(value: number | null): string {
  return typeof value === "number" ? value.toFixed(1) : "-";
}
