import { useState } from "react";
import type { Preferences, WorkspaceSummary } from "../client/contract";
import type { DialogPage } from "./Settings";
import { Icon, IconButton } from "./UI";
import { runLabels } from "../presentation";

export function Header(props: { title: string; code: string; mode: string; running: boolean; sidebar: boolean; onSidebar(): void; onNew(): void; onSettings(): void; onOverview(): void }) {
  return <header className="topbar"><div className="brand"><img className={props.running ? "thinking-brand" : ""} alt="JQ" src="assets/logo-mark.svg" />WhyJ Quant <small>v{__APP_VERSION__}</small></div><div className="separator" />
    <button id="projectSwitch" className="switch" aria-expanded={props.sidebar} aria-controls="projects" onClick={props.onSidebar} title="展开会话侧栏"><Icon name="panel-left" /><span>{props.code}</span><span className="project-name">{props.title}</span></button>
    <div className="top-actions"><span className="demo">{props.mode === "demo" ? "交互演示 · 合成数据" : props.mode === "host" ? "工作区已连接" : "研究服务未连接"}</span>
      <IconButton name="square-pen" label="新建会话" onClick={props.onNew} /><IconButton name="settings-2" label="界面设置" onClick={props.onSettings} /><IconButton name="panel-right" label="切换研究概览" onClick={props.onOverview} /></div>
  </header>;
}
export function Sessions(props: { sessions: readonly WorkspaceSummary[]; active: string; onSelect(id: string): void; onNew(): void; onClose(): void }) {
  const [search, setSearch] = useState("");
  const [pinned, setPinned] = useState<string[]>([]);
  const sessions = [...props.sessions].filter(s => (s.name + s.code).includes(search)).sort((a, b) => Number(pinned.includes(b.sessionId)) - Number(pinned.includes(a.sessionId)));
  return <aside id="projects" className="projects" aria-label="研究会话列表"><div className="section-label"><strong>研究会话</strong><IconButton name="x" label="收起会话" onClick={props.onClose} /></div>
    <input className="session-search" aria-label="搜索会话" placeholder="搜索会话" value={search} onChange={e => setSearch(e.target.value)} />
    <button className="new-session" onClick={props.onNew}>＋ 新建研究</button>
    {sessions.map(s => <div className={"session-row " + (s.sessionId === props.active ? "active" : "")} key={s.sessionId}>
      <button className="session-select" onClick={() => props.onSelect(s.sessionId)} aria-current={s.sessionId === props.active ? "true" : undefined}><strong>{s.name}</strong><small>{s.code && s.code + " · "}{runLabels[s.state]}</small></button>
      <button className="pin" aria-label={(pinned.includes(s.sessionId) ? "取消置顶 " : "置顶 ") + s.name} onClick={() => setPinned(p => p.includes(s.sessionId) ? p.filter(id => id !== s.sessionId) : [...p, s.sessionId])}>{pinned.includes(s.sessionId) ? "◆" : "◇"}</button>
    </div>)}{!sessions.length && <p className="empty-state">没有匹配的会话。试试名称或证券代码。</p>}
  </aside>;
}
export function Footer({ preferences, mode, onOpen }: { preferences: Preferences; mode: string; onOpen(page: DialogPage): void }) {
  return <footer className="status"><button className="status-model" onClick={() => onOpen("model")} title={mode === "demo" ? "演示模式未调用模型" : preferences.model || "模型未连接"}><Icon name="settings-2" /><span>{mode === "demo" ? "演示 · 未调用模型" : preferences.model || "模型未连接"}</span></button>
    <button className="status-source" onClick={() => onOpen("source")}>{mode === "host" && preferences.researchSource ? "研究源：" + (preferences.researchSources?.find(item => item.id === preferences.researchSource)?.label ?? preferences.researchSource) : preferences.source === "demo" && mode === "demo" ? "本地合成 · 示例" : "数据源未连接"}</button>
    <button id="statusText" className="status-portfolio" onClick={() => onOpen("portfolio")}>{preferences.portfolio || "选择投资组合"}</button></footer>;
}
