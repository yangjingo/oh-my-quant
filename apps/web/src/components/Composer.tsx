import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReferenceCandidate, WorkbenchClient } from "../client/contract";
import { detect, replaceToken } from "../features/composer/editor.mjs";
import { canSubmitText } from "../presentation";

const descriptions: Record<string, string> = { config: "界面与连接设置", resume: "切换会话", clear: "新建研究", portfolio: "选择观察组", artifact: "报告与版本", evidence: "当前证据", help: "输入快捷键" };
export function Composer(props: {
  client: WorkbenchClient; sessionId: string; text: string; onText(text: string): void;
  running: boolean; disabled: boolean; onSubmit(text: string): Promise<boolean>; onCancel(): void; onCommand(name: string): boolean;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(props.text.length);
  const [choices, setChoices] = useState<readonly ReferenceCandidate[]>([]);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState(false);
  const [searching, setSearching] = useState(false);
  const generation = useRef(0);
  const composing = useRef(false);
  const active = detect(props.text, caret);
  const trigger = active?.trigger;
  const query = active?.query ?? "";
  const open = !!active && !dismissed;
  useEffect(() => { setFeedback(""); }, [props.running]);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    let mounted = true;
    let width = -1;
    const resize = () => {
      if (!mounted) return;
      element.style.height = "44px";
      element.style.height = Math.max(44, Math.min(144, element.scrollHeight)) + "px";
    };
    resize();
    const observer = new ResizeObserver(entries => {
      const nextWidth = entries[0]?.contentRect.width;
      if (nextWidth !== width) { width = nextWidth ?? -1; resize(); }
    });
    observer.observe(element.parentElement!);
    void document.fonts.ready.then(resize);
    document.fonts.addEventListener("loadingdone", resize);
    return () => { mounted = false; observer.disconnect(); document.fonts.removeEventListener("loadingdone", resize); };
  }, [props.text]);
  useEffect(() => {
    const ticket = ++generation.current;
    setIndex(0); setChoices([]); setSearching(false);
    if (!open) return;
    if (trigger === "/") {
      setChoices(Object.keys(descriptions).filter(c => c.includes(query)).map(c => ({ id: c, label: "/" + c, token: "/" + c, kind: "file", description: descriptions[c]! })));
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void props.client.references(props.sessionId, query).then(rows => {
        if (ticket === generation.current) { setChoices(rows); setSearching(false); }
      }, error => { if (ticket === generation.current) { setFeedback(error instanceof Error ? error.message : "引用搜索失败"); setSearching(false); } });
    }, 80);
    return () => { clearTimeout(timer); generation.current++; };
  }, [props.client, props.sessionId, open, trigger, query, caret]);
  const complete = (choice: ReferenceCandidate) => {
    if (!active) return;
    const result = replaceToken(props.text, active, choice.token, choice.kind === "directory");
    props.onText(result.text); setCaret(result.caret); setDismissed(choice.kind !== "directory");
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(result.caret, result.caret); });
  };
  const send = async () => {
    if (props.running) { setFeedback("研究仍在进行，草稿已保留。停止请用右侧按钮或 Ctrl + G。"); return; }
    if (!canSubmitText(props.text, props.running, props.disabled, pending, composing.current)) return;
    const text = props.text;
    if (text.trim().startsWith("/")) {
      if (props.onCommand(text.trim().slice(1))) props.onText("");
      else setFeedback("该命令需要 Host 支持，草稿已保留。");
      return;
    }
    setPending(true);
    try { await props.onSubmit(text); }
    finally { setPending(false); input.current?.focus(); }
  };
  return <form id="composer" className="composer" onSubmit={e => { e.preventDefault(); void send(); }}>
    <div className="input-box"><div className="input-tools"><span aria-hidden="true" className="prompt">›</span></div>
      <div className="editor-wrap"><textarea ref={input} id="input" aria-label="研究问题" value={props.text} rows={1}
        placeholder={props.disabled ? "连接研究服务后开始提问" : "提出研究问题，@ 引用，/ 命令"} spellCheck={false} disabled={props.disabled}
        role="combobox" aria-autocomplete="list" aria-controls="suggestionList" aria-expanded={open} aria-activedescendant={open && choices[index] ? "choice-" + index : undefined}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onChange={e => { props.onText(e.target.value); setCaret(e.target.selectionStart); setDismissed(false); setFeedback(""); }}
        onSelect={e => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing || composing.current || e.keyCode === 229) return;
          if (open && e.key === "Escape") { e.preventDefault(); setDismissed(true); return; }
          if (open && choices.length && ["ArrowDown", "ArrowUp"].includes(e.key)) {
            e.preventDefault(); setIndex((index + (e.key === "ArrowDown" ? 1 : choices.length - 1)) % choices.length); return;
          }
          if (open && choices[index] && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
            e.preventDefault(); complete(choices[index]!); return;
          }
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
        }} /></div>
      <div className="composer-actions"><button key={props.running ? "stop" : "send"} id="send" type={props.running ? "button" : "submit"} onClick={props.running ? event => { event.preventDefault(); props.onCancel(); requestAnimationFrame(() => input.current?.focus()); } : undefined} className="icon-button send-button" disabled={props.disabled || pending || (!props.running && !props.text.trim())}
        aria-label={props.running ? "停止生成" : "发送问题"} title={props.running ? "停止生成 · Ctrl + G" : "发送 · Enter"}><span aria-hidden="true">{props.running ? "■" : "↑"}</span></button></div>
    </div>
    {open && <section id="cmdMenu" className="suggestion-panel" aria-label="输入候选">
      <div className="suggestion-header"><strong>{trigger === "/" ? "命令" : "文件 · 会话 · 证据"}</strong><small>{props.client.mode === "demo" ? "示例工作区" : "当前工作区"}</small></div>
      <div id="suggestionList" className="suggestion-list" role="listbox">
        {choices.map((choice, i) => <button type="button" role="option" id={"choice-" + i} aria-selected={index === i} key={choice.kind + choice.id} className="completion-row" onMouseDown={e => e.preventDefault()} onClick={() => complete(choice)}><span>{choice.label}</span><small>{choice.description}</small></button>)}
        {!choices.length && <p className="completion-empty" role="status">{searching ? "正在查找引用…" : "没有匹配的候选"}</p>}
      </div><div className="suggestion-footer">↑ ↓ 选择 · Enter / Tab 确认 · Esc 收起</div>
    </section>}
    {feedback && <div role="status" className="composer-feedback">{feedback}</div>}
    <div className="composer-hint"><span>{props.running ? "可继续写草稿，运行结束后发送" : "Enter 发送 · Shift + Enter 换行"}</span><span>{props.running ? "Ctrl + G 停止" : "研究需要证据，结论需要复核"}</span></div>
  </form>;
}
