import type { Preferences, WorkbenchClient } from "../../types/workbench.ts";
import { WorkbenchError } from "./errors.ts";

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
    case "refreshMarket": count(1); {
      if (typeof args[0] !== "boolean") throw new WorkbenchError("INPUT_INVALID", "重试参数无效。");
      if (!client.refreshMarket) throw new WorkbenchError("UNAVAILABLE", "此连接不支持行情刷新。");
      return client.refreshMarket(args[0]);
    }
    case "createSession": count(0); return client.createSession();
    case "session": count(1); return client.session(string(args[0]));
    case "transcript": count(1); return client.transcript(string(args[0]));
    case "output": count(1); return client.output(string(args[0]));
    case "cancel": count(1); return client.cancel(string(args[0]));
    case "acknowledgeInterruption": count(1); {
      if (!client.acknowledgeInterruption) throw new WorkbenchError("UNAVAILABLE", "当前服务不支持恢复确认。");
      return client.acknowledgeInterruption(string(args[0]));
    }
    case "renameSession": count(2); return client.renameSession(string(args[0]), string(args[1], 100));
    case "references": count(2); return client.references(string(args[0]), string(args[1], 1000));
    case "submit": {
      count(1); const value = object(args[0]); keys(value, ["workspaceId", "sessionId", "text"]);
      return client.submit({ workspaceId: string(value.workspaceId), sessionId: string(value.sessionId), text: string(value.text, 16000) });
    }
    case "updatePreferences": {
      count(1); const value = object(args[0]); keys(value, ["revision", "model", "thinkingLevel", "source", "portfolio", "researchSource"]);
      if (value.source !== "none" && value.source !== "akshare") throw new WorkbenchError("INPUT_INVALID", "此连接不接受演示数据源。");
      return client.updatePreferences({ revision: string(value.revision), model: string(value.model), source: value.source,
        portfolio: string(value.portfolio), ...(value.thinkingLevel === undefined ? {} : { thinkingLevel: string(value.thinkingLevel, 20) }),
        ...(value.researchSource === undefined ? {} : { researchSource: string(value.researchSource, 30) as NonNullable<Preferences["researchSource"]> }) });
    }
    default: throw new WorkbenchError("METHOD_NOT_FOUND", "此连接不支持该操作。", 404);
  }
}
