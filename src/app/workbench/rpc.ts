import type { WorkbenchClient } from "../../types/workbench.ts";
import { WorkbenchError } from "./errors.ts";
import { artifactRequest, deleteSessionRequest, nextRunRequest, preferencesRequest, renameSessionRequest, requestString, reviewRequest, runIdentity, runRevisionRequest, saveRequest, submitRequest } from "../services/requests.ts";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkbenchError("INPUT_INVALID", "请求参数无效。");
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 160) {
  if (typeof value !== "string" || value.length > max) throw new WorkbenchError("INPUT_INVALID", "请求参数无效。");
  return value;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new WorkbenchError("INPUT_INVALID", "请求包含未支持的字段。");
}

/** Explicit dispatch: browser input cannot choose an object property or call arbitrary service methods. */
export async function dispatchWorkbench(client: WorkbenchClient, payload: unknown) {
  const request = object(payload); keys(request, ["method", "args"]);
  const method = string(request.method), args = request.args;
  if (!Array.isArray(args)) throw new WorkbenchError("INPUT_INVALID", "请求参数无效。");
  const count = (length: number) => { if (args.length !== length) throw new WorkbenchError("INPUT_INVALID", "请求参数数量无效。"); };
  switch (method) {
    case "identity": count(0); return client.identity();
    case "workspaces": count(0); return client.workspaces();
    case "preferences": count(0); return client.preferences();
    case "market": count(0); return client.market();
    case "createSession": count(0); return client.createSession();
    case "session": count(1); return client.session(requestString(args[0]));
    case "transcript": count(1); return client.transcript(requestString(args[0]));
    case "output": count(1); return client.output(requestString(args[0]));
    case "cancel": count(1); return client.cancel(runIdentity(args[0]));
    case "acknowledgeInterruption": count(1); {
      if (!client.acknowledgeInterruption) throw new WorkbenchError("UNAVAILABLE", "当前服务不支持恢复确认。");
      return client.acknowledgeInterruption(runRevisionRequest(args[0]));
    }
    case "renameSession": count(1); return client.renameSession(renameSessionRequest(args[0]));
    case "references": count(2); return client.references(requestString(args[0]), requestString(args[1], 1000, true));
    case "submit": {
      count(1); return client.submit(submitRequest(args[0]));
    }
    case "continue": {
      count(1); const input = nextRunRequest(args[0], "continue");
      if (!client.continue) throw new WorkbenchError("UNAVAILABLE", "当前服务不支持继续操作。");
      return client.continue(input);
    }
    case "followup": {
      count(1); const input = nextRunRequest(args[0], "followup");
      if (!client.followup) throw new WorkbenchError("UNAVAILABLE", "当前服务不支持追问操作。");
      return client.followup(input);
    }
    case "save": {
      count(1); const input = saveRequest(args[0]);
      if (!client.save) throw new WorkbenchError("UNAVAILABLE", "当前服务不支持报告保存。");
      return client.save(input);
    }
    case "reload": {
      count(1); const input = artifactRequest(args[0]);
      if (!client.reload) throw new WorkbenchError("UNAVAILABLE", "当前服务不支持固定报告重开。");
      return client.reload(input);
    }
    case "review": {
      count(1); const input = reviewRequest(args[0]);
      if (!client.review) throw new WorkbenchError("UNAVAILABLE", "当前服务不支持独立复核。");
      return client.review(input);
    }
    case "deleteSession": {
      count(1); const input = deleteSessionRequest(args[0]);
      if (!client.deleteSession) throw new WorkbenchError("UNAVAILABLE", "当前服务不支持会话删除。");
      return client.deleteSession(input);
    }
    case "updatePreferences": {
      count(1); return client.updatePreferences(preferencesRequest(args[0]));
    }
    default: throw new WorkbenchError("METHOD_NOT_FOUND", "此连接不支持该操作。", 404);
  }
}
