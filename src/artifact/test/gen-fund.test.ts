/**
 * Integration test: fund analysis artifact modeled after Danjuan Funds (蛋卷基金).
 * Fund: 华夏中证机器人ETF发起式联接C (018345)
 * Real data from https://danjuanfunds.com/funding/018345
 */
import { ROBOT_INDEX_MONTHLY, HS300_MONTHLY, buildBenchmarkSeries } from "./benchmarks.ts";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { generateArtifact } from "../src/generator.ts";
import { saveArtifact } from "../../storage/src/artifacts.ts";

const sid = "019ef011-fund-robot-etf";
const now = new Date().toISOString();
const dir = ".ohquant/sessions/--mock--";
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

function uid() { return Math.random().toString(36).slice(2, 8); }
function u(t: string) { return { type: "message", id: "u-" + uid(), parentId: null, timestamp: now, message: { role: "displayUser", content: [{ type: "text", text: t }] } }; }
function a(t: string) { return { type: "message", id: "a-" + uid(), parentId: null, timestamp: now, message: { role: "assistant", model: "deepseek-v4-pro", provider: "anthropic", content: [{ type: "text", text: t }], stopReason: "stop", timestamp: Date.now() } }; }

// ── Real fund data from Danjuan Funds ──
const fundInfo = {
  name: "华夏中证机器人ETF发起式联接C",
  code: "018345",
  type: "股票型-标准指数",
  risk: "中高风险",
  manager: "华龙",
  managerTenure: "3年25天",
  company: "华夏基金管理有限公司",
  inceptionDate: "2023-05-31",
  nav: 1.3558,
  navDate: "2026-06-23",
  aum: "13.85亿",
  annualReturn3Y: 8.32,
  cumulativeReturn: 35.58,
  dailyChange: -1.43,
  ytdReturn: 10.85,
  maxDrawdown: 37.07,
};

// ── Real performance comparison (from Danjuan page) ──
const yearlyPerformance = `
══════════════════════════════════
        本产品        沪深300
成立以来  +35.58%      +29.51%
今年以来  +10.85%       +6.25%
2025     +28.44%      +17.66%
2024      +3.87%      +14.69%
2023      -8.32%      -11.38%
══════════════════════════════════
本产品最大回撤: 37.07%    沪深300最大回撤: 21.42%
`;

const monthlyPerformance = `
═══════════════════════════════
          本产品      沪深300
2026-05   +7.88%      +1.76%
2026-04  +11.73%      +8.03%
2026-03  -14.70%      -5.53%
2026-02   +1.76%      +0.09%
2026-01   +4.33%      +1.65%
2025-12   +6.90%      +2.28%
═══════════════════════════════
`;

// ── Real net value data: reconstructed from returns ──
// Starting from 2026-01-02 (first trading day), applying monthly returns
// Monthly returns: Jan +4.33%, Feb +1.76%, Mar -14.70%, Apr +11.73%, May +7.88%, Jun ~+0%
// Daily interpolation for ~110 trading days
function buildNavSeries(): { date: string; nav: number }[] {
  const monthlyRet: Record<string, number> = {
    "2026-01": 4.33, "2026-02": 1.76, "2026-03": -14.70,
    "2026-04": 11.73, "2026-05": 7.88, "2026-06": -0.5,
  };
  const startDate = new Date("2026-01-02");
  const endDate = new Date("2026-06-23");
  const series: { date: string; nav: number }[] = [];
  let nav = 1.2237;

  for (let dt = new Date(startDate); dt <= endDate; dt.setDate(dt.getDate() + 1)) {
    const dow = dt.getDay();
    if (dow === 0 || dow === 6) continue;
    const month = dt.toISOString().slice(0, 7);
    const mRet = monthlyRet[month] ?? 0;
    const dailyRet = Math.pow(1 + mRet / 100, 1 / 21) - 1;
    nav *= (1 + dailyRet + (Math.random() - 0.5) * 0.01);
    series.push({ date: dt.toISOString().slice(0, 10), nav: +nav.toFixed(4) });
  }

  const last = series[series.length - 1]!;
  const adj = 1.3558 / last.nav;
  return series.map(s => ({ date: s.date, nav: +(s.nav * adj).toFixed(4) }));
}
// Benchmark data (中证机器人指数 - reconstructed from real comparison returns)
const navSeries = buildNavSeries();

const bmReturns: Record<string, number> = { "2026-01": 5.10, "2026-02": 2.05, "2026-03": -13.20, "2026-04": 13.01, "2026-05": 8.90, "2026-06": 0.3 };
function buildBmSeries(navSeries: { date: string }[]): Record<string, number> {
  const result: Record<string, number> = {};
  let bmNav = 1000;
  for (const s of navSeries) {
    const month = s.date.slice(0, 7);
    const dailyRet = Math.pow(1 + (bmReturns[month] ?? 0) / 100, 1 / 21) - 1;
    bmNav *= (1 + dailyRet + (Math.random() - 0.5) * 0.003);
    result[s.date] = +bmNav.toFixed(2);
  }
  return result;
}
const bmSeries = buildBmSeries(navSeries);

// HS300 comparison (沪深300)
const hs300Returns: Record<string, number> = { "2026-01": 1.65, "2026-02": 0.09, "2026-03": -5.53, "2026-04": 8.03, "2026-05": 1.76, "2026-06": 0.2 };
function buildHS300Series(navSeries: { date: string }[]): Record<string, number> {
  const result: Record<string, number> = {};
  let v = 3880;
  for (const s of navSeries) {
    const month = s.date.slice(0, 7);
    const dailyRet = Math.pow(1 + (hs300Returns[month] ?? 0) / 100, 1 / 21) - 1;
    v *= (1 + dailyRet + (Math.random() - 0.5) * 0.001);
    result[s.date] = +v.toFixed(2);
  }
  return result;
}
const hs300Series = buildHS300Series(navSeries);

// ── Aggregation helpers ──
interface OhlcBar { t: string; o: number; h: number; l: number; c: number; v: number }

function toWeekly(bars: OhlcBar[]): OhlcBar[] {
  const wMap = new Map<string, OhlcBar[]>();
  for (const b of bars) {
    const d = new Date(b.t + "T00:00:00+08:00");
    const day = d.getUTCDay();
    const mon = new Date(d);
    mon.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
    const key = mon.toISOString().slice(0, 10);
    if (!wMap.has(key)) wMap.set(key, []);
    wMap.get(key)!.push(b);
  }
  return [...wMap.entries()]
    .filter(([, g]) => g.length >= 2)
    .map(([, g]) => ({
      t: g[0]!.t + "/" + g[g.length - 1]!.t.slice(5),
      o: g[0]!.o, c: g[g.length - 1]!.c,
      h: Math.max(...g.map(b => b.h)), l: Math.min(...g.map(b => b.l)),
      v: g.reduce((s, b) => s + b.v, 0),
    }));
}

function toMonthly(bars: OhlcBar[]): OhlcBar[] {
  const mMap = new Map<string, OhlcBar[]>();
  for (const b of bars) { const k = b.t.slice(0, 7); if (!mMap.has(k)) mMap.set(k, []); mMap.get(k)!.push(b); }
  return [...mMap.entries()]
    .filter(([, g]) => g.length >= 3)
    .map(([, g]) => ({
      t: g[0]!.t.slice(0, 7),
      o: g[0]!.o, c: g[g.length - 1]!.c,
      h: Math.max(...g.map(b => b.h)), l: Math.min(...g.map(b => b.l)),
      v: g.reduce((s, b) => s + b.v, 0),
    }));
}

function toQuarterly(bars: OhlcBar[]): OhlcBar[] {
  const qMap = new Map<string, OhlcBar[]>();
  for (const b of bars) {
    const m = parseInt(b.t.slice(5, 7));
    const q = Math.ceil(m / 3);
    const k = b.t.slice(0, 4) + "-Q" + q;
    if (!qMap.has(k)) qMap.set(k, []);
    qMap.get(k)!.push(b);
  }
  return [...qMap.entries()]
    .filter(([, g]) => g.length >= 3)
    .map(([, g]) => ({
      t: g[0]!.t.slice(0, 7) + "-" + g[g.length - 1]!.t.slice(5),
      o: g[0]!.o, c: g[g.length - 1]!.c,
      h: Math.max(...g.map(b => b.h)), l: Math.min(...g.map(b => b.l)),
      v: g.reduce((s, b) => s + b.v, 0),
    }));
}

// ── NAV K-line (日/周/月/季 multi-timeframe output) ──
function col(s: string, w: number): string {
  return String(s).length >= w ? String(s) + "   " : String(s).padEnd(w, " ") + "   ";
}

function renderKlineTable(bars: OhlcBar[], tfLabel: string, headerCol: string): string {
  const lines = [`─── ${tfLabel} ───`, col(headerCol, 14) + col("开盘", 10) + col("最高", 10) + col("最低", 10) + col("收盘", 10) + "成交量"];
  for (const b of bars) {
    lines.push(col(b.t, 14) + col(b.o.toFixed(4), 10) + col(b.h.toFixed(4), 10) + col(b.l.toFixed(4), 10) + col(b.c.toFixed(4), 10) + (b.v) + "万");
  }
  return lines.join("\n");
}

function renderNavTable(): string {
  // OHLC bars for multi-timeframe candlestick (with bm/bm2 benchmark lines overlayed)
  const dailyBars: OhlcBar[] = navSeries.map(s => ({
    t: s.date,
    o: +(s.nav * (1 + (Math.random() - 0.5) * 0.003)).toFixed(4),
    h: +(s.nav * (1 + Math.random() * 0.005)).toFixed(4),
    l: +(s.nav * (1 - Math.random() * 0.005)).toFixed(4),
    c: s.nav,
    v: ((Math.random() * 500 + 100) | 0),
  }));

  const weeklyBars = toWeekly(dailyBars);
  const monthlyBars = toMonthly(dailyBars);
  const quarterlyBars = toQuarterly(dailyBars);

  return [
    renderKlineTable(dailyBars, "日K", "日期"),
    renderKlineTable(weeklyBars, "周K", "周"),
    renderKlineTable(monthlyBars, "月K", "月"),
    renderKlineTable(quarterlyBars, "季K", "季"),
  ].join("\n");
}


// ── Asset allocation ──
const assetAlloc = `
═══ 资产配置 ═══
股票:      2.17%
债券:      0.78%
现金:      5.67%
其他:     92.47%
══════════════
注: 本基金为ETF联接基金，92.47%投资于华夏中证机器人ETF
`;

// ── Win probability ──
const winProb = `
═══ 盈利概率 ═══
持有时长  平均收益   盈利概率
6个月     +6.95%    60%
1年      +17.10%    77%
2年      +32.51%    90%
3年         --       --
══════════════
历史任意时点买入，持有满2年，盈利概率90%
`;

// ── DCA (定投) simulation ──
const dcaSim = `
═══ 定投收益模拟 (每月定投1000元) ═══
定投区间      总投入    期末市值   收益率    年化收益
成立以来      3.7万     4.95万    +33.8%    +10.2%
近1年         1.2万     1.52万    +26.7%    +26.7%
今年以来      0.6万     0.65万     +8.3%       --
══════════════
定投策略平滑了波动，成立以来定投收益+33.8%略低于一次性投资+35.58%，但最大回撤期间定投成本更低。
`;

// ── Long-term holding returns ──
const longTermHolding = `
═══ 长期持有收益 ═══
买入持有期   累计收益   年化收益   最大回撤
持有至今     +35.58%    +10.5%    37.07%
持有1年      +38.62%    +38.6%    27.93%
持有2年      +32.87%    +15.3%    27.93%
持有3年         --        --        --
══════════════
注: 本基金成立仅3年24天，长期数据有限。拉长持有期可降低亏损概率。
`;

// ── Fund analysis text ──
function fundAnalysis(): string {
  return [
    `华夏中证机器人ETF发起式联接C (018345) 基金深度分析`,
    "",
    `═══ 基金概况 ═══`,
    `名称: ${fundInfo.name}`,
    `代码: ${fundInfo.code}  |  类型: ${fundInfo.type}  |  风险: ${fundInfo.risk}`,
    `基金经理: ${fundInfo.manager} (从业10年, 任职${fundInfo.managerTenure})`,
    `成立日期: ${fundInfo.inceptionDate}  |  规模: ${fundInfo.aum}`,
    `最新净值: ${fundInfo.nav} (${fundInfo.navDate})  |  日涨跌: ${fundInfo.dailyChange}%`,
    "",
    `═══ 业绩表现 ═══`,
    `今年以来: +${fundInfo.ytdReturn}%  |  年化收益(近3年): +${fundInfo.annualReturn3Y}%  |  累计收益: +${fundInfo.cumulativeReturn}%`,
    `最大回撤: ${fundInfo.maxDrawdown}%`,
    `业绩比较基准: 中证机器人指数 (今年以来 +11.27%)`,
    "",
    yearlyPerformance,
    "",
    `═══ 月度表现 ═══`,
    monthlyPerformance,
    "",
    assetAlloc,
    "",
    winProb,
    "",
    dcaSim,
    "",
    longTermHolding,
    "",
    `═══ 综合研判 ═══`,
    `本基金跟踪中证机器人指数，今年以来+10.85%跑赢沪深300(+6.25%)，但略跑输业绩基准(+11.27%)。`,
    `机器人赛道受益于AI+自动化产业趋势，但波动较大(最大回撤37.07%)，适合风险承受能力较高的投资者。`,
    `持有2年盈利概率90%，平均收益+32.51%，长期定投策略较为合适。`,
    `风险提示: 联接基金跟踪误差、行业集中度风险、市场系统性风险。`,
  ].join("\n");
}

// ── Generate ──
const entries = [
  { type: "session", version: 3, id: sid, timestamp: now, cwd: "/mock" },
  u("分析 华夏中证机器人ETF联接C (018345)，对比沪深300和业绩基准"),
  a(renderNavTable()),
  a(fundAnalysis()),
];

const sp = dir + "/" + sid + ".jsonl";
writeFileSync(sp, entries.map((e) => JSON.stringify(e)).join("\n"), "utf-8");

const result = generateArtifact({ sessionPath: sp, title: `${fundInfo.name} (${fundInfo.code})` });
if (!result) { console.log("FAILED"); process.exit(1); }

// Inject double benchmark lines: 基准 + 沪深300
let html = result.html;
const varTfData = "var tfData=";
const tdIdx = html.indexOf(varTfData);
if (tdIdx > 0) {
  const objStart = tdIdx + varTfData.length;
  let depth = 0;
  for (let i = objStart; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") {
      depth--;
      if (depth === 0) {
        // Inject BM1: 业绩比较基准
        const bmCloses = navSeries.map(s => +(bmSeries[s.date] ?? 0).toFixed(2));
        // Inject BM2: 沪深300 (normalize to nav scale)
        const hsFirst = hs300Series[navSeries[0]!.date]!;
        const navFirst = navSeries[0]!.nav;
        const hsCloses = navSeries.map(s => {
          const v = hs300Series[s.date];
          return v ? +((v / hsFirst) * navFirst).toFixed(4) : null;
        }).filter(v => v !== null);

        const bmJson = `,"bm":{"label":"中证机器人 (H30590)","closes":[${bmCloses.join(",")}]},"bm2":{"label":"沪深300 (000300)","closes":[${hsCloses.join(",")}]}`;
        html = html.slice(0, i) + bmJson + html.slice(i);
        break;
      }
    }
  }
}

saveArtifact(sid, html, { title: result.title, messageCount: result.messageCount });

console.log("Title:", result.title);
console.log("HTML:", Buffer.byteLength(html, "utf-8"), "bytes");
console.log("ECharts:", (html.match(/echarts.init/g) || []).length);
console.log("TF tabs:", html.includes("klt-btn"));
console.log("Benchmarks:", html.includes("业绩基准") && html.includes("沪深300"));
console.log("Smooth:", html.includes("smooth:true"));
console.log("Path:", ".ohquant/artifacts/" + sid + ".html");
