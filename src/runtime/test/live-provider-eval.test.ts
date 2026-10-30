import { expect, it, spyOn } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { evaluateLiveProvider, type LiveFetch } from "../dev/live-provider-eval.ts";

const configured = { WHYJ_LIVE_OPT_IN: "true", WHYJ_LIVE_PROVIDER: "fixture", WHYJ_LIVE_MODEL: "fixture-model", WHYJ_LIVE_BASE_URL: "https://provider.example/v1", WHYJ_LIVE_API_KEY: "fixture-private-key", GITHUB_SHA: "a".repeat(40) };
const reply = (message: object) => Response.json({ choices: [{ message }] });

it("keeps live evaluation manual, disabled by default and separate from PR workflows", () => {
  const workflow = parse(readFileSync(new URL("../../../.github/workflows/live-provider-evaluation.yml", import.meta.url), "utf8"));
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.on.workflow_dispatch.inputs.run_live.default).toBe(false);
  expect(workflow.jobs.evaluate.if).toContain("inputs.run_live");
  expect(workflow.jobs.evaluate.if).toContain("refs/heads/main");
});

it("never calls a provider without explicit opt-in or complete configuration", async () => {
  let calls = 0;
  const fetcher: LiveFetch = async () => { calls++; throw new Error("must not call"); };
  const disabled = await evaluateLiveProvider({ ...configured, WHYJ_LIVE_OPT_IN: "false" }, fetcher);
  const missing = await evaluateLiveProvider({ ...configured, WHYJ_LIVE_API_KEY: "" }, fetcher);
  expect(disabled).toMatchObject({ status: "unavailable", reason: "not-opted-in", requestsAttempted: 0 });
  expect(missing).toMatchObject({ status: "unavailable", reason: "missing-or-invalid-configuration", requestsAttempted: 0 });
  expect(calls).toBe(0);
});

it("writes an unavailable receipt and exits nonzero from the actual command", async () => {
  const script = fileURLToPath(new URL("../dev/live-provider-eval.ts", import.meta.url));
  for (const overrides of [{ WHYJ_LIVE_OPT_IN: "false" }, { WHYJ_LIVE_API_KEY: "" }]) {
    const tempRoot = resolve(tmpdir());
    const cwd = mkdtempSync(join(tempRoot, "whyj-live-eval-"));
    if (dirname(cwd) !== tempRoot || !basename(cwd).startsWith("whyj-live-eval-")) throw new Error("Unexpected temporary path");
    try {
      const child = Bun.spawn({ cmd: [process.execPath, script], cwd,
        env: { ...process.env, ...configured, ...overrides }, stdout: "pipe", stderr: "pipe" });
      const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exitCode).toBe(1);
      expect(stderr).toBe("");
      const files = readdirSync(join(cwd, "output", "live-provider-eval"));
      expect(files).toHaveLength(1);
      const contents = readFileSync(join(cwd, "output", "live-provider-eval", files[0]!), "utf8");
      const report = JSON.parse(contents);
      expect(report).toEqual(JSON.parse(stdout));
      expect(report).toMatchObject({ status: "unavailable", requestsAttempted: 0 });
      expect(contents).not.toContain(configured.WHYJ_LIVE_API_KEY);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

it("does not emit a credential accidentally placed in identity fields", async () => {
  const key = "fixture-private-key";
  for (const field of ["WHYJ_LIVE_PROVIDER", "WHYJ_LIVE_MODEL"] as const) {
    const report = await evaluateLiveProvider({ ...configured, [field]: key }, async () => { throw new Error("must not call"); });
    expect(JSON.stringify(report)).not.toContain(key);
    expect(report).toMatchObject({ status: "unavailable", requestsAttempted: 0 });
  }
  const keyMatchingRevision = "a".repeat(40);
  const report = await evaluateLiveProvider({ ...configured, WHYJ_LIVE_API_KEY: keyMatchingRevision }, async () => { throw new Error("must not call"); });
  expect(JSON.stringify(report)).not.toContain(keyMatchingRevision);
  expect(report).toMatchObject({ status: "unavailable", requestsAttempted: 0 });
});

it.each(["http://provider.example/v1", "https://user:pass@provider.example/v1", "https://provider.example/v1?token=secret"])("rejects unsafe endpoint %s", async endpoint => {
  const report = await evaluateLiveProvider({ ...configured, WHYJ_LIVE_BASE_URL: endpoint }, async () => { throw new Error("must not call"); });
  expect(report).toMatchObject({ status: "unavailable", reason: "invalid-endpoint", requestsAttempted: 0 });
});

it("runs exactly three bounded requests and a single fixed local tool without persisting responses or credentials", async () => {
  const requests: Record<string, unknown>[] = [];
  const fetcher: LiveFetch = async (_url, init) => {
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-private-key");
    expect(init.redirect).toBe("error");
    requests.push(JSON.parse(String(init?.body)));
    if (requests.length === 1) return reply({ role: "assistant", content: "WHYJ_OK" });
    if (requests.length === 2) return reply({ role: "assistant", content: "private-response-text", tool_calls: [{ id: "call_1", type: "function", function: { name: "fixture_sum", arguments: '{"left":2,"right":3}' } }] });
    return reply({ role: "assistant", content: "5" });
  };
  const report = await evaluateLiveProvider(configured, fetcher);
  expect(report).toMatchObject({ status: "passed", requestsAttempted: 3, checks: { text: "passed", tool: "passed" }, budget: { requests: 3, requestedMaxOutputTokensPerRequest: 64, timeoutMsPerRequest: 30000 } });
  expect(requests.every(body => body.max_tokens === 64)).toBe(true);
  expect((requests[2]!.messages as Array<Record<string, unknown>>).at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_1", content: "5" });
  expect(JSON.stringify(requests[2])).not.toContain("private-response-text");
  expect(JSON.stringify(report)).not.toContain("fixture-private-key");
  expect(JSON.stringify(report)).not.toContain("private-response-text");
});

it("performs the fixed round trip over a disposable loopback HTTP fixture", async () => {
  let calls = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    calls++;
    expect(req.headers.get("authorization")).toBe("Bearer fixture-private-key");
    const body = await req.json() as Record<string, unknown>;
    expect(body.max_tokens).toBe(64);
    if (calls === 1) return reply({ role: "assistant", content: "WHYJ_OK" });
    if (calls === 2) return reply({ role: "assistant", tool_calls: [{ id: "fixture_call", type: "function", function: { name: "fixture_sum", arguments: '{"left":2,"right":3}' } }] });
    return reply({ role: "assistant", content: "5" });
  } });
  try {
    const report = await evaluateLiveProvider(configured, (_url, init) => fetch(server.url, init));
    expect(report.status).toBe("passed");
    expect(calls).toBe(3);
  } finally { server.stop(true); }
});

it("reports a timeout without leaking the provider error", async () => {
  const spy = spyOn(AbortSignal, "timeout").mockImplementation(() => {
    const c = new AbortController(); setTimeout(() => c.abort(new DOMException("fixture-private-key", "TimeoutError")), 10); return c.signal;
  });
  try {
    const report = await evaluateLiveProvider(configured, (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("fixture-private-key")), { once: true })));
    expect(report).toMatchObject({ status: "failed", reason: "timeout", requestsAttempted: 1, checks: { text: "failed", tool: "unavailable" } });
    expect(JSON.stringify(report)).not.toContain("fixture-private-key");
  } finally { spy.mockRestore(); }
});

it("bounds a stalled loopback HTTP response without contacting a live provider", async () => {
  let finishHandler!: () => void;
  const settled = new Promise<void>(resolve => { finishHandler = resolve; });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 1000);
      req.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    finishHandler();
    return reply({ role: "assistant", content: "WHYJ_OK" });
  } });
  const spy = spyOn(AbortSignal, "timeout").mockImplementation(() => {
    const c = new AbortController(); setTimeout(() => c.abort(new DOMException("Timed out", "TimeoutError")), 250); return c.signal;
  });
  try {
    const report = await evaluateLiveProvider(configured, (_url, init) => fetch(server.url, init));
    expect(report).toMatchObject({ status: "failed", reason: "timeout", requestsAttempted: 1 });
    await settled;
  } finally { spy.mockRestore(); server.stop(true); }
}, 3000);

it("fails closed on provider errors, unexpected tool arguments, and oversized responses", async () => {
  for (const fetcher of [async () => new Response("private error fixture-private-key", { status: 403 }), async () => new Response("x".repeat(1_048_577))] as LiveFetch[]) {
    const report = await evaluateLiveProvider(configured, fetcher);
    expect(report.status).toBe("failed"); expect(report.requestsAttempted).toBe(1);
    expect(JSON.stringify(report)).not.toContain("fixture-private-key");
  }
  let calls = 0;
  const report = await evaluateLiveProvider(configured, async () => ++calls === 1 ? reply({ role: "assistant", content: "WHYJ_OK" }) : reply({ role: "assistant", tool_calls: [{ id: "1", function: { name: "fixture_sum", arguments: '{"left":9,"right":3}' } }] }));
  expect(report).toMatchObject({ status: "failed", requestsAttempted: 2, checks: { text: "passed", tool: "failed" } });
});
