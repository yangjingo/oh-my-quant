import { expect, it } from "bun:test";
import { runInNewContext } from "node:vm";
import { renderComparisonRadar, renderEchartsBars, renderEchartsKline, renderFactorRadar, renderNavEcharts } from "../src/renderers.ts";

const label = `</script><svg/onload=top.q=1> ' " 中文`;
const bar = { label, pct: 50, value: "50%", up: true };

function executeChart(html: string): unknown {
  // A chart fragment has exactly one script; labels must never create markup.
  expect([...html.matchAll(/<\/script\s*>/gi)]).toHaveLength(1);
  expect(html).not.toContain(label);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  let option: unknown;
  const element = { innerHTML: "fallback", parentElement: { parentElement: { querySelectorAll: () => [] } } };
  runInNewContext(script, {
    document: { getElementById: () => element }, window: { addEventListener: () => {} },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    echarts: { init: () => ({ setOption: (value: unknown) => { option = value; }, resize: () => {} }) },
  });
  expect(option).toBeDefined();
  return option;
}

it("preserves chart labels as data while preventing script-element termination", () => {
  for (const html of [
    renderEchartsBars([bar]),
    renderFactorRadar([bar]),
    renderComparisonRadar([{ name: label, factors: [bar] }]),
  ]) {
    expect(JSON.stringify(executeChart(html))).toContain(JSON.stringify(label).slice(1, -1));
  }
});

it("preserves the quoted K-line timeframe and NAV dates as chart data", () => {
  const timeframe = `quoted ' 中文 </script><svg/onload=top.q=1>`;
  const kline = { timeframe, header: ["date", "open", "high", "low", "close"], rows: [
    { date: "2026-01-01", open: 1, high: 2, low: 1, close: 2 },
  ] };
  const klineOption = executeChart(renderEchartsKline([kline]));
  expect(JSON.stringify(klineOption)).toContain("2026-01-01");
  const navOption = executeChart(renderNavEcharts({ header: ["date", "nav"], rows: [{ date: "2026-01-01", nav: 1 }] }));
  expect(JSON.stringify(navOption)).toContain("2026-01-01");
});
