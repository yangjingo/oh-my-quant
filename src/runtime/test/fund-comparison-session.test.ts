import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { AppRuntime } from "../../app-runtime.ts";
import type { QuantAgentSession } from "../../agent/src/session.ts";
import { createDefaultSessionDependencies } from "../session-dependencies.ts";
import { createBuiltinTools } from "../../tools/registry.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import type { UIMessage } from "../../types/ui.ts";
import { saveSettings } from "../../storage/index.ts";
import { createEvaluationFundData, researchEvaluationCase, runResearchEvaluation } from "../evaluation/research-evaluation.ts";
import { createQuantResearchAgent } from "../quant-harness.ts";
import { localProvider } from "./fixtures/local-provider.ts";

const fixture = researchEvaluationCase("fund");
const complete = "Principal return 25.00%; Time-weighted return 50.00%; Maximum drawdown (TWR) 0.00%。TWR 与未对齐的基金或基准不可直接比较。";
const wrong = "Principal return 25.00%; Time-weighted return 50.00%; Maximum drawdown (TWR) 0.00%。TWR 可与其它基金或基准直接比较。";
let root: string, previous: string | undefined, proxy: string | undefined;
let server: ReturnType<typeof localProvider>, agent: QuantAgentSession | undefined, runtime: AppRuntime | undefined;
let requests: number, answer: string, recoveryAnswer: string | null, inputs: string[];
let stop: AbortController, pending: Promise<void> | undefined;
const owned = (body: () => Promise<void>) => pending = body();

beforeEach(() => {
  previous = process.env.OHQUANT_DIR; proxy = process.env.NO_PROXY;
  root = mkdtempSync(join(tmpdir(), "whyj-fund-comparison-session-")); process.env.OHQUANT_DIR = root;
  process.env.NO_PROXY = "127.0.0.1,localhost"; requests = 0; inputs = []; agent = undefined; runtime = undefined;
  answer = complete; recoveryAnswer = null;
  stop = new AbortController(); pending = undefined;
  server = localProvider(async incoming => {
    const payload = await incoming.json() as { messages: Array<{ role: string; content: string }> };
    requests++; inputs.push(JSON.stringify(payload.messages));
    let call: { name: string; args: Record<string, unknown> } | undefined;
    if (requests === 1) call = { name: "research_task", args: { action: "read" } };
    if (requests === 2) {
      const result = payload.messages.findLast(item => item.role === "tool" && item.content.includes("\nTask details: "))!;
      const state = JSON.parse(result.content.split("\nTask details: ")[1]!);
      call = { name: "research_task", args: { action: "declare", expectedRevision: state.expectedRevision,
        requestEntryId: state.latestRequest.entryId, task: { id: "fund-methods", goal: "Verify fund methods", scope: {
          symbols: fixture.symbols, market: fixture.market, start: fixture.start, end: fixture.end },
          constraints: { allowedTools: ["fund_dca_backtest"], notes: [] }, dataRefs: [], reportRequired: false,
          criteria: fixture.required.map((item, index) => ({ id: `criterion-${index}`, description: "Fund return methods", ...item })) } } };
    }
    if (requests === 3) call = { name: "fund_dca_backtest", args: fixture.required[0]!.parameters };
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: `fund-${requests}`, type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.args) } }] }
      : { role: "assistant", content: requests >= 5 && recoveryAnswer !== null ? recoveryAnswer : answer };
    const chunk = { id: "fund-comparison", object: "chat.completion.chunk", created: 0, model: "fund-comparison-test" };
    return new Response([{ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] }]
      .map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  });
  const settings = structuredClone(DEFAULT_SETTINGS); settings.provider = "custom"; settings.model = "fund-comparison-test"; settings.thinkingLevel = "off";
  settings.artifactGeneration.auto = true;
  settings.providers = { custom: { baseUrl: `${server.url}v1`, api: "openai-completions", apiKey: "synthetic-fund-comparison-key" } }; saveSettings(settings);
});
afterEach(async () => {
  // A watchdog rejects the runner's wait, not the underlying async test body.
  // Settle that body before the next case can replace its globals or data root.
  stop.abort(); agent?.abort(); runtime?.dispose();
  const stopped = server.close();
  await pending?.catch(() => {});
  await runtime?.shutdown(); await agent?.waitForIdle();
  await stopped;
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (proxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = proxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected fund comparison fixture root");
  rmSync(root, { recursive: true, force: true });
});
function dependencies() {
  const deps = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions") });
  deps.tools = createBuiltinTools({ fundData: createEvaluationFundData() }).filter(tool => tool.name === "fund_dca_backtest");
  deps.loadSkills = async () => [];
  return deps;
}

// Five/six local provider requests plus journal writes and restore are an
// integration scenario, not a five-second performance assertion.
test.each(["correct", "wrong-research", "wrong-recovery"] as const)("fund evaluation keeps real receipts and checks %s after lossy recovery", scenario => owned(async () => {
  if (scenario === "wrong-research") { answer = wrong; recoveryAnswer = complete; }
  if (scenario === "wrong-recovery") recoveryAnswer = wrong;
  const report = await runResearchEvaluation("fund", dependencies(), { maxRequests: 8, signal: stop.signal });
  expect(report.operations).toHaveLength(1); expect(report.task?.status).toBe("complete");
  expect(report.checks.every(check => check.passed)).toBe(true);
  expect(requests).toBe(5); expect(report.answers).toHaveLength(2); expect(report.passed).toBe(scenario === "correct");
  expect(report.knownClaimViolations).toEqual(scenario === "correct" ? [] : [{ phase: scenario === "wrong-research" ? "research" : "recovery", code: "unaligned-direct-twr-comparison" }]);
}), 15000);

test.each(["research", "recovery"] as const)("actual runtime preserves an unsupported TWR comparison and pauses report generation in %s", phase => owned(async () => {
  const deps = dependencies(); agent = createQuantResearchAgent({ dependencies: deps });
  const messages: UIMessage[][] = [], report = mock(async () => ({ success: true, message: "synthetic report" }));
  const start = async () => {
    runtime = new AppRuntime({ onMessages: value => messages.push(value), onActivity: () => {} },
      async () => [], async () => [], () => agent!, report, undefined, 1000, 0);
    await runtime.bootstrap();
  };
  await start(); answer = phase === "research" ? wrong : complete;
  await runtime!.submit(fixture.prompt);
  const original = structuredClone((await agent.getResearchState()).operations);
  expect(original).toHaveLength(1); expect(report).toHaveBeenCalledTimes(phase === "research" ? 0 : 1);
  const metadata = (await agent.getSessionMetadata())!, stored = await deps.sessions.open(metadata);
  const tail = await stored.appendMessage({ role: "user", content: "稍后继续", timestamp: 0 });
  await stored.appendCompaction("Fund comparison details deliberately omitted.", tail, 50000);
  await runtime!.shutdown(); agent = createQuantResearchAgent({ dependencies: deps }); await agent.resumeSession(metadata.id); await start();
  answer = phase === "recovery" ? wrong : complete;
  await runtime!.submit("恢复基金 270042.OF 已完成的定投研究，保留日期，不重新计算。");
  expect(requests).toBe(5); expect(report).toHaveBeenCalledTimes(1);
  expect((await agent.getResearchState()).operations).toEqual(original);
  expect(messages.flat().some(message => message.role === "assistant" && message.text === wrong)).toBe(true);
  expect(messages.flat().some(message => message.text?.includes("基金或基准直接比较缺少"))).toBe(true);
  expect((await agent.getSessionEntries()).some(entry => entry.type === "message" && entry.message.role === "assistant"
    && entry.message.content.some(part => part.type === "text" && part.text === wrong))).toBe(true);
  expect(inputs[4]).toContain("fund_dca_backtest");
  answer = complete; await runtime!.submit("更正基金 270042.OF 定投研究的 TWR 比较口径后继续。");
  expect(requests).toBe(6); expect(report).toHaveBeenCalledTimes(2);
}), 15000);
