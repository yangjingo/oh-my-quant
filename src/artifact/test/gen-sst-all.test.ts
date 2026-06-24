/**
 * Batch generate artifacts for all SST / semiconductor funds.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { generateArtifact } from "../src/generator.ts";
import { saveArtifact } from "../../storage/src/artifacts.ts";
import { HS300_MONTHLY, buildBenchmarkSeries } from "./benchmarks.ts";

const now = new Date().toISOString();
const dir = ".ohquant/sessions/--mock--";
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

function uid() { return Math.random().toString(36).slice(2, 8); }
function u(t: string) { return { type: "message", id: "u-" + uid(), parentId: null, timestamp: now, message: { role: "displayUser", content: [{ type: "text", text: t }] } }; }
function a(t: string) { return { type: "message", id: "a-" + uid(), parentId: null, timestamp: now, message: { role: "assistant", model: "deepseek-v4-pro", provider: "anthropic", content: [{ type: "text", text: t }], stopReason: "stop", timestamp: Date.now() } }; }

interface FundSpec {
  code: string; name: string; theme: string; ytd: number; nav: number; inception: string;
  monthly: number[]; // Jan-Jun 2026 monthly returns
  bmLabel: string; // benchmark index name shown on chart
  bmYtd: number; // benchmark YTD return for scaling
}

// Real/semi-real fund data for Jan-Jun 2026
const funds: FundSpec[] = [
  { code: "159325", name: "半导体ETF南方", theme: "中证半导体行业精选指数", ytd: 98.5, nav: 2.8561, inception: "2022-05", monthly: [15.2, 12.8, -8.5, 22.1, 18.3, 6.2], bmLabel: "中证半导体行业精选指数", bmYtd: 80 },
  { code: "588890", name: "科创芯片ETF南方", theme: "上证科创板芯片指数", ytd: 85.3, nav: 1.9234, inception: "2023-08", monthly: [13.5, 10.2, -10.1, 25.4, 15.8, 5.9], bmLabel: "上证科创板芯片指数", bmYtd: 75 },
  { code: "159995", name: "芯片ETF华夏", theme: "国证半导体芯片指数", ytd: 72.8, nav: 1.4567, inception: "2020-01", monthly: [11.8, 9.5, -7.2, 19.3, 14.1, 4.8], bmLabel: "国证半导体芯片指数", bmYtd: 65 },
  { code: "159516", name: "半导体设备ETF", theme: "中证半导体设备指数", ytd: 105.2, nav: 1.6789, inception: "2023-03", monthly: [16.8, 14.2, -9.8, 24.5, 19.7, 7.1], bmLabel: "中证半导体设备指数", bmYtd: 90 },
  { code: "588170", name: "科创半导体ETF华夏", theme: "上证科创板半导体指数", ytd: 91.6, nav: 1.5234, inception: "2023-06", monthly: [14.5, 11.3, -9.2, 23.8, 17.2, 6.5], bmLabel: "上证科创板半导体指数", bmYtd: 78 },
  { code: "561380", name: "电网设备ETF", theme: "中证电网设备指数", ytd: 45.3, nav: 1.2345, inception: "2024-01", monthly: [6.2, 5.1, -3.8, 12.5, 9.4, 3.2], bmLabel: "中证电网设备指数", bmYtd: 35 },
  { code: "159387", name: "创业板新能源ETF", theme: "创业板新能源指数", ytd: 38.7, nav: 1.1123, inception: "2024-03", monthly: [5.5, 4.2, -4.1, 10.8, 8.1, 2.8], bmLabel: "创业板新能源指数", bmYtd: 30 },
];

function buildNav(monthlyRet: number[]): { date: string; nav: number }[] {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
  const series: { date: string; nav: number }[] = [];
  let nav = 1.0;
  const start = new Date("2026-01-02"), end = new Date("2026-06-23");

  for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
    if (dt.getDay() === 0 || dt.getDay() === 6) continue;
    const mi = months.indexOf(dt.toISOString().slice(0, 7));
    const mRet = mi >= 0 ? monthlyRet[mi]! : 0;
    const dr = Math.pow(1 + mRet / 100, 1 / 21) - 1;
    nav *= (1 + dr + (Math.random() - 0.5) * 0.008);
    series.push({ date: dt.toISOString().slice(0, 10), nav: +nav.toFixed(4) });
  }
  return series;
}

// Shared HS300 benchmark
const allDates = buildNav([0,0,0,0,0,0]).map(s => s.date);

function col(s: string, w: number): string { return String(s).length >= w ? String(s) + "   " : String(s).padEnd(w, " ") + "   "; }

function renderKline(navSeries: { date: string; nav: number }[], navFinal: number): string {
  // Scale to actual NAV
  const adj = navFinal / navSeries[navSeries.length - 1]!.nav;
  const scaledBars = navSeries.map(s => {
    const c = +(s.nav * adj).toFixed(4);
    return {
      t: s.date, c,
      o: +(c * (1 + (Math.random() - 0.5) * 0.004)).toFixed(4),
      h: +(c * (1 + Math.random() * 0.006)).toFixed(4),
      l: +(c * (1 - Math.random() * 0.006)).toFixed(4),
      v: ((Math.random() * 500 + 100) | 0),
    };
  });

  // Weekly/Monthly aggregation
  const wk = agg(scaledBars, b => { const d = new Date(b.t + "T00:00:00+08:00"); const day = d.getUTCDay(); const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1)); return mon.toISOString().slice(0, 10); }, 2);
  const mo = agg(scaledBars, b => b.t.slice(0, 7), 3);

  function tf(bars: any[], label: string, hdr: string): string {
    const lines = [`─── ${label} ───`, col(hdr, 14) + col("开盘", 10) + col("最高", 10) + col("最低", 10) + col("收盘", 10) + "成交量"];
    for (const b of bars) lines.push(col(b.t, 14) + col(b.o.toFixed(4), 10) + col(b.h.toFixed(4), 10) + col(b.l.toFixed(4), 10) + col(b.c.toFixed(4), 10) + b.v + "万");
    return lines.join("\n");
  }

  return [tf(scaledBars, "日K", "日期"), tf(wk, "周K", "周"), tf(mo, "月K", "月")].join("\n");
}

function agg(bars: any[], gf: (b: any) => string, min: number): any[] {
  const m = new Map<string, any[]>();
  for (const b of bars) { const k = gf(b); if (!m.has(k)) m.set(k, []); m.get(k)!.push(b); }
  return [...m.entries()].filter(([, g]) => g.length >= min).map(([, g]) => ({
    t: g[0]!.t + (g.length > 1 ? "/" + g[g.length - 1]!.t.slice(5) : ""),
    o: g[0]!.o, c: g[g.length - 1]!.c,
    h: Math.max(...g.map(b => b.h)), l: Math.min(...g.map(b => b.l)),
    v: g.reduce((s, b) => s + b.v, 0),
  }));
}

function analysis(f: FundSpec): string {
  return [
    `${f.name} (${f.code}) 基金分析`,
    "",
    `═══ 关键指标 ═══`,
    `年内收益: +${f.ytd}%`,
    `跟踪指数: ${f.theme}`,
    `成立日期: ${f.inception}`,
    `最新净值: ${f.nav}`,
    "",
    `═══ 行业背景 ═══`,
    `半导体/AI算力产业链持续景气，芯片需求旺盛。SST(固态变压器)为800VDC终极方案，`,
    `碳化硅(SiC)衬底需求激增。本基金聚焦${f.theme}方向。`,
    "",
    `═══ 综合研判 ═══`,
    `年内${f.ytd > 80 ? "大幅" : "稳健"}跑赢沪深300(+6.25%)。`,
    f.ytd > 80 ? "半导体设备/芯片方向受益AI资本开支持续高景气。" : "电网设备/新能源方向受益能源转型政策。",
    `注意行业集中度高、波动大等风险。`,
  ].join("\n");
}

// ── Generate all ──
for (const f of funds) {
  const sid = `019ef014-sst-${f.code}`;
  const navSeries = buildNav(f.monthly);
  const scaledNav = navSeries.map(s => ({ date: s.date, nav: +(s.nav * (f.nav / navSeries[navSeries.length - 1]!.nav)).toFixed(4) }));
  const hs300 = buildBenchmarkSeries(scaledNav.map(s => s.date), HS300_MONTHLY, scaledNav[0]!.nav);

  const entries = [
    { type: "session", version: 3, id: sid, timestamp: now, cwd: "/mock" },
    u(`分析 ${f.name} ${f.code}`),
    a(renderKline(navSeries, f.nav)),
    a(analysis(f)),
  ];

  const sp = dir + "/" + sid + ".jsonl";
  writeFileSync(sp, entries.map(e => JSON.stringify(e)).join("\n"), "utf-8");

  const result = generateArtifact({ sessionPath: sp });
  if (!result) { console.log(`FAILED: ${f.code}`); continue; }

  // Inject benchmark: fund's tracking index (specific label), scaled from product start
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
          const bmCloses = scaledNav.map(s => +(hs300[s.date] ?? 0).toFixed(4));
          html = html.slice(0, i) + `,"bm":{"label":"${f.bmLabel}","closes":[${bmCloses.join(",")}]}` + html.slice(i);
          break;
        }
      }
    }
  }

  saveArtifact(sid, html, { title: result.title, messageCount: result.messageCount });
  console.log(`${f.code} ${f.name}: ${(html.length / 1024).toFixed(0)}KB`);
}

// Open all
import { exec } from "node:child_process";
for (const f of funds) {
  exec(`start "" ".ohquant/artifacts/019ef014-sst-${f.code}.html"`);
}
console.log("\nAll 7 artifacts generated and opened.");
