import type { AnnualResearch } from "../../research/annual.ts";
import { renderResearchComparison } from "./research-comparison-renderer.ts";
import { researchCss } from "./research-theme.ts";
import { esc } from "./template.ts";

/** Host-supplied private projection; the renderer never reads account history or credentials. */
export interface AnnualAccountSection {
  accountRef: string;
  currency: string;
  startAt: number;
  endAt: number;
  source: { adapterId: string; reference: string; observedAt: number };
  openingEquity: number;
  closingEquity: number;
  netExternalFlow: number;
  netProfit: number;
  feesAlreadyDeducted: number;
  timeWeightedReturn: number;
  observedMaxDrawdown: number;
  valuationCount: number;
}

function amount(value: number): string {
  const text = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value < 0 ? `−${text}` : text;
}

/** Offline report with fixed arithmetic and separately attributed historical perspectives. */
export function renderAnnualResearch(report: AnnualResearch, createdAt: string, account?: AnnualAccountSection): string {
  const { source, comparison, request, datasets } = report, { input } = source.result;
  const title = `${request.year} ${report.period === "calendar-year" ? "年度" : "年内截至日"}研究报告`;
  const scope = [
    ["请求区间", `${input.start} — ${request.valuationCutoff}`],
    ["实际共同估值", `${comparison.dates[0]} — ${comparison.dates.at(-1)} · ${comparison.dates.length} 个观察日`],
    ["Portfolio A", input.groups[0].name], ["Portfolio B", input.groups[1].name],
    ["币种与基准", `${input.baseCurrency} · ${input.benchmark}`],
    ["研究方法", `${input.weighting === "buy-and-hold" ? "买入持有" : "每个共同估值日再平衡"} · 缺成员时${input.missingMembers === "exclude" ? "排除并归一权重" : "停止"}`],
  ];
  const provenance = [
    ["报告生成时间（UTC）", createdAt], ["比较归档", source.id], ["比较生成时间（UTC）", source.createdAt],
    ["比较内容 SHA-256", report.comparisonHash], ["观察组合版本", input.portfolioRevision],
    ["Portfolio A ID", input.groups[0].id], ["Portfolio B ID", input.groups[1].id],
  ];
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${esc(title)} · WhyJ Quant</title><style>${researchCss}
body{margin:0;background:#0C0C0C}.annual{max-width:1120px;margin:auto;padding:32px 24px}.annual a{color:#C99A2E}.annual dt{color:var(--muted,#8F8A7B);font-size:12px}.annual dd{margin:0 0 12px}.annual-scope{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 24px}.annual article+article{margin-top:24px;padding-top:24px;border-top:1px solid #3A362C}.annual footer{padding:16px 0}.annual-scroll-hint{display:none}.annual a:focus-visible{outline:2px solid #C99A2E;outline-offset:3px}@media screen and (max-width:600px){.annual{padding:16px}.annual-scope{grid-template-columns:1fr}.annual-scroll-hint{display:block}}
@media print{body{background:#fff}.annual{padding:0;font-size:12px;line-height:1.5}.annual a,.annual summary{color:#665100}.annual section{break-inside:auto}.annual article,.annual-scope>div,.annual .comparison-chart,.annual tr{break-inside:avoid}.annual h2,.annual h3{break-after:avoid}.annual .comparison-chart g{fill:#444}.annual-provenance::details-content{content-visibility:visible;display:block}.annual-provenance dl{display:grid;grid-template-columns:140px minmax(0,1fr);gap:4px 12px}.annual-provenance dd{margin:0}.annual [data-research-comparison] details:not([open]) summary::after{content:"（展开内容见原始 HTML）"}}
</style></head><body><main class="research-bound annual">
<header><p class="research-kicker">WHYJ QUANT / ANNUAL RESEARCH</p><h1>${esc(title)}</h1><p>观察组合假设复盘 · 本地研究文档 · ${account ? "含显式读取的私有账户区间业绩；禁止分享" : "不含真实账户业绩"}</p></header>
<section aria-labelledby="scope"><h2 id="scope">研究范围</h2><dl class="annual-scope">${scope.map(([key, value]) => `<div><dt>${esc(key!)}</dt><dd>${esc(value!)}</dd></div>`).join("")}</dl>
<details class="annual-provenance"><summary>查看版本与生成记录</summary><dl>${provenance.map(([key, value]) => `<dt>${esc(key!)}</dt><dd>${esc(value!)}</dd>`).join("")}</dl></details>
<p>截止日是价格/NAV 估值边界。抓取时间与报告生成时间可能晚于截止日，不证明这些数据在历史当时已可得。收益从首个共同估值日计算；不补齐年初或年末缺失值。</p></section>
<section aria-labelledby="performance"><h2 id="performance">收益与风险</h2><p class="annual-scroll-hint">图表与数据表可左右滚动，聚焦后也可用方向键浏览。</p>${renderResearchComparison(comparison)}<ul>${report.analysis.assumptions.map(item => `<li>${esc(item)}</li>`).join("")}</ul></section>
${account ? `<section data-account-performance aria-labelledby="account-performance"><h2 id="account-performance">只读账户区间业绩（私有）</h2>
<p>以下金额和收益来自显式选择的账户历史适配器，按资金流发生时的权益计算；观察组合 A/B 与基准为独立假设，不得把两类收益合并或解释为实际交易归因。适配器声明完整流水和已扣费用，本地只核对输入一致性，不认证原始账单事实。</p>
<dl class="annual-scope"><div><dt>账户 / 报告币种</dt><dd>${esc(account.accountRef)} / ${esc(account.currency)}</dd></div><div><dt>UTC 精确区间</dt><dd>${esc(new Date(account.startAt).toISOString())} — ${esc(new Date(account.endAt).toISOString())}</dd></div>
<div><dt>时间加权收益</dt><dd>${esc(amount(account.timeWeightedReturn * 100))}%</dd></div><div><dt>估值点观察回撤</dt><dd>${esc(amount(account.observedMaxDrawdown * 100))}% · ${account.valuationCount} 个估值点</dd></div>
<div><dt>期初 / 期末权益</dt><dd>${esc(amount(account.openingEquity))} / ${esc(amount(account.closingEquity))} ${esc(account.currency)}</dd></div><div><dt>区间净出入金 / 净损益</dt><dd>${esc(amount(account.netExternalFlow))} / ${esc(amount(account.netProfit))} ${esc(account.currency)}</dd></div>
<div><dt>已计入权益的费用</dt><dd>${esc(amount(account.feesAlreadyDeducted))} ${esc(account.currency)}（不重复扣减）</dd></div><div><dt>账单来源 / 观测时间</dt><dd>${esc(account.source.adapterId)} · ${esc(account.source.reference)} · ${esc(new Date(account.source.observedAt).toISOString())}</dd></div></dl>
<ul><li>出入金、费用、币种和覆盖完整性由适配器声明；本地核对输入一致性，不独立认证账单事实。</li><li>每次外部资金流均需相同时点估值；账户内交易及留在账户内的收益不算外部资金流。已扣费用仅展示，不再次扣减。</li><li>回撤只覆盖所提供的估值点，不据此计算日波动率、Sharpe、交易日历覆盖或声称 GIPS 合规。</li></ul><p>账户区间按 UTC 年初至截止日 23:59:59.999 定义；券商本地时区、分页/资金分类及币种换算须由授权适配器核对。此私有 HTML 未自动保存、进入模型上下文或公共分享。</p></section>` : ""}
<section aria-labelledby="gaps"><h2 id="gaps">覆盖缺口与待补证据</h2><ul>${report.missing.filter(item => !account || !item.startsWith("真实账户业绩未接入")).map(item => `<li>${esc(item)}</li>`).join("")}</ul>
<p>已排除成员 ${comparison.excluded.length} 个；因价格或汇率不齐而丢弃 ${comparison.droppedDates.length} 个候选日期。详情见上方展开项。N/A 指指标不可计算，不代表零风险。</p></section>
${report.decisions.length ? `<section aria-labelledby="decisions"><h2 id="decisions">研究决策记录</h2><p>${report.request.decisionSelection ? `生成时本地档案中可核验的匹配研究记录共 ${report.decisions.length} 条，ID 已冻结；这不证明全年真实决策完整。` : "仅列本次显式选取的记录，不代表全年完整决策。"}日期、选择和理由属于工具输入声明；比较及原始数据经过核对，理由本身未经独立核验。补录与事后数据不可当成历史当时可得的决策证据。</p>${report.decisions.map(entry => `<article><h3>${esc(entry.decision.request.declaredDate)} · ${esc(entry.decision.request.choice)}</h3><p>${esc(entry.decision.request.rationale)}</p><dl><dt>实际记录时间（UTC）</dt><dd>${esc(entry.decision.recordedAt)}</dd><dt>时间边界</dt><dd>${entry.retrospective ? "补录声明日期" : "当日记录"}；${entry.evidenceAfterDeclaredDate ? "引用比较的记录时间或数据区间晚于声明日期" : "仍未独立证明历史当时可得性"}</dd><dt>比较引用 / 决策 ID</dt><dd>${esc(entry.decision.request.comparisonId)} / ${esc(entry.decision.id)}</dd><dt>记录 SHA-256</dt><dd>${esc(entry.hash)}</dd></dl></article>`).join("")}</section>` : ""}
<section aria-labelledby="sources"><h2 id="sources">数据出处</h2><p>生成和恢复均检查这些原始归档，再重算选定比较。哈希只检测内容一致性，不认证提供者。更新缓存不会替换这里的历史版本。</p>
${datasets.map(({ ref }, index) => `<article><h3>D${index + 1} · ${esc(ref.symbol)}</h3><dl><dt>来源 / 抓取时间（UTC）</dt><dd>${esc(ref.source)} / ${esc(ref.snapshotAt)}</dd><dt>归档日期范围</dt><dd>${esc(ref.dates[0]!)} — ${esc(ref.dates.at(-1)!)} · ${ref.dates.length} observations</dd><dt>Revision</dt><dd>${esc(ref.revision)}</dd><dt>Content SHA-256</dt><dd>${esc(ref.contentHash)}</dd></dl></article>`).join("")}</section>
<section aria-labelledby="perspectives"><h2 id="perspectives">大师观点与本次研究的联系</h2><p>以下为有原文出处的历史观点摘要；不是当年市场预测，也不代表作者认可本报告。仅列出版日期不晚于估值截止日的观点。</p>
${report.perspectives.map(view => `<article><h3>${esc(view.author)}</h3><p><a href="${esc(view.url)}" rel="noreferrer">${esc(view.title)}</a> · ${view.published} · ${esc(view.locator)}</p><p><b>原文观点摘要：</b>${esc(view.summary)}</p><p><b>WhyJ 研究应用：</b>${esc(view.application)}</p><small>来源核对日期：${view.checkedAt}。生成报告不实时抓取原文；浏览原文需要网络。</small></article>`).join("") || "<p>此截止日没有可用的已整理观点，未填入未来出版内容。</p>"}</section>
<footer><small>保留原始归档才能重新核对。此本地文档包含观察组合名称、标的和研究配置，未经过公共分享过滤。${account ? "私有账户数据仅在本次内存生成的 HTML 中，勿通过公共分享或 Agent 工具发布。" : ""}</small></footer>
</main></body></html>`;
}
