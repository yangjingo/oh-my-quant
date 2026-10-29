import { randomUUID } from "node:crypto";
import type { QuantAgentDependencies } from "../../agent/src/session-contracts.ts";
import type { SessionSnapshot, ToolActivity, Turn } from "../../types/workbench.ts";
import { toUiMessage } from "../../runtime/workspace/messages.ts";
import { toolPresentation } from "../workbench/tool-presentation.ts";
import { WorkbenchError } from "../workbench/errors.ts";

/** Read-only presentation import. The existing journal remains the sole context. */
export async function readLegacySession(repository: QuantAgentDependencies["sessions"], metadata: Awaited<ReturnType<typeof repository.list>>[number], clean: (text: string) => string) {
  const source = await repository.open(metadata), leaf = await source.getLeafId();
  const branch = leaf ? await source.getBranch(leaf) : [];
  const turns: Turn[] = [], tools = new Map<string, ToolActivity>();
  let lastRole = "", lastStop = "";
  for (const entry of branch) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role === "user" || message.role === "displayUser" || message.role === "assistant" || message.role === "toolResult") lastRole = message.role;
    const visible = toUiMessage(message);
    if (visible && (visible.role === "user" || visible.role === "assistant")) {
      const state = message.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted") ? "interrupted" : "settled";
      turns.push({ id: "legacy-" + entry.id, role: visible.role, text: clean(visible.text ?? ""), state, at: entry.timestamp });
    }
    if (message.role === "assistant") {
      lastStop = message.stopReason;
      for (const part of message.content) if (part.type === "toolCall") tools.set(part.id, {
        id: part.id, name: clean(part.name), title: clean(toolPresentation(part.name).title ?? part.name).slice(0, 100), state: "unconfirmed",
      });
    } else if (message.role === "toolResult") {
      const tool = tools.get(message.toolCallId);
      if (tool) tools.set(message.toolCallId, { ...tool, state: message.isError ? "failed" : "completed" });
    }
  }
  const unconfirmed = [...tools.values()].filter(tool => tool.state === "unconfirmed");
  const interrupted = turns.length > 0 && (lastRole !== "assistant" || lastStop !== "stop" || unconfirmed.length > 0);
  // This identity labels imported recovery only; no new execution is counted.
  const runId = interrupted ? randomUUID() : null;
  let recovery: SessionSnapshot["recovery"];
  if (runId) {
    turns.push({ id: runId + "-assistant", role: "assistant", state: "interrupted", at: branch.at(-1)?.timestamp ?? metadata.createdAt,
      text: "旧会话尚未完成，恢复没有重新执行模型或工具。请核对已记录的结果后再继续。", activity: unconfirmed });
    recovery = { runId, unconfirmedTools: unconfirmed.length, acknowledgementRequired: unconfirmed.length > 0 };
  }
  const name = clean(await source.getSessionName() ?? turns.find(turn => turn.role === "user")?.text ?? "恢复的终端会话").slice(0, 100);
  if (await source.getLeafId() !== leaf) throw new WorkbenchError("CONTEXT_CHANGED", "旧会话正在变化，未导入过期历史；请核对运行所有者后重试。", 409);
  return { turns, coreLeafId: leaf, name, runId, state: interrupted ? "interrupted" as const : "idle" as const, recovery };
}
