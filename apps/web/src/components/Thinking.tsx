import { useLayoutEffect, useRef } from "react";
import type { Turn } from "../client/contract";

/** Provider text is plain process content; expansion and scroll position belong to the reader. */
export function Thinking({ turn }: { turn: Turn }) {
  const body = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const active = turn.state === "running" && turn.phase === "thinking";
  useLayoutEffect(() => {
    if (body.current && following.current) body.current.scrollTop = body.current.scrollHeight;
  }, [turn.thinking]);
  if (!turn.thinking?.trim() && !active) return null;
  const status = active ? "正在输出" : turn.state === "running" ? "已输出" : turn.state === "cancelled" ? "已停止"
    : turn.state === "interrupted" ? "已中断" : turn.state === "failed" ? "已保留" : "已结束";
  return <details className="thinking-process" onToggle={event => {
    if (event.currentTarget.open && following.current && body.current) body.current.scrollTop = body.current.scrollHeight;
  }}>
    <summary><span>思考过程</span><small>{status}</small></summary>
    <div className="thinking-body" ref={body} tabIndex={0} role="region" aria-label="模型思考内容" onScroll={event => {
      const element = event.currentTarget;
      following.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 32;
    }}><p>{turn.thinking || "模型正在思考，尚未返回可显示的思考文本。"}</p></div>
    <small className="thinking-note">模型返回的过程文本，可能包含尚未核对的判断。</small>
  </details>;
}
