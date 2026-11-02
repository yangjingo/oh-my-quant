import { HOST_MAX_REQUEST_BYTES } from "../../types/workbench-host.ts";

/** Isolate only requests the Host will reject; never retry an operation. */
export function terminalRequestConnection(body: string): Pick<RequestInit, "keepalive"> {
  return new TextEncoder().encode(body).byteLength > HOST_MAX_REQUEST_BYTES ? { keepalive: false } : {};
}
