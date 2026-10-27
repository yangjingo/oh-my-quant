import type { ArtifactRequest, ContinueRequest, DeleteSessionRequest, FollowupRequest, Preferences, RenameSessionRequest, ReviewRequest, RunIdentity, RunRevisionRequest, SaveRequest, SubmitRequest } from "../../types/workbench.ts";
import { WorkbenchError } from "../workbench/errors.ts";

/** The same runtime boundary for local callers and HTTP; copy before any await. */
export function submitRequest(value: unknown): SubmitRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkbenchError("INPUT_INVALID", "请求参数无效。");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["workspaceId", "sessionId", "requestId", "expectedRevision", "text"].includes(key)))
    throw new WorkbenchError("INPUT_INVALID", "请求包含未支持的字段。");
  const id = (key: string) => {
    const item = input[key];
    if (typeof item !== "string" || !item.trim() || item.length > 160) throw new WorkbenchError("INPUT_INVALID", "请求标识无效。");
    return item;
  };
  const workspaceId = id("workspaceId"), sessionId = id("sessionId"), requestId = id("requestId");
  if (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0) throw new WorkbenchError("INPUT_INVALID", "会话修订号无效，请重新读取会话。");
  if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 16000) throw new WorkbenchError("QUESTION_INVALID", "请输入不超过 16000 字的研究问题。");
  return { workspaceId, sessionId, requestId, expectedRevision: input.expectedRevision as number, text: input.text };
}

export function runIdentity(value: unknown): RunIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkbenchError("INPUT_INVALID", "运行标识无效。");
  const input = value as Record<string, unknown>, fields = ["workspaceId", "sessionId", "runId"] as const;
  if (Object.keys(input).some(key => !(fields as readonly string[]).includes(key)) || fields.some(key =>
    typeof input[key] !== "string" || !input[key].trim() || input[key].length > 160)) throw new WorkbenchError("INPUT_INVALID", "运行标识无效。");
  return { workspaceId: input.workspaceId as string, sessionId: input.sessionId as string, runId: input.runId as string };
}

export function nextRunRequest(value: unknown, operation: "continue"): ContinueRequest;
export function nextRunRequest(value: unknown, operation: "followup"): FollowupRequest;
export function nextRunRequest(value: unknown, operation: "continue" | "followup"): ContinueRequest | FollowupRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkbenchError("INPUT_INVALID", "请求参数无效。");
  const { previousRunId, ...input } = value as Record<string, unknown>;
  if (typeof previousRunId !== "string" || !previousRunId.trim() || previousRunId.length > 160)
    throw new WorkbenchError("INPUT_INVALID", "请指定先前的运行标识。");
  if (operation === "continue" && Object.hasOwn(input, "text")) throw new WorkbenchError("INPUT_INVALID", "继续操作不接受额外问题，请使用追问或新提交。");
  const request = submitRequest(operation === "continue" ? { ...input, text: "继续" } : input);
  if (operation === "followup") return { ...request, previousRunId };
  const { text: _, ...target } = request;
  return { ...target, previousRunId };
}

export function saveRequest(value: unknown): SaveRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkbenchError("INPUT_INVALID", "保存参数无效。");
  const { expectedRevision, expectedArtifactRevision, ...identity } = value as Record<string, unknown>;
  const target = runIdentity(identity);
  if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 0
    || !(expectedArtifactRevision === null || typeof expectedArtifactRevision === "string" && /^[a-f0-9]{64}$/.test(expectedArtifactRevision)))
    throw new WorkbenchError("INPUT_INVALID", "请提供已读取的会话和报告修订号。");
  return { ...target, expectedRevision: expectedRevision as number, expectedArtifactRevision };
}

export function artifactRequest(value: unknown): ArtifactRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkbenchError("INPUT_INVALID", "报告参数无效。");
  const { artifactId, sha256, ...identity } = value as Record<string, unknown>;
  // Reuse identity validation, including its rejection of additional fields.
  const target = runIdentity({ ...identity, runId: artifactId });
  if (Object.hasOwn(identity, "runId") || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(target.runId)) throw new WorkbenchError("INPUT_INVALID", "请指定固定报告版本。");
  return { workspaceId: target.workspaceId, sessionId: target.sessionId, artifactId: target.runId, sha256 };
}

export function reviewRequest(value: unknown): ReviewRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkbenchError("INPUT_INVALID", "复核参数无效。");
  const { requestId, expectedRevision, text, ...reference } = value as Record<string, unknown>;
  const artifact = artifactRequest(reference);
  const input = submitRequest({ workspaceId: artifact.workspaceId, sessionId: artifact.sessionId, requestId, expectedRevision, text });
  return { ...artifact, requestId: input.requestId, expectedRevision: input.expectedRevision, text: input.text };
}

export function deleteSessionRequest(value: unknown): DeleteSessionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkbenchError("INPUT_INVALID", "删除参数无效。");
  const { workspaceId, sessionId, expectedRevision, ...extra } = value as Record<string, unknown>;
  if (Object.keys(extra).length) throw new WorkbenchError("INPUT_INVALID", "删除请求包含未支持的字段。");
  const input = submitRequest({ workspaceId, sessionId, expectedRevision, requestId: "delete", text: "delete" });
  return { workspaceId: input.workspaceId, sessionId: input.sessionId, expectedRevision: input.expectedRevision };
}

export function renameSessionRequest(value: unknown): RenameSessionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkbenchError("INPUT_INVALID", "重命名参数无效。");
  const { title, ...target } = value as Record<string, unknown>;
  const input = deleteSessionRequest(target);
  if (typeof title !== "string" || !title.trim() || title.length > 100) throw new WorkbenchError("NAME_INVALID", "请输入不超过 100 字的会话名称。");
  return { ...input, title: title.trim() };
}

export function runRevisionRequest(value: unknown): RunRevisionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkbenchError("INPUT_INVALID", "运行参数无效。");
  const { expectedRevision, ...identity } = value as Record<string, unknown>;
  const target = runIdentity(identity);
  if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 0) throw new WorkbenchError("INPUT_INVALID", "会话修订号无效。");
  return { ...target, expectedRevision: expectedRevision as number };
}

export function requestString(value: unknown, max = 160, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > max || !allowEmpty && !value.trim()) throw new WorkbenchError("INPUT_INVALID", "请求参数无效。");
  return value;
}

export function preferencesRequest(value: unknown): Preferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkbenchError("INPUT_INVALID", "设置参数无效。");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["revision", "model", "source", "portfolio", "thinkingLevel"].includes(key)))
    throw new WorkbenchError("INPUT_INVALID", "设置包含未支持的字段。");
  if (input.source !== "none" && input.source !== "akshare") throw new WorkbenchError("INPUT_INVALID", "此连接不接受演示数据源。");
  return { revision: requestString(input.revision), model: requestString(input.model, 160, true), source: input.source,
    portfolio: requestString(input.portfolio, 160, true), ...(input.thinkingLevel === undefined ? {} : { thinkingLevel: requestString(input.thinkingLevel, 20, true) }) };
}
