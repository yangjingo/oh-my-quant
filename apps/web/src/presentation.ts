import type { RunState, SessionSnapshot } from "./client/contract";

export const runLabels: Record<RunState, string> = {
  idle: "尚未开始", running: "研究进行中", settled: "本轮已结束", failed: "本轮失败", cancelled: "已停止", interrupted: "意外中断",
};

export const confidenceLabels = { low: "低", medium: "中", high: "高" } as const;

/** Text submission never doubles as a command to cancel an existing run. */
export function canSubmitText(text: string, running: boolean, disabled: boolean, pending: boolean, composing: boolean) {
  return !!text.trim() && !running && !disabled && !pending && !composing;
}

export function researchSummary(title: string, snapshot: SessionSnapshot, demo: boolean): string {
  const { output } = snapshot;
  return [
    "# " + title,
    demo ? "> 合成演示记录，非实际研究报告。" : "> 当前界面的研究摘要，不是不可变报告原文件。",
    "## 结论", output.conclusion.statement ?? "暂无已发布结论。",
    "## 观察条件", output.conclusion.boundary ?? "尚未提供观察条件。",
    "## 证据目录",
    ...output.evidence.map(e => `- ${e.label}｜${e.available ? "已记录" : "缺失"}｜来源：${e.source ?? "未提供"}｜日期：${e.asOf ?? "未提供"}｜ID：${e.id}`),
    "## 报告版本",
    ...output.artifacts.map(a => `- v${a.version} ${a.title}｜${a.createdAt}｜SHA-256：${a.sha256}`),
  ].join("\n\n") + "\n";
}
