import type { ToolActivity, Turn } from "../client/contract";
import { runLabels } from "../presentation";

export const toolStateLabels: Record<ToolActivity["state"], string> = {
  preparing: "准备中", running: "执行中", completed: "已完成", failed: "未成功", cancelled: "已停止", "not-run": "未执行",
};
export function activitySummary(items: readonly ToolActivity[]): string {
  const counts = ["running", "preparing", "completed", "failed", "cancelled", "not-run"] as const;
  return counts.map(state => {
    const count = items.filter(item => item.state === state).length;
    return count ? `${toolStateLabels[state]} ${count}` : "";
  }).filter(Boolean).join(" · ");
}
const explanations: Record<ToolActivity["state"], string> = {
  preparing: "正在准备调用参数，工具尚未开始执行。",
  running: "工具正在执行，结果返回后会更新这条记录。",
  completed: "工具已返回结果；这不代表研究结论已完成独立核验。",
  failed: "工具未成功返回。请核对输入或数据来源，不能将此记录作为成功证据。",
  cancelled: "本次执行已停止。继续研究前请核对已返回的内容。",
  "not-run": "准备过程已结束，此工具未开始执行。",
};
export function ToolHistory({ turn }: { turn: Turn }) {
  const items = turn.activity ?? [];
  return <details className="process tool-history" open={turn.state === "running" && items.length > 0}>
    <summary><span>{items.length ? "执行记录" : "运行详情"}</span>{items.length > 0 && <small>{activitySummary(items)}</small>}</summary>
    {!items.length ? <p>状态：{runLabels[turn.state]}。界面只显示实际执行状态。</p> : <>
      <ol className="tool-records">{items.map(item => <li key={item.id}>
        <details className="tool-record" data-state={item.state}>
          <summary><span className="tool-record-title">{item.title ?? "研究工具"}</span><span className="tool-record-state">{toolStateLabels[item.state]}{item.elapsedMs === undefined ? "" : ` · ${(item.elapsedMs / 1000).toFixed(2)} 秒`}</span></summary>
          {item.context && <p className="tool-record-context">{item.context}</p>}
          <p>{explanations[item.state]}</p>
          <dl><dt>工具</dt><dd><code>{item.name}</code></dd><dt>调用标识</dt><dd><code>{item.id}</code></dd></dl>
        </details>
      </li>)}</ol>
      <p className="tool-history-note">仅展示执行记录与有限输入摘要；原始结果和研究证据入口尚未接通。</p>
    </>}
  </details>;
}
