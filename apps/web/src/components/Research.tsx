import { useEffect, useRef, useState } from "react";
import type { MarketSnapshot, SessionSnapshot } from "../client/contract";
import { IconButton } from "./UI";

export function Transcript({ snapshot, positions, onEvidence, onReport }: { snapshot: SessionSnapshot; positions: Map<string, number>; onEvidence(): void; onReport(): void }) {
  const stream = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
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
    try { await navigator.clipboard.writeText(text); setCopyStatus("已复制"); }
    catch { setCopyStatus("无法复制，请手动选择文本"); }
  };
  return <><div id="stream" ref={stream} className="stream" role="region" aria-label="研究会话" onScroll={e => {
    const el = e.currentTarget; positions.set(id, el.scrollTop); following.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 60; setAway(!following.current);
  }}>
    {!snapshot.turns.length && <div className="empty-state"><h2>开始一份研究</h2><p>提出问题，或用 @ 引用文件、会话与证据。</p></div>}
    <div className="thread-inner">{snapshot.turns.map(turn => <article className={"turn turn-" + turn.role} key={turn.id}>
      {turn.role === "user" ? <div className="question"><span className="prompt">›</span><p>{turn.text}</p></div> : <>
        <details className="process"><summary>{turn.state === "running" ? "Thinking…" : turn.state === "cancelled" ? "已停止" : "过程与状态"}</summary><p>状态：{turn.state}。执行细节由客户端提供；此处不展示隐藏推理。</p></details>
        <span className="assistant-label">WhyJ</span><div className="answer">{turn.text || "等待运行结果…"}</div>
      </>}
      <div className="turn-meta"><small>{turn.at}</small><button onClick={() => void copy(turn.text)}>复制{turn.role === "user" ? "问题" : "回答"}</button></div>
    </article>)}
    {snapshot.output.conclusion.statement && <section className="conclusion"><h2>{snapshot.output.conclusion.statement}</h2><p>{snapshot.output.conclusion.boundary}</p><small>{snapshot.output.conclusion.settled ? "已完成" : "尚未完成"} · 置信度 {snapshot.output.conclusion.confidence ?? "未记录"}</small></section>}
    {!!(snapshot.output.evidence.length || snapshot.output.artifacts.length) && <div className="result-links"><button onClick={onEvidence}>证据 {snapshot.output.evidence.filter(e => e.available).length} / {snapshot.output.evidence.length} ↗</button><button onClick={onReport}>研究报告 ↗</button></div>}
    </div><span className="sr-only" role="status">{copyStatus}</span>
  </div>{away && <button className="jump-latest" onClick={() => { setAway(false); stream.current?.scrollTo({ top: stream.current.scrollHeight }); }}>回到最新 ↓</button>}</>;
}

export function Overview({ snapshot, portfolio, demo, onClose }: { snapshot: MarketSnapshot | null; portfolio: string; demo: boolean; onClose(): void }) {
  const rows = snapshot?.quotes ?? [];
  const watch = rows.filter(q => q.group === "watchlist");
  const market = rows.filter(q => q.group !== "watchlist");
  const group = (title: string, items: typeof rows) => <section className="quote-group"><h3>{title} <small>{items.length}</small></h3>{items.map(q => <div className="quote-row" key={q.code}><small>{q.code}</small><span>{q.name}</span><strong className={q.change === null ? "" : q.change > 0 ? "up" : q.change < 0 ? "down" : ""}>{q.change === null ? "—" : (q.change > 0 ? "+" : "") + q.change.toFixed(2) + "%"}</strong></div>)}</section>;
  return <aside id="overview" className="overview"><div className="section-label"><strong>◫ Overview</strong><IconButton name="x" label="收起概览" onClick={onClose} /></div>
    <div className="refresh" title="刷新事件，不代表各标的交易日期"><span>Refresh: {snapshot?.refreshedAt || "—"}</span><small>{demo ? "示例" : snapshot?.source.provider ?? "未刷新"}</small></div>
    {!rows.length ? <p className="empty-state">尚无行情数据</p> : <><details open><summary className="watch-heading">{portfolio || "观察组"}</summary>{group("Watchlist", watch)}</details>{group("Market", market)}</>}
  </aside>;
}
