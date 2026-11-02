import { compareRpc413 } from "./rpc-413-comparison.ts";

// This preload is used only by the explicitly requested isolated CI probe.
const originalFetch = globalThis.fetch;
const mode = process.env.WHYJ_RPC_413_REUSE;
if (mode !== "true" && mode !== "false") throw new Error("Set WHYJ_RPC_413_REUSE to true or false");
let sampled = false;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!sampled && url.endsWith("/api/workbench/rpc") && init?.body instanceof Uint8Array && init.body.length === 32769) {
    sampled = true;
    await compareRpc413(originalFetch, input, init, mode === "true", counts => console.log("PACKAGED_HOST_413_PROBE " + JSON.stringify(counts)));
  }
  return originalFetch(input, init);
}) as typeof fetch;

process.on("exit", () => {
  if (!sampled) {
    console.error("Packaged Host 413 comparison did not reach the target request");
    process.exitCode = 1;
  }
});
