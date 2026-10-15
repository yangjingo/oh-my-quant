// Three throwaway views of the same in-memory research state, not a live Agent.
const variants = ["A", "B", "C"];
const names = { A: "对话优先", B: "证据优先", C: "研究笔记" };
const sampleQuestion = "研究演示标的 A 这次回调，是否还值得跟踪？相对大盘和板块怎样？什么证据可以确认，什么情况会失效？";
const prices = [100, 102, 101, 104, 106, 105, 108, 111, 109, 114, 116, 113, 111, 110, 109, 110, 108, 109];
const steps = ["核对研究范围与完成日线", "获取标的、大盘与板块样本", "计算量价与相对表现", "核对结构锚点和反证", "整理结论与证据引用"];
let variant = new URLSearchParams(location.search).get("variant") || "A";
if (!variants.includes(variant)) variant = "A";
let phase = "complete";
let stage = 5;
let scenario = "complete";
let tab = "summary";
let mobileResults = false;
let resultsOpen = true;
let resultsExpanded = false;
let selectedEvidence = null;
let comparisonMode = new URLSearchParams(location.search).get("compare") === "1" || variant !== "A";
let saved = false;
let question = sampleQuestion;
let input = "";
let versions = [{ id: "T0", signal: "观察", close: 109, data: prices.slice() }];
let selectedVersion = 0;
let timer;
let noticeTimer;
let pendingReview = false;
const app = document.querySelector("#app");
const dialog = document.querySelector("#detail-dialog");

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
function notify(text) {
  clearTimeout(noticeTimer);
  document.querySelector("#notice").textContent = text;
  noticeTimer = setTimeout(() => { document.querySelector("#notice").textContent = ""; }, 4200);
}
function brand() {
  return '<div class="wordmark"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span class="brand-name">WhyJ Quant</span></div>';
}
function sidebar() {
  return `<nav class="sidebar" aria-label="研究导航">${brand()}
    <button class="new-research" data-action="new" aria-label="新建研究">＋ <span class="new-label">新建研究</span></button>
    <section><div class="nav-label">演示研究库</div><button class="history-item" data-action="history">回调结构 · 演示标的 A<p>已完成示例 · T0 截止</p></button><p>示例为合成数据，不对应真实证券。</p></section>
    ${saved ? `<section><div class="nav-label">已保存 · 仅本次浏览</div>${versions.map((v, i) => `<button class="history-item" data-version="${i}">${v.id} · ${v.signal}<p>${i ? "主动复核版本" : "原始研究"}</p></button>`).join("")}</section>` : ""}
    <div class="sidebar-bottom"><button class="text-button" data-action="settings">设置与连接</button><button class="text-button" data-action="help">使用说明</button><p class="sidebar-note">研究有依据<br>判断有边界</p></div></nav>`;
}
function current() { return versions[selectedVersion]; }
function runLabel() {
  return ({ idle: "等待提问", running: "研究中 · 模拟执行", cancelled: "已停止 · 保留演示证据", complete: "演示完成" })[phase];
}
function runLog() {
  return `<details class="run-log" ${phase === "running" || phase === "cancelled" ? "open" : ""}><summary>${phase === "complete" ? "查看 5 个演示步骤 · 无真实请求" : "执行记录 · 模拟事件"}</summary><div class="steps">${steps.map((s, i) => `<div class="step ${i < stage ? "done" : i === stage ? "active" : ""}"><span>${i < stage ? "✓" : i === stage && phase === "running" ? "◌" : "·"} ${s}</span><code>${i < stage ? "演示完成" : i === stage && phase === "running" ? "等待…" : "待运行"}</code></div>`).join("")}</div></details>`;
}
function conversation() {
  const version = current();
  return `<section class="main-column" aria-label="Agent 研究对话"><header class="column-header"><div class="eyebrow">RESEARCH / 001</div><div class="row spread"><h2>回调结构研究</h2><div class="row wrap"><span class="tag neutral">${runLabel()}</span>${variant === "A" ? `<button class="small" data-action="toggle-results" aria-expanded="${resultsOpen}">${resultsOpen ? "收起成果" : "查看成果"}</button>` : ""}</div></div></header><div class="conversation">
    ${phase === "idle" ? `<div class="empty"><div class="empty-mark">↗</div><h2>从一个投资问题开始</h2><p class="muted">问清依据、比较和失效条件。<br>本原型只运行一个固定示例。</p><button data-action="example" class="primary">运行研究示例</button></div>` : `<div class="message-label">你 · ${version.id} 研究</div><div class="user-message">${escapeHtml(question)}</div><div class="agent-label"><span class="dot"></span>WhyJ Research <span class="muted">· 演示回答</span></div>
      ${phase === "running" ? `<p class="agent-message">${pendingReview ? "对照原假设，检查新增数据是否改变判断。" : "我会先核对完成日线与比较口径，再检查结构证据和反证。"}</p><div class="run-status" role="status"><span class="dot"></span><div><strong>${steps[Math.min(stage, steps.length - 1)]}</strong><p>已完成 ${stage} / ${steps.length} 个演示步骤 · 可随时停止</p></div></div>${runLog()}<p class="muted">模拟事件用于验证等待与停止体验，没有调用模型或行情。</p>` : phase === "cancelled" ? `${runLog()}<div class="note">研究已停止。已完成的演示步骤仍保留，尚未生成新的完整结论。</div><button class="primary" data-action="continue">继续演示研究</button>` : `<div class="agent-message"><p>${version.signal === "失效" ? "<strong>原假设已失效。</strong>新增演示收盘值低于原定结构边界 108，不能通过下移边界维持原判断。" : version.signal === "触发" ? "<strong>从观察转为触发，尚未确认。</strong>新增演示收盘值收复 110，仍需要后续已完成日线的支持。" : "<strong>当前保持观察。</strong>回调尚未跌破原结构边界，但缩量本身不足以证明回调结束。"} <button class="citation" data-evidence="E1">E1</button></p><p>${scenario === "missing" ? "板块样本缺失，不能判断是否跑赢板块。已有标的和大盘证据继续保留。" : "标的与大盘、板块使用相同起点和截止范围；相对表现只作为研究依据，不等于可执行买点。"} <button class="citation" data-evidence="E2">E2</button></p></div>${selectedVersion > 0 ? `<button class="review-preview" data-action="view-changes"><span class="eyebrow">T0 → ${version.id} · 本次变化</span><strong>观察 → ${version.signal} · 原失效边界保持不变</strong><span>查看新增证据与后续条件 ↗</span></button>` : ""}${runLog()}<div class="next-question"><h3>接下来验证什么？</h3><p>${version.signal === "失效" ? "旧假设已经终止。重新研究须另立假设，不能沿用原来的看多结论。原边界仍保留供复盘。" : "关注 110 的收复与后续保持；原失效条件固定为完成日线收盘低于 108。均为合成样例条件。"}</p></div><button data-action="evidence" class="text-button">打开证据与计算 ↗</button>`}`}
    </div>${composer()}</section>`;
}
function composer() {
  return `<div class="composer"><form id="question-form"><label class="eyebrow" for="question-input">继续研究</label><textarea id="question-input" placeholder="追问证据，或输入下一次复核的问题…" aria-label="研究问题">${escapeHtml(input)}</textarea><div class="composer-footer"><span class="hint">固定示例 · 无模型用量 · Enter 换行</span>${phase === "running" ? '<button type="button" data-action="stop">停止</button>' : '<button class="primary" type="submit">发送 ↗</button>'}</div></form><div class="suggestions"><button data-action="followup">为什么还不能确认？</button><button data-action="review">复核下一个收盘</button></div></div>`;
}
function chart() {
  const data = current().data;
  const x = (i) => 38 + i / (data.length - 1) * 490;
  const y = (value) => 169 - (value - 98) / 20 * 140;
  const points = data.map((p, i) => `${x(i)},${y(p)}`).join(" ");
  const baseline = data.map((_, i) => `${x(i)},${y(100 + i / (data.length - 1) * 5)}`).join(" ");
  return `<div class="mini-chart"><div class="chart-top"><span>演示标的 A / 同起点归一化</span><span class="mono">${current().id} · 合成样本</span></div><svg class="price-chart" viewBox="0 0 570 220" role="img" aria-label="合成价格路径，起点100，结构边界108，收复参考110；非真实行情"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d4af37" stop-opacity=".16"/><stop offset="1" stop-color="#d4af37" stop-opacity="0"/></linearGradient></defs>${[100, 108, 116].map((v) => `<line x1="36" y1="${y(v)}" x2="535" y2="${y(v)}" stroke="#2a2a2a"/><text x="5" y="${y(v) + 4}" fill="#a6a6a6" font-size="10">${v}</text>`).join("")}<polygon points="38,185 ${points} 528,185" fill="url(#chart-fill)"/><polyline points="${baseline}" fill="none" stroke="#a6a6a6" stroke-dasharray="4 5" stroke-width="1.5"/><line x1="36" y1="${y(108)}" x2="535" y2="${y(108)}" stroke="#9b8448" stroke-dasharray="3 5"/><polyline points="${points}" fill="none" stroke="#d4af37" stroke-width="2.5" stroke-linejoin="round"/><circle cx="${x(data.length - 1)}" cy="${y(data.at(-1))}" r="4" fill="#f0d77a"/><text x="395" y="${y(108) + 16}" fill="#a6a6a6" font-size="10">结构边界 108 · E1</text><text x="36" y="210" fill="#a6a6a6" font-size="10">样本起点</text><text x="465" y="210" fill="#a6a6a6" font-size="10">${current().id} 截止</text></svg><div class="row wrap"><span class="gold">— 标的样本</span><span class="muted">┄ 大盘样本</span><button class="text-button" data-evidence="E1">查看锚点与原始值 ↗</button></div></div><p class="chart-caption">起点归一化为 100；全部为合成值，非收益预测，不对应真实证券或指数。</p>`;
}
function summary() {
  const v = current();
  const title = v.signal === "失效" ? "原结构已破坏，重新建立假设。" : v.signal === "触发" ? "收复关键位，等待后续证据。" : "回调尚在结构内，继续观察。";
  return `<div class="result-topline"><span>演示标的 A · 收盘后研究</span><span class="mono">${v.id} / 已完成日线样本</span></div><span class="tag"><span class="dot"></span>${v.signal} · 条件研究</span><h2 class="research-title">${title}</h2><p class="lede">${scenario === "missing" ? "数据覆盖不完整：板块证据缺失，研究只使用现有标的与大盘样本。" : "缩量是观察证据。只有后续价格与量价表现支持，才能升级研究状态。"}</p><dl class="stats"><div class="stat"><dt>末点归一化值</dt><dd>${v.close}</dd><small>非真实报价</small></div><div class="stat"><dt>收复参考</dt><dd>110</dd><small>需后续确认</small></div><div class="stat"><dt>原失效边界</dt><dd>&lt;108</dd><small>完成日线收盘</small></div></dl>${chart()}<div class="condition"><span class="number">01</span><div><h3>确认需要后续证据</h3><p>收复参考位后，后续完成交易日保持并得到量价支持。首次收复不等于确认。</p></div></div><div class="condition"><span class="number">02</span><div><h3>失效条件不随观点移动</h3><p>收盘低于原定 108 时，终止旧假设；重新研究须明确另立假设。</p></div></div>${actions()}<p class="source-line">来源：prototype-fixture-v1 · 合成数据 · 模型解释为预设演示文案</p>`;
}
function evidence() {
  const v = current();
  const returnValue = ((v.close / v.data[0] - 1) * 100).toFixed(2);
  return `<h2>证据与计算</h2><p class="muted">可复核的是样本和算式，结构解释仍需要审阅。</p><article class="evidence-card ${selectedEvidence === "E1" ? "evidence-selected" : ""}" id="evidence-E1" tabindex="-1"><div class="row spread"><h3>E1 · 日线样本与结构边界</h3><span class="tag neutral">合成</span></div><p>原始值、窗口和锚点固定在当前版本。108 与 110 是预先定义的演示边界，不来自真实市场研究。</p><dl><dt>来源</dt><dd>prototype-fixture-v1</dd><dt>截止</dt><dd>${v.id}，仅包含该版本可见样本</dd><dt>输入</dt><dd class="mono">${v.data.join(", ")}</dd><dt>复算示例</dt><dd>(${v.close} / 100 − 1) × 100 = ${returnValue}%</dd><dt>解释边界</dt><dd>可复算不代表结构判断已被证明</dd></dl><button class="small" data-raw-evidence="E1">查看 E1 原始数据</button></article><article class="evidence-card ${selectedEvidence === "E2" ? "evidence-selected" : ""}" id="evidence-E2" tabindex="-1"><div class="row spread"><h3>E2 · 同口径比较</h3><span class="tag neutral">${scenario === "missing" ? "部分缺失" : "合成"}</span></div><p>全部序列同起点归一化；仅比较演示区间末点，不对真实市场作结论。</p><div class="table-wrap"><table><thead><tr><th>对象</th><th>起点</th><th>末点</th><th>覆盖</th></tr></thead><tbody><tr><td>标的样本</td><td>100</td><td>${v.close}</td><td>${v.id}</td></tr><tr><td>大盘样本</td><td>100</td><td>105</td><td>${v.id}</td></tr><tr><td>板块样本</td><td>${scenario === "missing" ? "—" : "100"}</td><td>${scenario === "missing" ? "—" : "106"}</td><td>${scenario === "missing" ? "未获取，禁止推断" : v.id}</td></tr></tbody></table></div><button class="small" data-raw-evidence="E2">查看 E2 原始数据</button></article>${scenario === "missing" ? '<div class="note">缺板块证据：不能推断跑赢板块或完成买点资格判断。</div>' : ""}`;
}
function review() {
  const latest = current();
  const changed = selectedVersion > 0;
  return `<h2>这次复核，什么变了？</h2><p class="muted">保留原假设和证据，先看变化，再看完整版本。</p>
    ${changed ? `<section class="review-diff" aria-label="复核变化摘要"><div class="diff-heading"><span class="tag">T0 → ${latest.id}</span><strong>${latest.signal === "失效" ? "原假设失效，停止沿用旧判断" : "已触发，但还没有确认"}</strong></div><dl><div><dt>状态变化</dt><dd>观察 → ${latest.signal}</dd></div><div><dt>新增证据</dt><dd>合成收盘末点 109 → ${latest.close} <button class="citation" data-evidence="E1">E1</button></dd></div><div><dt>保持不变</dt><dd>原失效边界 &lt;108，不下移</dd></div><div><dt>接下来</dt><dd>${latest.signal === "失效" ? "旧假设终止；如继续研究，需明确另立新假设。" : "等待后续已完成日线支持，不能把首次收复当作确认。"}</dd></div></dl></section>` : '<div class="note">当前查看 T0 原始研究，不包含后续数据。已有复核可从下方版本列表打开；尚未复核时，可用下一次合成收盘样本验证原假设。</div>'}
    <h3 class="versions-title">完整版本 · 当前查看 ${current().id}</h3>${versions.map((v, i) => `<article class="version-card ${i === selectedVersion ? "version-selected" : ""}"><div class="row spread"><h3>${v.id} · ${v.signal}</h3><button class="small" data-version="${i}" aria-label="打开 ${v.id} 研究版本">${i === selectedVersion ? "当前版本" : "打开版本"}</button></div><p>${i ? `新增末点 ${v.close}；原边界 108 保持不变。${v.signal === "失效" ? "旧假设失效。" : "已触发，尚无后续确认。"}` : "原假设：108 结构边界内观察，收复 110 后等待后续确认。"}</p></article>`).join("")}<div class="note">跟踪卡是研究条件，不会自动创建定时任务或交易。仅本次浏览内存保存。</div>${actions()}`;
}
function actions() {
  return `<div class="result-actions"><button data-action="save">${saved ? "✓ 已保存（内存）" : "保存这次研究"}</button><button class="primary" data-action="review">复核下一个收盘 ↗</button></div>`;
}
function stateView() {
  return `<details class="state-json"><summary>原型状态 · 可展开检查</summary><pre>${escapeHtml(JSON.stringify({ variant, phase, stage, scenario, tab, resultsOpen, resultsExpanded, selectedEvidence, comparisonMode, selectedVersion: current().id, saved, versions: versions.map(({ id, signal, close }) => ({ id, signal, close })), liveModel: false, liveData: false, persistence: "memory-only" }, null, 2))}</pre></details>`;
}
function resultPanel() {
  const labels = { summary: "结论", chart: "图表", evidence: "证据", review: "复核" };
  return `<section class="result-panel" aria-label="研究成果"><header class="result-header"><div class="eyebrow">RESEARCH ARTIFACT</div><div class="row spread"><h2>研究成果 <span class="tag neutral">${current().id}</span></h2><div class="row"><button class="small" data-action="expand-results" ${phase !== "complete" ? "disabled" : ""} aria-pressed="${resultsExpanded}">${resultsExpanded ? "退出专注" : "放大审阅"}</button><button class="small" data-action="return-chat">返回对话</button></div></div></header><nav class="tabs" aria-label="研究成果页签">${Object.entries(labels).map(([key, label]) => `<button data-tab="${key}" class="${tab === key ? "active" : ""}" aria-pressed="${tab === key}">${label}</button>`).join("")}</nav><div class="tab-content">${phase !== "complete" ? `<div class="empty"><h2>${phase === "cancelled" ? "保留已完成证据" : phase === "idle" ? "研究成果将在这里出现" : "正在形成研究成果"}</h2><p class="muted">${phase === "running" ? "阶段反馈在对话区，未完成内容不会冒充最终报告。" : "提问、查看依据，再保存与复核。"}</p></div>` : tab === "summary" ? summary() : tab === "chart" ? `<h2>价格结构与同口径比较</h2>${chart()}${evidence()}` : tab === "evidence" ? evidence() : review()}${stateView()}</div></section>`;
}
function VariantA() { return `${sidebar()}${conversation()}${resultPanel()}`; }
function VariantB() {
  return `${sidebar()}<section class="market-desk" aria-label="证据优先研究台"><div class="desk-heading"><div><div class="eyebrow">EVIDENCE DESK / ${current().id}</div><h1>先看结构，再审阅判断</h1></div><span class="tag">${current().signal} · 合成演示</span></div>${phase === "complete" ? `${chart()}<div class="desk-main"><div><h2>研究条件</h2><div class="condition"><span class="number">01</span><div><h3>收复参考 110</h3><p>首次收复只能触发，仍需后续证据。</p></div></div><div class="condition"><span class="number">02</span><div><h3>原失效边界 &lt;108</h3><p>锚点不因偏好而下移。</p></div></div>${review()}</div><div>${evidence()}</div></div>` : `<div class="empty"><h2>${runLabel()}</h2><p class="muted">成果等待当前演示完成，执行进度在右侧。</p></div>`}${stateView()}</section>${conversation()}`;
}
function VariantC() {
  return `${sidebar()}<article class="notebook" aria-label="研究笔记"><div class="row spread"><span class="eyebrow">RESEARCH NOTE / ${current().id}</span><span class="tag neutral">合成样例</span></div><h1>这次回调，<br>原来的研究假设还成立吗？</h1><p class="lede">演示标的 A · 收盘后结构研究<br>让问题、证据与下一次复核保持在同一份研究里。</p>${phase === "complete" ? `<section class="notebook-section"><h2>01 / 当前判断</h2><span class="tag">${current().signal}</span><p class="lede">${current().signal === "失效" ? "原边界已破坏，停止使用旧假设。" : current().signal === "触发" ? "已收复参考位，等待后续完成日线确认。" : "继续观察，缩量本身不足以确认回调结束。"} <button class="citation" data-evidence="E1">E1</button></p>${chart()}</section><section class="notebook-section"><h2>02 / 依据与反证</h2>${evidence()}</section><section class="notebook-section"><h2>03 / 跟踪与变化</h2>${review()}</section>` : `<div class="empty"><h2>${runLabel()}</h2><p class="muted">通过右侧对话完成本次模拟研究。</p></div>`}${stateView()}</article>${conversation()}`;
}
function switchVariant(next) {
  variant = variants[(variants.indexOf(variant) + next + variants.length) % variants.length];
  const url = new URL(location.href); url.searchParams.set("variant", variant); history.replaceState({}, "", url);
  resultsExpanded = false; resultsOpen = true;
  render();
}
function revealEvidence(id) {
  selectedEvidence = id; tab = "evidence"; resultsOpen = true; mobileResults = true;
  render();
  const target = document.getElementById(`evidence-${id}`);
  target?.scrollIntoView({ block: "nearest" });
  target?.focus({ preventScroll: true });
}
function render() {
  const wasInput = document.activeElement?.id === "question-input";
  const selection = wasInput ? document.activeElement.selectionStart : null;
  app.innerHTML = `<div class="prototype-banner"><span>可点击原型 · 固定合成样例 · 无真实 Agent / 行情 / 交易</span><span>仅内存，刷新清空 · 当前布局 ${variant} / ${names[variant]}</span></div><div class="mobile-actions"><button data-action="new" aria-label="新建研究">新建</button><button data-mobile="chat" aria-pressed="${!mobileResults}">研究对话</button><button data-mobile="result" aria-pressed="${mobileResults}">成果与证据</button><button data-action="settings" aria-label="设置与连接">设置</button></div><main class="workspace layout-${variant.toLowerCase()} ${mobileResults ? "mobile-results" : ""} ${resultsOpen ? "" : "results-hidden"} ${resultsExpanded ? "results-expanded" : ""} ${comparisonMode ? "comparing" : ""}">${({ A: VariantA, B: VariantB, C: VariantC })[variant]()}</main>`;
  document.querySelector("#prototype-switcher").classList.toggle("compact", !comparisonMode);
  document.querySelector("#prototype-switcher").innerHTML = comparisonMode ? `<span class="switch-caption">布局对照 · 非产品功能<br>← / → 切换</span><button data-cycle="-1" aria-label="上一个布局">←</button>${variants.map((v) => `<button data-variant="${v}" aria-pressed="${variant === v}">${v} ${names[v]}</button>`).join("")}<button data-cycle="1" aria-label="下一个布局">→</button><button data-action="close-comparison">收起</button>` : `<span class="chosen-layout">已选择 A · 对话优先</span><button data-action="open-comparison">布局对照</button>`;
  if (wasInput) { const field = document.querySelector("#question-input"); field.focus(); field.setSelectionRange(selection, selection); }
}
function startRun(isReview = false, resume = false) {
  clearTimeout(timer);
  if (isReview && versions.length > 1 && !resume) { selectedVersion = 1; phase = "complete"; tab = "review"; render(); notify("已存在相同演示截止点，打开已有复核版本。"); return; }
  pendingReview = isReview;
  if (!resume) {
    stage = 0;
    if (!isReview) {
      versions = [{ id: "T0", signal: "观察", close: 109, data: prices.slice() }];
      selectedVersion = 0; saved = false; tab = "summary";
    }
  }
  selectedEvidence = null; resultsExpanded = false;
  phase = "running"; mobileResults = false; render();
  function advance() {
    if (phase !== "running") return;
    stage++;
    if (stage >= steps.length) {
      phase = "complete";
      if (pendingReview) {
        const close = scenario === "invalid" ? 107 : 111;
        versions.push({ id: "T1", signal: close < 108 ? "失效" : "触发", close, data: [...prices, close] });
        selectedVersion = 1; saved = true; tab = "review"; resultsOpen = true;
      }
      render(); notify("演示研究完成。工具、证据和模型回答均为固定样例。"); return;
    }
    render(); timer = setTimeout(advance, 800);
  }
  timer = setTimeout(advance, 800);
}
function openDetail(id) {
  const v = current();
  dialog.innerHTML = `<div class="row spread"><h2 id="detail-title">${id === "E1" ? "E1 · 日线与结构证据" : "E2 · 比较证据"}</h2><button data-action="close-dialog" aria-label="关闭详情">×</button></div><p>固定合成数据，用于验证引用跳转与复算展示。非真实证券或指数，不构成实时研究。</p><pre>${escapeHtml(id === "E1" ? JSON.stringify({ source: "prototype-fixture-v1", as_of: v.id, adjusted: "synthetic-normalized", closes: v.data, trigger_reference: 110, invalidation_below: 108, formula: "(last / first - 1) × 100", return_percent: ((v.close / 100 - 1) * 100).toFixed(2) }, null, 2) : JSON.stringify({ source: "prototype-fixture-v1", as_of: v.id, start: 100, stock_end: v.close, market_end: 105, sector_end: scenario === "missing" ? null : 106, sector_coverage: scenario === "missing" ? "缺失，不能得出板块比较结论" : "合成样本" }, null, 2))}</pre><button class="primary" data-action="close-dialog">返回研究</button>`;
  dialog.showModal();
}
document.addEventListener("input", (event) => { if (event.target.id === "question-input") input = event.target.value; });
document.addEventListener("submit", (event) => {
  if (event.target.id !== "question-form") return;
  event.preventDefault();
  if (!input.trim()) { notify("请输入问题，或点击运行研究示例。"); return; }
  question = input.trim(); input = "";
  if (phase === "complete" && /为什么|依据|确认/.test(question)) { revealEvidence("E1"); notify("演示追问：定位固定证据，不执行真实模型。"); return; }
  startRun(false); notify("输入已接收；原型仅展示固定示例，不会实际分析新问题。");
});
document.addEventListener("click", (event) => {
  const button = event.target.closest("button"); if (!button || button.disabled) return;
  if (button.dataset.variant) { const next = variants.indexOf(button.dataset.variant) - variants.indexOf(variant); switchVariant(next); return; }
  if (button.dataset.cycle) { switchVariant(Number(button.dataset.cycle)); return; }
  if (button.dataset.mobile) { mobileResults = button.dataset.mobile === "result"; resultsOpen = true; if (!mobileResults) resultsExpanded = false; render(); return; }
  if (button.dataset.tab) { tab = button.dataset.tab; selectedEvidence = null; render(); return; }
  if (button.dataset.evidence) { revealEvidence(button.dataset.evidence); return; }
  if (button.dataset.rawEvidence) { openDetail(button.dataset.rawEvidence); return; }
  if (button.dataset.version !== undefined) {
    if (phase === "running" || phase === "cancelled") { notify("当前研究尚未完成。请先继续当前任务，或新建研究重置演示，再打开历史版本。"); return; }
    selectedVersion = Number(button.dataset.version); selectedEvidence = null; phase = "complete"; tab = "summary"; render(); return;
  }
  const action = button.dataset.action;
  if (action === "toggle-results") { resultsOpen = !resultsOpen; mobileResults = resultsOpen; resultsExpanded = false; render(); }
  if (action === "expand-results") { resultsExpanded = !resultsExpanded; resultsOpen = true; mobileResults = true; render(); }
  if (action === "return-chat") { resultsExpanded = false; mobileResults = false; render(); document.querySelector("#question-input").focus(); }
  if (action === "open-comparison" || action === "close-comparison") {
    comparisonMode = action === "open-comparison";
    if (!comparisonMode) { variant = "A"; resultsExpanded = false; resultsOpen = true; }
    const url = new URL(location.href); url.searchParams.set("variant", variant);
    if (comparisonMode) url.searchParams.set("compare", "1"); else url.searchParams.delete("compare");
    history.replaceState({}, "", url); render();
  }
  if (action === "new") { clearTimeout(timer); phase = "idle"; stage = 0; input = ""; question = sampleQuestion; mobileResults = false; resultsExpanded = false; selectedEvidence = null; render(); document.querySelector("#question-input").focus(); }
  if (action === "example") { question = sampleQuestion; startRun(); }
  if (action === "history") {
    if (phase === "running" || phase === "cancelled") { notify("当前研究尚未完成。请先继续当前任务，或新建研究重置演示，再打开示例研究。"); return; }
    phase = "complete"; stage = 5; selectedVersion = 0; question = sampleQuestion; render();
  }
  if (action === "stop") { clearTimeout(timer); phase = "cancelled"; render(); notify("已停止模拟执行，保留已完成步骤。"); }
  if (action === "continue") startRun(pendingReview, true);
  if (action === "evidence") revealEvidence("E1");
  if (action === "view-changes") { tab = "review"; resultsOpen = true; mobileResults = true; selectedEvidence = null; render(); }
  if (action === "save") { saved = true; render(); notify("研究已保存到本次浏览内存；刷新后清空，没有写入文件。"); }
  if (action === "review") { if (phase === "running") { notify("请先完成或停止当前研究。"); return; } if (phase !== "complete") { notify("先完成示例研究，再进行复核。"); return; } saved = true; question = "用下一次已收盘样本复核原假设，只解释变化和原因。"; startRun(true); }
  if (action === "followup") { input = "为什么还不能确认？请解释依据。"; render(); document.querySelector("#question-input").focus(); }
  if (action === "close-dialog") dialog.close();
  if (action === "settings" || action === "help") {
    dialog.innerHTML = `<div class="row spread"><h2 id="detail-title">${action === "settings" ? "原型连接与演示情形" : "如何试用这个原型"}</h2><button data-action="close-dialog" aria-label="关闭详情">×</button></div><p>未连接模型、行情或账户，无需密钥。所有输入、保存和复核仅在浏览器内存中，刷新后清空。</p><p>A 对话优先，B 图表证据优先，C 研究笔记优先。打开底部“布局对照”后可切换，编辑输入时不会拦截方向键。</p><label for="scenario">演示情形</label><select id="scenario"><option value="complete">完整合成数据 · 复核后触发</option><option value="missing">缺少板块证据</option><option value="invalid">下一次复核破坏原结构</option></select><p>切换情形会重置演示版本；不会发出外部请求。</p><button class="primary" data-action="close-dialog">返回工作台</button>`;
    dialog.querySelector("select").value = scenario; dialog.showModal();
  }
});
document.addEventListener("change", (event) => {
  if (event.target.id !== "scenario") return;
  clearTimeout(timer); scenario = event.target.value; phase = "complete"; stage = 5; saved = false; selectedVersion = 0; pendingReview = false; versions = [{ id: "T0", signal: "观察", close: 109, data: prices.slice() }]; question = sampleQuestion; selectedEvidence = null; resultsExpanded = false; render(); notify("已切换合成情形，研究版本重置。");
});
document.addEventListener("keydown", (event) => {
  if (!comparisonMode || dialog.open || event.target.closest("input, textarea, select, [contenteditable]")) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); switchVariant(event.key === "ArrowLeft" ? -1 : 1); }
});
render();
