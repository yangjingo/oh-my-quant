import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { generateArtifact } from "../src/generator.ts";
import { saveArtifact } from "../../storage/src/artifacts.ts";

const sid = "019ef010-kechuang50";
const now = new Date().toISOString();
const dir = ".ohquant/sessions/--mock--";
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

function uid() { return Math.random().toString(36).slice(2, 8); }
function u(t: string) { return { type: "message", id: "u-" + uid(), parentId: null, timestamp: now, message: { role: "displayUser", content: [{ type: "text", text: t }] } }; }
function a(t: string) { return { type: "message", id: "a-" + uid(), parentId: null, timestamp: now, message: { role: "assistant", model: "deepseek-v4-pro", provider: "anthropic", content: [{ type: "text", text: t }], stopReason: "stop", timestamp: Date.now() } }; }

interface Bar { t: string; o: number; h: number; l: number; c: number; v: number }

// 科创50 (000688.SH) daily data Apr-Jun 2026
const KC50_D: Bar[] = [
  { t: "2026-04-01", o: 1290.64, h: 1302.87, l: 1282.31, c: 1298.20, v: 1.2e7 }, { t: "2026-04-02", o: 1294.63, h: 1294.63, l: 1254.62, c: 1262.18, v: 1.4e7 }, { t: "2026-04-03", o: 1270.94, h: 1272.84, l: 1254.76, c: 1256.21, v: 1.1e7 }, { t: "2026-04-07", o: 1261.71, h: 1286.53, l: 1261.71, c: 1274.01, v: 1.3e7 }, { t: "2026-04-08", o: 1317.28, h: 1352.69, l: 1316.63, c: 1352.69, v: 2.1e7 }, { t: "2026-04-09", o: 1335.29, h: 1362.91, l: 1333.01, c: 1343.95, v: 1.8e7 }, { t: "2026-04-10", o: 1363.58, h: 1382.94, l: 1362.40, c: 1364.49, v: 1.6e7 }, { t: "2026-04-13", o: 1358.46, h: 1396.00, l: 1358.46, c: 1375.29, v: 1.5e7 }, { t: "2026-04-14", o: 1398.40, h: 1409.85, l: 1387.42, c: 1405.07, v: 1.7e7 }, { t: "2026-04-15", o: 1415.39, h: 1433.35, l: 1399.75, c: 1406.32, v: 1.9e7 }, { t: "2026-04-16", o: 1406.32, h: 1424.17, l: 1402.20, c: 1422.23, v: 1.6e7 }, { t: "2026-04-17", o: 1414.87, h: 1433.80, l: 1413.58, c: 1423.35, v: 1.4e7 }, { t: "2026-04-20", o: 1426.89, h: 1451.39, l: 1426.03, c: 1450.52, v: 1.8e7 }, { t: "2026-04-21", o: 1445.20, h: 1445.54, l: 1415.60, c: 1426.68, v: 1.5e7 }, { t: "2026-04-22", o: 1420.78, h: 1451.46, l: 1420.24, c: 1451.14, v: 1.6e7 }, { t: "2026-04-23", o: 1466.12, h: 1467.70, l: 1419.01, c: 1432.59, v: 2.0e7 }, { t: "2026-04-24", o: 1443.04, h: 1472.96, l: 1417.21, c: 1453.69, v: 2.2e7 }, { t: "2026-04-27", o: 1478.31, h: 1515.28, l: 1466.66, c: 1508.38, v: 2.5e7 }, { t: "2026-04-28", o: 1497.32, h: 1525.34, l: 1479.67, c: 1488.66, v: 2.3e7 }, { t: "2026-04-29", o: 1474.12, h: 1495.01, l: 1451.71, c: 1493.50, v: 1.8e7 }, { t: "2026-04-30", o: 1511.39, h: 1580.52, l: 1511.39, c: 1571.07, v: 2.8e7 },
  { t: "2026-05-06", o: 1634.31, h: 1715.08, l: 1631.65, c: 1656.95, v: 3.1e7 }, { t: "2026-05-07", o: 1663.16, h: 1682.22, l: 1646.94, c: 1678.89, v: 2.4e7 }, { t: "2026-05-08", o: 1653.31, h: 1655.57, l: 1625.61, c: 1640.46, v: 2.1e7 }, { t: "2026-05-11", o: 1687.64, h: 1727.30, l: 1669.73, c: 1716.69, v: 2.8e7 }, { t: "2026-05-12", o: 1708.21, h: 1747.17, l: 1687.96, c: 1723.78, v: 2.5e7 }, { t: "2026-05-13", o: 1684.37, h: 1771.49, l: 1677.54, c: 1770.15, v: 2.7e7 }, { t: "2026-05-14", o: 1792.34, h: 1800.61, l: 1723.70, c: 1725.09, v: 3.0e7 }, { t: "2026-05-15", o: 1724.36, h: 1769.80, l: 1669.99, c: 1696.26, v: 2.6e7 }, { t: "2026-05-18", o: 1690.38, h: 1748.10, l: 1684.90, c: 1709.96, v: 2.2e7 }, { t: "2026-05-19", o: 1697.40, h: 1776.26, l: 1670.36, c: 1775.13, v: 2.9e7 }, { t: "2026-05-20", o: 1764.21, h: 1835.22, l: 1764.21, c: 1832.02, v: 3.4e7 }, { t: "2026-05-21", o: 1866.29, h: 1892.60, l: 1759.94, c: 1764.17, v: 4.1e7 }, { t: "2026-05-22", o: 1790.74, h: 1797.65, l: 1747.14, c: 1790.77, v: 2.6e7 }, { t: "2026-05-25", o: 1791.67, h: 1899.97, l: 1774.19, c: 1896.04, v: 3.5e7 }, { t: "2026-05-26", o: 1877.39, h: 1880.65, l: 1824.32, c: 1867.71, v: 2.8e7 }, { t: "2026-05-27", o: 1875.42, h: 1901.97, l: 1809.70, c: 1815.45, v: 3.2e7 }, { t: "2026-05-28", o: 1805.11, h: 1854.52, l: 1796.04, c: 1844.25, v: 2.5e7 }, { t: "2026-05-29", o: 1850.27, h: 1855.26, l: 1727.62, c: 1751.32, v: 2.9e7 },
  { t: "2026-06-01", o: 1751.23, h: 1753.02, l: 1662.82, c: 1663.69, v: 1.7e7 }, { t: "2026-06-02", o: 1676.31, h: 1710.98, l: 1641.17, c: 1690.56, v: 1.6e7 }, { t: "2026-06-03", o: 1697.66, h: 1776.20, l: 1697.36, c: 1726.18, v: 1.7e7 }, { t: "2026-06-04", o: 1700.31, h: 1759.98, l: 1697.22, c: 1738.06, v: 1.5e7 }, { t: "2026-06-05", o: 1706.53, h: 1735.08, l: 1659.48, c: 1668.33, v: 1.7e7 }, { t: "2026-06-08", o: 1587.97, h: 1634.03, l: 1578.18, c: 1596.57, v: 1.6e7 }, { t: "2026-06-09", o: 1630.23, h: 1666.48, l: 1607.58, c: 1663.11, v: 1.4e7 }, { t: "2026-06-10", o: 1662.85, h: 1722.33, l: 1632.33, c: 1652.22, v: 1.6e7 }, { t: "2026-06-11", o: 1644.60, h: 1676.53, l: 1631.94, c: 1662.44, v: 1.4e7 }, { t: "2026-06-12", o: 1726.01, h: 1730.89, l: 1656.85, c: 1663.22, v: 2.1e7 }, { t: "2026-06-15", o: 1687.67, h: 1748.51, l: 1658.32, c: 1748.33, v: 1.6e7 }, { t: "2026-06-16", o: 1751.71, h: 1766.14, l: 1729.04, c: 1758.42, v: 1.5e7 }, { t: "2026-06-17", o: 1729.23, h: 1841.37, l: 1725.90, c: 1840.82, v: 1.8e7 }, { t: "2026-06-18", o: 1837.07, h: 1937.30, l: 1836.04, c: 1911.51, v: 1.8e7 }, { t: "2026-06-22", o: 1922.47, h: 1963.33, l: 1879.59, c: 1948.93, v: 1.9e7 }, { t: "2026-06-23", o: 1929.27, h: 1982.91, l: 1890.16, c: 1916.21, v: 1.8e7 },
];

// 创业板指 (399006.SZ) as market benchmark
const CYP_CLOSES: Record<string, number> = {
  "2026-04-01": 3247.52, "2026-04-02": 3172.65, "2026-04-03": 3149.60, "2026-04-07": 3160.82, "2026-04-08": 3347.61, "2026-04-09": 3323.30, "2026-04-10": 3448.79, "2026-04-13": 3476.44, "2026-04-14": 3558.53, "2026-04-15": 3514.96, "2026-04-16": 3626.27, "2026-04-17": 3678.29, "2026-04-20": 3677.58, "2026-04-21": 3688.94, "2026-04-22": 3752.76, "2026-04-23": 3720.25, "2026-04-24": 3667.79, "2026-04-27": 3648.79, "2026-04-28": 3596.71, "2026-04-29": 3687.17, "2026-04-30": 3677.15,
  "2026-05-06": 3778.16, "2026-06-03": 4122.99, "2026-06-04": 4088.88, "2026-06-05": 3957.94, "2026-06-08": 3811.79, "2026-06-22": 4359.39, "2026-06-23": 4192.19,
};

// ── Aggregate weekly / monthly ──
function toWeekly(bars: Bar[]): Bar[] {
  const wMap = new Map<string, Bar[]>();
  for (const b of bars) {
    const d = new Date(b.t + "T00:00:00+08:00");
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
    result.push({ t: group[0]!.t + "/" + group[group.length - 1]!.t.slice(5), o: group[0]!.o, c: group[group.length - 1]!.c, h: Math.max(...group.map((b) => b.h)), l: Math.min(...group.map((b) => b.l)), v: group.reduce((s, b) => s + b.v, 0) });
  }
  return result;
}

function toMonthly(bars: Bar[]): Bar[] {
  const mMap = new Map<string, Bar[]>();
  for (const b of bars) { const key = b.t.slice(0, 7); if (!mMap.has(key)) mMap.set(key, []); mMap.get(key)!.push(b); }
  const result: Bar[] = [];
  for (const [, group] of mMap) {
    if (group.length < 3) continue;
    result.push({ t: group[0]!.t.slice(0, 7), o: group[0]!.o, c: group[group.length - 1]!.c, h: Math.max(...group.map((b) => b.h)), l: Math.min(...group.map((b) => b.l)), v: group.reduce((s, b) => s + b.v, 0) });
  }
  return result;
}

const KC50_W = toWeekly(KC50_D);
const KC50_M = toMonthly(KC50_D);

// Normalize 创业板指 to 科创50 price scale
const kc50First = KC50_D[0]!.c;
const cypFirst = CYP_CLOSES["2026-04-01"]!;
const bmCloses: number[] = KC50_D.map((b) => {
  const cyp = CYP_CLOSES[b.t];
  return cyp ? +((cyp / cypFirst) * kc50First).toFixed(2) : NaN; // NaN = gap days
});

function col(s: string, w: number): string {
  return String(s).length >= w ? String(s) + "   " : String(s).padEnd(w, " ") + "   ";
}

function renderKlineTable(bars: Bar[], tfLabel: string, headerCol: string): string {
  const lines: string[] = [`─── ${tfLabel} ───`, col(headerCol, 14) + col("开盘", 10) + col("最高", 10) + col("最低", 10) + col("收盘", 10) + "成交量"];
  for (const b of bars) lines.push(col(b.t, 14) + col(b.o.toFixed(2), 10) + col(b.h.toFixed(2), 10) + col(b.l.toFixed(2), 10) + col(b.c.toFixed(2), 10) + (b.v / 1e8).toFixed(2) + "亿");
  return lines.join("\n");
}

function klineText(): string {
  return [renderKlineTable(KC50_D, "日K", "日期"), renderKlineTable(KC50_W, "周K", "周"), renderKlineTable(KC50_M, "月K", "月")].join("\n");
}

// ── Candle analysis ──
function candleAnalysis(): string {
  const bars = KC50_D, n = bars.length;
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
  for (let i = 0; i < n; i++) { const c = bars[i]!.c; e12 = c * (2 / 13) + e12 * (1 - 2 / 13); e26 = c * (2 / 27) + e26 * (1 - 2 / 27); dif.push(e12 - e26); }
  let eDea = dif[25] || 0;
  const dea: number[] = [], macd: number[] = [];
  for (let i = 0; i < n; i++) { eDea = dif[i]! * (2 / 10) + eDea * (1 - 2 / 10); dea.push(eDea); macd.push((dif[i]! - eDea) * 2); }

  const kcRet = (bars[n - 1]!.c / bars[0]!.c - 1) * 100;
  const cypFirstClose = CYP_CLOSES["2026-04-01"]!;
  const cypLastClose = CYP_CLOSES["2026-06-23"]!;
  const cypRet = (cypLastClose / cypFirstClose - 1) * 100;
  const alpha = kcRet - cypRet;

  // Patterns
  const findings: string[] = [];
  for (let i = Math.max(5, n - 10); i < n; i++) {
    const bd = body(i), u = us(i), l = ls(i), r = rng(i), dt = bars[i]!.t;
    if (r === 0) continue;
    const pos = +((bars[i]!.c - recentLow) / (recentHigh - recentLow) * 100).toFixed(0);
    if (bull(i) && bd / r > 0.6 && l / r < 0.15 && u / r < 0.15) findings.push(dt + "  大阳线 强势买盘,区间" + pos + "%");
    if (!bull(i) && bd / r > 0.6 && u / r < 0.15 && l / r < 0.15) findings.push(dt + "  大阴线 卖盘压制,区间" + pos + "%");
    if (bd / r < 0.1) findings.push(dt + "  十字星(Doji) 多空平衡");
    if (l / r > 0.35 && bd / r < 0.35 && u / r < 0.2) {
      if (pos < 30) findings.push(dt + "  锤子线(Hammer) 低位看涨反转");
      else if (pos > 70) findings.push(dt + "  上吊线(Hanging Man) 高位警惕");
      else findings.push(dt + "  锤子形态 长下影(" + (l / r * 100).toFixed(0) + "%)");
    }
    if (u / r > 0.35 && bd / r < 0.35 && l / r < 0.2) {
      if (pos > 70) findings.push(dt + "  射击之星(Shooting Star) 高位抛压");
      else findings.push(dt + "  长上影线(" + (u / r * 100).toFixed(0) + "%)");
    }
  }

  // Candle table
  const tbl = ["K线逐日分类(近10日):", "", "日期          涨跌  实体%  上影%  下影%  形态"];
  for (let i = n - 10; i < n; i++) {
    const bd = body(i), u = us(i), l = ls(i), r = rng(i);
    const tp = bull(i) ? "阳" : "阴";
    const bp = (bd / r * 100).toFixed(0) + "%", up = (u / r * 100).toFixed(0) + "%", lp = (l / r * 100).toFixed(0) + "%";
    let sh = ""; if (bd / r < 0.1) sh = "十字星"; else if (l / r > 0.35 && bd / r < 0.35) sh = "锤子"; else if (u / r > 0.35 && bd / r < 0.35) sh = "射击之星"; else if (bd / r > 0.6) sh = bull(i) ? "大阳线" : "大阴线"; else sh = bull(i) ? "阳线" : "阴线";
    tbl.push(bars[i]!.t + "  " + tp + "   " + bp.padEnd(6) + up.padEnd(6) + lp.padEnd(6) + sh);
  }

  const totalRet = (bars[n - 1]!.c - bars[0]!.c) / bars[0]!.c * 100;
  const upDays = bars.filter((_, i) => i > 0 && bars[i]!.c > bars[i - 1]!.c).length;
  const align = (m5[n - 1] ?? 0) > (m10[n - 1] ?? 0) && (m10[n - 1] ?? 0) > (m20[n - 1] ?? 0) ? "多头排列(看涨)" : (m5[n - 1] ?? 0) < (m10[n - 1] ?? 0) && (m10[n - 1] ?? 0) < (m20[n - 1] ?? 0) ? "空头排列(看跌)" : "均线缠绕(震荡)";

  // Historical highs
  const histHigh = Math.max(...bars.map((b) => b.h));
  const histHighDate = bars.find((b) => b.h === histHigh)!.t;
  const fromHigh = (bars[n - 1]!.c / histHigh - 1) * 100;

  return [
    "科创50 (000688) 指数 K线深度分析",
    "",
    "═══ 市场定位 ═══",
    "科创50 是上交所科创板的核心指数,由50只市值大、流动性好的科创板证券组成",
    "行业分布: 半导体(35%), 生物医药(22%), 计算机(15%), 高端装备(12%), 新能源(8%), 其他(8%)",
    "",
    "═══ 基准对比 (创业板指 399006) ═══",
    "科创50累计: " + (kcRet > 0 ? "+" : "") + kcRet.toFixed(1) + "%  |  创业板指累计: " + (cypRet > 0 ? "+" : "") + cypRet.toFixed(1) + "%",
    "相对强弱(Alpha): " + (alpha > 0 ? "+" : "") + alpha.toFixed(1) + "%  |  科创50" + (alpha > 0 ? " 跑赢 " : " 跑输 ") + "创业板指",
    alpha > 5 ? "科创板表现显著强于创业板,半导体/AI产业周期推动" : alpha > 0 ? "科创板略强于创业板,硬科技属性受资金青睐" : "科创板与创业板同步,科技成长风格共振",
    "",
    "═══ 趋势结构 ═══",
    "区间: " + bars[0]!.t + " -> " + bars[n - 1]!.t + "  (" + n + "个交易日)",
    "累计涨跌: " + (totalRet > 0 ? "+" : "") + totalRet.toFixed(1) + "%  |  上涨日占比: " + (upDays / (n - 1) * 100).toFixed(0) + "%",
    "历史最高: " + histHigh.toFixed(0) + " (" + histHighDate + "), 距高点: " + fromHigh.toFixed(1) + "%",
    "4月: +21.0% / 5月: +11.5% / 6月至23日: +9.4% (连续三月上行)",
    "均线: MA5 " + formatMaybeNumber(m5[n - 1]) + "  MA10 " + formatMaybeNumber(m10[n - 1]) + "  MA20 " + formatMaybeNumber(m20[n - 1]),
    "排列: " + align,
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
    "科创50 vs 创业板指: " + (alpha > 5 ? "显著跑赢" : alpha > 0 ? "略跑赢" : alpha > -5 ? "与创业板同步" : "跑输"),
    "趋势: " + (totalRet > 10 ? "强上升" : totalRet > 0 ? "震荡偏强" : totalRet > -10 ? "震荡偏弱" : "下行"),
    "均线: " + align,
    "关键因素: 半导体景气上行(AI芯片/存储), 生物医药政策回暖, 科创50面临1982历史高位考验",
    "操作参考: " + (totalRet > 10 ? "强势趋势,但接近前高1982;关注创业板指基准方向确认;日周月共振验证趋势延续性" : "关注创业板指基准方向;多周期对比确认信号"),
  ].join("\n");
}

// ── Generate ──
const entries = [
  { type: "session", version: 3, id: sid, timestamp: now, cwd: "/mock" },
  u("分析 科创50指数 (000688) 近期走势, 对比创业板指, 多周期K线形态"),
  a(klineText()),
  u("深度K线形态分析, 基准对比, 多周期研判"),
  a(candleAnalysis()),
];

const sp = dir + "/" + sid + ".jsonl";
writeFileSync(sp, entries.map((e) => JSON.stringify(e)).join("\n"), "utf-8");

const result = generateArtifact({ sessionPath: sp, title: "科创50 vs 创业板指 多周期技术分析" });
if (!result) { console.log("FAILED"); process.exit(1); }

// Inject BM into tfData
let html = result.html;
const varTfData = "var tfData=";
const tdIdx = html.indexOf(varTfData);
if (tdIdx > 0) {
  const objStart = tdIdx + varTfData.length;
  let depth = 0;
  for (let i = objStart; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") { depth--; if (depth === 0) { const tfDataEnd = i; const bmJson = ',"bm":{"label":"创业板指 399006 (市场基准)","closes":[' + bmCloses.filter(v => !isNaN(v)).join(',') + ']}'; html = html.slice(0, tfDataEnd) + bmJson + html.slice(tfDataEnd); break; } }
  }
}

saveArtifact(sid, html, { title: result.title, messageCount: result.messageCount });

console.log("Title:", result.title);
console.log("HTML:", Buffer.byteLength(html, "utf-8"), "bytes");
console.log("ECharts:", (html.match(/echarts.init/g) || []).length);
console.log("TF tabs:", html.includes("klt-btn on"));
console.log("CYB benchmark:", html.includes("创业板指"));
console.log("Smooth:", html.includes("smooth:true"));
console.log("Candlestick:", html.includes("candlestick"));
console.log("");
console.log("Path:", ".ohquant/artifacts/" + sid + ".html");

function formatMaybeNumber(value: number | null): string {
  return typeof value === "number" ? value.toFixed(1) : "-";
}
