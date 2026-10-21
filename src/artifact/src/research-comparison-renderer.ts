import { esc } from "./template.ts";
import type { ResearchComparison, ResearchMetric } from "../../research/types.ts";

function metricText(metric: ResearchMetric): string {
  if (metric.value === null) return "N/A";
  return metric.unit === "percent" ? `${(metric.value * 100).toFixed(2)}%` : metric.value.toFixed(4);
}

/** Static SVG and HTML tables work offline, in the full report and in the public copy. */
export function renderResearchComparison(comparison: ResearchComparison): string {
  const { dates, series, fx } = comparison;
  let min = Infinity, max = -Infinity;
  for (const curve of series) for (const value of curve.values) { min = Math.min(min, value); max = Math.max(max, value); }
  const range = max - min || Math.max(1, max * 0.01);
  const start = Date.parse(dates[0]!), duration = Date.parse(dates.at(-1)!) - start;
  const styles = [{ color: "#C99A2E", dash: "" }, { color: "var(--ink,#FFF3C4)", dash: "10 4" }, { color: "var(--muted,#8F8A7B)", dash: "2 5" }];
  const chart = `<div class="research-table comparison-chart" tabindex="0" role="region" aria-label="Portfolio NAV chart"><svg viewBox="0 0 880 300" role="img" aria-label="Portfolio A, Portfolio B and benchmark, normalized to 1; calendar date axis"><path d="M64 24V244H832" fill="none" stroke="#8F8A7B"/>${series.map((curve, index) => {
    const style = styles[index]!;
    const points = curve.values.map((value, i) => `${(64 + (Date.parse(dates[i]!) - start) / duration * 768).toFixed(2)},${(24 + (max - value) / range * 220).toFixed(2)}`).join(" ");
    return `<polyline data-comparison-series="${index}" points="${points}" fill="none" stroke="${style.color}" stroke-width="2" stroke-dasharray="${style.dash}"/>`;
  }).join("")}<g fill="#8F8A7B" font-family="system-ui,sans-serif" font-size="12"><text x="64" y="280">${esc(dates[0]!)}</text><text x="832" y="280" text-anchor="end">${esc(dates.at(-1)!)}</text><text x="58" y="28" text-anchor="end">${max.toFixed(3)}</text><text x="58" y="244" text-anchor="end">${min.toFixed(3)}</text></g></svg></div>`;
  const legend = `<ul class="comparison-legend">${series.map((curve, i) => `<li><span style="border-color:${styles[i]!.color};border-top-style:${i === 0 ? "solid" : i === 1 ? "dashed" : "dotted"}"></span>${esc(curve.label)}</li>`).join("")}</ul>`;
  const metrics = `<div class="research-table" tabindex="0" role="region" aria-label="Portfolio return and risk comparison"><table data-comparison-metrics><caption>Return and risk · ${esc(fx.baseCurrency)}</caption><thead><tr><th>Metric</th>${series.map(curve => `<th>${esc(curve.label)}</th>`).join("")}</tr></thead><tbody>${series[0]!.metrics.map((metric, i) => `<tr><th scope="row">${esc(metric.label)}</th>${series.map(curve => `<td>${metricText(curve.metrics[i]!)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const members = `<details><summary>查看假设权重与成员收益</summary><p>初始配置比例；本币与基准币收益均使用共同估值区间。权重不代表实际账户仓位。</p><div class="research-table" tabindex="0" role="region" aria-label="Hypothetical member allocations"><table><thead><tr><th>Portfolio</th><th>Symbol</th><th>Quote currency</th><th>Initial weight</th><th>Local return</th><th>Base return</th></tr></thead><tbody>${series.flatMap(curve => curve.members.map(member => `<tr><td>${esc(curve.label)}</td><td>${esc(member.symbol)}</td><td>${esc(member.currency)}</td><td>${(member.initialWeight * 100).toFixed(2)}%</td><td>${(member.localReturn * 100).toFixed(2)}%</td><td>${(member.baseReturn * 100).toFixed(2)}%</td></tr>`)).join("")}</tbody></table></div></details>`;
  const raw = `<details><summary>查看三组净值数据</summary><div class="research-table" tabindex="0" role="region" aria-label="Raw normalized portfolio NAV"><table data-comparison-nav><thead><tr><th>Date</th>${series.map(curve => `<th>${esc(curve.label)}</th>`).join("")}</tr></thead><tbody>${dates.map((date, index) => `<tr><td>${esc(date)}</td>${series.map(curve => `<td>${curve.values[index]!.toPrecision(12)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
  const coverage = `<details><summary>查看缺失成员与日期 · ${comparison.excluded.length} / ${comparison.droppedDates.length}</summary><p>缺成员默认停止；显式排除后归一化剩余权重。缺价格或同日汇率的日期整行移除，不填充。</p>${comparison.excluded.length ? `<ul>${comparison.excluded.map(item => `<li>${esc(item.portfolio)} · ${esc(item.symbol)} · 窗口内少于两条价格</li>`).join("")}</ul>` : "<p>未排除成员。</p>"}${comparison.droppedDates.length ? `<div class="research-table" tabindex="0" role="region" aria-label="Missing valuation dates"><table><thead><tr><th>Date</th><th>Missing observations</th></tr></thead><tbody>${comparison.droppedDates.map(item => `<tr><td>${esc(item.date)}</td><td>${esc(item.missing.join(", "))}</td></tr>`).join("")}</tbody></table></div>` : "<p>候选估值日期全部对齐。</p>"}</details>`;
  const rates = `<details><summary>查看汇率观测与来源 · ${fx.points.length} 条</summary><p>Source: ${esc(fx.source)} · Observed at: ${esc(fx.observedAt)}<br>换算方向：每 1 单位外币对应的 ${esc(fx.baseCurrency)} 数量；本币价格 × 汇率 = 基准币价格。记录固定于比较归档，不重新取数。</p>${fx.points.length ? `<div class="research-table" tabindex="0" role="region" aria-label="Archived FX observations"><table data-comparison-fx><thead><tr><th>Date</th><th>Quote currency</th><th>${esc(fx.baseCurrency)} per unit</th></tr></thead><tbody>${fx.points.map(point => `<tr><td>${esc(point.date)}</td><td>${esc(point.currency)}</td><td>${point.rate.toPrecision(12)}</td></tr>`).join("")}</tbody></table></div>` : "<p>所有有效标的与基准均为同币种，恒等换算，无外部汇率请求。</p>"}</details>`;
  return `<div data-research-comparison>${legend}${chart}<p>假设配置净值 · 初值 1 · 横轴为实际日历日期，连线跨越非估值日。三组采用相同价格与汇率日期。</p>${metrics}${members}${raw}${coverage}${rates}</div>`;
}
