import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const MAX_REQUESTS = 3, MAX_TOKENS = 64, TIMEOUT_MS = 30_000, MAX_RESPONSE = 1_048_576;
type Status = "passed" | "failed" | "unavailable";
type Env = Record<string, string | undefined>;
export type LiveFetch = (url: string, init: RequestInit) => Promise<Response>;
interface Receipt { version: 1; status: Status; reason: string; provider: string | null; model: string | null; revision: string | null; startedAt: string; durationMs: number; budget: { requests: number; requestedMaxOutputTokensPerRequest: number; timeoutMsPerRequest: number }; requestsAttempted: number; checks: { text: Status; tool: Status } }

/** A fixed, opt-in probe. Provider responses and credentials are never included in its receipt. */
export async function evaluateLiveProvider(env: Env, request: LiveFetch = fetch): Promise<Receipt> {
  const started = performance.now();
  const key = env.WHYJ_LIVE_API_KEY;
  const safeName = (s: string | undefined) => s && (!key || !s.includes(key)) && /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,99}$/.test(s) ? s : null;
  const provider = safeName(env.WHYJ_LIVE_PROVIDER), model = safeName(env.WHYJ_LIVE_MODEL);
  const revision = /^[a-f0-9]{40}$/i.test(env.GITHUB_SHA ?? "") && (!key || !env.GITHUB_SHA!.includes(key)) ? env.GITHUB_SHA! : null;
  const receipt: Receipt = { version: 1, status: "unavailable", reason: "not-opted-in", provider, model, revision,
    startedAt: new Date().toISOString(), durationMs: 0, budget: { requests: MAX_REQUESTS, requestedMaxOutputTokensPerRequest: MAX_TOKENS, timeoutMsPerRequest: TIMEOUT_MS }, requestsAttempted: 0, checks: { text: "unavailable", tool: "unavailable" } };
  const finish = (status: Status, reason: string) => { receipt.status = status; receipt.reason = reason; receipt.durationMs = Math.round(performance.now() - started); return receipt; };
  if (env.WHYJ_LIVE_OPT_IN !== "true") return finish("unavailable", "not-opted-in");
  if (!provider || !model || !env.WHYJ_LIVE_API_KEY || !env.WHYJ_LIVE_BASE_URL || !revision) return finish("unavailable", "missing-or-invalid-configuration");
  let base: URL;
  try { base = new URL(env.WHYJ_LIVE_BASE_URL); } catch { return finish("unavailable", "invalid-endpoint"); }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) return finish("unavailable", "invalid-endpoint");
  const endpoint = `${base.href.replace(/\/+$/, "")}/chat/completions`;
  type Message = Record<string, unknown>;
  async function call(messages: Message[], tool = false): Promise<Record<string, unknown>> {
    if (receipt.requestsAttempted >= MAX_REQUESTS) throw new Error("budget");
    receipt.requestsAttempted++;
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    try {
      const response = await request(endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.WHYJ_LIVE_API_KEY}` }, signal, redirect: "error",
      body: JSON.stringify({ model, messages, max_tokens: MAX_TOKENS, stream: false, ...(tool ? { tools: [{ type: "function", function: { name: "fixture_sum", description: "Add two integers without external data.", parameters: { type: "object", properties: { left: { type: "integer" }, right: { type: "integer" } }, required: ["left", "right"], additionalProperties: false } } }], tool_choice: "required" } : {}) }) });
      if (!response.ok || !response.body) { await response.body?.cancel().catch(() => {}); throw new Error("provider-response"); }
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) { const { done, value } = await reader.read(); signal.throwIfAborted(); if (done) break; size += value.length; if (size > MAX_RESPONSE) throw new Error("response-limit"); chunks.push(value); }
      } finally { await reader.cancel().catch(() => {}); }
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!parsed || typeof parsed !== "object") throw new Error("invalid-response");
      return parsed as Record<string, unknown>;
    } catch (error) {
      if (signal.aborted) throw new DOMException("Timed out", "TimeoutError");
      throw error;
    }
  }
  const message = (payload: Record<string, unknown>): Record<string, unknown> => {
    const choices = payload.choices;
    if (!Array.isArray(choices) || choices.length !== 1 || !choices[0]?.message || typeof choices[0].message !== "object") throw new Error("invalid-response");
    const result = choices[0].message as Record<string, unknown>;
    if (result.role !== "assistant") throw new Error("invalid-response");
    return result;
  };
  try {
    const first = message(await call([{ role: "user", content: "Reply with exactly WHYJ_OK." }]));
    if (typeof first.content !== "string" || first.content.trim() !== "WHYJ_OK") throw new Error("text-mismatch");
    receipt.checks.text = "passed";
    const question: Message = { role: "user", content: "Use fixture_sum to add 2 and 3, then answer only the result." };
    const assistant = message(await call([question], true));
    const calls = assistant.tool_calls;
    if (!Array.isArray(calls) || calls.length !== 1 || typeof calls[0]?.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(calls[0].id) || calls[0]?.function?.name !== "fixture_sum" || typeof calls[0]?.function?.arguments !== "string") throw new Error("tool-call-mismatch");
    const args: unknown = JSON.parse(calls[0].function.arguments);
    if (!args || typeof args !== "object" || Object.keys(args).sort().join(",") !== "left,right" || (args as Record<string, unknown>).left !== 2 || (args as Record<string, unknown>).right !== 3) throw new Error("tool-arguments-mismatch");
    const { left, right } = args as { left: number; right: number };
    const toolResult = String(left + right);
    const safeAssistant = { role: "assistant", content: null, tool_calls: [{ id: calls[0].id, type: "function", function: { name: "fixture_sum", arguments: '{"left":2,"right":3}' } }] };
    const final = message(await call([question, safeAssistant, { role: "tool", tool_call_id: calls[0].id, content: toolResult }]));
    if (typeof final.content !== "string" || final.content.trim() !== toolResult) throw new Error("tool-result-mismatch");
    receipt.checks.tool = "passed";
    return finish("passed", "completed");
  } catch (error) {
    if (receipt.checks.text !== "passed") receipt.checks.text = "failed";
    else receipt.checks.tool = "failed";
    return finish("failed", error instanceof Error && error.name === "TimeoutError" ? "timeout" : "provider-or-validation-failure");
  }
}

if (import.meta.main) {
  const report = await evaluateLiveProvider(process.env);
  const target = resolve(`output/live-provider-eval/${Date.now()}-${process.pid}.json`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(report));
  if (report.status !== "passed") process.exitCode = 1;
}
