import { expect, test } from "bun:test";
import { compareRpc413, type Rpc413Counts } from "../dev/rpc-413-comparison.ts";

test("413 comparison exercises both input forms and preserves the no-reuse control", async () => {
  const calls: RequestInit[] = [], reports: Rpc413Counts[] = [];
  for (const reuse of [false, true]) await compareRpc413(async (_input, init) => {
    calls.push(init!);
    return new Response("", { status: typeof init?.body === "string" ? 200 : 413 });
  }, "http://synthetic.invalid", { method: "POST", headers: { token: "PRIVATE" }, keepalive: false }, reuse, value => reports.push(value), 1);
  expect(reports.map(({ streaming, reuse, oversized413, identity200 }) => [streaming, reuse, oversized413, identity200])).toEqual([
    [false, false, 1, 1], [true, false, 1, 1], [false, true, 1, 1], [true, true, 1, 1],
  ]);
  expect(calls.filter(call => typeof call.body !== "string").map(call => call.keepalive)).toEqual([false, false, undefined, undefined]);
  expect(calls.every(call => call.signal instanceof AbortSignal)).toBe(true);
  expect(JSON.stringify(reports)).not.toContain("PRIVATE");
});

test("experimental reuse resets are counted but a control reset or unexpected error fails", async () => {
  const reports: Rpc413Counts[] = [];
  let first = true;
  await compareRpc413(async (_input, init) => {
    if (first) { first = false; throw Object.assign(new Error("private"), { code: "ECONNRESET" }); }
    return new Response("", { status: typeof init?.body === "string" ? 200 : 413 });
  }, "http://synthetic.invalid", { method: "POST" }, true, value => reports.push(value), 1);
  expect(reports[0]!.oversizedResets).toBe(1);
  expect(JSON.stringify(reports)).not.toContain("private");
  let resetIdentity = true;
  const identityReports: Rpc413Counts[] = [];
  await compareRpc413(async (_input, init) => {
    if (resetIdentity && typeof init?.body === "string") {
      resetIdentity = false; throw Object.assign(new Error("private"), { code: "ECONNRESET" });
    }
    return new Response("", { status: typeof init?.body === "string" ? 200 : 413 });
  }, "http://synthetic.invalid", { method: "POST" }, true, value => identityReports.push(value), 1);
  expect(identityReports[0]!.identityResets).toBe(1);
  await expect(compareRpc413(async (_input, init) => {
    if (init?.keepalive === false) throw Object.assign(new Error("private"), { code: "ECONNRESET" });
    return new Response("", { status: typeof init?.body === "string" ? 200 : 413 });
  }, "http://synthetic.invalid", { method: "POST" }, false, () => {}, 1)).rejects.toThrow("comparison failed");
  await expect(compareRpc413(async () => { throw new Error("private"); }, "http://synthetic.invalid",
    { method: "POST" }, true, () => {}, 1)).rejects.toThrow("comparison failed");
  await expect(compareRpc413(async () => new Response(), "http://synthetic.invalid",
    { method: "POST" }, false, () => {}, 21)).rejects.toThrow("iteration count");
});
