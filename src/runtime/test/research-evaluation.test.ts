import { afterEach, beforeEach, expect, it, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createDefaultSessionDependencies } from "../session-dependencies.ts";
import { createBuiltinTools, findBuiltinTool } from "../../tools/registry.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import { saveSettings } from "../../storage/index.ts";
import { createHash } from "node:crypto";
import { createEvaluationFundData, createEvaluationPriceData, researchEvaluationCase, runResearchEvaluation as evaluateResearch, type ResearchEvaluationCase } from "../evaluation/research-evaluation.ts";
import type { ResearchTaskSpec } from "../../types/research-task.ts";
import { createEvaluationPortfolioData } from "../evaluation/research-evaluation-portfolio.ts";

type Call = { name: string; args: Record<string, unknown> };
// These cases persist evidence and recover sessions across multiple HTTP turns.
// Keep the 10s operation deadline inside the 30s test budget (some cases run twice).
setDefaultTimeout(30_000);
let fixtureController: AbortController;
let pending: Set<ReturnType<typeof evaluateResearch>>;
let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
let onRequest: () => void;

function runResearchEvaluation(...[id, deps, options = {}]: Parameters<typeof evaluateResearch>) {
  // A timed-out test continuation must not start more work during teardown.
  fixtureController.signal.throwIfAborted();
  const signal = options.signal ? AbortSignal.any([options.signal, fixtureController.signal]) : fixtureController.signal;
  const operation = evaluateResearch(id, deps, { timeoutMs: 10_000, ...options, signal });
  const owned = pending;
  owned.add(operation);
  void operation.then(() => owned.delete(operation), () => owned.delete(operation));
  return operation;
}

async function stopEvaluations() {
  fixtureController.abort();
  await Promise.allSettled([...pending]);
}

let root: string, previous: string | undefined, noProxy: string | undefined;
let server: ReturnType<typeof Bun.serve>, requests: number, loop: boolean, hold: boolean;
let steps: Array<(payload: Record<string, unknown>) => Call | undefined>;
let receivedHashes: string[];
let answerText: string, answerEnding: "stop" | "length";
let stalledAnswer: "partial" | "empty" | null, cancelAnswer: () => void;
beforeEach(() => {
  fixtureController = new AbortController(); pending = new Set(); cancellationTimer = undefined; onRequest = () => {};
  previous = process.env.OHQUANT_DIR; noProxy = process.env.NO_PROXY;
  root = mkdtempSync(join(tmpdir(), "whyj-evaluation-test-")); process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
  requests = 0; steps = []; loop = false; hold = false; receivedHashes = [];
  answerText = "The task is complete. This sentence alone must not pass evaluation."; answerEnding = "stop";
  stalledAnswer = null; cancelAnswer = () => {};
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(incoming) {
    const payload = await incoming.json() as Record<string, unknown>; requests++;
    onRequest();
    receivedHashes.push(createHash("sha256").update(JSON.stringify(payload)).digest("hex"));
    if (hold) return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
    const call = loop ? { name: "research_task", args: { action: "read" } } : steps.shift()?.(payload);
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: `evaluation-${requests}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] }
      : { role: "assistant", content: answerText };
    const chunk = { id: "evaluation", object: "chat.completion.chunk", created: 0, model: "evaluation-test" };
    if (!call && stalledAnswer) return new Response(new ReadableStream({ start(controller) {
      if (stalledAnswer === "partial") controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`));
      cancellationTimer = setTimeout(cancelAnswer, 100);
    } }), { headers: { "content-type": "text/event-stream" } });
    return new Response([{ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : answerEnding }] }]
      .map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const settings = structuredClone(DEFAULT_SETTINGS); settings.provider = "custom"; settings.model = "evaluation-test"; settings.thinkingLevel = "off";
  settings.providers = { custom: { baseUrl: `${server.url}v1`, api: "openai-completions", apiKey: "TEST_SECRET_MUST_NOT_APPEAR" } }; saveSettings(settings);
});
afterEach(async () => {
  // Finish owned async work before removing the root or restoring process.env.
  await stopEvaluations();
  clearTimeout(cancellationTimer);
  await server.stop(true);
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (noProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = noProxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected evaluation fixture directory");
  rmSync(root, { recursive: true, force: true });
}, 15_000);

it("fixture teardown cancels an active provider stream before releasing its workspace", async () => {
  hold = true;
  const started = Promise.withResolvers<void>(); onRequest = started.resolve;
  const operation = runResearchEvaluation("stock", dependencies());
  await started.promise;
  await stopEvaluations();
  expect((await operation).outcome).toBe("cancelled");
  expect(pending.size).toBe(0);
  expect(process.env.OHQUANT_DIR).toBe(root);
  expect(() => runResearchEvaluation("stock", dependencies())).toThrow();
});

function dependencies(id: ResearchEvaluationCase = "stock") {
  const deps = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions") });
  deps.tools = id === "fund" ? createBuiltinTools({ fundData: createEvaluationFundData() }).filter(tool => tool.name === "fund_dca_backtest")
    : id === "portfolio" ? createBuiltinTools({ comparison: createEvaluationPortfolioData() }).filter(tool => ["list_portfolios", "compare_portfolios"].includes(tool.name))
    : createBuiltinTools({ analysisData: createEvaluationPriceData(id) }).filter(tool => ["compute_factor", "check_risk", "run_backtest"].includes(tool.name));
  deps.loadSkills = async () => [];
  return deps;
}

it.each(["research", "recovery"] as const)("rejects the retained incorrect downside definition in %s even with six correct metrics", async phase => {
  plan(false, "risk");
  const expected = researchEvaluationCase("risk").expected;
  const correct = `Annual volatility ${(expected[0]!.value * 100).toFixed(2)}%; Downside volatility ${(expected[1]!.value * 100).toFixed(2)}%; VaR 95% -20.00%; CVaR 95% -20.00%; Max DD 20.00%; Drawdown duration 3 periods.`;
  steps[steps.length - 3] = () => { answerText = correct; return undefined; };
  steps[steps.length - 1] = () => { answerText = correct; return undefined; };
  steps[steps.length - (phase === "research" ? 3 : 1)] = () => {
    answerText = correct + " 年化波动率与下行波动率是日收益标准差乘 √252 的年化结果。";
    return undefined;
  };
  const report = await runResearchEvaluation("risk", dependencies("risk"));
  expect(report.checks.every(check => check.passed)).toBe(true);
  expect(report.operations).toHaveLength(1);
  expect(report.knownClaimViolations).toEqual([{ phase, code: "wrong-verified-downside-method" }]);
  expect(report.passed).toBe(false);
});
it.each(["research", "recovery"] as const)("rejects a second N-1 division of sample variance in %s despite correct evidence", async phase => {
  plan(false, "index");
  const correct = "Latest 0.0146; Annual volatility 1.30%; Max DD 0.00%.";
  steps[steps.length - 3] = () => { answerText = correct; return undefined; };
  steps[steps.length - 1] = () => { answerText = correct; return undefined; };
  steps[steps.length - (phase === "research" ? 3 : 1)] = () => {
    answerText = correct + " 年化波动率 = sqrt(样本方差 / (N-1)) × sqrt(252)。";
    return undefined;
  };
  const report = await runResearchEvaluation("index", dependencies("index"));
  expect({ outcome: report.outcome, failedChecks: report.checks.filter(check => !check.passed).map(check => check.name) })
    .toEqual({ outcome: "finished", failedChecks: [] });
  expect(report.operations).toHaveLength(2);
  expect(report.knownClaimViolations).toEqual([{ phase, code: "wrong-verified-annual-volatility-method" }]);
  expect(report.passed).toBe(false);
});

it.each(["research", "recovery"] as const)("rejects drawdown as a single-period return in %s despite six correct metrics", async phase => {
  plan(false, "risk");
  const expected = researchEvaluationCase("risk").expected;
  const correct = `Annual volatility ${(expected[0]!.value * 100).toFixed(2)}%; Downside volatility ${(expected[1]!.value * 100).toFixed(2)}%; VaR 95% -20.00%; CVaR 95% -20.00%; Max DD 20.00%; Drawdown duration 3 periods.`;
  steps[steps.length - 3] = () => { answerText = correct; return undefined; };
  steps[steps.length - 1] = () => { answerText = correct; return undefined; };
  steps[steps.length - (phase === "research" ? 3 : 1)] = () => {
    answerText = correct + " VaR 95%、CVaR 95%、最大回撤均为单期（日）符号收益率。";
    return undefined;
  };
  const report = await runResearchEvaluation("risk", dependencies("risk"));
  expect(report.checks.every(check => check.passed)).toBe(true);
  expect(report.operations).toHaveLength(1);
  expect(report.knownClaimViolations).toEqual([{ phase, code: "wrong-drawdown-period-method" }]);
  expect(report.passed).toBe(false);
});

function plan(omitRisk = false, id: ResearchEvaluationCase = "stock") {
  const fixture = researchEvaluationCase(id);
  const body: Omit<ResearchTaskSpec, "request"> = { id: "evaluated-task", goal: "Verify required research evidence", scope: { symbols: fixture.symbols, start: fixture.start, end: fixture.end, market: fixture.market, ...fixture.comparisonScope },
    constraints: { allowedTools: fixture.required.map(item => item.tool), notes: [] }, dataRefs: [], reportRequired: false,
    criteria: fixture.required.slice(0, omitRisk ? 1 : 2).map((item, index) => ({ id: `criterion-${index}`, description: "Required evidence", ...item })) };
  const read = () => ({ name: "research_task", args: { action: "read", ...(id === "portfolio" ? { benchmark: "SPY" } : {}) } });
  steps = [read, payload => {
    const messages = payload.messages as Array<{ role: string; content: string }>;
    const result = messages.findLast(message => message.role === "tool" && message.content.includes("\nTask details: "))!;
    const state = JSON.parse(result.content.split("\nTask details: ")[1]!);
    expect(typeof state.expectedRevision).toBe("string"); expect(state.requestEntryId).toBe(state.latestRequest.entryId);
    if (id === "fund") expect(state.metricLabels.fund_dca_backtest).toEqual(["Principal return", "Time-weighted return", "XIRR", "Maximum drawdown (TWR)", "Purchases"]);
    else if (id === "portfolio") {
      expect(state.metricLabels.compare_portfolios).toHaveLength(28);
      expect(state.metricLabels.compare_portfolios).toContain("Portfolio A / Total return");
      expect(state.metricLabels.compare_portfolios).toContain("Portfolio B / Max drawdown");
      expect(state.metricLabels.compare_portfolios).toContain("Benchmark · SPY / Total return");
    } else expect(state.metricLabels.check_risk).toContain("Maximum drawdown");
    return { name: "research_task", args: { action: "declare", expectedRevision: state.expectedRevision, requestEntryId: state.latestRequest.entryId, task: body } };
  }, ...fixture.required.map(item => () => ({ name: item.tool, args: item.parameters })), read, () => undefined, read, () => undefined];
  if (id === "portfolio") steps.unshift(() => ({ name: "list_portfolios", args: {} }));
}

it("checks real tool evidence and lossy recovery, retaining answers separately from semantic review", async () => {
  plan();
  const afterCalculations = steps[4]!;
  steps[4] = payload => {
    expect(JSON.stringify(payload.messages)).toContain("do not test subsequent returns, mean reversion");
    return afterCalculations(payload);
  };
  const initialRead = steps[0]!;
  steps[0] = payload => {
    const outgoing = JSON.stringify(payload);
    expect(outgoing).toContain("Optional on the first declaration only");
    expect(outgoing).toContain("task.id may be omitted; the host assigns a stable ID");
    return initialRead(payload);
  };
  steps[steps.length - 1] = payload => {
    const messages = payload.messages as Array<{ role: string; content: string }>;
    const result = messages.findLast(message => message.role === "tool" && message.content.includes("\nTask details: "))!;
    const recovered = JSON.parse(result.content.split("\nTask details: ")[1]!);
    expect(recovered.operations[1].findings.metrics[0]).toMatchObject({ label: "Annual volatility", unit: "fraction", display: "1.3038293%" });
    expect(recovered.operations[0].findings.assumptions).toContainEqual(expect.stringContaining("do not test subsequent returns, mean reversion"));
    return undefined;
  };
  const report = await runResearchEvaluation("stock", dependencies());
  expect(report.passed).toBe(true); expect(report.checks).toHaveLength(7); expect(report.requests).toBe(requests);
  expect(report.answers.map(answer => answer.phase)).toEqual(["research", "recovery"]);
  expect(report.operations.map(operation => operation.status)).toEqual(["verified", "verified"]);
  expect(report.operations[0]!.findings?.assumptions).toContainEqual(expect.stringContaining("do not test subsequent returns, mean reversion"));
  expect(report.config.toolNames).toContain("research_task"); expect(report.reviewRequired).toContain("Human review");
  expect(JSON.stringify(report)).not.toContain("TEST_SECRET_MUST_NOT_APPEAR");
  expect(JSON.stringify(report)).not.toContain(String(server.url));
  expect(report.audit.preparedRequests.map(request => request.payloadHash)).toEqual(receivedHashes);
  expect(report.audit.preparedRequests[0]?.toolNames?.sort()).toEqual(["check_risk", "compute_factor", "research_task", "run_backtest"]);
  for (const request of report.audit.preparedRequests.slice(2)) expect(request.toolNames?.sort()).toEqual(["check_risk", "compute_factor", "research_task"]);
  expect(report.audit.preparedRequests.some(request => request.phase === "recovery")).toBe(true);
  const declaration = report.audit.toolTrace.find(item => item.type === "result" && item.taskEvent);
  expect(declaration?.entryId).toBeString();
  expect(report.audit.checkpoints.some(item => item.task?.revision === declaration?.entryId)).toBe(true);
  expect(report.audit.toolTrace.filter(item => item.phase === "recovery" && item.type === "call").every(item => item.tool === "research_task")).toBe(true);
});

it("rejects an unsupported mean-reversion conclusion even after verified tools and recovery", async () => {
  plan();
  answerText = "动量最新值低于历史均值，分位为 0%，属短周期均值回归型特征。";
  const report = await runResearchEvaluation("stock", dependencies());
  expect(report.outcome).toBe("finished");
  expect(report.checks).toHaveLength(7);
  expect(report.checks.every(check => check.passed)).toBe(true);
  expect(report.knownClaimViolations).toEqual([
    { phase: "research", code: "unsupported-mean-reversion-claim" },
    { phase: "recovery", code: "unsupported-mean-reversion-claim" },
  ]);
  expect(report.passed).toBe(false);
});

it("rejects a wrong labelled risk percentage despite a satisfied stock task", async () => {
  plan();
  const declare = steps[1]!;
  steps[1] = payload => {
    const call = declare(payload)!;
    const body = call.args.task as Omit<ResearchTaskSpec, "request">;
    const risk = body.criteria.find(item => item.tool === "check_risk")!;
    risk.metrics = ["Annual volatility"];
    body.criteria.push({ ...structuredClone(risk), id: "max-dd", metrics: ["Maximum drawdown"] });
    return call;
  };
  steps[steps.length - 3] = () => { answerText = "Annual volatility 9.00%; Max DD 0.00%."; return undefined; };
  steps[steps.length - 1] = () => { answerText = "Risk evidence was restored without recomputation."; return undefined; };
  const report = await runResearchEvaluation("stock", dependencies());
  expect(report.outcome).toBe("finished");
  expect(report.checks.every(check => check.passed)).toBe(true);
  expect(report.knownClaimViolations).toContainEqual({ phase: "research", code: "wrong-verified-annual-volatility" });
  expect(report.passed).toBe(false);
});

it("rejects a wrong risk percentage introduced only in lossy recovery", async () => {
  plan();
  steps[steps.length - 3] = () => { answerText = "Annual volatility 1.30%; Max DD 0.00%."; return undefined; };
  steps[steps.length - 1] = () => { answerText = "恢复原风险：Annual volatility 1.30%; Max DD 9.00%."; return undefined; };
  const report = await runResearchEvaluation("stock", dependencies());
  expect(report.outcome).toBe("finished");
  expect(report.checks.every(check => check.passed)).toBe(true);
  expect(report.knownClaimViolations).toEqual([{ phase: "recovery", code: "wrong-verified-risk-drawdown" }]);
  expect(report.passed).toBe(false);
});

it("rejects a wrong latest factor value introduced only in lossy recovery", async () => {
  plan();
  steps[steps.length - 3] = () => { answerText = "Latest 0.0146; Annual volatility 1.30%; Max DD 0.00%."; return undefined; };
  steps[steps.length - 1] = () => { answerText = "恢复动量：Latest 0.0946; Annual volatility 1.30%; Max DD 0.00%."; return undefined; };
  const report = await runResearchEvaluation("stock", dependencies());
  expect(report.outcome).toBe("finished");
  expect(report.checks.every(check => check.passed)).toBe(true);
  expect(report.knownClaimViolations).toEqual([{ phase: "recovery", code: "wrong-verified-factor-latest" }]);
  expect(report.passed).toBe(false);
});

it("rejects a changed portfolio return in lossy recovery despite an unchanged verified comparison", async () => {
  const deps = dependencies("portfolio");
  plan(false, "portfolio");
  steps[steps.length - 3] = () => { answerText = "Core 累计收益 +39.00%，最大回撤 0.00%；Stable 累计收益 0.00%，最大回撤 0.00%。"; return undefined; };
  steps[steps.length - 1] = () => { answerText = "恢复原比较：Core 累计收益 +38.00%，最大回撤 0.00%；Stable 累计收益 0.00%。"; return undefined; };
  const report = await runResearchEvaluation("portfolio", deps);
  expect(report.outcome).toBe("finished");
  expect(report.task?.status).toBe("complete");
  expect(report.checks.every(check => check.passed)).toBe(true);
  expect(report.knownClaimViolations).toEqual([{ phase: "recovery", code: "wrong-verified-portfolio-a-return" }]);
  expect(report.passed).toBe(false);
});

it.each(["index", "fund", "portfolio", "risk"] as const)("verifies real %s calculations, exact parameters and lossy recovery through the same evaluation runner", async id => {
  const deps = dependencies(id);
  plan(false, id);
  if (id === "risk") {
    const expected = researchEvaluationCase(id).expected;
    answerText = `Annual volatility ${(expected[0]!.value * 100).toFixed(2)}%; Downside volatility ${(expected[1]!.value * 100).toFixed(2)}%; VaR 95% -20.00%; CVaR 95% -20.00%; Max DD 20.00%; Drawdown duration 3 periods.`;
  }
  if (id === "fund") steps[steps.length - 1] = payload => {
    const text = JSON.stringify(payload.messages);
    expect(text).toContain("First contribution: 28 calendar days");
    expect(text).toContain("last contribution: 0 days");
    expect(text).toContain("XIRR is the solved annualized money-weighted rate");
    expect(text).toContain("annualization extrapolates hypothetically");
    const messages = payload.messages as Array<{ role: string; content: string }>;
    const content = messages.findLast(item => item.role === "tool" && item.content.includes("\nTask details: "))!.content;
    const state = JSON.parse(content.split("\nTask details: ")[1]!);
    expect(state.operations[0].findings.metrics.find((metric: { label: string }) => metric.label === "Purchases")).toMatchObject({ value: 2, unit: "number", display: "2" });
    return undefined;
  };
  const report = await runResearchEvaluation(id, deps);
  expect(report.task?.criteria.map(criterion => criterion.status === "satisfied" ? "satisfied" : criterion.reason)).toEqual(researchEvaluationCase(id).required.map(() => "satisfied"));
  expect(report.passed).toBe(true); expect(report.checks).toHaveLength(id === "risk" ? 9 : 7);
  expect(report.answers.map(answer => answer.phase)).toEqual(["research", "recovery"]);
  if (id === "fund") {
    expect(report.operations).toHaveLength(1);
    expect(report.operations[0]!.parameters).toMatchObject({ start_date: "2026-02-01", end_date: "2026-03-01", purchase_fee_rate: 0, purchase_fee_unit: "decimal" });
    expect(report.fixture.kind).toBe("synthetic-fund-nav");
    expect(report.audit.preparedRequests.every(request => request.toolNames?.join(",") === "fund_dca_backtest,research_task")).toBe(true);
    expect(report.operations[0]!.findings?.assumptions).toContain("First contribution: 28 calendar days to final valuation; last contribution: 0 days. Contributions have different holding durations, not all capital invested at the start.");
  }
});

it("rejects weakened fund acceptance and accepts documented canonical fund aliases", async () => {
  plan(false, "fund");
  const declare = steps[1]!;
  steps[1] = payload => {
    const call = declare(payload)!; const body = call.args.task as Omit<ResearchTaskSpec, "request">;
    body.criteria[0]!.metrics = ["Principal return"];
    return call;
  };
  const weakened = await runResearchEvaluation("fund", dependencies("fund"));
  expect(weakened.task?.status).toBe("complete"); expect(weakened.passed).toBe(false);
  expect(weakened.checks.find(check => check.name === "required criteria retained")?.passed).toBe(false);
  plan(false, "fund");
  const original = steps[1]!;
  steps[1] = payload => {
    const call = original(payload)!; const body = call.args.task as Omit<ResearchTaskSpec, "request">;
    body.criteria[0]!.parameters.symbol = "270042.OF";
    return call;
  };
  // Tool/criterion use the same valid canonical spelling.
  steps[2] = () => ({ name: "fund_dca_backtest", args: { ...researchEvaluationCase("fund").required[0]!.parameters, symbol: "270042.OF" } });
  expect((await runResearchEvaluation("fund", dependencies("fund"))).passed).toBe(true);
});

it("rejects a risk answer that omits tail metrics despite a complete task and successful recovery", async () => {
  plan(false, "risk");
  answerText = "Max DD 20.00%; Drawdown duration 3 periods. This is only partial risk evidence.";
  const report = await runResearchEvaluation("risk", dependencies("risk"));
  expect(report.task?.status).toBe("complete");
  expect(report.knownClaimViolations).toEqual([]);
  expect(report.checks.filter(check => check.name.includes("all six risk metrics")).map(check => check.passed)).toEqual([false, false]);
  expect(report.passed).toBe(false);
});

it("checks signed tail values after lossy risk recovery without recomputing or accepting annualized VaR", async () => {
  plan(false, "risk");
  const expected = researchEvaluationCase("risk").expected;
  const correct = `Annual volatility ${(expected[0]!.value * 100).toFixed(2)}%; Downside volatility ${(expected[1]!.value * 100).toFixed(2)}%; VaR 95% -20.00%; CVaR 95% -20.00%; Max DD 20.00%; Drawdown duration 3 periods.`;
  steps[steps.length - 3] = () => { answerText = correct; return undefined; };
  steps[steps.length - 1] = () => { answerText = correct.replace("VaR 95% -20.00%", "VaR 95% -317.49%"); return undefined; };
  const report = await runResearchEvaluation("risk", dependencies("risk"));
  expect(report.outcome).toBe("finished");
  expect(report.checks.every(check => check.passed)).toBe(true);
  expect(report.operations).toHaveLength(1);
  expect(report.knownClaimViolations).toEqual([{ phase: "recovery", code: "wrong-verified-var95" }]);
  expect(report.passed).toBe(false);
});

it("rejects a fund answer with the retained universal claims even when tools, task and recovery pass", async () => {
  plan(false, "fund");
  steps[steps.length - 3] = () => { answerText = "本金收益与基金本身表现无关；TWR 可与其它基金或基准直接对比。"; return undefined; };
  steps[steps.length - 1] = () => { answerText = "基金条件和原核验数值已恢复。"; return undefined; };
  const report = await runResearchEvaluation("fund", dependencies("fund"));
  expect(report.outcome).toBe("finished"); expect(report.checks).toHaveLength(7);
  expect(report.checks.every(check => check.passed)).toBe(true);
  expect(report.passed).toBe(false);
  expect(report.knownClaimViolations).toEqual([
    { phase: "research", code: "principal/fund-independence-claim" },
    { phase: "research", code: "unaligned-direct-twr-comparison" },
  ]);
  expect(report.task?.status).toBe("complete"); expect(report.answers).toHaveLength(2);
});

it("rejects blended cost and incorrect day count in a real Pi fund evaluation", async () => {
  plan(false, "fund");
  steps[steps.length - 3] = () => { answerText = "本例两次申购成本均为 0.6000，29 天窗口造成 XIRR 年化放大。"; return undefined; };
  steps[steps.length - 1] = () => { answerText = "基金条件和原核验数值已恢复。"; return undefined; };
  const report = await runResearchEvaluation("fund", dependencies("fund"));
  expect(report.outcome).toBe("finished"); expect(report.checks.every(check => check.passed)).toBe(true);
  expect(report.passed).toBe(false);
  expect(report.knownClaimViolations).toEqual([
    { phase: "research", code: "blended-cost-as-each-purchase-nav" },
    { phase: "research", code: "wrong-fixed-window-day-count" },
  ]);
  expect(report.task?.status).toBe("complete");
});

it("rejects a fund recovery formula that contradicts verified principal return", async () => {
  plan(false, "fund");
  steps[steps.length - 3] = () => { answerText = "基金三项条件已由实际回测核验。"; return undefined; };
  steps[steps.length - 1] = () => {
    answerText = "Principal return 25.00% （末期模拟市值 200 − 投入 200 本金）/ 200";
    return undefined;
  };
  const report = await runResearchEvaluation("fund", dependencies("fund"));
  expect(report.outcome).toBe("finished"); expect(report.checks.every(check => check.passed)).toBe(true);
  expect(report.passed).toBe(false);
  expect(report.knownClaimViolations).toEqual([{ phase: "recovery", code: "wrong-fixed-principal-formula" }]);
  expect(report.task?.status).toBe("complete");
});

it("fails a labelled recovery percentage that contradicts the verified DCA metric without an explicit formula", async () => {
  plan(false, "fund");
  steps[steps.length - 3] = () => { answerText = "基金三项条件已由实际回测核验。"; return undefined; };
  steps[steps.length - 1] = () => { answerText = "Principal return 20.00%; Time-weighted return 50.00%; Maximum drawdown (TWR) 0.00%."; return undefined; };
  const report = await runResearchEvaluation("fund", dependencies("fund"));
  expect(report.outcome).toBe("finished");
  expect(report.checks.every(check => check.passed)).toBe(true);
  expect(report.verifiedAnswerMetrics?.principalReturn).toBeCloseTo(0.25, 12);
  expect(report.verifiedAnswerMetrics?.timeWeightedReturn).toBeCloseTo(0.5, 12);
  expect(report.verifiedAnswerMetrics?.maximumDrawdownTwr).toBe(0);
  expect(report.passed).toBe(false);
  expect(report.knownClaimViolations).toEqual([{ phase: "recovery", code: "wrong-verified-principal-return" }]);
});

it("does not use a verified ratio from a different investment amount as answer evidence", async () => {
  plan(false, "fund");
  steps[2] = () => ({ name: "fund_dca_backtest", args: { ...researchEvaluationCase("fund").required[0]!.parameters, invest_amount: 200 } });
  const report = await runResearchEvaluation("fund", dependencies("fund"));
  expect(report.checks.find(check => check.name === "independent arithmetic expectations")?.passed).toBe(false);
  expect(report.verifiedAnswerMetrics).toBeNull();
  expect(report.passed).toBe(false);
});

it("isolates fund data overrides and refuses another fund or implicit fee lookup before any live fallback", async () => {
  const original = findBuiltinTool("fund_dca_backtest");
  const tools = createBuiltinTools({ fundData: createEvaluationFundData() });
  const fund = tools.find(tool => tool.name === "fund_dca_backtest")!;
  expect(findBuiltinTool("fund_dca_backtest")).toBe(original);
  const args = researchEvaluationCase("fund").required[0]!.parameters;
  await expect(fund.execute("wrong", { ...args, symbol: "000001" })).rejects.toThrow("no live fallback");
  const implicit = { ...args, purchase_fee_rate: undefined };
  await expect(fund.execute("implicit", implicit)).rejects.toThrow("explicit fee assumption");
  expect((await fund.execute("correct", args)).details).toHaveProperty("dataset");
  expect(requests).toBe(0);
});

it.each([{ key: "purchase_fee_rate", value: 0.01 }, { key: "start_date", value: "2026-01-01" }])("does not pass a fund study that changes the user's $key", async ({ key, value }) => {
  plan(false, "fund"); const original = steps[1]!;
  steps[1] = payload => {
    const call = original(payload)!; const body = call.args.task as Omit<ResearchTaskSpec, "request">;
    body.criteria[0]!.parameters[key] = value;
    return call;
  };
  steps[2] = () => ({ name: "fund_dca_backtest", args: { ...researchEvaluationCase("fund").required[0]!.parameters, [key]: value } });
  const report = await runResearchEvaluation("fund", dependencies("fund"));
  expect(report.passed).toBe(false);
  expect(report.checks.find(check => check.name === "required criteria retained")?.passed).toBe(false);
});

it("isolates portfolio ports and rejects wrong dates, currency, symbols or a nonempty fixture workspace", async () => {
  const original = findBuiltinTool("compare_portfolios"), data = createEvaluationPortfolioData();
  expect(() => createEvaluationPortfolioData()).toThrow("empty isolated workspace");
  for (const [symbol, currency, start, end] of [["UNKNOWN", "USD", "2026-01-01", "2026-02-09"],
    ["AAPL", "CNY", "2026-01-01", "2026-02-09"], ["AAPL", "USD", "2025-01-01", "2026-02-09"]] as const) {
    await expect(data.price(symbol, currency, start, end)).rejects.toThrow("no live fallback");
  }
  await expect(data.fx("USD", ["CNY"], "2026-01-01", "2026-02-09")).rejects.toThrow("no live fallback");
  const tools = createBuiltinTools({ comparison: data });
  expect(findBuiltinTool("compare_portfolios")).toBe(original);
  expect((await tools.find(tool => tool.name === "compare_portfolios")!.execute("comparison", researchEvaluationCase("portfolio").required[0]!.parameters)).details).toHaveProperty("id");
  expect(requests).toBe(0);
});

it.each([{ symbol: "SPY", valid: true }, { symbol: "GOOG", valid: false }])("checks portfolio scope with $symbol without rejecting its explicit benchmark or allowing extra members", async ({ symbol, valid }) => {
  const deps = dependencies("portfolio"); plan(false, "portfolio"); const declare = steps[2]!;
  steps[2] = payload => {
    const call = declare(payload)!; const body = call.args.task as Omit<ResearchTaskSpec, "request">;
    body.scope.symbols.push(symbol); return call;
  };
  const report = await runResearchEvaluation("portfolio", deps);
  expect(report.passed).toBe(valid);
  expect(report.checks.find(check => check.name === "original request and exact scope")?.passed).toBe(valid);
});

it("fails an unsupported completion claim and incomplete criteria even when the task reports complete", async () => {
  const narrative = await runResearchEvaluation("stock", dependencies());
  expect(narrative.passed).toBe(false); expect(narrative.checks.slice(0, 4).every(check => !check.passed)).toBe(true);
  expect(narrative.checks.at(-1)?.passed).toBe(true); // Completed prose is not verified research.
  plan(true);
  const weakened = await runResearchEvaluation("stock", dependencies());
  expect(weakened.task?.status).toBe("complete"); expect(weakened.passed).toBe(false);
  expect(weakened.checks.find(check => check.name === "required criteria retained")?.passed).toBe(false);
  expect(weakened.answers).toHaveLength(1);
});

it("explains a partial portfolio currency map and accepts a corrected declaration without recalculating", async () => {
  const deps = dependencies("portfolio"); plan(false, "portfolio"); const declare = steps[2]!;
  steps[2] = payload => {
    const call = declare(payload)!; const task = call.args.task as Omit<ResearchTaskSpec, "request">;
    task.criteria[0]!.parameters = { ...task.criteria[0]!.parameters, currencies: { AAPL: "USD" } };
    return call;
  };
  steps.splice(5, 0, payload => {
    const messages = payload.messages as Array<{ role: string; content: string }>;
    const content = messages.findLast(item => item.role === "tool" && item.content.includes("\nTask details: "))!.content;
    const state = JSON.parse(content.split("\nTask details: ")[1]!);
    expect(state.task.status).toBe("active");
    expect(state.task.criteria[0].reason).toContain("parameters differ: currencies");
    expect(state.operations.find((item: { tool: string }) => item.tool === "compare_portfolios").status).toBe("verified");
    const { request: _request, ...task } = state.task.spec;
    task.criteria[0].parameters = researchEvaluationCase("portfolio").required[0]!.parameters;
    return { name: "research_task", args: { action: "declare", expectedRevision: state.expectedRevision, requestEntryId: state.requestEntryId, task } };
  });
  const report = await runResearchEvaluation("portfolio", deps);
  expect(report.passed).toBe(true);
  expect(report.operations.filter(item => item.tool === "compare_portfolios")).toHaveLength(1);
  const declarations = report.audit.toolTrace.filter(item => item.type === "call" && item.arguments.action === "declare");
  expect(declarations).toHaveLength(2);
  expect(report.audit.checkpoints.some(item => item.task?.criteria.some(criterion => criterion.reason.includes("parameters differ: currencies")))).toBe(true);
});

it("keeps custom group labels blocked until corrected using the discovered verifier labels", async () => {
  const deps = dependencies("portfolio"); plan(false, "portfolio"); const declare = steps[2]!;
  steps[2] = payload => {
    const call = declare(payload)!; const task = call.args.task as Omit<ResearchTaskSpec, "request">;
    task.criteria[0]!.metrics = task.criteria[0]!.metrics.map(label => label.replace("Portfolio A", "Core").replace("Portfolio B", "Stable"));
    return call;
  };
  steps.splice(5, 0, payload => {
    const messages = payload.messages as Array<{ role: string; content: string }>;
    const content = messages.findLast(item => item.role === "tool" && item.content.includes("\nTask details: "))!.content;
    const state = JSON.parse(content.split("\nTask details: ")[1]!);
    expect(state.task.status).toBe("blocked");
    const operation = state.operations.find((item: { tool: string }) => item.tool === "compare_portfolios");
    expect(state.metricLabels.compare_portfolios).toEqual(operation.findings.metrics.map((item: { label: string }) => item.label));
    const { request: _request, ...task } = state.task.spec;
    task.criteria[0].metrics = task.criteria[0].metrics.map((label: string) => label.replace("Core", "Portfolio A").replace("Stable", "Portfolio B"));
    expect(task.criteria[0].metrics.every((label: string) => state.metricLabels.compare_portfolios.includes(label))).toBe(true);
    return { name: "research_task", args: { action: "declare", expectedRevision: state.expectedRevision, requestEntryId: state.requestEntryId, task } };
  });
  const report = await runResearchEvaluation("portfolio", deps);
  expect(report.passed).toBe(true);
  expect(report.operations.filter(item => item.tool === "compare_portfolios")).toHaveLength(1);
  expect(report.audit.checkpoints.some(item => item.task?.status === "blocked" && item.task.spec.criteria[0]?.metrics.includes("Core / Total return"))).toBe(true);
});

it("stops a repeating model at the request-event limit and aborts a stalled request", async () => {
  loop = true;
  const limited = await runResearchEvaluation("stock", dependencies(), { maxRequests: 2 });
  expect(limited.outcome).toBe("request-limit"); expect(limited.passed).toBe(false); expect(requests).toBe(2);
  loop = false; hold = true;
  const timedOut = await runResearchEvaluation("stock", dependencies(), { timeoutMs: 100 });
  expect(timedOut.outcome).toBe("timeout"); expect(timedOut.passed).toBe(false);
  expect(timedOut.checks).toHaveLength(5); expect(timedOut.checks.every(check => !check.passed)).toBe(true);
  expect(timedOut.answers).toHaveLength(1); expect(timedOut.answers[0]?.text).toBe("");
});

for (const id of ["stock", "fund"] as const) for (const phase of ["research", "recovery"] as const) {
  it.each(["empty", "length"] as const)(`${id} ${phase} ending with %s fails even with complete evidence and unchanged recovery`, async ending => {
    plan(false, id);
    const index = steps.length - (phase === "research" ? 3 : 1);
    steps[index] = () => { answerText = ending === "empty" ? " \n\t" : "Incomplete explanation retained."; answerEnding = ending === "length" ? "length" : "stop"; return undefined; };
    if (phase === "research") steps[steps.length - 1] = () => { answerText = "Normal recovery answer."; answerEnding = "stop"; return undefined; };
    const report = await runResearchEvaluation(id, dependencies(id));
    expect(report.passed).toBe(false); expect(report.task?.status).toBe("complete");
    expect(report.outcome).toBe(ending === "empty" ? "no-final-answer" : "request-failed");
    expect(report.checks.filter(check => !check.passed).map(check => check.name)).toEqual([`${phase}: nonempty normally completed answer retained for semantic review`]);
    expect(report.answers).toHaveLength(2);
    expect(report.answers.find(answer => answer.phase === phase)).toMatchObject({ text: ending === "empty" ? " \n\t" : "Incomplete explanation retained.",
      stopReason: ending === "length" ? "length" : "stop", hasError: false, toolCallCount: 0 });
    expect(report.operations).toHaveLength(id === "stock" ? 2 : 1);
  });
}

it.each(["research", "recovery"] as const)("preserves %s partial text when the caller cancels a stream without a finish event", async phase => {
  plan(false, "fund");
  const controller = new AbortController(); cancelAnswer = () => controller.abort();
  steps[steps.length - (phase === "research" ? 3 : 1)] = () => { stalledAnswer = "partial"; answerText = "Partial fund explanation before cancellation."; return undefined; };
  const report = await runResearchEvaluation("fund", dependencies("fund"), { signal: controller.signal });
  expect(report.outcome).toBe("cancelled"); expect(report.passed).toBe(false);
  expect(report.answers.at(-1)).toMatchObject({ phase, text: "Partial fund explanation before cancellation.", stopReason: "aborted", hasError: true });
  expect(report.task?.status).toBe("complete"); expect(report.operations).toHaveLength(1);
  expect(report.checks.at(-1)?.passed).toBe(false);
});

it("a silent cancelled recovery cannot reuse the earlier completed research answer", async () => {
  plan(false, "fund");
  const controller = new AbortController(); cancelAnswer = () => controller.abort();
  steps[steps.length - 1] = () => { stalledAnswer = "empty"; return undefined; };
  const report = await runResearchEvaluation("fund", dependencies("fund"), { signal: controller.signal });
  expect(report.outcome).toBe("cancelled"); expect(report.passed).toBe(false);
  expect(report.answers[0]).toMatchObject({ phase: "research", text: answerText, stopReason: "stop", hasError: false });
  expect(report.answers[1]).toMatchObject({ phase: "recovery", text: "", stopReason: "aborted", hasError: true });
  expect(report.operations).toHaveLength(1);
});

it("keeps injected price ports local to one registry and refuses live fallback or invalid limits", async () => {
  const original = findBuiltinTool("compute_factor");
  const first = createBuiltinTools({ analysisData: createEvaluationPriceData("stock") });
  const second = createBuiltinTools({ analysisData: createEvaluationPriceData("index") });
  expect(findBuiltinTool("compute_factor")).toBe(original);
  const args = { symbol: "AAPL", start: "2026-01-01", end: "2026-02-09", period: 2, factor: "momentum" };
  expect((await first.find(tool => tool.name === "compute_factor")!.execute("first", args)).details).toHaveProperty("dataset");
  await expect(second.find(tool => tool.name === "compute_factor")!.execute("second", args)).rejects.toThrow("no live fallback");
  await expect(runResearchEvaluation("stock", dependencies(), { maxRequests: 0 })).rejects.toThrow("Invalid evaluation limits");
  expect(requests).toBe(0);
});

it("retains a rejected task declaration for diagnosis without treating it as accepted evidence", async () => {
  steps = [() => ({ name: "research_task", args: { action: "declare", expectedRevision: "unobserved", requestEntryId: "unobserved" } })];
  const report = await runResearchEvaluation("stock", dependencies());
  expect(report.passed).toBe(false); expect(report.task).toBeNull();
  expect(report.toolFailures).toHaveLength(1); expect(report.toolFailures[0]?.tool).toBe("research_task");
  expect(report.toolFailures[0]?.message).toContain("copy its expectedRevision string");
  expect(report.toolFailures[0]?.arguments).toEqual({ action: "declare", expectedRevision: "unobserved", requestEntryId: "unobserved" });
});

it("rejects a string null revision and lets the caller correct it without weakening acceptance", async () => {
  plan();
  const declare = steps[1]!;
  steps.splice(1, 0, payload => { const call = declare(payload)!; return { ...call, args: { ...call.args, expectedRevision: "null" } }; });
  const report = await runResearchEvaluation("stock", dependencies());
  expect(report.passed).toBe(true); expect(report.toolFailures).toHaveLength(1);
  expect(report.toolFailures[0]?.message).toContain("copy its expectedRevision string");
  expect(report.task?.spec.criteria).toHaveLength(2);
  expect(report.audit.toolTrace.some(item => item.type === "call" && item.arguments.expectedRevision === "null")).toBe(true);
  expect(report.audit.toolTrace.some(item => item.type === "result" && item.isError && !item.taskEvent)).toBe(true);
});

it("retains the original version pin and blocked checkpoint after a corrected declaration satisfies existing evidence without recomputation", async () => {
  plan();
  const original = steps[1]!;
  steps[1] = payload => {
    const call = original(payload)!;
    const task = call.args.task as ResearchTaskSpec;
    return { ...call, args: { ...call.args, task: { ...task, dataRefs: [{ kind: "daily-bars", symbol: "AAPL", revision: "placeholder", contentHash: "placeholder" }] } } };
  };
  steps.splice(5, 0, payload => {
    const messages = payload.messages as Array<{ role: string; content: string }>;
    const content = messages.findLast(item => item.role === "tool" && item.content.includes("\nTask details: "))!.content;
    const state = JSON.parse(content.split("\nTask details: ")[1]!);
    expect(state.task.status).toBe("blocked");
    const { request: _request, ...task } = state.task.spec;
    return { name: "research_task", args: { action: "declare", expectedRevision: state.expectedRevision, requestEntryId: state.requestEntryId,
      task: { ...task, dataRefs: [] } } };
  });
  const report = await runResearchEvaluation("stock", dependencies());
  expect(report.passed).toBe(true); expect(report.operations).toHaveLength(2);
  const declarations = report.audit.toolTrace.filter(item => item.type === "call" && item.arguments.action === "declare");
  expect(declarations).toHaveLength(2);
  expect(JSON.stringify(declarations[0])).toContain("placeholder"); expect(JSON.stringify(declarations[1])).not.toContain("placeholder");
  const blocked = report.audit.checkpoints.find(item => item.task?.status === "blocked");
  expect(blocked?.task?.spec.dataRefs[0]?.revision).toBe("placeholder");
  expect(report.audit.checkpoints.at(-1)?.task?.status).toBe("complete");
  expect(report.audit.checkpoints.at(-1)?.task?.spec.dataRefs).toEqual([]);
});
