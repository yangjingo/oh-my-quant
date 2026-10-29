import type { CommandResult } from "./commands.ts";
import type { SessionSnapshot, SubmitRequest, WorkbenchClient } from "./workbench.ts";
import type { CurrentSessionMeta, UIMessage } from "./ui.ts";
import type { HudContextUsage } from "./hud.ts";
import { isWorkbenchSnapshot } from "./workbench.ts";
import type { ComposerReferenceSuggestion } from "./composer-reference.ts";
import type { ResearchTaskSpec } from "./research-task.ts";

export interface TerminalContextRequest { workspaceId: string; sessionId: string }
export interface TerminalReferenceRequest extends TerminalContextRequest { input: string }
export interface TerminalReferenceResult extends TerminalContextRequest { runId: string | null; items: ComposerReferenceSuggestion[] }
/** Private presentation only; never part of ordinary browser snapshots or checkpoints. */
export interface TerminalContext {
  session: SessionSnapshot;
  cwd: string;
  /** Model of the active owner only; no credentials or endpoint. */
  activeModel: { id: string; label: string } | null;
  latency: { ttftMs: number | null; tpotMs: number | null };
  coreSessionId: string | null;
  messages: UIMessage[];
  thinkingText: string;
  /** Number of user turns in the effective Agent context. */
  turnCount: number;
  contextUsage: HudContextUsage | null;
  currentSession: CurrentSessionMeta | null;
  composerQueue: string[];
}

export function isTerminalContext(value: unknown): value is TerminalContext {
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item);
  const optional = (item: unknown, type: string) => item === undefined || typeof item === type;
  const number = (item: unknown) => typeof item === "number" && Number.isFinite(item) && item >= 0;
  if (!object(value) || !isWorkbenchSnapshot(value.session) || !Number.isSafeInteger(value.session.revision)
    || typeof value.cwd !== "string" || !value.cwd || value.cwd.length > 4096 || value.cwd.includes("\0")
    || !(value.activeModel === null || object(value.activeModel) && typeof value.activeModel.id === "string" && value.activeModel.id.length > 0 && value.activeModel.id.length <= 200
      && typeof value.activeModel.label === "string" && value.activeModel.label.length > 0 && value.activeModel.label.length <= 200)
    || !object(value.latency) || ![value.latency.ttftMs, value.latency.tpotMs].every(item => item === null || number(item))
    || !(value.coreSessionId === null || typeof value.coreSessionId === "string" && value.coreSessionId.length > 0 && value.coreSessionId.length <= 160)
    || typeof value.thinkingText !== "string" || !Number.isSafeInteger(value.turnCount) || Number(value.turnCount) < 0 || !Array.isArray(value.messages)
    || !Array.isArray(value.composerQueue) || value.composerQueue.some(item => typeof item !== "string")) return false;
  if (value.contextUsage !== null && (!object(value.contextUsage) || !number(value.contextUsage.tokens)
    || !number(value.contextUsage.contextWindow) || !(value.contextUsage.percent === null || number(value.contextUsage.percent)))) return false;
  const meta = value.currentSession;
  if (meta !== null && (!object(meta) || meta.id !== value.coreSessionId || typeof meta.id !== "string"
    || typeof meta.createdAt !== "string" || !meta.createdAt || !object(meta.entryCount)
    || ![meta.entryCount.messages, meta.entryCount.compactions, meta.entryCount.branches].every(count => Number.isSafeInteger(count) && Number(count) >= 0)
    || meta.usage !== null && (!object(meta.usage) || !number(meta.usage.tokens) || !number(meta.usage.contextWindow)
      || !(meta.usage.percent === null || number(meta.usage.percent))))) return false;
  return value.messages.every(message => {
    if (!object(message) || !["user", "assistant", "thinking", "tool", "skill", "error"].includes(String(message.role))
      || !optional(message.text, "string") || !optional(message.thinkingLive, "boolean")
      || message.startedAt !== undefined && !number(message.startedAt)) return false;
    if (message.role === "tool" || message.tool !== undefined) {
      const tool = message.tool;
      if (!object(tool) || typeof tool.name !== "string" || typeof tool.label !== "string" || !number(tool.startedAt)
        || !["running", "done", "error"].includes(String(tool.status)) || !optional(tool.toolCallId, "string")
        || !optional(tool.args, "string") || !optional(tool.result, "string")) return false;
    }
    if (message.role === "skill" || message.skill !== undefined) {
      const skill = message.skill;
      if (!object(skill) || typeof skill.name !== "string" || typeof skill.label !== "string" || !number(skill.startedAt)
        || !["running", "done", "error"].includes(String(skill.status))) return false;
    }
    return true;
  });
}

export interface TerminalCommandIdentity { workspaceId: string; sessionId: string; requestId: string }
export interface TerminalQueueRequest extends TerminalCommandIdentity { runId: string; text: string }
export interface TerminalQueueReceipt extends TerminalCommandIdentity { runId: string; mode: "steer" | "followUp" }
export interface TerminalRestoreRequest extends TerminalCommandIdentity { expectedRevision: number; reportId: string }
export interface TerminalRestoreReceipt extends TerminalCommandReceipt { filePath?: string }
export interface TerminalResearchRequest extends TerminalCommandIdentity { expectedRevision: number; expectedTaskRevision: string | null; task: ResearchTaskSpec }
export interface TerminalCommandReceipt extends TerminalCommandIdentity {
  revision: number; result: CommandResult;
  /** A view selection, not a mutation of the request's source session. */
  selectedSessionId?: string;
}

/** Private local control capability; these operations are absent from browser RPC. */
export interface TerminalClient extends WorkbenchClient {
  suggestReferences(input: TerminalReferenceRequest): Promise<TerminalReferenceResult>;
  enqueue(input: TerminalQueueRequest): Promise<TerminalQueueReceipt>;
  context(input: TerminalContextRequest): Promise<TerminalContext>;
  command(input: SubmitRequest): Promise<TerminalCommandReceipt>;
  restoreReport(input: TerminalRestoreRequest): Promise<TerminalRestoreReceipt>;
  submitResearch(input: TerminalResearchRequest): Promise<import("./workbench.ts").SubmitResult>;
  cancelCommand(input: TerminalCommandIdentity): Promise<void>;
}
