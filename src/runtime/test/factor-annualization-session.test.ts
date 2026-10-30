import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { AppRuntime } from "../../app-runtime.ts";
import type { QuantAgentSession } from "../../agent/src/session.ts";
import { createDefaultSessionDependencies } from "../session-dependencies.ts";
import { createBuiltinTools } from "../../tools/registry.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import type { UIMessage } from "../../types/ui.ts";
import { saveSettings } from "../../storage/index.ts";
import { createEvaluationPriceData, researchEvaluationCase, runResearchEvaluation } from "../evaluation/research-evaluation.ts";
import { createQuantResearchAgent } from "../quant-harness.ts";
import { localProvider } from "./fixtures/local-provider.ts";

const fixture = researchEvaluationCase("stock-factors");
const values = "momentum(2) Latest -0.09489051; reversal(2) Latest 0.09489051; volatility(2) Latest 0.07689683; volume_ratio(20) Latest 1; rsi(14) Latest 48.14814815; sma_deviation(20) Latest 0.04077670。";
const complete = values + "volatility 原值未年化；有明确观察频率与无自相关假设时，可另行按 sqrt(periodsPerYear) 换算年化值。";
const wrong = values + "volatility(2)：日样本标准差不能年化。";
let root: string, previous: string | undefined, proxy: string | undefined;
let server: ReturnType<typeof localProvider>, agent: QuantAgentSession | undefined, runtime: AppRuntime | undefined;
let stop: AbortController, pending: Promise<void> | undefined;
let child: ReturnType<typeof Bun.spawn> | undefined;
const owned = (body: () => Promise<void>) => {
  const task = Promise.resolve().then(body).catch(error => {
    if (!stop.signal.aborted) throw error;
  }).finally(() => {
    if (process.env.WHYJ_ANNUALIZATION_DEADLINE_MARKER) appendFileSync(process.env.WHYJ_ANNUALIZATION_DEADLINE_MARKER, "body-settled\n");
  });
  pending = task; void task.catch(() => {}); return task;
};
let requests: number, answer: string, recoveryAnswer: string | null, inputs: string[];

beforeEach(() => {
  previous = process.env.OHQUANT_DIR; proxy = process.env.NO_PROXY;
  root = mkdtempSync(join(tmpdir(), "whyj-factor-annualization-session-")); process.env.OHQUANT_DIR = root;
  process.env.NO_PROXY = "127.0.0.1,localhost"; requests = 0; inputs = []; agent = undefined; runtime = undefined;
  answer = complete; recoveryAnswer = null; stop = new AbortController(); pending = undefined; child = undefined;
  server = localProvider(async incoming => {
    const payload = await incoming.json() as { messages: Array<{ role: string; content: string }> };
    requests++; inputs.push(JSON.stringify(payload.messages));
    if (process.env.WHYJ_ANNUALIZATION_DEADLINE_MARKER) {
      appendFileSync(process.env.WHYJ_ANNUALIZATION_DEADLINE_MARKER, "provider-start\n");
      await Bun.sleep(3000);
      appendFileSync(process.env.WHYJ_ANNUALIZATION_DEADLINE_MARKER, "provider-done\n");
      return new Response("done");
    }
    let call: { name: string; args: Record<string, unknown> } | undefined;
    if (requests === 1) call = { name: "research_task", args: { action: "read" } };
    if (requests === 2) {
      const result = payload.messages.findLast(item => item.role === "tool" && item.content.includes("\nTask details: "))!;
      const state = JSON.parse(result.content.split("\nTask details: ")[1]!);
      call = { name: "research_task", args: { action: "declare", expectedRevision: state.expectedRevision,
        requestEntryId: state.latestRequest.entryId, task: { id: "factor-methods", goal: "Verify factor methods", scope: {
          symbols: fixture.symbols, market: fixture.market, start: fixture.start, end: fixture.end },
          constraints: { allowedTools: ["compute_factor"], notes: [] }, dataRefs: [], reportRequired: false,
          criteria: fixture.required.map((item, index) => ({ id: `criterion-${index}`, description: "Factor methods", ...item })) } } };
    }
    if (requests >= 3 && requests <= 8) call = { name: "compute_factor", args: fixture.required[requests - 3]!.parameters };
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: `factor-${requests}`, type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.args) } }] }
      : { role: "assistant", content: requests >= 10 && recoveryAnswer !== null ? recoveryAnswer : answer };
    const chunk = { id: "factor-annualization", object: "chat.completion.chunk", created: 0, model: "factor-annualization-test" };
    return new Response([{ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] }]
      .map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  });
  const settings = structuredClone(DEFAULT_SETTINGS); settings.provider = "custom"; settings.model = "factor-annualization-test"; settings.thinkingLevel = "off";
  settings.artifactGeneration.auto = true;
  settings.providers = { custom: { baseUrl: `${server.url}v1`, api: "openai-completions", apiKey: "synthetic-factor-annualization-key" } }; saveSettings(settings);
});
afterEach(async () => {
  const deadline = process.env.WHYJ_ANNUALIZATION_DEADLINE_MARKER ? Number(process.env.WHYJ_ANNUALIZATION_DRAIN_DEADLINE_MS ?? 25000) : 25000;
  const watchdog = setTimeout(() => {
    console.error("Annualization fixture did not drain; stopping the test process before shared state can be reused");
    process.exit(1);
  }, deadline);
  try {
    stop.abort(); agent?.abort();
    if (child && child.exitCode === null) child.kill();
    const closed = server.close();
    await runtime?.shutdown(); await pending?.catch(() => {}); await child?.exited;
    agent?.abort(); await agent?.waitForIdle(); await closed;
    if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
    if (proxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = proxy;
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected factor annualization fixture root");
    rmSync(root, { recursive: true, force: true });
    if (process.env.WHYJ_ANNUALIZATION_DEADLINE_MARKER) appendFileSync(process.env.WHYJ_ANNUALIZATION_DEADLINE_MARKER, "teardown\n");
  } finally { clearTimeout(watchdog); }
}, 30000);
function dependencies() {
  const deps = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions") });
  deps.tools = createBuiltinTools({ analysisData: createEvaluationPriceData("stock-factors") }).filter(tool => tool.name === "compute_factor");
  deps.loadSkills = async () => [];
  return deps;
}

test.each(["correct", "wrong-research", "wrong-recovery"] as const)("factor evaluation keeps real receipts and checks %s after lossy recovery", scenario => owned(async () => {
  if (scenario === "wrong-research") { answer = wrong; recoveryAnswer = complete; }
  if (scenario === "wrong-recovery") recoveryAnswer = wrong;
  const report = await runResearchEvaluation("stock-factors", dependencies(), { maxRequests: 12, signal: stop.signal });
  stop.signal.throwIfAborted();
  expect(report.operations).toHaveLength(6); expect(report.task?.status).toBe("complete");
  expect(report.checks.every(check => check.passed)).toBe(true);
  expect(requests).toBe(10); expect(report.answers).toHaveLength(2); expect(report.passed).toBe(scenario === "correct");
  expect(report.knownClaimViolations).toEqual(scenario === "correct" ? [] : [{ phase: scenario === "wrong-research" ? "research" : "recovery", code: "unsupported-factor-annualization-prohibition" }]);
  // Both the actual tool receipt and lossy-recovery projection must preserve this distinction.
  for (const input of [inputs[8]!, inputs[9]!]) {
    expect(input).toContain("historical return dispersion, one aspect of risk");
    expect(input).toContain("being unannualized does not make it cease to be a risk measure");
    expect(input).toContain("does not measure every kind of risk or predict future losses");
  }
}), 30000);

test.each(["research", "recovery"] as const)("actual runtime preserves an unsupported factor annualization prohibition and pauses report generation in %s", phase => owned(async () => {
  const deps = dependencies(); agent = createQuantResearchAgent({ dependencies: deps });
  const messages: UIMessage[][] = [], report = mock(async () => ({ success: true, message: "synthetic report" }));
  const start = async () => {
    runtime = new AppRuntime({ onMessages: value => messages.push(value), onActivity: () => {} },
      async () => [], async () => [], () => agent!, report, undefined, 1000, 0);
    await runtime.bootstrap();
  };
  await start(); stop.signal.throwIfAborted(); answer = phase === "research" ? wrong : complete;
  await runtime!.submit(fixture.prompt); stop.signal.throwIfAborted();
  const original = structuredClone((await agent.getResearchState()).operations);
  expect(original).toHaveLength(6); expect(report).toHaveBeenCalledTimes(phase === "research" ? 0 : 1);
  const metadata = (await agent.getSessionMetadata())!, stored = await deps.sessions.open(metadata);
  const tail = await stored.appendMessage({ role: "user", content: "稍后继续", timestamp: 0 });
  await stored.appendCompaction("Factor method details deliberately omitted.", tail, 50000);
  await runtime!.shutdown(); stop.signal.throwIfAborted(); agent = createQuantResearchAgent({ dependencies: deps });
  await agent.resumeSession(metadata.id); stop.signal.throwIfAborted(); await start(); stop.signal.throwIfAborted();
  answer = phase === "recovery" ? wrong : complete;
  await runtime!.submit("恢复 AAPL 已完成的六因子研究，保留日期，不重新计算。"); stop.signal.throwIfAborted();
  expect(requests).toBe(10); expect(report).toHaveBeenCalledTimes(1);
  expect((await agent.getResearchState()).operations).toEqual(original);
  expect(messages.flat().some(message => message.role === "assistant" && message.text === wrong)).toBe(true);
  expect(messages.flat().some(message => message.text?.includes("不能笼统禁止年化"))).toBe(true);
  expect((await agent.getSessionEntries()).some(entry => entry.type === "message" && entry.message.role === "assistant"
    && entry.message.content.some(part => part.type === "text" && part.text === wrong))).toBe(true);
  expect(inputs[9]).toContain("compute_factor");
  answer = complete; await runtime!.submit("更正 AAPL 六因子研究的年化解释后继续。");
  stop.signal.throwIfAborted(); expect(requests).toBe(11); expect(report).toHaveBeenCalledTimes(2);
}), 30000);

const deadlineMarker = process.env.WHYJ_ANNUALIZATION_DEADLINE_MARKER;
test.skipIf(!deadlineMarker)("controlled annualization timeout fixture", () => owned(async () => {
  const response = fetch(server.url, { method: "POST", body: JSON.stringify({ messages: [] }) });
  void response.catch(() => {});
  await Bun.sleep(3500); stop.signal.throwIfAborted();
  appendFileSync(deadlineMarker!, "body-done\n");
}), 2000);

test.skipIf(!!deadlineMarker)("timed-out annualization fixture drains its body and provider before teardown", () => owned(async () => {
  const marker = join(root, "deadline-events.txt");
  const launched = Bun.spawn([process.execPath, "test", "src/runtime/test/factor-annualization-session.test.ts", "-t", "controlled annualization timeout fixture"], {
    cwd: resolve(import.meta.dir, "../../.."), env: { ...process.env, WHYJ_ANNUALIZATION_DEADLINE_MARKER: marker }, stdout: "pipe", stderr: "pipe", timeout: 15000,
  });
  child = launched;
  const [code, stdout, stderr] = await Promise.all([launched.exited, new Response(launched.stdout).text(), new Response(launched.stderr).text()]);
  expect(code).toBe(1); expect(stdout + stderr).toContain("timed out");
  expect(stdout + stderr).not.toContain("Unhandled error");
  const events = readFileSync(marker, "utf8").trim().split("\n");
  expect(events).toContain("provider-start"); expect(events).toContain("provider-done"); expect(events).toContain("body-settled");
  expect(events).not.toContain("body-done"); expect(events.at(-1)).toBe("teardown");
  const stuckMarker = join(root, "stuck-deadline-events.txt");
  const stuck = Bun.spawn([process.execPath, "test", "src/runtime/test/factor-annualization-session.test.ts", "-t", "controlled annualization timeout fixture"], {
    cwd: resolve(import.meta.dir, "../../.."), env: { ...process.env, WHYJ_ANNUALIZATION_DEADLINE_MARKER: stuckMarker,
      WHYJ_ANNUALIZATION_DRAIN_DEADLINE_MS: "200" }, stdout: "pipe", stderr: "pipe", timeout: 15000,
  });
  child = stuck;
  const [stuckCode, stuckOut, stuckErr] = await Promise.all([stuck.exited, new Response(stuck.stdout).text(), new Response(stuck.stderr).text()]);
  expect(stuckCode).toBe(1); expect(stuckOut + stuckErr).toContain("Annualization fixture did not drain; stopping the test process");
  const stuckEvents = readFileSync(stuckMarker, "utf8");
  expect(stuckEvents).toContain("provider-start"); expect(stuckEvents).not.toContain("teardown");
}), 30000);
