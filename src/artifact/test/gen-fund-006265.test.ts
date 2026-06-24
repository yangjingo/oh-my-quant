/**
 * Integration test: 红土创新新科技股票A (006265)
 * Full dashboard per Danjuan Funds spec — all sections
 */
import { HS300_MONTHLY, TECH_BENCHMARK_MONTHLY, buildBenchmarkSeries } from "./benchmarks.ts";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { generateArtifact } from "../src/generator.ts";
import { saveArtifact } from "../../storage/src/artifacts.ts";

const sid = "019ef012-fund-006265";
const now = new Date().toISOString();
const dir = ".ohquant/sessions/--mock--";
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

function uid() { return Math.random().toString(36).slice(2, 8); }
function u(t: string) { return { type: "message", id: "u-" + uid(), parentId: null, timestamp: now, message: { role: "displayUser", content: [{ type: "text", text: t }] } }; }
function a(t: string) { return { type: "message", id: "a-" + uid(), parentId: null, timestamp: now, message: { role: "assistant", model: "deepseek-v4-pro", provider: "anthropic", content: [{ type: "text", text: t }], stopReason: "stop", timestamp: Date.now() } }; }

interface Bar { t: string; o: number; h: number; l: number; c: number; v: number }

// ── Fund data (from Danjuan) ──
const fund = {
  name: "红土创新新科技股票A", code: "006265", type: "股票型-普通", risk: "中高风险",
  manager: "盖俊龙", company: "红土创新基金管理有限公司",
  inception: "2018-09-21", nav: 11.6711, navDate: "2026-06-23",
  aum: "6.17亿", dailyChg: -2.46,
  ytdReturn: 126.40, cumReturn: 1084.86, annual5Y: 26.38,
  maxDD: 65.60, vol: 45.78, sharpe: 7.56,
  rank: "2/1096", rank2025: "4/1065", rank2024: "117/990", rank2023: "929/933",
};

const benchmarkYtd = 31.37;

// ── NAV series (120 trading days, Jan-Jun 2026) ──
function buildNav(): { date: string; nav: number }[] {
  const mr: Record<string, number> = {
    "2026-01": 16.03, "2026-02": 9.06, "2026-03": -2.56,
    "2026-04": 29.30, "2026-05": 14.99, "2026-06": 4.5,
  };
  const series: { date: string; nav: number }[] = [];
  let nav = 5.15; // back-calc from YTD +126.4%
  const start = new Date("2026-01-02"), end = new Date("2026-06-23");

  for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
    const dow = dt.getDay(); if (dow === 0 || dow === 6) continue;
    const mRet = mr[dt.toISOString().slice(0, 7)] ?? 0;
    const dr = Math.pow(1 + mRet / 100, 1 / 21) - 1;
    nav *= (1 + dr + (Math.random() - 0.5) * 0.012);
    series.push({ date: dt.toISOString().slice(0, 10), nav: +nav.toFixed(4) });
  }
  const adj = 11.6711 / series[series.length - 1]!.nav;
  return series.map(s => ({ date: s.date, nav: +(s.nav * adj).toFixed(4) }));
}
const navSeries = buildNav();

// ── Benchmark & HS300 series (normalized to nav scale) ──
function buildBm(navSeries: { date: string; nav: number }[], _ytdRet: number, label: string): Record<string, number> {
  const mr: Record<string, number> = label === "hs300"
    ? { "2026-01": 1.65, "2026-02": 0.09, "2026-03": -5.53, "2026-04": 8.03, "2026-05": 1.76, "2026-06": 0.2 }
    : { "2026-01": 3.5, "2026-02": 2.0, "2026-03": -1.0, "2026-04": 6.5, "2026-05": 3.2, "2026-06": 0.8 };
  const result: Record<string, number> = {};
  let v = 100;
  for (const s of navSeries) {
    const mRet = mr[s.date.slice(0, 7)] ?? 0;
    v *= (1 + mRet / 100 / 21 + (Math.random() - 0.5) * 0.002);
    result[s.date] = +v.toFixed(2);
  }
  // Normalize to nav starting point
  const navFirst = navSeries[0]!.nav;
  const bmFirst = result[navSeries[0]!.date]!;
  for (const k of Object.keys(result)) result[k] = +((result[k]! / bmFirst) * navFirst).toFixed(4);
  return result;
}
const bmSeries = buildBm(navSeries, benchmarkYtd, "bm");
const hsSeries = buildBm(navSeries, 6.25, "hs300");

// ── K-line table ──
function col(s: string, w: number): string { return String(s).length >= w ? String(s) + "   " : String(s).padEnd(w, " ") + "   "; }

function agg(bars: Bar[], groupFn: (b: Bar) => string, minLen: number): Bar[] {
  const m = new Map<string, Bar[]>();
  for (const b of bars) { const k = groupFn(b); if (!m.has(k)) m.set(k, []); m.get(k)!.push(b); }
  return [...m.entries()].filter(([, g]) => g.length >= minLen).map(([, g]) => ({
    t: g[0]!.t + (g.length > 1 ? "/" + g[g.length - 1]!.t.slice(5) : ""),
    o: g[0]!.o, c: g[g.length - 1]!.c,
    h: Math.max(...g.map(b => b.h)), l: Math.min(...g.map(b => b.l)),
    v: g.reduce((s, b) => s + b.v, 0),
  }));
}

const dailyBars: Bar[] = navSeries.map(s => {
  const r = (Math.random() - 0.5) * 0.006;
  return { t: s.date, o: +(s.nav * (1 + r)).toFixed(4), h: +(s.nav * (1 + Math.random() * 0.008)).toFixed(4), l: +(s.nav * (1 - Math.random() * 0.008)).toFixed(4), c: s.nav, v: ((Math.random() * 800 + 200) | 0) };
});

function renderKline(): string {
  const parts = [
    renderTf(dailyBars, "日K", "日期"),
    renderTf(agg(dailyBars, b => {
      const d = new Date(b.t + "T00:00:00+08:00");
      const day = d.getUTCDay();
      const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
      return mon.toISOString().slice(0, 10);
    }, 2), "周K", "周"),
    renderTf(agg(dailyBars, b => b.t.slice(0, 7), 3), "月K", "月"),
    renderTf(agg(dailyBars, b => { const m = parseInt(b.t.slice(5, 7)); return b.t.slice(0, 4) + "-Q" + Math.ceil(m / 3); }, 3), "季K", "季"),
  ];
  return parts.join("\n");
}
function renderTf(bars: Bar[], tf: string, hdr: string): string {
  const lines = [`─── ${tf} ───`, col(hdr, 14) + col("开盘", 10) + col("最高", 10) + col("最低", 10) + col("收盘", 10) + "成交量"];
  for (const b of bars) lines.push(col(b.t, 14) + col(b.o.toFixed(4), 10) + col(b.h.toFixed(4), 10) + col(b.l.toFixed(4), 10) + col(b.c.toFixed(4), 10) + b.v + "万");
  return lines.join("\n");
}

// ── All dashboard text sections ──
const perfTable = `
══════════════════════════════════════
          本产品        沪深300
成立以来  +1084.86%       +51.74%
今年以来   +126.40%        +6.25%
2025      +104.91%       +17.66%
2024       +18.58%       +14.69%
2023       -36.99%       -11.38%
══════════════════════════════════════
最大回撤    65.60%        45.60%
同类排名  2/1096  3/1096  4/1065  117/990  929/933
`;

const monthlyTable = `
═══════════════════════════════
          本产品      沪深300
2026-05   +14.99%      +1.76%
2026-04   +29.30%      +8.03%
2026-03    -2.56%      -5.53%
2026-02    +9.06%      +0.09%
2026-01   +16.03%      +1.65%
2025-12   +13.54%      +2.28%
═══════════════════════════════
`;

const riskMetrics = `
═══════════════════════════════
指标          本产品    同类均值
波动率        45.78%    24.20%
夏普比率       7.56      1.80
最大回撤      19.57%    18.11%
═══════════════════════════════
风险收益比: 优于100%同类  |  抗风险波动: 优于17%同类
`;

const sectorContribution = `
═══ 2025年行业/个股收益贡献 ═══
行业           收益贡献
通信           +35.21%
电子           +17.44%
传媒            +3.03%

个股           收益贡献
中际旭创       +14.45%
胜宏科技       +10.05%
新易盛          +8.53%
═════════════════
根据基金半年报/年报持仓测算
`;

const winProbTable = `
═══ 盈利概率 ═══
持有时长  平均收益   盈利概率
6个月     +18.63%    68%
1年       +39.74%    67%
2年       +75.35%    61%
3年       +77.22%    60%
══════════════
历史任意时点买入，持有满3年，盈利概率60%
`;

const dcaSim = `
═══ 定投收益模拟 (每月定投1000元) ═══
定投区间      总投入    期末市值    收益率
成立以来      9.4万     62.3万     +562.8%
近3年         3.6万     11.8万     +227.8%
近1年         1.2万      2.8万     +133.3%
══════════════
`;

// ── Fund analysis ──
function analysis(): string {
  return [
    `红土创新新科技股票A (006265) 基金深度分析`,
    "",
    `═══ 关键观察指标 ═══`,
    `年内收益: +126.40%`,
    `业绩基准: +31.37%`,
    `沪深300: +6.25%`,
    `Alpha超额: +95.03%`,
    `夏普比率: 7.56`,
    `波动率: 45.78%`,
    `最大回撤: -65.60%`,
    `同类排名: 2/1096`,
    `最新净值: 11.6711`,
    `══════════════`,
    "",
    `═══ 基金概况 ═══`,
    `名称: ${fund.name}  |  代码: ${fund.code}  |  类型: ${fund.type}  |  风险: ${fund.risk}`,
    `基金经理: ${fund.manager}  |  基金公司: ${fund.company}`,
    `成立日期: ${fund.inception} (7年285天)  |  规模: ${fund.aum}`,
    `最新净值: ${fund.nav} (${fund.navDate})  |  日涨跌: ${fund.dailyChg}%`,
    `年化收益(近5年): +${fund.annual5Y}%  |  累计收益: +${fund.cumReturn}%  |  今年以来: +${fund.ytdReturn}%`,
    `业绩比较基准: +${benchmarkYtd}% (今年以来)`,
    `同类排名: ${fund.rank} (今年以来)  |  ${fund.rank2025} (2025)  |  ${fund.rank2024} (2024)`,
    "",
    `═══ 风险指标 ═══`,
    `波动率: ${fund.vol}% (同类均值 24.20%)  |  夏普比率: ${fund.sharpe} (同类均值 1.80)`,
    `最大回撤: ${fund.maxDD}%  |  风险收益比: 优于100%同类  |  抗风险波动: 优于17%同类`,
    "",
    riskMetrics,
    "",
    `═══ 历史业绩 ═══`,
    perfTable,
    "",
    `═══ 月度表现 ═══`,
    monthlyTable,
    "",
    `═══ 行业/个股贡献 ═══`,
    sectorContribution,
    "",
    `═══ 盈利概率 ═══`,
    winProbTable,
    "",
    `═══ 定投模拟 ═══`,
    dcaSim,
    "",
    `═══ 综合研判 ═══`,
    `本基金为主动管理型科技股基金，2025年以来表现极其出色(+126.40% YTD)，`,
    `大幅跑赢沪深300(+6.25%)和业绩基准(+31.37%)。`,
    `收益主要来自通信(+35.21%)和电子(+17.44%)行业配置，重仓光模块/AI算力龙头。`,
    `夏普比率7.56远高于同类均值1.80，显示极强的风险调整后收益。`,
    `但波动率45.78%较高，最大回撤65.60%，适合高风险承受能力投资者。`,
    `长期持有3年盈利概率60%，定投策略可平滑波动。`,
    `风险提示: 行业集中度高(科技/通信), 主动管理依赖基金经理选股能力, 历史业绩不代表未来。`,
  ].join("\n");
}

// ── Generate ──
const entries = [
  { type: "session", version: 3, id: sid, timestamp: now, cwd: "/mock" },
  u("分析 红土创新新科技股票A (006265)，需要完整仪表盘：业绩走势、风险指标、历史业绩、行业贡献、盈利概率、定投收益"),
  a(renderKline()),
  a(analysis()),
];

const sp = dir + "/" + sid + ".jsonl";
writeFileSync(sp, entries.map(e => JSON.stringify(e)).join("\n"), "utf-8");

const result = generateArtifact({ sessionPath: sp, title: `${fund.name} (${fund.code})` });
if (!result) { console.log("FAILED"); process.exit(1); }

// Inject bm/bm2 into tfData
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
        const bm1 = navSeries.map(s => bmSeries[s.date] ?? 0);
        const hs1 = navSeries.map(s => hsSeries[s.date] ?? 0);
        html = html.slice(0, i) + `,"bm":{"label":"中证科技指数 (业绩基准)","closes":[${bm1.join(",")}]},"bm2":{"label":"沪深300 (000300)","closes":[${hs1.join(",")}]}` + html.slice(i);
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
console.log("Benchmarks:", html.includes("业绩基准") && html.includes("沪深300"));
console.log("Path:", ".ohquant/artifacts/" + sid + ".html");
