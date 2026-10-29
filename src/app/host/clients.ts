import { randomUUID } from "node:crypto";
import { WorkbenchError } from "../workbench/errors.ts";

/** Expiry releases presence only. It never cancels an Agent or stops the Host. */
export function createHostClients(instanceId: string, now = Date.now) {
  const clients = new Map<string, number>(), lifetime = 90_000;
  function count() {
    for (const [id, expires] of clients) if (expires <= now()) clients.delete(id);
    return clients.size;
  }
  return { count, clear: () => clients.clear(), update(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkbenchError("INPUT_INVALID", "客户端登记参数无效。");
    const input = value as Record<string, unknown>;
    if (input.instanceId !== instanceId) throw new WorkbenchError("HOST_INSTANCE_CHANGED", "后端实例已变化，请重新连接。", 409);
    count();
    if (input.action === "attach" && ["web", "tui", "desktop"].includes(String(input.kind))
      && Object.keys(input).every(key => ["action", "instanceId", "kind"].includes(key))) {
      if (clients.size >= 128) throw new WorkbenchError("HOST_CLIENT_LIMIT", "客户端登记已达上限。", 429);
      const clientId = randomUUID(), expiresAt = now() + lifetime;
      clients.set(clientId, expiresAt);
      return { clientId, expiresAt, instanceId };
    }
    if (["renew", "detach"].includes(String(input.action)) && typeof input.clientId === "string"
      && Object.keys(input).every(key => ["action", "instanceId", "clientId"].includes(key))) {
      if (input.action === "detach") { clients.delete(input.clientId); return { detached: true, instanceId }; }
      if (!clients.has(input.clientId)) throw new WorkbenchError("HOST_CLIENT_EXPIRED", "客户端登记已失效，请重新登记。", 409);
      const expiresAt = now() + lifetime; clients.set(input.clientId, expiresAt);
      return { clientId: input.clientId, expiresAt, instanceId };
    }
    throw new WorkbenchError("INPUT_INVALID", "客户端登记参数无效。");
  } };
}
