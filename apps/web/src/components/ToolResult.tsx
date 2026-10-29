import { useState } from "react";
import type { ToolActivity } from "../client/contract";

/** Plain text only: tool output is untrusted and can contain HTML or instructions. */
export function ToolResult({ item }: { item: ToolActivity }) {
  const [feedback, setFeedback] = useState("");
  if (!item.result) return <p className="tool-result-missing">{item.state === "running" || item.state === "preparing" ? "结果尚未返回。" : "此记录未保存工具原始结果；不会从回答补造证据。"}</p>;
  const result = item.result;
  return <details className="tool-result"><summary>查看工具返回内容{result.truncated ? " · 已截断" : ""}</summary>
    <p>返回记录时间：<time dateTime={result.capturedAt}>{result.capturedAt}</time> · 非数据日期</p>
    <p>已对已知凭据及常见凭据字段脱敏。工具返回不代表结论已独立核验。</p>
    {result.truncated && <p role="note">内容超过 16,000 字符，仅保留前段，不能据此声称结果完整。</p>}
    {!!result.omittedBlocks && <p>未展示 {result.omittedBlocks} 个非文本块。</p>}
    {result.text ? <><pre tabIndex={0} aria-label="工具返回文本">{result.text}</pre><button className="text-action" onClick={() => void navigator.clipboard.writeText(result.text).then(() => setFeedback("已复制当前显示内容"), () => setFeedback("复制失败，请手动选择文本"))}>复制返回内容</button></> : <p>工具未返回可展示的文本。</p>}
    {feedback && <span role="status">{feedback}</span>}
  </details>;
}
