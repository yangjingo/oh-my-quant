import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { runInNewContext } from "node:vm";
import { renderEchartsKline, renderMetricCards, renderScoreTable, highlight } from "../src/renderers.ts";
import { renderDataTable } from "../src/detectors.ts";
import { artifactThemeCss } from "../src/theme.ts";
import { renderDashboardOverview } from "../src/dashboard.ts";
import { renderDock } from "../src/dock.ts";
import { generateCurrentSessionArtifact } from "../../runtime/research/artifact-reports.ts";
import { loadSettings, saveSettings } from "../../storage/index.ts";
import { WHYJ_THEME, type MarketColorScheme } from "../../types/theme-colors.ts";
import type { CommandContext } from "../../types/commands.ts";
import type { KlineData, GenCtx } from "../src/types.ts";

const kline: KlineData = { header: ["date", "open", "high", "low", "close", "volume"], rows: [
  { date: "2026-01-05", open: 10, close: 10, high: 11, low: 9, vol: 10 },
  { date: "2026-01-06", open: 10, close: 12, high: 13, low: 9, vol: 20 },
  { date: "2026-01-07", open: 12, close: 11, high: 13, low: 10, vol: 15 },
] };
function context(klines: KlineData[]): GenCtx {
  return { title: "Test", dashBody: [], trajBody: [], metrics: [], scores: null, factors: [], klines, navCharts: [], compareFactors: [],
    stats: { turnCount: 1, toolCallCount: 0, skillNames: [], firstTs: "", lastTs: "" } };
}
interface ChartOption { series: Array<{ name: string; data: unknown[]; lineStyle?: { color: string } }> }

it("executes chart scripts using the report CSS convention and keeps flat candles, volume and MACD neutral", () => {
  const html = renderEchartsKline([kline]);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  expect(html).toContain('class="k-neutral"');
  expect(html).toContain('class="k-up"');
  expect(html).toContain('class="k-down"');
  expect(html).not.toContain("阳线红涨阴线绿跌");
  for (const scheme of ["red-up", "green-up"] as const) {
    const css = artifactThemeCss(scheme);
    const properties = Object.fromEntries([...css.matchAll(/(--[\w-]+):([^;{}]+)[;}]?/g)].map(match => [match[1]!, match[2]!]));
    const options: ChartOption[] = [];
    const chartElement = { innerHTML: "fallback", parentElement: { parentElement: { querySelectorAll: () => [] } } };
    runInNewContext(script, {
      document: { getElementById: () => chartElement }, window: { addEventListener: () => {} },
      getComputedStyle: () => ({ getPropertyValue: (name: string) => properties[name] ?? "" }),
      echarts: { init: () => ({ setOption: (option: ChartOption) => options.push(option), resize: () => {} }) },
    });
    const [option] = options;
    expect(option).toBeDefined();
    const up = scheme === "red-up" ? WHYJ_THEME.marketUp : WHYJ_THEME.marketDown;
    const down = scheme === "red-up" ? WHYJ_THEME.marketDown : WHYJ_THEME.marketUp;
    expect(option!.series.find(series => series.name === "K线")!.data[0]).toMatchObject({
      value: [10, 10, 9, 11], itemStyle: { color: WHYJ_THEME.muted, color0: WHYJ_THEME.muted },
    });
    expect(option!.series.find(series => series.name === "Vol")!.data).toMatchObject([
      { itemStyle: { color: WHYJ_THEME.muted } }, { itemStyle: { color: up } }, { itemStyle: { color: down } },
    ]);
    expect(option!.series.find(series => series.name === "MACD(柱线)")!.data[0]).toMatchObject({ value: 0, itemStyle: { color: WHYJ_THEME.muted } });
    expect(option!.series.find(series => series.name === "MA20(20日均)")!.lineStyle?.color).toBe(WHYJ_THEME.muted);
    expect(css).toContain(`--up:${up};--down:${down}`);
    expect(css).toContain(`--positive:${WHYJ_THEME.positive};--negative:${WHYJ_THEME.negative}`);
    expect(css).toContain(`--gold:${WHYJ_THEME.gold};`);
    expect(css).toContain(".k-neutral line{stroke:var(--muted)");
  }
});

it("shows flat and missing observations neutrally across K-line KPIs, dock and dashboard", () => {
  const flat: KlineData = { ...kline, rows: [kline.rows[0]!, { ...kline.rows[0]!, date: "2026-01-06" }] };
  const one = { ...kline, rows: [kline.rows[0]!] };
  for (const [data, text] of [[flat, "0.00%"], [one, "N/A"]] as const) {
    const html = renderEchartsKline([data]);
    expect(html).toContain(`<span>涨跌幅</span><b class="neutral">${text}</b>`);
    expect(html).toContain('<span>MA20</span><b class="neutral">—</b>');
    expect(renderDock(context([data]), "fixture")).toContain(`<div class="ml">Change</div><div class="mv nt">${text}</div>`);
    expect(renderDashboardOverview(context([data]))).toContain('<div class="board-kpi neutral"><span>LATEST CLOSE</span>');
  }
  const ctx = context([kline]);
  ctx.metrics = [{ label: "Max drawdown", num: 8, value: "+8%" }];
  const html = renderDashboardOverview(ctx);
  expect(html).toContain('<div class="board-kpi down"><span>LATEST CLOSE</span>');
  expect(html).toContain('<div class="board-kpi negative"><span>RISK MARKER</span>');
});

it("distinguishes returns, risk amounts, scores and status without treating every positive number as a gain", () => {
  const table = { header: ["Symbol", "Return", "Max drawdown", "Sharpe", "Price"], data: [
    ["UP", "+12.30%", "+8.20%", "1.2", "100"], ["FLAT", "+0.00%", "0.00%", "0", "0"],
    ["DOWN", "-1.25%", "-9.10%", "-0.5", "50"],
    ["MISSING", "N/A", "—", "--", "N/A"],
  ] };
  for (const render of [renderDataTable, renderScoreTable]) {
    const html = render(table);
    expect(html).toContain('class="n u">+12.30%');
    expect(html).toContain('class="n d">-1.25%');
    expect(html).toContain('class="n ng">+8.20%');
    expect(html).toContain('class="n ng">-9.10%');
    expect(html).toContain('class="n p">1.2');
    expect(html).toContain('class="n m">+0.00%');
    expect(html).toContain('class="n m">100');
    expect(html).toContain('class="m">N/A');
  }
  const cards = renderMetricCards([{ label: "Return", value: "+2%", num: 2 }, { label: "VaR", value: "+5%", num: 5 }]);
  expect(cards).toContain('class="mv up">+2%'); expect(cards).toContain('class="mv neg">+5%');
  expect(highlight("收益 +2%，回撤 -3%，变化 +0%")).toBe('收益 <span class="whyj-up">+2%</span>，回撤 <span class="whyj-neg">-3%</span>，变化 <span class="whyj-nt">+0%</span>');
});

let root: string, previous: string | undefined;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR; root = mkdtempSync(join(tmpdir(), "whyj-report-colors-")); process.env.OHQUANT_DIR = root;
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected report colors test directory");
  rmSync(root, { recursive: true, force: true });
});

it("captures the saved preference during automatic generation and never rewrites earlier report bytes", async () => {
  const path = join(root, "fixture.jsonl");
  const metadata = { id: "color-session", path, cwd: root, createdAt: "2026-01-08T00:00:00Z" };
  writeFileSync(path, [
    { type: "session", version: 3, id: metadata.id, cwd: root, timestamp: metadata.createdAt },
    { type: "message", id: "u", parentId: null, message: { role: "user", content: "Analyze the fixture" } },
    { type: "message", id: "a", parentId: "u", message: { role: "assistant", content: [{ type: "text", text: "Fixture return +2%" }] } },
  ].map(entry => JSON.stringify(entry)).join("\n") + "\n");
  const opened: string[] = [];
  const ctx: CommandContext = { openFile: path => opened.push(path), agentSession: {
    waitForIdle: async () => {}, compact: async () => { throw new Error("unexpected compact"); },
    listSessions: async () => [metadata], getSessionMetadata: async () => metadata,
    resumeSession: async () => metadata, getContextUsage: () => undefined, getSkills: async () => [],
    skill: async () => {}, getLeafId: async () => "a",
  } };
  const reports: string[] = [];
  for (const scheme of ["green-up", "red-up"] as MarketColorScheme[]) {
    const settings = loadSettings(); settings.preferences.marketColorScheme = scheme; saveSettings(settings);
    expect((await generateCurrentSessionArtifact(ctx)).success).toBe(true);
    const html = readFileSync(opened.at(-1)!, "utf8"); reports.push(html);
    expect(html).toContain(`data-market-colors="${scheme}"`);
    expect(html).toContain(scheme === "green-up" ? "Green up / Red down" : "Red up / Green down");
  }
  expect(opened[0]).not.toBe(opened[1]);
  expect(readFileSync(opened[0]!, "utf8")).toBe(reports[0]!);
});
