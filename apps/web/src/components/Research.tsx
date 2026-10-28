import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { MarketSnapshot, SessionSnapshot } from "../client/contract";
import { IconButton } from "./UI";
import { confidenceLabels } from "../presentation";
import { RunStatus, elapsedLabel } from "./RunStatus";
import { ToolHistory } from "./ToolHistory";
import { Thinking } from "./Thinking";

const AnswerMarkdown = lazy(() => import("./Markdown").then(module => ({ default: module.ResearchMarkdown })));

const messageDate = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
export function displayMessageTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? messageDate.format(date) : "时间未知";
}

export function Transcript({ snapshot, positions, onEvidence, onReport, onSuggestion, mode = "demo" }: { snapshot: SessionSnapshot; positions: Map<string, number>; onEvidence(): void; onReport(): void; onSuggestion(text: string): void; mode?: string }) {
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
  const suggestions = mode === "host" ? [
    { label: "用假设数据计算三种仓位情景", text: "请调用 calculate_position_scenarios：假设100股、成本每股10元、给定2026-10-23收盘12元、币种CNY，计算下跌10%、不变、上涨10%的盈亏。仅使用这些假设输入，不取实时行情，不作投资建议。" },
    { label: "判断一次回撤，需要先收集哪些证据？", text: "我应该收集哪些证据，才能判断回撤结构？请区分必要数据、计算方法和还不能下的结论。" },
    { label: "梳理一个可以验证的研究问题", text: "帮我把一个投资疑问整理成研究问题。请先询问研究对象、时间范围和我已有的材料，不预设结论。" },
  ] : ["比较 002048.SZ 与沪深300今年的区间表现", "我应该收集哪些证据，才能判断回撤结构？", "帮我检查已有研究中哪些结论还缺少依据"].map(text => ({ label: text, text }));
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
    {!snapshot.turns.length && <div className="empty-state research-welcome"><span className="eyebrow">从一个明确的问题开始</span><h2>开始一份研究</h2><p>{mode === "host" ? "本机 Agent 已连接。可以先用给定数据验证工具；真实行情来源需要单独配置。" : "说明研究对象、时间区间，以及你想验证的判断。"}</p><div className="starter-questions">{suggestions.map(item => <button key={item.label} onClick={() => onSuggestion(item.text)}>{item.label}<span aria-hidden="true">↗</span></button>)}</div><p className="supporting">{mode === "host" ? "点击只会填入草稿。请核对并修改后再发送；当前连接暂未启用文件引用。" : "点击只会填入草稿。发送前可以修改问题或用 @ 添加引用。"}</p></div>}
    <div className="thread-inner">{snapshot.turns.map(turn => <article className={"turn turn-" + turn.role} key={turn.id}>
      {turn.role === "user" ? <div className="question"><span className="prompt">›</span><p>{turn.text}</p></div> : <>
        {turn.state !== "settled" && <RunStatus turn={turn} />}
        <Thinking turn={turn} />
        <ToolHistory turn={turn} />
        <span className="assistant-label">WhyJ</span><div className="answer markdown-body">{turn.text ? <Suspense fallback={<p className="plain-answer">{turn.text}</p>}><AnswerMarkdown text={turn.text} /></Suspense> : <p className="waiting-message">{turn.state === "running" ? "Agent 正在处理，你可以继续写下一条草稿。" : "本轮未返回文字内容。"}</p>}</div>
      </>}
      <div className="turn-meta"><span><time dateTime={turn.at} title={turn.at}>{displayMessageTime(turn.at)}</time>{turn.role === "assistant" && turn.state === "settled" && elapsedLabel(turn, 0) && <span> · 用时 {elapsedLabel(turn, 0)}</span>}</span><button onClick={() => void copy(turn.text)}>复制{turn.role === "user" ? "问题" : "回答"}</button></div>
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
  return <aside id="overview" className="overview" aria-label="行情概览" tabIndex={0}><div className="section-label"><strong>行情概览</strong><IconButton name="x" label="收起概览" onClick={onClose} /></div>
    <div className="refresh"><span>刷新：{snapshot?.refreshedAt || "尚未刷新"}</span><small>{demo ? "合成示例" : snapshot?.source.provider ?? "未连接"}</small></div>
    <p className="quote-note">刷新时间不等于交易日期；概览不替代研究证据。</p>
    {!rows.length ? <p className="empty-state">尚无行情数据</p> : <><details open><summary className="watch-heading">{portfolio || "观察组"}</summary>{group("关注标的", watch)}</details>{group("市场指数", market)}</>}
  </aside>;
}
