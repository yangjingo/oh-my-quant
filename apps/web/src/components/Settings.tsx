import { useState } from "react";
import type { Preferences, SessionSnapshot } from "../client/contract";
import { runLabels } from "../presentation";
import { Dialog } from "./UI";

export type DialogPage = "reading" | "model" | "source" | "portfolio" | "runtime" | "session" | "help" | "about";
const labels: Record<DialogPage, string> = { reading: "阅读与界面", model: "模型", source: "数据源", portfolio: "观察组", runtime: "运行状态", session: "会话设置", help: "命令帮助", about: "关于" };

export function Settings(props: {
  page: DialogPage; setPage(page: DialogPage): void; onClose(): void;
  preferences: Preferences; onPreferences(prefs: Preferences): Promise<void>;
  snapshot: SessionSnapshot | null; title: string; onRename(title: string): Promise<void>;
  fontSize: number; onFontSize(size: number): void; onStop(): void; mode: string;
}) {
  const [model, setModel] = useState(props.preferences.model);
  const [thinking, setThinking] = useState(props.preferences.thinkingLevel ?? "high");
  const [title, setTitle] = useState(props.title);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const perform = async (action: () => Promise<void>, success: string) => {
    if (pending) return;
    setPending(true); setFeedback(null);
    try { await action(); setFeedback({ error: false, text: success }); }
    catch (error) { setFeedback({ error: true, text: error instanceof Error ? error.message : "操作未完成，请重试。" }); }
    finally { setPending(false); }
  };
  const savePreferences = (next: Preferences) => perform(() => props.onPreferences(next), props.mode === "demo" ? "演示偏好已保存；未建立真实连接。" : "偏好已保存。连接状态以研究服务为准。");
  return <Dialog title={labels[props.page]} onClose={props.onClose}>
    <div className="settings-layout"><nav aria-label="设置分区" className="settings-nav" onKeyDown={event => {
      if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      if (!buttons.length) return;
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : buttons.length - 1)) % buttons.length;
      event.preventDefault(); buttons[next]?.focus();
    }}>{(Object.keys(labels) as DialogPage[]).map(page => <button key={page} disabled={pending} aria-current={props.page === page ? "page" : undefined} onClick={() => { props.setPage(page); setFeedback(null); }}>{labels[page]}</button>)}</nav>
      <section className="settings-main" aria-busy={pending}>
        {props.page === "reading" && <><h3>让研究更容易读</h3><p className="supporting">调整当前窗口的阅读字号，不改变研究内容。</p><label className="field-row">正文字号<select value={props.fontSize} onChange={event => props.onFontSize(Number(event.target.value))}><option value={13}>紧凑 · 13px</option><option value={15}>标准 · 15px</option><option value={16}>舒适 · 16px</option></select></label></>}
        {props.page === "model" && <><p>{props.mode === "demo" ? "这里仅保存演示偏好，不会调用模型。" : "模型连接由研究服务管理；这里不保存 API 密钥。"}</p>
          {props.preferences.modelProvider && <div className="notice"><p>服务商：{props.preferences.modelProvider} · {props.preferences.modelProtocol}</p><p>{props.preferences.modelCredentialsConfigured ? "凭据已在本机配置，实际可用性以研究请求为准。" : "凭据尚未验证；服务会在请求时检查本机配置。"}</p><p>当前连接仅编辑既有服务商的模型。新服务商与密钥请在本机配置。</p></div>}
          <label className="field-row">模型 ID<input aria-label="模型 ID" value={model} disabled={pending} onChange={event => { setModel(event.target.value); setFeedback(null); }} placeholder="填写服务提供的模型 ID" /></label>
          {!!props.preferences.availableThinkingLevels?.length && <label className="field-row">推理强度<select aria-label="推理强度" disabled={pending} value={thinking} onChange={event => { setThinking(event.target.value); setFeedback(null); }}>{props.preferences.availableThinkingLevels.map(level => <option key={level} value={level}>{level}</option>)}</select></label>}
          <button className="action primary-action" disabled={pending} onClick={() => void savePreferences({ ...props.preferences, model, ...(props.preferences.thinkingLevel ? { thinkingLevel: thinking } : {}) })}>{pending ? "正在保存…" : "保存偏好"}</button></>}
        {props.page === "source" && <><p>仅连接成功的数据源才能提供行情。变更偏好不会把旧数据当作新数据。</p><label className="field-row">数据源<select aria-label="数据源" disabled={pending} value={props.preferences.source} onChange={event => void savePreferences({ ...props.preferences, source: event.target.value as Preferences["source"] })}><option value="none">未启用</option>{props.mode === "demo" && <option value="demo">本地合成 · 示例</option>}<option value="akshare">AKShare · 需研究服务连接</option></select></label></>}
        {props.page === "portfolio" && <><p>观察组用于行情概览，不改变已经保存的研究。</p>{props.preferences.availablePortfolios?.length ? <label className="field-row">观察组<select aria-label="投资组合" value={props.preferences.portfolio} disabled={pending} onChange={event => void savePreferences({ ...props.preferences, portfolio: event.target.value })}>{props.preferences.availablePortfolios.map(name => <option key={name}>{name}</option>)}</select></label> : <p className="notice">研究服务尚未提供观察组。</p>}</>}
        {props.page === "runtime" && <><h3>{props.title || "当前会话"}</h3><p>{props.snapshot ? runLabels[props.snapshot.state] : "研究服务未连接"}</p><button className="action" disabled={props.snapshot?.state !== "running"} onClick={props.onStop}>停止生成</button><p className="supporting">关闭面板、切换会话只改变查看位置，研究仍会继续。</p>{props.snapshot?.identity.runId && <details><summary>运行标识</summary><code>{props.snapshot.identity.runId}</code></details>}</>}
        {props.page === "session" && <><label className="field-row">会话名称<input aria-label="会话名称" value={title} disabled={pending} onChange={event => { setTitle(event.target.value); setFeedback(null); }} /></label><button className="action primary-action" disabled={pending || !props.snapshot} onClick={() => void perform(() => props.onRename(title), "会话名称已保存。")}>保存名称</button></>}
        {props.page === "help" && <><h3>从问题开始</h3><p>用 / 打开界面命令，用 @ 查找当前工作区的文件、会话与证据。</p><dl className="shortcut-list"><dt>Enter</dt><dd>空闲时发送；运行中保留草稿</dd><dt>Shift + Enter</dt><dd>换行</dd><dt>Ctrl + G</dt><dd>停止当前会话正在运行的研究</dd><dt>↑ / ↓</dt><dd>选择输入候选</dd><dt>Tab / Enter</dt><dd>补全所选候选</dd><dt>Esc</dt><dd>收起候选或关闭弹窗</dd></dl><p className="supporting">引用由研究服务解释；演示候选不读取你的本机文件。</p></>}
        {props.page === "about" && <><h3>WhyJ Quant v{__APP_VERSION__}</h3><p>提问、检查证据、保留研究，再持续复核。</p><div className="notice">{props.mode === "demo" ? "当前为交互演示：数据、证据与报告均为合成示例，没有调用模型。" : props.mode === "disconnected" ? "当前界面尚未连接研究服务。此独立入口暂不能执行研究；请使用接入 Host 的应用入口。" : "当前界面连接到工作区研究服务。"}</div><p className="supporting">浏览器与桌面共用界面，运行与保存由研究服务管理。已结束不等于结论已核验。</p></>}
        {feedback && <p className={feedback.error ? "operation-feedback error-feedback" : "operation-feedback"} role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
      </section>
    </div>
  </Dialog>;
}
