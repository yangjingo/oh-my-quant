import { expect, test } from "bun:test";
import { createSmokeRpcDiagnostics } from "../dev/smoke-rpc-diagnostics.ts";

test("RPC diagnostics preserve failures and report only the supplied safe context", async () => {
  const messages: string[] = [];
  const request = createSmokeRpcDiagnostics(() => ({ host: "alive", modelRequests: 2 }), message => messages.push(message));
  const transport = Object.assign(new Error("PRIVATE_REQUEST_BODY"), { code: "ECONNRESET" });
  const body = new Error("PRIVATE_RESPONSE_BODY");
  for (const [phase, failure] of [["rpc-rejected:suggestReferences", transport], ["oversized-buffer:body", body]] as const) {
    await expect(request(phase, async () => { throw failure; })).rejects.toBe(failure);
  }
  expect(messages.map(message => JSON.parse(message))).toEqual([
    { diagnostic: "packaged-rpc", phase: "rpc-rejected:suggestReferences", host: "alive", modelRequests: 2 },
    { diagnostic: "packaged-rpc", phase: "oversized-buffer:body", host: "alive", modelRequests: 2 },
  ]);
  expect(messages.join("\n")).not.toContain("PRIVATE_");
  expect(await request("success", async () => 42)).toBe(42);
  expect(messages).toHaveLength(2);
});

test("diagnostic failures do not replace the original RPC failure", async () => {
  const original = new Error("original");
  for (const request of [
    createSmokeRpcDiagnostics(() => { throw new Error("context failure"); }),
    createSmokeRpcDiagnostics(() => ({ host: "alive", modelRequests: 0 }), () => { throw new Error("logger failure"); }),
  ]) await expect(request("phase", async () => { throw original; })).rejects.toBe(original);
});
