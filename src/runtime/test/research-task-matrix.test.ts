import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import * as source from "../../source/index.ts";
import { createQuantResearchAgent } from "../quant-harness.ts";
import type { QuantAgentSession } from "../../agent/src/session.ts";
import { AppRuntime } from "../../app-runtime.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import type { Bar } from "../../types/data.ts";
import type { ResearchTaskSpec } from "../../types/research-task.ts";
import { projectResearchState, type ResearchState } from "../../research/state.ts";
import { saveSettings } from "../../storage/index.ts";
import { editPortfolio } from "../research/portfolio.ts";
import { fundHistory } from "../../storage/test/fixtures/fund-nav.ts";
import { generateCurrentSessionArtifact } from "../research/artifact-reports.ts";
import { JsonlSessionRepo } from "../../agent/src/session-runtime/index.ts";
import { NodeExecutionEnv } from "../../agent/src/session-runtime/node.ts";
import { localProvider } from "./fixtures/local-provider.ts";

type Call = { name: string; args: Record<string, unknown> };
type Step = (payload: Record<string, unknown>) => Call;
const fetchSourceBars = source.fetchBars;
let root: string, previous: string | undefined, noProxy: string | undefined;
let agent: QuantAgentSession, runtime: AppRuntime | undefined, server: ReturnType<typeof localProvider>;
let steps: Step[], requests: Record<string, unknown>[];
let dataMode: "ok" | "empty" | "failure";
let pending: Promise<void> | undefined;
const owned = (body: () => Promise<void>) => pending = body();
const restores: Array<() => void> = [];
const start = "2026-01-01", end = "2026-02-09";

beforeEach(() => {
  previous = process.env.OHQUANT_DIR; noProxy = process.env.NO_PROXY;
  root = mkdtempSync(join(tmpdir(), "whyj-task-matrix-")); process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
  steps = []; requests = []; runtime = undefined; dataMode = "ok"; pending = undefined;
  server = localProvider(async incoming => {
    const payload = await incoming.json() as Record<string, unknown>; requests.push(payload);
    const call = steps.shift()?.(payload);
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: `matrix-${requests.length}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] }
      : { role: "assistant", content: "Fixed matrix response; acceptance comes from verified evidence." };
    const chunk = { id: "matrix", object: "chat.completion.chunk", created: 0, model: "task-matrix" };
    return new Response([{ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] }]
      .map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  });
  const settings = structuredClone(DEFAULT_SETTINGS); settings.provider = "custom"; settings.model = "task-matrix"; settings.thinkingLevel = "off";
  settings.providers = { custom: { baseUrl: `${server.url}v1`, api: "openai-completions", apiKey: "fixture" } };
  settings.preferences.source = "financial-datasets"; saveSettings(settings);
  // Replace only provider transport: real source orchestration, caches and immutable archives still run.
  const adapter = { async fetchBars(request: { symbol: string }) {
    if (dataMode === "empty") return [];
    if (dataMode === "failure") throw new Error("Fixture market provider unavailable");
    const bars: Bar[] = Array.from({ length: 40 }, (_, index) => {
      const close = request.symbol === "MSFT" ? 100 : 100 + index;
      return { date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10), open: close, high: close, low: close, close, volume: 10, amount: 1000 };
    });
    return [{ ...bars[0]!, date: "2025-12-31", close: 999, high: 999 }, ...bars, { ...bars.at(-1)!, date: "2026-03-01", close: 999, high: 999 }];
  } };
  const bars = spyOn(source, "fetchBars").mockImplementation((symbol, market, from, until, preferred, options = {}) => fetchSourceBars(symbol, market, from, until, preferred,
    { ...options, providers: { ...options.providers, adapters: { akshare: adapter, tushare: adapter, "llmquant-data": adapter, "financial-datasets": adapter } } }));
  const nav = spyOn(source, "fetchAkshareFundNav").mockResolvedValue(fundHistory());
  const fee = spyOn(source, "fetchAkshareFundPurchase").mockImplementation(async () => { throw new Error("Explicit zero fee must not fetch fees"); });
  restores.push(() => bars.mockRestore(), () => nav.mockRestore(), () => fee.mockRestore());
  agent = createQuantResearchAgent({ cwd: root, sessionsRoot: join(root, "sessions") });
});
afterEach(async () => {
  runtime?.dispose(); agent.abort(); const stopped = server.close();
  await pending?.catch(() => {});
  await runtime?.shutdown(); await agent.waitForIdle();
  await stopped;
  for (const restore of restores.splice(0)) restore();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (noProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = noProxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected task matrix root");
  rmSync(root, { recursive: true, force: true });
});

function receivedTask(payload: Record<string, unknown>): { expectedRevision: string; latestRequest: { entryId: string }; task: ResearchState["task"]; operations: ResearchState["operations"] } {
  const messages = payload.messages as Array<{ role: string; content: string }>;
  const result = messages.findLast(message => message.role === "tool" && typeof message.content === "string" && message.content.includes("\nTask details: "));
  if (!result) throw new Error("Missing model-visible task state");
  return JSON.parse(result.content.split("\nTask details: ")[1]!);
}
const read: Step = () => ({ name: "research_task", args: { action: "read" } });

// Each entry gets its own provider, data root and unchanged 15-second budget.
const entryCases = (["stock", "index", "fund", "portfolio"] as const)
  .flatMap(kind => (["headless", "composer"] as const).map(mode => [kind, mode] as const));
it.each(entryCases)("verifies, reports and restores a fixed %s task in %s", (kind, mode) => owned(async () => {
  const symbol = kind === "index" ? "000300.SH" : kind === "fund" ? "270042.OF" : "AAPL";
  const spec: ResearchTaskSpec = { id: `matrix-${kind}`, request: `研究 ${symbol}，保持指定日期与假设，核验结果并保存报告。`, goal: `Fixed ${kind} evidence`,
    scope: { symbols: [symbol], market: kind === "index" || kind === "fund" ? "A" : "US", start, end },
    constraints: { allowedTools: [], notes: ["Synthetic observations; research only"] }, criteria: [], dataRefs: [], reportRequired: true };
  let calls: Call[];
  if (kind === "fund") {
    spec.scope.start = "2026-02-01"; spec.scope.end = "2026-03-01";
    calls = [{ name: "fund_dca_backtest", args: { symbol: "270042", start_date: spec.scope.start, end_date: spec.scope.end,
      frequency: "monthly", invest_amount: 100, invest_day: 1, purchase_fee_rate: 0, purchase_fee_unit: "decimal" } }];
    spec.criteria = [{ id: "fund-result", description: "Principal return and cash-flow-adjusted risk", tool: calls[0]!.name,
      parameters: calls[0]!.args, metrics: ["Principal return", "Time-weighted return", "Maximum drawdown (TWR)"] }];
  } else if (kind === "portfolio") {
    editPortfolio({ type: "create", name: "Core" }); editPortfolio({ type: "add", group: "Core", code: "AAPL" });
    editPortfolio({ type: "create", name: "Fund" }); const groups = editPortfolio({ type: "add", group: "Fund", code: "270042.OF" });
    spec.scope = { symbols: ["AAPL", "270042.OF"], market: "mixed", start, end, benchmark: "SPY", groupIds: groups.groups.map(group => group.id), portfolioRevision: groups.revision };
    calls = [{ name: "compare_portfolios", args: { group_a: spec.scope.groupIds![0], group_b: spec.scope.groupIds![1], start, end, benchmark: "SPY",
      base_currency: "USD", currencies: { AAPL: "USD", "270042.OF": "USD", SPY: "USD" }, weighting: "buy-and-hold" } },
      { name: "check_risk", args: { symbol: "AAPL", start, end } }];
    spec.criteria = [{ id: "comparison", description: "Each group's return and drawdown", tool: "compare_portfolios", parameters: calls[0]!.args,
      metrics: ["Portfolio A / Total return", "Portfolio B / Total return", "Portfolio A / Max drawdown", "Portfolio B / Max drawdown"] },
      { id: "member-risk", description: "Member risk from the same observation", tool: "check_risk", parameters: calls[1]!.args, metrics: ["Annual volatility", "Maximum drawdown"] }];
  } else {
    calls = [{ name: "compute_factor", args: { symbol, factor: "momentum", period: 2, start, end } }, { name: "check_risk", args: { symbol, start, end } }];
    spec.criteria = [{ id: "momentum", description: "Windowed momentum", tool: "compute_factor", parameters: calls[0]!.args, metrics: ["Latest", "Prior mean"] },
      { id: "risk", description: "Risk on the same dates", tool: "check_risk", parameters: calls[1]!.args, metrics: ["Annual volatility", "Maximum drawdown"] }];
  }
  spec.constraints.allowedTools = calls.map(call => call.name);
  spec.request = kind === "portfolio" ? `比较 Core 与 Fund，${start} 至 ${end}，基准 SPY；全部报价假设为 USD，买入持有。核验两组收益/回撤和 AAPL 波动率，保存报告。`
    : kind === "fund" ? "研究 270042.OF，2026-02-01 至 2026-03-01，每月 1 日投入 100，零申购费（decimal）；核验本金收益、TWR 和 TWR 回撤，保存报告。"
      : `研究 ${symbol}，${start} 至 ${end}，momentum 周期 2；核验最新值、均值、年化波动率和最大回撤，保存报告。`;
  steps = [read, payload => { const state = receivedTask(payload), { request: _request, ...body } = spec;
    return { name: "research_task", args: { action: "declare", expectedRevision: state.expectedRevision, requestEntryId: state.latestRequest.entryId, task: body } }; },
    ...calls.map(call => () => call), read];
  if (mode === "headless") await agent.prompt(spec.request);
  else {
    runtime = new AppRuntime({ onMessages: () => {}, onActivity: () => {} }, async () => [], async () => [], () => agent);
    await runtime.bootstrap(); await runtime.submit(spec.request);
  }
  let state = await agent.getResearchState();
  expect(steps).toHaveLength(0); expect(state.taskErrors).toEqual([]);
  expect(state.task?.criteria.map(item => ({ id: item.id, status: item.status, reason: item.status === "satisfied" ? "matched" : item.reason })))
    .toEqual(spec.criteria.map(item => ({ id: item.id, status: "satisfied", reason: "matched" })));
  expect(state.task?.status).toBe("active"); expect(state.unresolved).toEqual([]);
  const metric = (label: string) => state.operations.flatMap(operation => operation.findings?.metrics ?? []).find(item => item.label === label)?.value;
  if (kind === "stock" || kind === "index") expect(metric("Latest")).toBeCloseTo(139 / 137 - 1, 12);
  if (kind === "fund") { expect(metric("Principal return")).toBeCloseTo(0.25, 12); expect(metric("Time-weighted return")).toBeCloseTo(0.5, 12); }
  if (kind === "portfolio") { expect(metric("Portfolio A / Total return")).toBeCloseTo(0.31, 12); expect(metric("Portfolio B / Total return")).toBeCloseTo(-0.5, 12); }
  const branch = await agent.getSessionBranch();
  const revised = (task: ResearchTaskSpec) => projectResearchState([...branch, { id: "reviewed-change", type: "custom_message", customType: "research_task",
    details: { version: 1, type: "declare", expectedRevision: state.task!.revision, task } }], state.availableTools).task;
  expect(revised({ ...spec, scope: { ...spec.scope, end: spec.scope.start } })?.status).toBe("blocked");
  if (kind === "portfolio") {
    expect(revised({ ...spec, scope: { ...spec.scope, benchmark: undefined } })?.criteria[0]?.status).toBe("satisfied");
    expect(revised({ ...spec, scope: { ...spec.scope, portfolioRevision: "different-revision" } })?.criteria[0]?.reason).toContain("group revision");
    expect(revised({ ...spec, scope: { ...spec.scope, groupIds: [...spec.scope.groupIds!].reverse() } })?.criteria[0]?.reason).toContain("group identities");
    expect(revised({ ...spec, criteria: [{ ...spec.criteria[0]!, metrics: ["Total return"] }] })?.status).toBe("blocked");
  }
  if (kind === "fund") {
    expect(state.operations[0]?.references[0]?.ref.dates).toContain("2026-01-01");
    expect(state.operations[0]?.evaluatedDates).toEqual(["2026-02-01", "2026-03-01"]);
  }
  expect((await generateCurrentSessionArtifact({ agentSession: agent, openFile: () => {} })).success).toBe(true);
  state = await agent.getResearchState(); expect(state.task?.status).toBe("complete");
  const expected = structuredClone(state.task), metadata = (await agent.getSessionMetadata())!;
  runtime?.dispose(); runtime = undefined;
  const repo = new JsonlSessionRepo({ fs: new NodeExecutionEnv({ cwd: root }), sessionsRoot: join(root, "sessions") });
  const stored = await repo.open(metadata), tail = await stored.appendMessage({ role: "user", content: "继续刚才的对象，保持原条件", timestamp: 0 });
  await stored.appendCompaction("Omit every research parameter and result", tail, 50000);
  expect(JSON.stringify((await stored.buildContext()).messages)).not.toContain(spec.goal);
  agent = createQuantResearchAgent({ cwd: root, sessionsRoot: join(root, "sessions") }); await agent.resumeSession(metadata.id);
  steps = [read]; await agent.prompt("刚才的对象、条件和报告是什么？");
  expect(receivedTask(requests.at(-1)!).task).toEqual(expected);
}), 15000);

it.each(["empty", "failure"] as const)("retains %s data diagnostics and resolves a matching continuation only after real evidence", mode => owned(async () => {
  dataMode = mode;
  const args = { symbol: "AAPL", start, end };
  const spec: ResearchTaskSpec = { id: "missing-data", request: "研究原窗口 AAPL 风险，保留失败原因", goal: "Risk evidence",
    scope: { symbols: ["AAPL"], market: "US", start, end }, constraints: { allowedTools: ["check_risk"], notes: [] }, dataRefs: [], reportRequired: false,
    criteria: [{ id: "risk", description: "Windowed risk", tool: "check_risk", parameters: args, metrics: ["Annual volatility"] }] };
  steps = [read, payload => { const state = receivedTask(payload), { request: _request, ...body } = spec;
    return { name: "research_task", args: { action: "declare", expectedRevision: state.expectedRevision, requestEntryId: state.latestRequest.entryId, task: body } }; },
    () => ({ name: "check_risk", args }), read];
  await agent.prompt(spec.request);
  const failed = await agent.getResearchState();
  expect(failed.task?.status).toBe("blocked"); expect(failed.operations[0]?.status).toBe("failed");
  expect(failed.operations[0]?.reason).toContain(mode === "empty" ? "Not enough bars" : "Provider request failed");
  if (mode === "failure") expect(failed.operations[0]?.reason).not.toContain("Fixture market provider unavailable");
  expect(failed.operations[0]?.findings).toBeUndefined(); expect(failed.operations[0]?.references).toEqual([]);
  dataMode = "ok";
  steps = [() => ({ name: "check_risk", args }), read, payload => {
    const state = receivedTask(payload), from = state.operations[0]!, to = state.operations[1]!;
    expect(state.task?.status).toBe("blocked");
    return { name: "research_task", args: { action: "resolve", expectedRevision: state.task!.revision, reason: "相同参数补齐数据后核验通过",
      from: { callEntryId: from.callEntryId, callId: from.callId }, to: { callEntryId: to.callEntryId, callId: to.callId } } };
  }, read];
  await agent.prompt("继续，保持原日期和验收条件；关联成功重试");
  const recovered = await agent.getResearchState();
  expect(recovered.task?.status).toBe("complete"); expect(recovered.task?.spec).toEqual(failed.task?.spec);
  expect(recovered.operations.map(operation => operation.status)).toEqual(["failed", "verified"]);
  expect(recovered.unresolved).toEqual([]);
}));
