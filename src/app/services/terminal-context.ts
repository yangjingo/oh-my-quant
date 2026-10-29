import type { QuantAgentDependencies, QuantAgentSession } from "../../agent/src/session-contracts.ts";
import type { TerminalContext } from "../../types/terminal.ts";
import type { SessionSnapshot } from "../../types/workbench.ts";
import { syncMessagesFromAgentState } from "../../runtime/workspace/agent-events.ts";
import { countConversationTurns } from "../../runtime/workspace/hud.ts";
import { WorkbenchError } from "../workbench/errors.ts";
import type { SessionTreeEntry } from "../../agent/src/session-runtime/harness/types.ts";
import { buildSessionContext } from "../../agent/src/session-runtime/harness/session/session.ts";

/** Reuses committed history or the live owner; never constructs an Agent or writes a journal. */
export async function readTerminalContext(input: {
  session: SessionSnapshot;
  coreSessionId: string | null;
  agent?: QuantAgentSession;
  repository?: QuantAgentDependencies["sessions"];
  cwd: string;
  clean(text: string): string;
  composerQueue?: string[];
  latency?: TerminalContext["latency"];
  cachedUsage?: { coreSessionId: string; leafId: string | null; usage: NonNullable<TerminalContext["contextUsage"]> };
}): Promise<TerminalContext> {
  const { agent, coreSessionId, session, clean } = input;
  let messages: unknown[] = [], thinkingText = "", turnCount = 0;
  let metadata: { id: string; createdAt: string } | null = null, entries: SessionTreeEntry[] = [];
  let contextUsage = agent?.getContextUsage() ?? null;
  if (agent) {
    [metadata, entries] = await Promise.all([agent.getSessionMetadata(), agent.getSessionEntries()]);
    const state = agent.state;
    turnCount = countConversationTurns(state.messages);
    messages = structuredClone(state.messages);
    if (state.streamingMessage && !state.messages.includes(state.streamingMessage)) messages.push(structuredClone(state.streamingMessage));
    thinkingText = clean(state.thinkingText);
  } else if (coreSessionId) {
    const stored = (await input.repository!.list({ cwd: input.cwd })).find(item => item.id === coreSessionId);
    if (!stored) throw new WorkbenchError("CONTEXT_MISSING", "原终端上下文不可用；未创建替代会话。", 409);
    metadata = stored;
    const source = await input.repository!.open(stored), leaf = await source.getLeafId();
    const branch = leaf ? await source.getBranch(leaf) : [];
    turnCount = countConversationTurns(buildSessionContext(branch).messages);
    if (input.cachedUsage?.coreSessionId === coreSessionId && input.cachedUsage.leafId === leaf) contextUsage = structuredClone(input.cachedUsage.usage);
    entries = await source.getEntries();
    messages = branch.flatMap(entry => entry.type === "message" ? [entry.message] : []);
  }
  const projected = syncMessagesFromAgentState(messages).map(message => ({ ...message,
    ...(message.text === undefined ? {} : { text: clean(message.text) }),
    ...(message.tool ? { tool: { ...message.tool, name: clean(message.tool.name), label: clean(message.tool.label),
      ...(message.tool.args === undefined ? {} : { args: clean(message.tool.args) }),
      ...(message.tool.result === undefined ? {} : { result: clean(message.tool.result) }),
      // A missing historical result is not evidence of a live tool execution.
      ...(!agent && message.tool.status === "running" ? { status: "error" as const, result: "工具结果尚未确认；恢复不会重新执行。" } : {}),
    } } : {}),
  }));
  const modelId = agent && session.state === "running" ? clean(agent.state.model?.id ?? "").replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 200) : "";
  const modelLabel = modelId ? clean(agent!.state.model?.name || modelId).replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 200) || modelId : "";
  return { session, cwd: input.cwd, activeModel: modelId ? { id: modelId, label: modelLabel } : null,
    latency: input.latency ?? { ttftMs: null, tpotMs: null },
    coreSessionId, messages: projected, thinkingText, turnCount, contextUsage, composerQueue: (input.composerQueue ?? []).map(clean),
    currentSession: metadata ? { id: metadata.id, createdAt: metadata.createdAt, usage: contextUsage, entryCount: {
      messages: entries.filter(entry => entry.type === "message").length,
      compactions: entries.filter(entry => entry.type === "compaction").length,
      branches: entries.filter(entry => entry.type === "branch_summary").length,
    } } : null };
}
