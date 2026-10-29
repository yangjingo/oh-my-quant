import type { HostRegistration } from "../../storage/index.ts";

export const HOST_PROTOCOL_VERSION = 1;
export const HOST_SERVICE_CONTRACT_VERSION = 1;
export const HOST_READY_TIMEOUT_MS = 15_000;

export function publicHostIdentity(entry: HostRegistration) {
  return { workspaceId: entry.workspaceId, instanceId: entry.instanceId, url: entry.url,
    protocolVersion: entry.protocolVersion, serviceContractVersion: entry.serviceContractVersion,
    applicationVersion: entry.applicationVersion };
}

export function assertCompatibleHost(entry: ReturnType<typeof publicHostIdentity>, workspaceId: string) {
  if (entry.workspaceId !== workspaceId || entry.protocolVersion !== HOST_PROTOCOL_VERSION
    || entry.serviceContractVersion !== HOST_SERVICE_CONTRACT_VERSION) {
    throw Object.assign(new Error("The workspace Host uses a different workspace or protocol/service contract. Stop that Host explicitly before upgrading."), { code: "HOST_INCOMPATIBLE" });
  }
}
