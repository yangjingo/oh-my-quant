import { esc } from "./template.ts";
import type { ResearchAnalysis, ResearchReport, ResearchFundDataset } from "../../research/types.ts";

import { researchCss } from "./research-theme.ts";
import { renderResearchComparison } from "./research-comparison-renderer.ts";

function lineChart(values: number[], label: string, dates: string[], benchmark?: number[]): string {
  const all = benchmark ? [...values, ...benchmark] : values;
  const min = Math.min(...all), max = Math.max(...all), range = max - min || Math.max(1, max * 0.01);
  const points = (series: number[]) => series.map((value, i) => `${(48 + i / Math.max(1, series.length - 1) * 784).toFixed(2)},${(24 + (max - value) / range * 192).toFixed(2)}`).join(" ");
  return `<svg viewBox="0 0 880 260" role="img" aria-label="${esc(label)}"><path d="M48 24V216H832" fill="none" stroke="#555"/><polyline points="${points(values)}" fill="none" stroke="#C99A2E" stroke-width="2"/>${benchmark ? `<polyline points="${points(benchmark)}" fill="none" stroke="#8F8A7B" stroke-width="1.5" stroke-dasharray="5 4"/>` : ""}<g fill="#8F8A7B" font-family="system-ui,sans-serif" font-size="12"><text x="48" y="244">${esc(dates[0] ?? "")}</text><text x="832" y="244" text-anchor="end">${esc(dates.at(-1) ?? "")}</text><text x="48" y="16">${max.toFixed(4)}</text><text x="48" y="232">${min.toFixed(4)}</text></g></svg>`;
}

function analysisHtml(analysis: ResearchAnalysis, index: number): string {
  const cells = analysis.metrics.map(item => {
    const value = item.value === null ? "N/A" : item.unit === "percent" ? `${item.value >= 0 ? "+" : ""}${(item.value * 100).toFixed(2)}%` : item.unit === "periods" ? String(item.value) : item.value.toFixed(4);
    return `<div><span>${esc(item.label)}</span><b>${esc(value)}</b></div>`;
  }).join("");
  const curve = analysis.curve;
  const comparison = analysis.comparison ? renderResearchComparison(analysis.comparison) : "";
  const ranking = analysis.ranking ? `<div class="research-table" tabindex="0" role="region" aria-label="Saved evaluation ranking"><table data-research-ranking><caption>Saved evaluation ranking</caption><thead><tr><th>Rank</th><th>Strategy / inputs</th><th>Score / 100</th><th>CAGR</th><th>Sharpe</th><th>Max drawdown</th></tr></thead><tbody>${analysis.ranking.map((row, rank) => `<tr><td>${rank + 1}</td><td>${esc(row.title)}<br>${esc(row.basis)}<br>${row.datasetIndexes.map(id => `Dataset ${id + 1}`).join(" · ")}</td><td>${row.score}</td><td>${row.cagr === null ? "N/A" : (row.cagr * 100).toFixed(2) + "%"}</td><td>${row.sharpe ?? "N/A"}</td><td>${row.maxDrawdown === null ? "N/A" : (row.maxDrawdown * 100).toFixed(2) + "%"}</td></tr>`).join("")}</tbody></table></div>` : "";
  return `<section data-analysis="${index}"><span class="research-kicker">RECOMPUTED · MATCHED SAVED RESULT</span><h3>${esc(analysis.title)}</h3><div class="research-metrics">${cells}</div>${ranking}${comparison}${curve ? lineChart(curve.values, "Normalized simulated equity", curve.dates, curve.benchmark) + `<p>${curve.basis === "cash-flow-adjusted" ? "时间加权模拟序列 · 申购前基准 1，首点包含费用" : "模拟净值 · 初始值 1"}${curve.benchmark ? " · 虚线为基准" : ""}。横轴按共同观测日顺序排列。</p><details><summary>查看净值数据</summary><div class="research-table"><table><thead><tr><th>Date</th><th>${curve.basis === "cash-flow-adjusted" ? "TWR index" : "Strategy"}</th>${curve.benchmark ? "<th>Benchmark</th>" : ""}</tr></thead><tbody>${curve.dates.map((date, i) => `<tr><td>${esc(date)}</td><td>${curve.values[i]!.toPrecision(12)}</td>${curve.benchmark ? `<td>${curve.benchmark[i]!.toPrecision(12)}</td>` : ""}</tr>`).join("")}</tbody></table></div></details>` : ""}<p>输入：${analysis.datasetIndexes.map(id => `Dataset ${id + 1}`).join(" · ")}</p><ul>${analysis.assumptions.map(value => `<li>${esc(value)}</li>`).join("")}</ul></section>`;
}

export function renderFundNavInput({ ref, nav, fee }: ResearchFundDataset, index?: number): string {
  return `<section data-public-fund="${esc(ref.contentHash)}"><span class="research-kicker">${index === undefined ? "ARCHIVED" : `DATASET ${index + 1}`} · PUBLIC FUND NAV</span><h2>${esc(ref.symbol)} · ${esc(ref.endpoint)}</h2><p>${esc(nav[0]!.navDate)} — ${esc(nav.at(-1)!.navDate)} · ${nav.length} observations</p>${lineChart(nav.map(row => row.unitNav), "Public unit NAV, not account value", nav.map(row => row.navDate))}<details><summary>查看公开净值与来源版本</summary><p>Observed at: ${esc(ref.snapshotAt)}<br>Revision: ${esc(ref.revision)}<br>Content hash: ${esc(ref.contentHash)}<br>Unit NAV unadjusted · Observed at fetch · Cash distributions not included${fee ? `<br>Current fee observation: ${fee.rate === null ? "unavailable" : `${(fee.rate * 100).toPrecision(6)}%`} · fund_purchase_em · ${esc(fee.fetchedAt)}` : ""}</p><div class="research-table"><table><thead><tr><th>Date</th><th>Unit NAV</th><th>Accumulated NAV</th></tr></thead><tbody>${nav.map(row => `<tr><td>${esc(row.navDate)}</td><td>${row.unitNav}</td><td>${row.accumulatedNav ?? "N/A"}</td></tr>`).join("")}</tbody></table></div></details></section>`;
}

export function renderResearchResults(report: ResearchReport): string {
  if (!report.analyses.length && !report.exclusions.unverifiedResults && !report.exclusions.unsupportedResults) return "";
  return `<div class="research-bound" data-bound-research="true"><h2>Verified research results</h2><p>以下数值从匹配的调用参数与归档输入重新计算，并与保存的工具结果逐字段核对。此核对不验证模型叙述、供应商数据真实性或实盘可成交性。</p>${report.analyses.map(analysisHtml).join("\n")}<p>未通过核对的结果：${report.exclusions.unverifiedResults} · 尚无归档输入绑定的结果：${report.exclusions.unsupportedResults}</p></div>`;
}

/** A fresh document from the public projection. It never receives original HTML or session text. */
export function renderShareReport(report: ResearchReport): string | undefined {
  if (!report.datasets.length) return;
  const title = [...new Set(report.datasets.map(dataset => dataset.ref.symbol))].slice(0, 5).join(" · ") + " 量化研究";
  const inputs = report.datasets.map((dataset, index) => {
    if ("nav" in dataset) return renderFundNavInput(dataset, index);
    const { ref, bars } = dataset;
    return `<section data-public-dataset="${index}"><span class="research-kicker">DATASET ${index + 1} · PUBLIC OBSERVATIONS</span><h2>${esc(ref.symbol)} · ${esc(ref.source)}</h2><p>${esc(bars[0]!.date)} — ${esc(bars.at(-1)!.date)} · ${bars.length} observations · ${esc(ref.market)}</p>${lineChart(bars.map(bar => bar.close), `${ref.symbol} closing prices`, bars.map(bar => bar.date))}<details><summary>查看公开行情与来源版本</summary><p>Observed at: ${esc(ref.snapshotAt)}<br>Requested: ${esc(ref.requested.start ?? "unbounded")} — ${esc(ref.requested.end ?? "unbounded")}<br>Revision: ${esc(ref.revision)}<br>Content hash: ${esc(ref.contentHash)}<br>Adjustment: provider-unspecified · Availability: observed-at-fetch</p><div class="research-table"><table><thead><tr><th>Date</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Volume</th></tr></thead><tbody>${bars.map(bar => `<tr><td>${esc(bar.date)}</td>${[bar.open, bar.high, bar.low, bar.close, bar.volume].map(value => `<td>${value}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details></section>`;
  }).join("\n");
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="generator" content="WhyJ Quant Public Research v1"><title>${esc(title)} — WhyJ Quant</title><style>body{margin:0;background:#0C0C0C}main{max-width:1120px;margin:auto;padding:32px 20px}*{box-sizing:border-box}@media(max-width:600px){main{padding:24px 12px}}${researchCss}</style></head><body><main class="research-bound"><header><span class="research-kicker">WHYJ QUANT · PUBLIC RESEARCH COPY</span><h1>${esc(title)}</h1><p>本副本包含公开行情、数据版本和已核对的量化结果。研究标的与区间可见；不包含会话原文、模型叙述、执行轨迹或资金金额。保存的完整研究报告仍独立保留。</p></header>${renderResearchResults(report)}${inputs}<footer><p>不可用输入：${report.exclusions.unavailableInputs}。未绑定或不一致的结论不会由文本推测补齐。结果用于复盘显式假设下的研究，不代表实际账户业绩。</p><small>静态 HTML · 无外部脚本、字体或数据请求 · 页面价格和结果固定于生成时的引用观测</small></footer></main></body></html>`;
}
