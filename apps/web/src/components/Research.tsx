import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { MarketSnapshot, SessionSnapshot } from "../client/contract";
import { IconButton } from "./UI";
import { confidenceLabels, runLabels } from "../presentation";

const AnswerMarkdown = lazy(() => import("./Markdown").then(module => ({ default: module.ResearchMarkdown })));

export function Transcript({ snapshot, positions, onEvidence, onReport, onSuggestion }: { snapshot: SessionSnapshot; positions: Map<string, number>; onEvidence(): void; onReport(): void; onSuggestion(text: string): void }) {
  const stream = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    if (!copyStatus) return;
    const timer = setTimeout(() => setCopyStatus(""), 4000);
    return () => clearTimeout(timer);
  }, [copyStatus]);
  const following = useRef(true);
  const id = snapshot.identity.sessionId;
  useEffect(() => {
    const el = stream.current;
    if (!el) return;
    el.scrollTop = positions.get(id) ?? el.scrollHeight;
    following.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 60;
    setAway(!following.current);
  }, [id, positions]);
  useEffect(() => { if (following.current && stream.current) stream.current.scrollTop = stream.current.scrollHeight; }, [snapshot.turns]);
  const copy = async (text: string) => {
    setCopyStatus("");
    try { await navigator.clipboard.writeText(text); setCopyStatus("已复制"); }
    catch { setCopyStatus("无法复制，请手动选择文本"); }
  };
  return <><div id="stream" ref={stream} className="stream" role="region" aria-label="研究会话" onScroll={e => {
    const el = e.currentTarget; positions.set(id, el.scrollTop); following.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 60; setAway(!following.current);
  }}>
    {!snapshot.turns.length && <div className="empty-state research-welcome"><span className="eyebrow">从一个明确的问题开始</span><h2>开始一份研究</h2><p>说明研究对象、时间区间，以及你想验证的判断。</p><div className="starter-questions">{["比较 002048.SZ 与沪深300今年的区间表现", "我应该收集哪些证据，才能判断回撤结构？", "帮我检查已有研究中哪些结论还缺少依据"].map(text => <button key={text} onClick={() => onSuggestion(text)}>{text}<span aria-hidden="true">↗</span></button>)}</div><p className="supporting">点击只会填入草稿。发送前可以修改问题或用 @ 添加引用。</p></div>}
    <div className="thread-inner">{snapshot.turns.map(turn => <article className={"turn turn-" + turn.role} key={turn.id}>
      {turn.role === "user" ? <div className="question"><span className="prompt">›</span><p>{turn.text}</p></div> : <>
        <details className="process"><summary>{turn.state === "running" ? "研究进行中" : turn.state === "cancelled" ? "已停止" : "过程与状态"}</summary><p>状态：{runLabels[turn.state]}。界面只显示服务提供的执行状态，不推测分析进度。</p></details>
        <span className="assistant-label">WhyJ</span><div className="answer markdown-body">{turn.text ? <Suspense fallback={<p className="plain-answer">{turn.text}</p>}><AnswerMarkdown text={turn.text} /></Suspense> : <p className="waiting-message">正在等待研究结果。你可以先写下一条草稿，或切换会话查看其他研究。</p>}</div>
      </>}
      <div className="turn-meta"><small>{turn.at}</small><button onClick={() => void copy(turn.text)}>复制{turn.role === "user" ? "问题" : "回答"}</button></div>
    </article>)}
    {snapshot.output.conclusion.statement && <section className="conclusion"><span className="eyebrow">{snapshot.state === "running" ? "上次已记录的结论 · 本轮尚未结束" : "已记录的研究结论"}</span><h2>{snapshot.output.conclusion.statement}</h2><p>{snapshot.output.conclusion.boundary}</p><small>{snapshot.output.conclusion.settled ? "结论已记录" : "尚未完成"} · 模型置信度{snapshot.output.conclusion.confidence ? "：" + confidenceLabels[snapshot.output.conclusion.confidence] : "未提供"} · 不代表独立核验</small></section>}
    {!!(snapshot.output.evidence.length || snapshot.output.artifacts.length) && <div className="result-links"><button onClick={onEvidence}>查看证据 <span>{snapshot.output.evidence.filter(e => e.available).length} / {snapshot.output.evidence.length}</span> ↗</button><button onClick={onReport}>研究报告 <span>{snapshot.output.artifacts.length} 个版本</span> ↗</button></div>}
    </div>
  </div>{copyStatus && <span className="copy-feedback" role="status">{copyStatus}</span>}{away && <button className="jump-latest" onClick={() => { setAway(false); stream.current?.scrollTo({ top: stream.current.scrollHeight }); }}>回到最新 ↓</button>}</>;
}

export function Overview({ snapshot, portfolio, demo, onClose }: { snapshot: MarketSnapshot | null; portfolio: string; demo: boolean; onClose(): void }) {
  const rows = snapshot?.quotes ?? [];
  const watch = rows.filter(q => q.group === "watchlist");
  const market = rows.filter(q => q.group !== "watchlist");
  const group = (title: string, items: typeof rows) => <section className="quote-group"><h3>{title} <small>{items.length}</small></h3>{items.map(q => <div className="quote-row" key={q.code}><small>{q.code}</small><span>{q.name}</span><strong className={q.change === null ? "" : q.change > 0 ? "up" : q.change < 0 ? "down" : ""}>{q.change === null ? "—" : (q.change > 0 ? "+" : "") + q.change.toFixed(2) + "%"}</strong></div>)}</section>;
  return <aside id="overview" className="overview" aria-label="行情概览"><div className="section-label"><strong>行情概览</strong><IconButton name="x" label="收起概览" onClick={onClose} /></div>
    <div className="refresh"><span>刷新：{snapshot?.refreshedAt || "尚未刷新"}</span><small>{demo ? "合成示例" : snapshot?.source.provider ?? "未连接"}</small></div>
    <p className="quote-note">刷新时间不等于交易日期；概览不替代研究证据。</p>
    {!rows.length ? <p className="empty-state">尚无行情数据</p> : <><details open><summary className="watch-heading">{portfolio || "观察组"}</summary>{group("关注标的", watch)}</details>{group("市场指数", market)}</>}
  </aside>;
}
