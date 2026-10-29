import type { HostConnection } from "../bootstrap.ts";
import type { SubmitResult } from "../../types/workbench.ts";
import type { TerminalClient, TerminalCommandReceipt, TerminalQueueReceipt } from "../../types/terminal.ts";
import { isTerminalContext } from "../../types/terminal.ts";
import { createHostClient, type HostFetch } from "./client.ts";
import { assertCompatibleHost } from "./protocol.ts";
import { tokenizeSlashArguments } from "../../cli/arguments.ts";
import { isAbsolute } from "node:path";
import type { TerminalRestoreReceipt } from "../../types/terminal.ts";

/** Private local capability; ordinary Web clients never receive this constructor's connection. */
export function createTerminalClient(connection: HostConnection, options: { fetch?: HostFetch; retryMs?: number } = {}): TerminalClient {
  assertCompatibleHost(connection, connection.workspaceId);
  const request = options.fetch ?? globalThis.fetch;
  const client = createHostClient({ ...options, baseUrl: connection.url, connection });
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item);
  async function invoke(method: "submit" | "followup" | "continue" | "command" | "cancelCommand" | "context" | "enqueue" | "suggestReferences" | "restoreReport" | "submitResearch", input: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await request(new URL("/api/host/terminal", connection.url), {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(method === "command" || method === "restoreReport" ? 310_000 : 30_000),
        headers: { "content-type": "application/json", "x-workbench-token": connection.token,
          "x-host-control-token": connection.controlToken, "x-host-instance-id": connection.instanceId },
        body: JSON.stringify({ instanceId: connection.instanceId, method, input }),
      });
    } catch { throw new Error("Terminal request outcome is unknown; reconnect and inspect the run before submitting again."); }
    let value: unknown;
    try { value = await response.json(); } catch { throw new Error("Terminal response is invalid; inspect the run before submitting again."); }
    if (!response.ok || !object(value) || value.ok !== true || !Object.hasOwn(value, "result")) {
      const error = object(value) && object(value.error) ? value.error : undefined;
      throw Object.assign(new Error(typeof error?.message === "string" ? error.message.slice(0, 500) : "Terminal Host refused the request."),
        typeof error?.code === "string" && /^[A-Z_]{1,80}$/.test(error.code) ? { code: error.code } : {});
    }
    return value.result;
  }
  async function execute(method: "submit" | "followup" | "continue" | "submitResearch", input: unknown): Promise<SubmitResult> {
    const result = await invoke(method, input);
    if (!object(result) || typeof result.sessionId !== "string" || !result.sessionId || result.sessionId.length > 160
      || typeof result.runId !== "string" || !result.runId || result.runId.length > 160
      || result.sessionId !== (object(input) ? input.sessionId : undefined)) throw new Error("Terminal Host refused the request.");
    return { sessionId: result.sessionId, runId: result.runId };
  }
  return { ...client, submit: input => execute("submit", input), followup: input => execute("followup", input), continue: input => execute("continue", input),
    submitResearch: input => execute("submitResearch", input),
    async suggestReferences(input) {
      const result = await invoke("suggestReferences", input);
      if (!object(result) || result.workspaceId !== connection.workspaceId || result.sessionId !== input.sessionId
        || !(result.runId === null || typeof result.runId === "string" && result.runId.length > 0 && result.runId.length <= 160)
        || !Array.isArray(result.items) || result.items.some(item => !object(item) || !["file", "session", "evidence"].includes(String(item.kind))
          || typeof item.label !== "string" || typeof item.fill !== "string"))
        throw new Error("Terminal reference response is invalid; reconnect before using it.");
      return { workspaceId: connection.workspaceId, sessionId: input.sessionId, runId: result.runId,
        items: result.items.map(item => ({ kind: item.kind, label: item.label, fill: item.fill })) };
    },
    async enqueue(input) {
      const receipt = await invoke("enqueue", input);
      if (!object(receipt) || receipt.workspaceId !== connection.workspaceId || receipt.sessionId !== input.sessionId
        || receipt.runId !== input.runId || receipt.requestId !== input.requestId || !["steer", "followUp"].includes(String(receipt.mode)))
        throw new Error("Terminal queue receipt is invalid; inspect the run before trying again.");
      return receipt as unknown as TerminalQueueReceipt;
    },
    async context(input) {
      const result = await invoke("context", { workspaceId: input.workspaceId, sessionId: input.sessionId });
      if (!isTerminalContext(result) || result.session.identity.workspaceId !== connection.workspaceId || result.session.identity.sessionId !== input.sessionId)
        throw new Error("Terminal context response is invalid; reconnect before displaying it.");
      return result;
    },
    async command(input) {
      const receipt = await invoke("command", input);
      const command = tokenizeSlashArguments(input.text.trim().slice(1));
      const clear = !command.error && command.tokens.length === 1 && command.tokens[0]?.value === "clear";
      const effects = clear ? ["clearConversation", "resetAgent"] : ["compactSession", "sessionChanged", "openResume"];
      if (!object(receipt) || receipt.workspaceId !== connection.workspaceId || receipt.sessionId !== input.sessionId || receipt.requestId !== input.requestId
        || receipt.selectedSessionId !== undefined && (typeof receipt.selectedSessionId !== "string" || !receipt.selectedSessionId || receipt.selectedSessionId.length > 160)
        || !Number.isSafeInteger(receipt.revision) || Number(receipt.revision) < 0 || !object(receipt.result)
        || typeof receipt.result.success !== "boolean" || typeof receipt.result.message !== "string"
        || receipt.result.effects !== undefined && (!Array.isArray(receipt.result.effects) || receipt.result.effects.some(effect => !object(effect) || !effects.includes(String(effect.type)))))
        throw new Error("Terminal command response is invalid; inspect the session before trying again.");
      return receipt as unknown as TerminalCommandReceipt;
    },
    async restoreReport(input) {
      const receipt = await invoke("restoreReport", input);
      if (!object(receipt) || receipt.workspaceId !== connection.workspaceId || receipt.sessionId !== input.sessionId || receipt.requestId !== input.requestId
        || !Number.isSafeInteger(receipt.revision) || Number(receipt.revision) < 0 || !object(receipt.result)
        || typeof receipt.result.success !== "boolean" || typeof receipt.result.message !== "string"
        || receipt.result.effects !== undefined && (!Array.isArray(receipt.result.effects) || receipt.result.effects.some(effect => !object(effect) || effect.type !== "sessionChanged"))
        || receipt.result.success && (typeof receipt.selectedSessionId !== "string" || !receipt.selectedSessionId || receipt.selectedSessionId.length > 160
          || typeof receipt.filePath !== "string" || !isAbsolute(receipt.filePath) || receipt.filePath.length > 4096 || receipt.filePath.includes("\0"))
        || !receipt.result.success && (receipt.selectedSessionId !== undefined || receipt.filePath !== undefined))
        throw new Error("Terminal report receipt is invalid; inspect the session before trying again.");
      return receipt as unknown as TerminalRestoreReceipt;
    },
    async cancelCommand(input) { await invoke("cancelCommand", input); },
  };
}
