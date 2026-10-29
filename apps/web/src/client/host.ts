import { createHostClient as createSharedHostClient } from "../../../../src/app/host/client";

/** Browser-specific origin selection; HTTP/SSE behavior is shared with terminal clients. */
export function createHostClient(options: { baseUrl?: string; fetch?: typeof fetch; retryMs?: number } = {}) {
  return createSharedHostClient({ ...options, baseUrl: options.baseUrl ?? location.origin });
}
