import { useState } from "react";
import type { SessionSnapshot } from "../client/contract";
import { confidenceLabels, researchSummary } from "../presentation";
import { Dialog } from "./UI";
import { ResearchMarkdown } from "./Markdown";

import { ToolResult } from "./ToolResult";
import { toolStateLabels } from "./ToolHistory";

export type ResearchPage = "conclusion" | "evidence" | "report";
const pages: ResearchPage[] = ["conclusion", "evidence", "report"];
const labels = { conclusion: "结论与条件", evidence: "证据", report: "报告版本" };

export function ResearchDialog({ page, setPage, snapshot, title, demo, onClose }: {
  page: ResearchPage; setPage(page: ResearchPage): void; snapshot: SessionSnapshot; title: string; demo: boolean; onClose(): void;
}) {
  const [copied, setCopied] = useState("");
  const [compare, setCompare] = useState(false);
  const output = snapshot.output;
  const calls = snapshot.turns.flatMap(turn => (turn.activity ?? []).map(item => ({ item, turnId: turn.id, at: turn.at })));
  const artifacts = [...output.artifacts].sort((a, b) => b.version - a.version);
  const available = output.evidence.filter(item => item.available).length;
  const returned = calls.filter(call => !!call.item.result).length;
  const download = () => {
    const url = URL.createObjectURL(new Blob([researchSummary(title, snapshot, demo)], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "research-summary.md"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <Dialog title="研究成果" onClose={onClose} className="research-dialog">
    <div className="research-context"><strong>{title}</strong><span>{demo ? "合成示例 · 非实际研究" : "当前会话的成果摘要"}</span></div>
    <div className="research-tabs" role="tablist" aria-label="研究成果分区" onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = pages.indexOf(page);
      const next = event.key === "Home" ? 0 : event.key === "End" ? pages.length - 1 : (index + (event.key === "ArrowRight" ? 1 : pages.length - 1)) % pages.length;
      setPage(pages[next]!);
      event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
    }}>{pages.map(item => <button key={item} id={"research-tab-" + item} role="tab" aria-selected={page === item} aria-controls="research-content" tabIndex={page === item ? 0 : -1} onClick={() => setPage(item)}>{labels[item]}{item === "evidence" && <span className="count">{calls.length ? `${calls.length} 条调用` : `${available}/${output.evidence.length}`}</span>}</button>)}</div>
    <section id="research-content" className="research-content" role="tabpanel" aria-labelledby={"research-tab-" + page} tabIndex={0}>
      {page === "conclusion" && <>
        <p className="eyebrow">当前判断</p><div className="markdown-body"><ResearchMarkdown text={output.conclusion.statement ?? "尚未提供研究结论。"} /></div>
        <div className="boundary"><h3>继续观察的条件</h3><p>{output.conclusion.boundary ?? "尚未提供观察条件。"}</p></div>
        <div className="research-facts"><span>记录状态：{output.conclusion.settled ? "结论已记录" : "尚未完成"}</span><span>模型置信度：{output.conclusion.confidence ? confidenceLabels[output.conclusion.confidence] : "未提供"}</span><span>证据：{available} 份已记录，{output.evidence.length - available} 份缺失</span></div>
        <p className="notice">记录状态和模型置信度不代表独立核验。请检查来源、日期和缺失证据后再作判断。</p>
      </>}
      {page === "evidence" && <>
        <div className="section-intro"><h3>判断依据在哪里</h3><p>来源摘要 {available} / {output.evidence.length}；工具返回记录 {returned} / {calls.length}。失败与缺失项分别保留，不能视为核验通过。</p></div>
        {output.evidence.map(item => <article className="evidence-card" key={item.id}>
          <div className="evidence-heading"><h3>{item.label}</h3><span className={"badge " + (item.available ? "" : "badge-warning")}>{item.available ? "已记录" : "缺失"}</span></div>
          <dl className="evidence-facts"><dt>来源</dt><dd>{item.source ?? "未提供"}</dd><dt>数据日期</dt><dd>{item.asOf ?? "未提供"}</dd></dl>
          <details><summary>证据标识</summary><code>{item.id}</code></details>
        </article>)}
        {!output.evidence.length && !calls.length && <div className="empty-state"><h3>{demo ? "还没有可查看的证据" : "尚无工具返回记录"}</h3><p>{demo ? "示例目录为空。" : "请先发起研究。新工具调用返回后会保留可查看的文本；旧会话未保存的结果不会补造。"}</p></div>}
        {!!calls.length && <section aria-label="工具取证记录"><h3>工具取证记录</h3><p>按本会话调用顺序保留。返回记录时间不是行情日期；来源、数据日期与计算口径请核对工具内容。成功状态只表示工具返回。</p>
          {calls.map(({ item, turnId, at }) => <article className="evidence-card" key={turnId + item.id}>
            <div className="evidence-heading"><h3>{item.title ?? item.name}</h3><span className={"badge " + (item.state === "completed" ? "" : "badge-warning")}>{toolStateLabels[item.state]}</span></div>
            <dl className="evidence-facts"><dt>工具</dt><dd><code>{item.name}</code></dd><dt>调用标识</dt><dd><code>{item.id}</code></dd><dt>所属轮次</dt><dd>{at}</dd></dl>
            {item.context && <p>{item.context}</p>}<ToolResult item={item} />
          </article>)}
        </section>}
        <p className="notice">来源摘要与工具返回均不代表独立核验。此入口不读取本地原始文件，也不提供完整归档或报告。</p>
      </>}
      {page === "report" && <>
        <div className="section-intro"><h3>保留版本，方便以后再看</h3><p>以下是客户端提供的报告版本标识。下载按钮只导出当前可见摘要。</p></div>
        {artifacts.map((artifact, index) => <article className="evidence-card" key={artifact.id}>
          <div className="evidence-heading"><h3>{artifact.title}</h3><span className="badge">v{artifact.version}{index === 0 ? " · 最新记录" : ""}</span></div>
          <p className="supporting">{artifact.createdAt}</p><details><summary>文件校验标识 SHA-256</summary><code>{artifact.sha256}</code><button className="text-action" onClick={() => void navigator.clipboard.writeText(artifact.sha256).then(() => setCopied("校验标识已复制。"), () => setCopied("复制未完成，请展开后手动选择标识。"))}>复制校验标识</button></details>
        </article>)}
        {artifacts.length > 1 && <><button className="text-action" aria-expanded={compare} onClick={() => setCompare(!compare)}>对照最近两个版本的标识</button>{compare && <div className="version-comparison"><div className="table-scroll" role="region" aria-label="版本标识对照" tabIndex={0}><table><thead><tr><th>字段</th>{artifacts.slice(0, 2).map(a => <th key={a.id}>v{a.version}</th>)}</tr></thead><tbody><tr><th>记录时间</th>{artifacts.slice(0, 2).map(a => <td key={a.id}>{a.createdAt}</td>)}</tr><tr><th>SHA-256</th>{artifacts.slice(0, 2).map(a => <td key={a.id}><code>{a.sha256}</code></td>)}</tr></tbody></table></div><p className="supporting">这是版本元数据对照。哈希不同不说明市场或结论发生了什么变化；当前尚未提供报告正文对比。</p></div>}</>}
        {!artifacts.length && <div className="empty-state"><h3>{demo ? "还没有保存的报告版本" : "当前连接未开放报告目录"}</h3><p>版本目录由研究服务提供，结束一次对话不会自动生成不可变报告。</p></div>}
        <p className="notice">原始报告读取和重新取证复核尚未接入。当前摘要不能用于恢复完整运行。</p>
      </>}
    </section>
    <footer className="research-footer"><span role="status">{copied || (demo ? "全部内容为合成示例" : "保留来源与缺失信息")}</span><button className="action" onClick={download}>下载当前摘要 Markdown</button></footer>
  </Dialog>;
}
