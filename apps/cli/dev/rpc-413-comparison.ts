type FetchRequest = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type Rpc413Counts = {
  streaming: boolean;
  reuse: boolean;
  attempts: number;
  oversized413: number;
  identity200: number;
  oversizedResets: number;
  identityResets: number;
  unexpected: number;
};

/** Compare a deliberately oversized request with and without connection reuse. */
export async function compareRpc413(fetchRequest: FetchRequest, input: string | URL | Request, init: RequestInit,
  reuse: boolean, report: (counts: Rpc413Counts) => void, iterations = 20): Promise<void> {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 20) throw new Error("Invalid comparison iteration count");
  const { keepalive: _keepalive, body: _body, signal: _signal, ...request } = init;
  let failed = false;
  for (const streaming of [false, true]) {
    const counts: Rpc413Counts = { streaming, reuse, attempts: 0, oversized413: 0, identity200: 0,
      oversizedResets: 0, identityResets: 0, unexpected: 0 };
    for (let attempt = 0; attempt < iterations; attempt++) {
      let phase: "oversized" | "identity" = "oversized";
      try {
        const bytes = new Uint8Array(32769).fill(32);
        const body = streaming ? new ReadableStream<Uint8Array>({ start(controller) {
          controller.enqueue(bytes.subarray(0, 16000)); controller.enqueue(bytes.subarray(16000)); controller.close();
        } }) : bytes;
        const rejected = await fetchRequest(input, { ...request, body, ...(reuse ? {} : { keepalive: false }), signal: AbortSignal.timeout(5000) });
        if (rejected.status === 413) counts.oversized413++; else counts.unexpected++;
        await rejected.text();
        phase = "identity";
        const identity = await fetchRequest(input, { method: "POST", headers: request.headers,
          body: JSON.stringify({ method: "identity", args: [] }), signal: AbortSignal.timeout(5000) });
        if (identity.status === 200) counts.identity200++; else counts.unexpected++;
        await identity.text();
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ECONNRESET") {
          if (phase === "oversized") counts.oversizedResets++; else counts.identityResets++;
        } else counts.unexpected++;
      }
      counts.attempts++;
    }
    report(counts);
    if (counts.unexpected || (!reuse && (counts.oversizedResets || counts.identityResets || counts.oversized413 !== iterations || counts.identity200 !== iterations))) failed = true;
  }
  if (failed) throw new Error("Packaged Host 413 comparison failed; see aggregate counts");
}
