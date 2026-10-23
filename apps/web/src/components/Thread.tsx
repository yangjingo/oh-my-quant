import type { Turn } from "../contract.ts";

const ROLE_LABEL: Record<Turn["role"], string> = {
  user: "你",
  assistant: "WhyJ",
};

interface ThreadProps {
  readonly turns: readonly Turn[];
  /** Ticker of the active workspace, so the example matches what is selected. */
  readonly code?: string | null;
}

export function Thread({ turns, code }: ThreadProps) {
  if (turns.length === 0) {
    const subject = code ?? "一个标的";
    return (
      <div className="empty">
        <h1 className="empty__title">先聊一个投资问题。</h1>
        <p className="empty__body">
          我会取证、复算，再说明判断与边界。结论、图表与证据会出现在右侧，并随追问展开。
        </p>
        <p className="empty__example">
          研究 {subject} 最近的回撤结构：相对沪深300表现如何？哪些证据支持继续观察，哪些变化会破坏当前结构？
        </p>
      </div>
    );
  }

  return (
    <>
      {turns.map(turn => (
        <article key={turn.id} className="turn" data-role={turn.role} data-state={turn.state}>
          <div className="turn__role">
            {ROLE_LABEL[turn.role]}
            {turn.state === "running" ? " · 分析中" : ""}
          </div>
          <p className="turn__text">{turn.text}</p>
        </article>
      ))}
    </>
  );
}
