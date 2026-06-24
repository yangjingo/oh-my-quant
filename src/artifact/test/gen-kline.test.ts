import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { generateArtifact } from "../src/generator.ts";
import { saveArtifact } from "../../storage/src/artifacts.ts";

const sid = "019ef009-multi-tf-benchmark";
const now = new Date().toISOString();
const dir = ".ohquant/sessions/--mock--";
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

function uid() { return Math.random().toString(36).slice(2, 8); }
function u(t: string) { return { type: "message", id: "u-" + uid(), parentId: null, timestamp: now, message: { role: "displayUser", content: [{ type: "text", text: t }] } }; }
function a(t: string) { return { type: "message", id: "a-" + uid(), parentId: null, timestamp: now, message: { role: "assistant", model: "deepseek-v4-pro", provider: "anthropic", content: [{ type: "text", text: t }], stopReason: "stop", timestamp: Date.now() } }; }

interface Bar { t: string; o: number; h: number; l: number; c: number; v: number }

// SMH daily data (real)
const SMH_D: Bar[] = [
  { t: "2026-04-01", o: 388.26, h: 396.63, l: 386.38, c: 391.97, v: 10805400 }, { t: "2026-04-02", o: 378.07, h: 393.50, l: 378.00, c: 392.32, v: 8505800 }, { t: "2026-04-06", o: 393.75, h: 397.10, l: 391.90, c: 395.98, v: 4186100 }, { t: "2026-04-07", o: 394.71, h: 400.09, l: 389.64, c: 399.90, v: 6672500 }, { t: "2026-04-08", o: 423.16, h: 424.99, l: 414.99, c: 422.92, v: 10184300 }, { t: "2026-04-09", o: 423.17, h: 430.65, l: 422.63, c: 430.31, v: 6018200 }, { t: "2026-04-10", o: 434.45, h: 441.54, l: 434.45, c: 436.88, v: 11224200 }, { t: "2026-04-13", o: 434.75, h: 443.64, l: 433.60, c: 443.34, v: 6549800 }, { t: "2026-04-14", o: 448.00, h: 452.10, l: 444.24, c: 452.00, v: 6932400 }, { t: "2026-04-15", o: 450.70, h: 453.33, l: 435.15, c: 453.00, v: 9155700 }, { t: "2026-04-16", o: 450.73, h: 457.09, l: 447.77, c: 454.80, v: 6450700 }, { t: "2026-04-17", o: 462.80, h: 464.58, l: 459.50, c: 464.16, v: 7184600 }, { t: "2026-04-20", o: 464.64, h: 465.74, l: 458.65, c: 463.96, v: 3935100 }, { t: "2026-04-21", o: 466.29, h: 468.43, l: 462.24, c: 464.66, v: 5598600 }, { t: "2026-04-22", o: 471.05, h: 477.42, l: 467.17, c: 476.83, v: 7835200 }, { t: "2026-04-23", o: 480.40, h: 488.08, l: 475.19, c: 481.85, v: 10619700 }, { t: "2026-04-24", o: 499.51, h: 509.59, l: 495.46, c: 506.44, v: 12614300 }, { t: "2026-04-27", o: 509.19, h: 510.10, l: 497.75, c: 506.26, v: 9040200 }, { t: "2026-04-28", o: 488.19, h: 496.66, l: 483.29, c: 491.21, v: 12664800 }, { t: "2026-04-29", o: 496.35, h: 499.58, l: 492.34, c: 499.58, v: 6007900 }, { t: "2026-04-30", o: 504.71, h: 507.79, l: 495.02, c: 506.72, v: 8401600 }, { t: "2026-05-01", o: 504.21, h: 511.99, l: 502.25, c: 509.82, v: 5308300 }, { t: "2026-05-04", o: 512.47, h: 513.15, l: 501.15, c: 506.79, v: 6867500 }, { t: "2026-05-05", o: 515.38, h: 526.20, l: 514.12, c: 522.69, v: 8624600 }, { t: "2026-05-06", o: 537.77, h: 549.88, l: 532.35, c: 549.76, v: 15262900 }, { t: "2026-05-07", o: 545.77, h: 549.70, l: 535.92, c: 540.10, v: 10905200 }, { t: "2026-05-08", o: 551.58, h: 566.79, l: 549.00, c: 566.54, v: 8553700 }, { t: "2026-05-11", o: 570.26, h: 578.06, l: 566.80, c: 576.31, v: 12680900 }, { t: "2026-05-12", o: 565.01, h: 570.40, l: 542.67, c: 561.25, v: 17720800 }, { t: "2026-05-13", o: 571.80, h: 576.20, l: 560.12, c: 572.46, v: 9586700 },
];

// SOX (Philadelphia Semiconductor Index) closes
const SOX_CLOSES: Record<string, number> = {
  "2026-04-01": 7802.31, "2026-04-02": 7833.39, "2026-04-06": 7916.11, "2026-04-07": 8003.87, "2026-04-08": 8510.92, "2026-04-09": 8689.53, "2026-04-10": 8889.83, "2026-04-13": 9039.52, "2026-04-14": 9224.12, "2026-04-15": 9239.29, "2026-04-16": 9329.35, "2026-04-17": 9555.88, "2026-04-20": 9599.21, "2026-04-21": 9647.21, "2026-04-22": 9909.27, "2026-04-23": 10078.57, "2026-04-24": 10513.66, "2026-04-27": 10408.04, "2026-04-28": 10035.58, "2026-04-29": 10271.30, "2026-04-30": 10503.70, "2026-05-01": 10595.34, "2026-05-04": 10534.66, "2026-05-05": 10980.58, "2026-05-06": 11472.75, "2026-05-07": 11160.99, "2026-05-08": 11775.50, "2026-05-11": 12081.04, "2026-05-12": 11717.26, "2026-05-13": 12017.98,
};

// ── Aggregate weekly / monthly from daily ──
function toWeekly(bars: Bar[]): Bar[] {
  const wMap = new Map<string, Bar[]>();
  for (const b of bars) {
    const d = new Date(b.t + "T00:00:00Z");
    const day = d.getUTCDay();
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
    const key = monday.toISOString().slice(0, 10);
    if (!wMap.has(key)) wMap.set(key, []);
    wMap.get(key)!.push(b);
  }
  const result: Bar[] = [];
  for (const [, group] of wMap) {
    if (group.length < 2) continue;
    result.push({
      t: group[0]!.t + "/" + group[group.length - 1]!.t.slice(5),
      o: group[0]!.o, c: group[group.length - 1]!.c,
      h: Math.max(...group.map((b) => b.h)),
      l: Math.min(...group.map((b) => b.l)),
      v: group.reduce((s, b) => s + b.v, 0),
    });
  }
  return result;
}

function toMonthly(bars: Bar[]): Bar[] {
  const mMap = new Map<string, Bar[]>();
  for (const b of bars) {
    const key = b.t.slice(0, 7);
    if (!mMap.has(key)) mMap.set(key, []);
    mMap.get(key)!.push(b);
  }
  const result: Bar[] = [];
  for (const [, group] of mMap) {
    if (group.length < 3) continue;
    result.push({
      t: group[0]!.t.slice(0, 7),
      o: group[0]!.o, c: group[group.length - 1]!.c,
      h: Math.max(...group.map((b) => b.h)),
      l: Math.min(...group.map((b) => b.l)),
      v: group.reduce((s, b) => s + b.v, 0),
    });
  }
  return result;
}

const SMH_W = toWeekly(SMH_D);
const SMH_M = toMonthly(SMH_D);

// Normalize SOX to SMH price scale for benchmark
const smhFirst = SMH_D[0]!.c;
const soxFirst = SOX_CLOSES["2026-04-01"]!;
const bmCloses: number[] = SMH_D.map((b) => {
  const sc = SOX_CLOSES[b.t];
  return sc ? +((sc / soxFirst) * smhFirst).toFixed(2) : NaN;
});

function col(s: string, w: number): string {
  return String(s).length >= w ? String(s) + "   " : String(s).padEnd(w, " ") + "   ";
}

function renderKlineTable(bars: Bar[], tfLabel: string, headerCol: string): string {
  // No blank line after header — see parseKlineTable for data layout
  const lines: string[] = [`─── ${tfLabel} ───`, col(headerCol, 14) + col("开盘", 10) + col("最高", 10) + col("最低", 10) + col("收盘", 10) + "成交量"];
  for (const b of bars) {
    lines.push(col(b.t, 14) + col(b.o.toFixed(2), 10) + col(b.h.toFixed(2), 10) + col(b.l.toFixed(2), 10) + col(b.c.toFixed(2), 10) + (b.v / 1e6).toFixed(1) + "M");
  }
  return lines.join("\n");
}

function klineText(): string {
  // Sections joined without blank lines → single paragraph → tryKline multi-section triggers
  return [renderKlineTable(SMH_D, "日K", "日期"), renderKlineTable(SMH_W, "周K", "周"), renderKlineTable(SMH_M, "月K", "月")].join("\n");
}

// ── Candle analysis ──
function candleAnalysis(): string {
  const bars = SMH_D, n = bars.length;
  const body = (i: number) => Math.abs(bars[i]!.c - bars[i]!.o);
  const us = (i: number) => bars[i]!.h - Math.max(bars[i]!.c, bars[i]!.o);
  const ls = (i: number) => Math.min(bars[i]!.c, bars[i]!.o) - bars[i]!.l;
  const rng = (i: number) => bars[i]!.h - bars[i]!.l;
  const bull = (i: number) => bars[i]!.c > bars[i]!.o;
  const recentHigh = Math.max(...bars.slice(-10).map((b) => b.h));
  const recentLow = Math.min(...bars.slice(-10).map((b) => b.l));

  const ma = (p: number): (number | null)[] => {
    const r: (number | null)[] = [];
    for (let i = 0; i < n; i++) { if (i < p - 1) { r.push(null); continue; } let s = 0; for (let j = i - p + 1; j <= i; j++) s += bars[j]!.c; r.push(s / p); }
    return r;
  };
  const m5 = ma(5), m10 = ma(10), m20 = ma(20);

  let e12 = bars[0]!.c, e26 = bars[0]!.c;
  const dif: number[] = [];
  for (let i = 0; i < n; i++) { const c = bars[i]!.c; e12 = c * (2/13) + e12 * (1-2/13); e26 = c * (2/27) + e26 * (1-2/27); dif.push(e12 - e26); }
  let eDea = dif[25] || 0;
  const dea: number[] = [], macd: number[] = [];
  for (let i = 0; i < n; i++) { eDea = dif[i]! * (2/10) + eDea * (1-2/10); dea.push(eDea); macd.push((dif[i]! - eDea) * 2); }

  const smhRet = (bars[n-1]!.c / bars[0]!.c - 1) * 100;
  const soxRet = ((SOX_CLOSES["2026-05-13"] ?? soxFirst) / soxFirst - 1) * 100;
  const alpha = smhRet - soxRet;

  const findings: string[] = [];
  for (let i = Math.max(5, n-10); i < n; i++) {
    const bd = body(i), u = us(i), l = ls(i), r = rng(i), dt = bars[i]!.t;
    if (r === 0) continue;
    const pos = +((bars[i]!.c - recentLow) / (recentHigh - recentLow) * 100).toFixed(0);
    if (bull(i) && bd/r > 0.6 && l/r < 0.15 && u/r < 0.15) findings.push(dt + "  大阳线 买盘强势,区间" + pos + "%");
    if (!bull(i) && bd/r > 0.6 && u/r < 0.15 && l/r < 0.15) findings.push(dt + "  大阴线 卖盘压制,区间" + pos + "%");
    if (bd/r < 0.1) findings.push(dt + "  十字星(Doji) 多空平衡,区间" + pos + "%");
    if (l/r > 0.35 && bd/r < 0.35 && u/r < 0.2) {
      if (pos < 30) findings.push(dt + "  锤子线(Hammer) 长下影,低位看涨反转");
      else if (pos > 70) findings.push(dt + "  上吊线(Hanging Man) 高位警惕顶部");
      else findings.push(dt + "  锤子形态 长下影(" + (l/r*100).toFixed(0) + "%)");
    }
    if (u/r > 0.35 && bd/r < 0.35 && l/r < 0.2) {
      if (pos > 70) findings.push(dt + "  射击之星(Shooting Star) 高位抛压,看跌");
      else findings.push(dt + "  长上影线(" + (u/r*100).toFixed(0) + "%)");
    }
  }

  const tbl = ["K线逐日分类(近10日):", "", "日期          涨跌  实体%  上影%  下影%  形态"];
  for (let i = n-10; i < n; i++) {
    const bd = body(i), u = us(i), l = ls(i), r = rng(i);
    const tp = bull(i) ? "阳" : "阴";
    const bp = (bd/r*100).toFixed(0)+"%", up = (u/r*100).toFixed(0)+"%", lp = (l/r*100).toFixed(0)+"%";
    let sh = ""; if (bd/r < 0.1) sh = "十字星"; else if (l/r > 0.35 && bd/r < 0.35) sh = "锤子"; else if (u/r > 0.35 && bd/r < 0.35) sh = "射击之星"; else if (bd/r > 0.6) sh = bull(i) ? "大阳线" : "大阴线"; else sh = bull(i) ? "阳线" : "阴线";
    tbl.push(bars[i]!.t + "  " + tp + "   " + bp.padEnd(6) + up.padEnd(6) + lp.padEnd(6) + sh);
  }

  const totalRet = (bars[n-1]!.c - bars[0]!.c) / bars[0]!.c * 100;
  const upDays = bars.filter((_,i) => i > 0 && bars[i]!.c > bars[i-1]!.c).length;
  const align = (m5[n-1]??0) > (m10[n-1]??0) && (m10[n-1]??0) > (m20[n-1]??0) ? "多头排列(看涨)" : (m5[n-1]??0) < (m10[n-1]??0) && (m10[n-1]??0) < (m20[n-1]??0) ? "空头排列(看跌)" : "均线缠绕(震荡)";

  return [
    "SMH 半导体ETF K线形态深度分析",
    "",
    "═══ 行业基准对比 (SOX 费城半导体指数) ═══",
    "SMH累计: " + (smhRet>0?"+":"") + smhRet.toFixed(1) + "%  |  SOX累计: " + (soxRet>0?"+":"") + soxRet.toFixed(1) + "%",
    "相对强弱(Alpha): " + (alpha>0?"+":"") + alpha.toFixed(1) + "%  |  SMH" + (alpha>0?" 跑赢 ":" 跑输 ") + "行业基准",
    "",
    "═══ 趋势结构 ═══",
    "区间: " + bars[0]!.t + " → " + bars[n-1]!.t + "  (" + n + "交易日)",
    "累计涨跌: " + (totalRet>0?"+":"") + totalRet.toFixed(1) + "%  |  上涨日占比: " + (upDays/(n-1)*100).toFixed(0) + "%",
    "日K/W/M: 日K " + formatMaybeNumber(m5[n-1]) + " | 周K " + SMH_W[SMH_W.length-1]!.c.toFixed(1) + " | 月K " + SMH_M[SMH_M.length-1]!.c.toFixed(1),
    "均线排列: " + align,
    "",
    "═══ MACD ═══",
    "DIF: " + dif[n-1]!.toFixed(2) + "  DEA: " + dea[n-1]!.toFixed(2) + "  MACD柱: " + (macd[n-1]!>0?"+":"") + macd[n-1]!.toFixed(2),
    "DIF在DEA" + (dif[n-1]! > dea[n-1]! ? "上方(偏多)" : "下方(偏空)"),
    "",
    ...tbl,
    "",
    "═══ 形态识别 ═══",
    ...(findings.length > 0 ? findings : ["  无显著经典形态"]),
    "",
    "═══ 综合研判 ═══",
    "SMH vs SOX: " + (alpha > 2 ? "显著跑赢行业" : alpha > 0 ? "略跑赢行业" : alpha > -2 ? "与行业同步" : "跑输行业"),
    "趋势: " + (totalRet > 5 ? "偏强" : totalRet > -5 ? "震荡" : "偏弱") + "  |  均线: " + align,
    "多周期: 日/周/月K均处上升通道, SOX基准确认行业方向",
    "操作参考: " + (totalRet > 5 && align.includes("多头") ? "上升趋势,持有为主;日周月多周期共振确认趋势,SOX基准提供方向确认" : "震荡格局,关注SOX基准方向,多周期对比寻找信号"),
  ].join("\n");
}

// ── Generate session + artifact ──
const entries = [
  { type: "session", version: 3, id: sid, timestamp: now, cwd: "/mock" },
  u("分析 SMH 半导体 ETF 近期走势，对比 SOX 行业基准，多周期K线形态"),
  a(klineText()),
  u("深度分析K线形态和基准对比，多周期研判"),
  a(candleAnalysis()),
];

const sp = dir + "/" + sid + ".jsonl";
writeFileSync(sp, entries.map((e) => JSON.stringify(e)).join("\n"), "utf-8");

const result = generateArtifact({ sessionPath: sp, title: "SMH vs SOX 多周期行业分析" });
if (!result) { console.log("FAILED"); process.exit(1); }

// Post-process: inject BM (SOX benchmark) into the tfData ← top-level key
let html = result.html;
// Find: var tfData={...}; — inject bm as peer of the tf entries
const varTfData = "var tfData=";
const tdIdx = html.indexOf(varTfData);
if (tdIdx > 0) {
  const objStart = tdIdx + varTfData.length; // points at "{"
  // Walk braces to find end of tfData object
  let depth = 0;
  for (let i = objStart; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") { depth--; if (depth === 0) { const tfDataEnd = i; const bmJson = ',"bm":{"label":"SOX 费城半导体 (市场基准)","closes":[' + bmCloses.filter(v => !isNaN(v)).join(',') + ']}'; html = html.slice(0, tfDataEnd) + bmJson + html.slice(tfDataEnd); break; } }
  }
}

saveArtifact(sid, html, { title: result.title, messageCount: result.messageCount });

console.log("Title:", result.title);
console.log("HTML:", Buffer.byteLength(html, "utf-8"), "bytes");
console.log("ECharts:", (html.match(/echarts.init/g) || []).length);
console.log("TF tabs:", html.includes("klt-btn"));
console.log("SOX benchmark:", html.includes("SOX"));
console.log("Smooth:", html.includes("smooth:true"));
console.log("Candlestick:", html.includes("candlestick"));
console.log("");
console.log("Path:", ".ohquant/artifacts/" + sid + ".html");

function formatMaybeNumber(value: number | null): string {
  return typeof value === "number" ? value.toFixed(1) : "-";
}
