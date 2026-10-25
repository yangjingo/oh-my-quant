import { useEffect, useRef, useState } from "react";
import type { Preferences, SessionSnapshot } from "../client/contract";
import { IconButton } from "./UI";

export type DialogPage = "reading" | "model" | "source" | "portfolio" | "runtime" | "about" | "evidence" | "report" | "session" | "help";
const labels: Record<DialogPage, string> = { reading: "阅读与界面", model: "模型", source: "数据源", portfolio: "投资组合", runtime: "运行状态", about: "关于", evidence: "证据", report: "研究报告", session: "会话设置", help: "命令帮助" };
export function Settings(props: {
  page: DialogPage; setPage(page: DialogPage): void; onClose(): void;
  preferences: Preferences; onPreferences(prefs: Preferences): Promise<void>;
  snapshot: SessionSnapshot | null; title: string; onRename(title: string): Promise<void>;
  fontSize: number; onFontSize(size: number): void; onStop(): void; mode: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [model, setModel] = useState(props.preferences.model);
  const [title, setTitle] = useState(props.title);
  const [saved, setSaved] = useState(false);
  const pages = Object.keys(labels) as DialogPage[];
  useEffect(() => {
    const trigger = document.activeElement;
    const element = dialog.current!;
    element.showModal();
    return () => { element.close(); if (trigger instanceof HTMLElement) trigger.focus(); };
  }, []);
  const report = () => {
    const output = props.snapshot?.output;
    if (!output) return;
    const body = "# " + props.title + "\n\n" + (props.mode === "demo" ? "合成演示记录，非实际研究报告。\n\n" : "")
      + (output.conclusion.statement ?? "暂无结论") + "\n\n" + (output.conclusion.boundary ?? "") + "\n\n"
      + output.evidence.map(e => "- " + e.label + ": " + (e.source ?? "缺失")).join("\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "research-summary.md"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <dialog id="modal" ref={dialog} className="app-dialog" aria-labelledby="modalTitle" onCancel={e => { e.preventDefault(); props.onClose(); }}>
    <header className="modal-header"><h2 id="modalTitle">{labels[props.page]}</h2><IconButton name="x" label="关闭窗口" onClick={props.onClose} /></header>
    <div className="settings-layout"><nav aria-label="设置分区" className="settings-nav" onKeyDown={e => {
      const buttons = Array.from(e.currentTarget.querySelectorAll("button"));
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const index = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (current + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length;
      buttons[index]?.focus();
    }}>{pages.map(page => <button key={page} aria-current={props.page === page ? "page" : undefined} onClick={() => { props.setPage(page); setSaved(false); }}>{labels[page]}</button>)}</nav>
      <section className="settings-main">
        {props.page === "reading" && <label className="field-row">正文字号<select value={props.fontSize} onChange={e => props.onFontSize(Number(e.target.value))}><option value={13}>13px</option><option value={15}>15px</option><option value={16}>16px</option></select></label>}
        {props.page === "model" && <><p>模型连接由 Host 管理。{props.mode === "demo" ? "此处只保存演示偏好，不建立连接。" : "当前界面不保存凭证。"}</p><label className="field-row">模型 ID<input aria-label="模型 ID" value={model} onChange={e => setModel(e.target.value)} /></label><button className="action" onClick={() => { void props.onPreferences({ ...props.preferences, model }).then(() => setSaved(true)); }}>保存偏好</button>{saved && <p role="status">已提交偏好更新；连接状态仍以 Host 为准。</p>}</>}
        {props.page === "source" && <><p>未连接的数据源不会显示为已取到行情。</p><label className="field-row">数据源<select aria-label="数据源" value={props.preferences.source} onChange={e => void props.onPreferences({ ...props.preferences, source: e.target.value as Preferences["source"] })}><option value="none">未启用</option>{props.mode === "demo" && <option value="demo">本地合成 · 示例</option>}<option value="akshare">AKShare · 未连接</option></select></label></>}
        {props.page === "portfolio" && <><p>观察组只影响 Overview，不改写之前的研究。</p>{props.preferences.availablePortfolios?.length ? <label className="field-row">观察组<select aria-label="投资组合" value={props.preferences.portfolio} onChange={e => void props.onPreferences({ ...props.preferences, portfolio: e.target.value })}>{props.preferences.availablePortfolios.map(name => <option key={name}>{name}</option>)}</select></label> : <p>等待 Host 提供投资组合目录。</p>}</>}
        {props.page === "runtime" && <><p>{props.title} · {props.snapshot?.state ?? "未连接"}</p><button className="action" disabled={props.snapshot?.state !== "running"} onClick={props.onStop}>停止生成</button><p>关闭面板或切换会话只改变订阅视图，不取消运行。</p></>}
        {props.page === "about" && <><h3>WhyJ Quant v{__APP_VERSION__}</h3><p>{props.mode === "demo" ? "开发演示适配器 · 合成数据" : "共享 React 工作台"}</p><p>浏览器与 Desktop 使用同一界面；会话和执行由客户端连接的 Host 管理。</p></>}
        {props.page === "session" && <><label className="field-row">会话名称<input value={title} onChange={e => setTitle(e.target.value)} /></label><button className="action" onClick={() => void props.onRename(title)}>保存名称</button></>}
        {props.page === "evidence" && <>{props.snapshot?.output.evidence.map(e => <article className="evidence-row" key={e.id}><h3>{e.label}</h3><p>{e.available ? "已记录" : "缺失"} · {e.source ?? "无来源"} · {e.asOf ?? "无日期"}</p><code>{e.id}</code></article>)}{!props.snapshot?.output.evidence.length && <p>暂无证据。</p>}</>}
        {props.page === "report" && <><p>{props.snapshot?.output.conclusion.statement ?? "暂无研究报告。"}</p>{props.snapshot?.output.artifacts.map(a => <article className="evidence-row" key={a.id}><h3>{a.title} · v{a.version}</h3><small>{a.createdAt}</small><code>{a.sha256}</code></article>)}{!!props.snapshot?.output.artifacts.length && <button className="action" onClick={report}>下载当前摘要 Markdown</button>}</>}
        {props.page === "help" && <><p>输入 / 浏览本界面动作，@ 搜索当前工作区的文件、会话或证据。</p><p>↑ ↓ 选择候选 · Tab / Enter 补全 · Esc 关闭</p><p>Enter 发送 · Shift + Enter 换行。未连接的能力保留输入并提示原因。</p></>}
      </section></div>
  </dialog>;
}
