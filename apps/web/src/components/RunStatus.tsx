import { useEffect, useState } from "react";
import type { Turn } from "../client/contract";
import { runLabels } from "../presentation";

export function runStatusLabel(turn: Turn): string {
  if (turn.state !== "running") return runLabels[turn.state];
  if (turn.activity?.some(item => item.state === "running")) return "正在调用工具";
  if (turn.activity?.some(item => item.state === "preparing")) return "准备调用工具";
  return ({ waiting: "等待模型响应", thinking: "思考中", preparing: "准备调用工具", tool: "正在调用工具", answering: "正在生成回答" })[turn.phase ?? (turn.text ? "answering" : "waiting")];
}

export function elapsedLabel(turn: Turn, now: number): string | null {
  const start = Date.parse(turn.at), end = turn.state === "running" ? now : Date.parse(turn.endedAt ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

/** One local clock for the visible running turn; stage changes come only from Host events. */
export function RunStatus({ turn }: { turn: Turn }) {
  const [now, setNow] = useState(Date.now);
  const running = turn.state === "running";
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [turn.id, running]);
  const elapsed = elapsedLabel(turn, now);
  const tools = turn.activity?.filter(item => running && (item.state === "running" || item.state === "preparing"));
  return <div className={"agent-status" + (running ? " is-running" : "")}>
    <span className="agent-status-mark" aria-hidden="true" />
    <span role="status" className="agent-status-label">{runStatusLabel(turn)}</span>
    {elapsed && <small aria-hidden="true">已用 {elapsed}</small>}
    {!!tools?.length && <span className="agent-status-tool">{tools.map(item => item.title ?? "研究工具").join(" · ")}</span>}
  </div>;
}
