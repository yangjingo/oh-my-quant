import { Buffer, truncate, wrap } from "./buffer.ts";
import { drawPanelFrame } from "./panel-chrome.ts";
import { S } from "./styles.ts";

/** Display the affected tools; acknowledgement does not replay or verify effects. */
export function drawRecoveryConfirmation(buf: Buffer, unconfirmedTools: number, activities: string[], offset: number, pending: boolean): number {
  const frame = drawPanelFrame(buf, "核对未确定的结果", "", 2, 1);
  const lead = unconfirmedTools > 0 ? `${unconfirmedTools} 次工具调用的结果待核对。` : "执行记录不完整，无法确认工具是否运行。";
  const lines = [lead, ...activities, "请先核对外部结果。确认只解除提问限制，不会重跑或验证操作。", "草稿会保留；确认后仍需手动发送。"]
    .flatMap(line => wrap(line, Math.max(1, frame.inner.w)));
  const maxOffset = Math.max(0, lines.length - frame.contentH);
  lines.slice(Math.min(offset, maxOffset), Math.min(offset, maxOffset) + frame.contentH)
    .forEach((line, index) => buf.text(frame.inner.x, frame.contentY + index, line, S.cream));
  buf.text(frame.inner.x, frame.footerY, truncate(pending ? "正在记录核对…" : "↑↓ 查看 · Enter 我已核对 · Esc 返回", frame.inner.w), S.goldB);
  return maxOffset;
}
