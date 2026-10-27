import { useLayoutEffect, useRef, useState } from "react";
import type { Turn } from "../client/contract";

/** Select actual provider text; never generate progress narration. */
export function thinkingSummary(text: string | undefined, active: boolean): string {
  const lines = (text ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return (active ? lines.at(-1) : lines[0]) ?? "";
}

/** Provider text is plain process content; expansion and scroll position belong to the reader. */
export function Thinking({ turn }: { turn: Turn }) {
  const [open, setOpen] = useState(false);
  const summary = useRef<HTMLSpanElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const active = turn.state === "running" && turn.phase === "thinking";
  const preview = thinkingSummary(turn.thinking, active);
  useLayoutEffect(() => {
    if (summary.current) summary.current.scrollLeft = active && !open ? summary.current.scrollWidth : 0;
  }, [preview, active, open]);
  useLayoutEffect(() => {
    if (open && body.current && following.current) body.current.scrollTop = body.current.scrollHeight;
  }, [turn.thinking, open]);
  if (!turn.thinking?.trim() && !active) return null;
  const status = active ? "正在输出" : turn.state === "running" ? "已输出" : turn.state === "cancelled" ? "已停止"
    : turn.state === "interrupted" ? "已中断" : turn.state === "failed" ? "已保留" : "已结束";
  return <details className="thinking-process" onToggle={event => {
    setOpen(event.currentTarget.open);
    if (event.currentTarget.open && following.current && body.current) body.current.scrollTop = body.current.scrollHeight;
  }}>
    <summary><span className="thinking-title">思考过程</span><small>{status}</small>{preview && <span className="thinking-preview" ref={summary}>{preview}</span>}</summary>
    <div className="thinking-body" ref={body} tabIndex={0} role="region" aria-label="模型思考内容" onScroll={event => {
      const element = event.currentTarget;
      following.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 32;
    }}><p>{turn.thinking || "模型正在思考，尚未返回可显示的思考文本。"}</p></div>
    <small className="thinking-note">模型返回的过程文本，可能包含尚未核对的判断。</small>
  </details>;
}
