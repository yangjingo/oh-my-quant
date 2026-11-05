import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { loadSettings, saveSettings, loadDataset, saveBars, saveBenchmarkResult } from "../../storage/index.ts";
import { projectResearchState, formatResearchContext, type ResearchEntry } from "../state.ts";
import { buildResearchReport } from "../input.ts";
import { checkResearchTaskCall, validateResearchTask, validateResearchTaskEvent } from "../tasks.ts";
import { backtestFixture, researchEntries, researchMessages } from "./fixtures.ts";
import { computeFactorTool, runBacktestTool, scoreBenchmarkTool, showDashboardTool } from "../../tools/quant-tools.ts";
import type { ResearchTaskSpec, ResearchTaskEvent } from "../../types/research-task.ts";
import type { DatasetRef } from "../../types/data.ts";

let root: string, previous: string | undefined;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR; root = mkdtempSync(join(tmpdir(), "whyj-task-evidence-")); process.env.OHQUANT_DIR = root;
  const settings = loadSettings(); settings.preferences.source = "financial-datasets"; saveSettings(settings);
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected task fixture root");
  rmSync(root, { recursive: true, force: true });
});

function taskSpec(): ResearchTaskSpec {
  return { id: "aapl-study", request: "按固定窗口回测 AAPL；保留费用与缺项", goal: "核对 AAPL 策略收益和风险",
    scope: { symbols: ["AAPL"], market: "US", start: "2026-01-01", end: "2026-02-09" },
    constraints: { allowedTools: ["run_backtest"], notes: ["不执行交易"] }, dataRefs: [], reportRequired: false,
    criteria: [{ id: "returns", description: "固定费用下的收益与回撤", tool: "run_backtest", parameters: { symbol: "AAPL", fast: 1, slow: 2, cash: 1000, commission: 0, start: "2026-01-01", end: "2026-02-09" }, metrics: ["Total return", "Maximum drawdown"] }] };
}
function note(id: string, event: ResearchTaskEvent): ResearchEntry { return { id, type: "custom_message", customType: "research_task", details: event }; }
function declaration(task = taskSpec()) { return note("task-start", { version: 1, type: "declare", expectedRevision: null, task }); }

it("rejects widening a declared symbol task to a main-board discovery even when allowedTools includes it", () => {
  const task = taskSpec(); task.constraints.allowedTools.push("scan_mainboard");
  expect(checkResearchTaskCall(task, "scan_mainboard", { start: task.scope.start, end: task.scope.end })).toContain("fresh discovery session");
});
function chain(entries: ResearchEntry[]) { return entries.map((entry, index) => ({ ...entry, parentId: entries[index - 1]?.id ?? null })); }

it("requires declared metrics, parameters and matching observed scope rather than an assistant completion claim", async () => {
  const fixture = await backtestFixture(), entries = [declaration(), ...researchEntries(fixture.messages)];
  expect(projectResearchState([declaration()], ["run_backtest"]).task?.status).toBe("active");
  expect(formatResearchContext(projectResearchState([declaration()], []) )).toContain("aapl-study");
  const complete = projectResearchState(entries, ["run_backtest"]);
  expect(complete.task).toMatchObject({ status: "complete", criteria: [{ status: "satisfied", evidence: { callId: "research-call", callEntryId: "entry-1" } }] });
  expect(complete.operations[0]!.findings!.metrics[0]!.value).toBeCloseTo(139 / 102 - 1, 12);
  const spec = taskSpec(); spec.criteria[0]!.metrics.push("Invented metric");
  expect(projectResearchState([declaration(spec), ...entries.slice(1)], []).task?.status).toBe("blocked");
  spec.criteria[0]!.metrics.pop(); spec.scope.end = "2026-02-08";
  expect(projectResearchState([declaration(spec), ...entries.slice(1)], ["run_backtest"]).task?.criteria[0]!.reason).toContain("task window");
  expect(projectResearchState([declaration(), { id: "claim", type: "message", message: { role: "assistant", content: "任务已全部完成" } }], ["run_backtest"]).task?.status).toBe("active");
  expect(projectResearchState([...entries.slice(1), declaration()], ["run_backtest"]).task?.status).toBe("active");
});

it("keeps accepted calculation values and archive references in the model context after later operations", async () => {
  const fixture = await backtestFixture();
  const entries: ResearchEntry[] = [declaration(), ...researchEntries(fixture.messages)];
  for (let index = 0; index < 8; index++) {
    const callId = `later-${index}`, args = { ...fixture.args, cash: 1100 + index };
    const result = await runBacktestTool.execute(callId, args);
    const [call, outcome] = researchMessages("run_backtest", args, result.details).slice(1);
    if (call?.role !== "assistant" || call.content[0]?.type !== "toolCall" || outcome?.role !== "toolResult") throw new Error("Invalid research fixture");
    call.content[0].id = callId;
    outcome.toolCallId = callId;
    entries.push({ id: `later-call-entry-${index}`, type: "message", message: call },
      { id: `later-result-entry-${index}`, type: "message", message: outcome });
  }
  const state = projectResearchState(entries, ["run_backtest"]);
  expect(state.task?.status).toBe("complete");
  const accepted = state.operations[0]!;
  expect(state.operations).toHaveLength(9);

  const context = formatResearchContext(state);
  const snapshot = JSON.parse(context.slice(context.indexOf('{"version"'))) as {
    operations: { items: Array<{ callId: string; findings?: { metrics: { items: Array<{ label: string; value: number }> } }; references: { items: Array<{ ref: { revision: string } }> } }> };
  };
  const visible = snapshot.operations.items.find(operation => operation.callId === accepted.callId);
  expect(visible?.findings?.metrics.items.find(metric => metric.label === "Total return")?.value).toBeCloseTo(139 / 102 - 1, 12);
  expect(visible?.references.items[0]?.ref.revision).toBe(String(accepted.references[0]?.ref.revision));

  rmSync(join(root, "data", "financial-datasets", "AAPL", "revisions", `${String(accepted.references[0]?.ref.revision)}.json`));
  const missing = projectResearchState(entries, ["run_backtest"]);
  expect(missing.task?.criteria[0]?.status).toBe("blocked");
  expect(formatResearchContext(missing)).not.toContain('"label":"Total return"');
});

it("does not satisfy a criterion when a verified call adds an undeclared cash assumption", async () => {
  const fixture = await backtestFixture();
  const spec = taskSpec();
  delete spec.criteria[0]!.parameters.cash;
  const state = projectResearchState([declaration(spec), ...researchEntries(fixture.messages)], ["run_backtest"]);
  expect(state.operations[0]?.status).toBe("verified");
  expect(state.task?.status).toBe("active");
  expect(state.task?.criteria[0]).toMatchObject({ status: "pending", evidence: null });
  expect(state.task?.criteria[0]?.reason).toContain("parameters differ: cash");
});

it("does not satisfy a scoped SPY benchmark with the tool's default CSI 300", async () => {
  const settings = loadSettings(); settings.preferences.source = "akshare"; saveSettings(settings);
  const bars = Array.from({ length: 120 }, (_, index) => {
    const close = 100 + index * 0.2;
    return { date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      open: close, high: close, low: close, close, volume: 100, amount: 1000 };
  });
  await saveBars("AAPL", "akshare", bars, "1900-01-01");
  await saveBars("000300.SH", "akshare", bars, "1900-01-01");
  const args = { symbol: "AAPL", fast: 5, slow: 20 };
  const result = await scoreBenchmarkTool.execute("research-call", args);
  const spec = taskSpec();
  spec.scope = { symbols: ["AAPL", "000300.SH"], market: "mixed", start: "2026-01-01", end: "2026-04-30", benchmark: "SPY" };
  spec.constraints.allowedTools = ["score_benchmark"];
  spec.criteria = [{ id: "score", description: "SPY 基准下的评分", tool: "score_benchmark", parameters: args, metrics: ["Score / 100"] }];
  expect(checkResearchTaskCall(spec, "score_benchmark", args)).toContain("Benchmark differs from the task");
  expect(checkResearchTaskCall(spec, "score_benchmark", { ...args, benchmark_symbol: "SPY" })).toBeNull();
  const state = projectResearchState([declaration(spec), ...researchEntries(researchMessages("score_benchmark", args, result.details))], ["score_benchmark"]);
  expect(state.operations[0]?.status).toBe("verified");
  expect(state.task?.status).toBe("blocked");
  expect(state.task?.criteria[0]?.reason).toContain("Benchmark differs from the task");
  spec.scope.benchmark = "000300.SH";
  expect(checkResearchTaskCall(spec, "score_benchmark", args)).toBeNull();
  expect(projectResearchState([declaration(spec), ...researchEntries(researchMessages("score_benchmark", args, result.details))], ["score_benchmark"]).task?.status).toBe("complete");
  delete spec.scope.benchmark;
  spec.scope.symbols = ["AAPL"];
  spec.scope.market = "US";
  expect(projectResearchState([declaration(spec), ...researchEntries(researchMessages("score_benchmark", args, result.details))], ["score_benchmark"]).task?.status).toBe("complete");
  await saveBars("SPY", "akshare", bars, "1900-01-01");
  const explicit = { ...args, benchmark_symbol: "SPY" };
  const spyResult = await scoreBenchmarkTool.execute("research-call", explicit);
  spec.criteria[0]!.parameters = explicit;
  expect(checkResearchTaskCall(spec, "score_benchmark", explicit)).toBeNull();
  expect(projectResearchState([declaration(spec), ...researchEntries(researchMessages("score_benchmark", explicit, spyResult.details))], ["score_benchmark"]).task?.status).toBe("complete");
});

it("does not treat a mixed-benchmark saved dashboard as a SPY-scoped result", async () => {
  const bars = Array.from({ length: 120 }, (_, index) => {
    const close = 100 + index * 0.2;
    return { date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      open: close, high: close, low: close, close, volume: 100, amount: 1000 };
  });
  const refs = new Map<string, DatasetRef>();
  for (const symbol of ["AAPL", "SPY", "QQQ"]) refs.set(symbol, (await saveBars(symbol, "financial-datasets", bars, "1900-01-01"))!);
  await scoreBenchmarkTool.execute("score-SPY", { symbol: "AAPL", benchmark_symbol: "SPY", fast: 5, slow: 20, label: "a00" });
  const args = {};
  const spec = taskSpec();
  spec.scope = { symbols: ["AAPL", "SPY", "QQQ"], market: "US", start: "2026-01-01", end: "2026-04-30", benchmark: "SPY" };
  spec.constraints.allowedTools = ["show_dashboard"];
  spec.criteria = [{ id: "ranking", description: "SPY 基准评分汇总", tool: "show_dashboard", parameters: args, metrics: ["Evaluations"] }];
  const onlySpy = await showDashboardTool.execute("research-call", args);
  const onlySpyState = projectResearchState([declaration(spec), ...researchEntries(researchMessages("show_dashboard", args, onlySpy.details))], ["show_dashboard"]);
  expect(onlySpyState.task?.status).toBe("complete");
  saveBenchmarkResult("invalid-qqq.json", { strategy: "excluded", totalScore: 999,
    datasets: { benchmark: { ...refs.get("QQQ")!, revision: "0".repeat(64) } } });
  const withExcluded = await showDashboardTool.execute("research-call", args);
  expect(projectResearchState([declaration(spec), ...researchEntries(researchMessages("show_dashboard", args, withExcluded.details))], ["show_dashboard"]).task?.status).toBe("complete");
  for (let index = 1; index <= 10; index++) await scoreBenchmarkTool.execute(`score-SPY-${index}`, {
    symbol: "AAPL", benchmark_symbol: "SPY", fast: 5, slow: 20, label: `a${String(index).padStart(2, "0")}`,
  });
  await scoreBenchmarkTool.execute("score-QQQ", { symbol: "AAPL", benchmark_symbol: "QQQ", fast: 5, slow: 20, label: "z99" });
  const result = await showDashboardTool.execute("research-call", args);
  expect((result.details as { rows: Array<{ strategy: string }> }).rows.map(row => row.strategy)).not.toContain("z99");
  const entries = researchEntries(researchMessages("show_dashboard", args, result.details));
  const state = projectResearchState([declaration(spec), ...entries], ["show_dashboard"]);
  expect(state.operations[0]?.status).toBe("verified");
  expect(new Set(state.operations[0]?.benchmarkSymbols)).toEqual(new Set(["SPY", "QQQ"]));
  expect(state.task?.status).toBe("blocked");
  expect(state.task?.criteria[0]?.reason).toContain("Benchmark differs from the task");
  delete spec.scope.benchmark;
  spec.scope.symbols = ["AAPL"];
  expect(projectResearchState([declaration(spec), ...entries], ["show_dashboard"]).task?.status).toBe("complete");
  await saveBars("MSFT", "financial-datasets", bars, "1900-01-01");
  await scoreBenchmarkTool.execute("score-MSFT", { symbol: "MSFT", benchmark_symbol: "SPY", fast: 5, slow: 20, label: "m00" });
  const outside = await showDashboardTool.execute("research-call", args);
  const outsideState = projectResearchState([declaration(spec), ...researchEntries(researchMessages("show_dashboard", args, outside.details))], ["show_dashboard"]);
  expect(outsideState.task?.status).toBe("blocked");
  expect(outsideState.task?.criteria[0]?.reason).toContain("outside the task scope");
});

it("accepts independently verified historical dashboard scores from different price revisions", async () => {
  const bars = Array.from({ length: 120 }, (_, index) => {
    const close = 100 + index * 0.2;
    return { date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      open: close, high: close, low: close, close, volume: 100, amount: 1000 };
  });
  await saveBars("AAPL", "financial-datasets", bars, "1900-01-01");
  await saveBars("SPY", "financial-datasets", bars, "1900-01-01");
  await scoreBenchmarkTool.execute("score-before", { symbol: "AAPL", benchmark_symbol: "SPY", fast: 5, slow: 20, label: "before" });
  await saveBars("AAPL", "financial-datasets", bars.map((bar, index) => index === 60
    ? { ...bar, open: bar.open + 5, high: bar.high + 5, low: bar.low + 5, close: bar.close + 5 } : bar), "1900-01-01");
  await scoreBenchmarkTool.execute("score-after", { symbol: "AAPL", benchmark_symbol: "SPY", fast: 5, slow: 20, label: "after" });
  const args = {}, result = await showDashboardTool.execute("research-call", args);
  const spec = taskSpec();
  spec.scope = { symbols: ["AAPL"], market: "US", start: "2026-01-01", end: "2026-04-30", benchmark: "SPY" };
  spec.constraints.allowedTools = ["show_dashboard"];
  spec.criteria = [{ id: "ranking", description: "SPY 历史评分汇总", tool: "show_dashboard", parameters: args, metrics: ["Evaluations"] }];
  const state = projectResearchState([declaration(spec), ...researchEntries(researchMessages("show_dashboard", args, result.details))], ["show_dashboard"]);
  expect(state.operations[0]?.status).toBe("verified");
  expect(state.operations[0]?.findings?.metrics.find(metric => metric.label === "Evaluations")?.value).toBe(2);
  expect(state.task?.criteria[0]?.status).toBe("satisfied");
  expect(state.task?.status).toBe("complete");
  const firstStrategy = state.operations[0]!.references.find(reference => reference.role === "result-0-strategy")!.ref;
  spec.dataRefs = [{ kind: "daily-bars", symbol: "AAPL", revision: String(firstStrategy.revision), contentHash: String(firstStrategy.contentHash) }];
  const pinned = projectResearchState([declaration(spec), ...researchEntries(researchMessages("show_dashboard", args, result.details))], ["show_dashboard"]);
  expect(pinned.task?.status).toBe("blocked");
  expect(pinned.task?.criteria[0]?.reason).toContain("version differs");
});

it("rejects malformed scopes, duplicate acceptance IDs, unallowed tools and non-JSON parameters", () => {
  for (const change of [
    (task: ResearchTaskSpec) => { task.scope.market = "A"; },
    (task: ResearchTaskSpec) => { task.scope.end = "2025-01-01"; },
    (task: ResearchTaskSpec) => { task.criteria.push(structuredClone(task.criteria[0]!)); },
    (task: ResearchTaskSpec) => { task.constraints.allowedTools = []; },
    (task: ResearchTaskSpec) => { task.criteria[0]!.parameters.invalid = Infinity; },
  ]) { const task = taskSpec(); change(task); expect(() => validateResearchTask(task)).toThrow(); }
});

it("allows a current price criterion to pin its market while rejecting a wrong market or source", () => {
  const task = taskSpec();
  task.criteria[0]!.parameters.market = "US";
  expect(validateResearchTask(task).criteria[0]!.parameters.market).toBe("US");
  expect(checkResearchTaskCall(task, "run_backtest", { symbol: "AAPL", market: "US" })).toBeNull();
  const wrongMarket = structuredClone(task); wrongMarket.criteria[0]!.parameters.market = "A";
  expect(() => validateResearchTask(wrongMarket)).toThrow();
  expect(checkResearchTaskCall(task, "run_backtest", { symbol: "AAPL", market: "A" })).toContain("market differs");
  const wrongSource = structuredClone(task); wrongSource.criteria[0]!.parameters.source = "akshare";
  expect(() => validateResearchTask(wrongSource)).toThrow("source requires observed_before");
});

it("preserves failed attempts until an explicit matching verified retry resolves them, reopening when its archive is lost", async () => {
  const fixture = await backtestFixture();
  const failed = researchEntries(researchMessages("run_backtest", fixture.args, {}, true)).map(entry => ({ ...entry, id: `failed-${entry.id}` }));
  const failedCall = failed[1]!.message, failedResult = failed[2]!.message;
  if (failedCall.role === "assistant" && failedCall.content[0]?.type === "toolCall") failedCall.content[0].id = "failed-call";
  if (failedResult.role === "toolResult") failedResult.toolCallId = "failed-call";
  const entries = [declaration(), ...failed, ...researchEntries(fixture.messages)];
  let state = projectResearchState(entries, ["run_backtest"]);
  expect(state.task?.status).toBe("blocked"); expect(state.task?.criteria[0]?.status).toBe("satisfied");
  const event: ResearchTaskEvent = { version: 1, type: "resolve", expectedRevision: "task-start",
    from: { callEntryId: "failed-entry-1", callId: "failed-call" }, to: { callEntryId: "entry-1", callId: "research-call" }, reason: "同参数补齐数据后成功重算" };
  expect(validateResearchTaskEvent(event, entries, state.operations, state.availableTools).status).toBe("complete");
  entries.push(note("resolved", event)); state = projectResearchState(entries, ["run_backtest"]);
  expect(state.unresolved).toEqual([]); expect(state.task?.status).toBe("complete"); expect(state.operations[0]?.status).toBe("failed");
  const ref = state.operations[1]!.references[0]!.ref;
  rmSync(join(root, "data", "financial-datasets", "AAPL", "revisions", `${ref.revision}.json`));
  state = projectResearchState(entries, ["run_backtest"]);
  expect(state.task?.revision).toBe("resolved"); expect(state.task?.resolutions[0]?.active).toBe(false);
  expect(state.task?.status).toBe("blocked"); expect(state.unresolved).toHaveLength(2);
  expect(() => validateResearchTaskEvent({ ...event, expectedRevision: "resolved" }, entries, state.operations, state.availableTools)).toThrow();
});

it("preserves task revisions on stale updates, isolates branches, and supports explicit cancellation", async () => {
  const fixture = await backtestFixture(), entries = [declaration(), ...researchEntries(fixture.messages)];
  const stale = note("stale", { version: 1, type: "declare", expectedRevision: "unreviewed", task: { ...taskSpec(), goal: "silently weakened goal" } });
  const state = projectResearchState([...entries, stale], ["run_backtest"]);
  expect(state.task?.spec.goal).toBe(taskSpec().goal); expect(state.taskErrors).toMatchObject([{ entryId: "stale" }]);
  const cancelled = projectResearchState([...entries, note("cancelled", { version: 1, type: "cancel", expectedRevision: "task-start", reason: "用户停止这项研究" })], []);
  expect(cancelled.task).toMatchObject({ revision: "cancelled", status: "cancelled", reasons: ["用户停止这项研究"] });
  expect(cancelled.task?.criteria[0]?.status).toBe("satisfied");
  expect(projectResearchState([], ["run_backtest"]).task).toBeNull();
  expect(projectResearchState(entries, ["run_backtest"]).task?.status).toBe("complete");
});

it("requires a recorded report bound to the task revision and accepted result entries", async () => {
  const fixture = await backtestFixture(), spec = taskSpec(); spec.reportRequired = true;
  const entries = chain([declaration(spec), ...researchEntries(fixture.messages)]);
  const state = projectResearchState(entries, ["run_backtest"]);
  expect(state.task?.status).toBe("active"); expect(state.task?.reportRef).toBeNull();
  const provenance = { scope: "branch", leafId: entries.at(-1)!.id, entryIds: entries.map(entry => entry.id), entryHash: createHash("sha256").update(JSON.stringify(entries)).digest("hex") };
  const report: ResearchEntry = { id: "report", type: "custom_message", customType: "artifact_export", details: { reportRef: "fixture@fixed-revision", provenance } };
  expect(projectResearchState([...entries, report], []).task).toMatchObject({ status: "blocked", reportRef: "fixture@fixed-revision", reportAvailable: null });
  expect(projectResearchState([...entries, report], [], buildResearchReport, () => false).task)
    .toMatchObject({ status: "blocked", reportAvailable: false, reasons: ["Recorded task report version is unavailable or damaged."] });
  expect(projectResearchState([...entries, report], [], buildResearchReport, () => true).task)
    .toMatchObject({ status: "complete", reportRef: "fixture@fixed-revision", reportAvailable: true });
  expect(projectResearchState([...entries, report], [], buildResearchReport, () => { throw new Error("disk offline"); }).task)
    .toMatchObject({ status: "blocked", reportAvailable: false });
  provenance.entryHash = "changed";
  expect(projectResearchState([...entries, report], []).task?.status).toBe("active");
});

it("rejects pinned input mismatches and conflicting observation revisions across required results", async () => {
  const fixture = await backtestFixture(), first = researchEntries(fixture.messages);
  const oldState = projectResearchState(first, []), ref = oldState.operations[0]!.references[0]!.ref as unknown as DatasetRef;
  const spec = taskSpec(); spec.dataRefs = [{ kind: ref.kind, symbol: ref.symbol, revision: "wrong-version", contentHash: ref.contentHash }];
  expect(projectResearchState([declaration(spec), ...first], ["run_backtest"]).task?.criteria[0]?.reason).toContain("version differs");
  await saveBars("AAPL", "financial-datasets", loadDataset(ref).map(bar => ({ ...bar, amount: (bar.amount ?? 0) + 1 })), fixture.args.start, fixture.args.end);
  const args = { ...fixture.args, fast: 2, slow: 3 }, result = await runBacktestTool.execute("second-call", args);
  const second = researchEntries(researchMessages("run_backtest", args, result.details)).map(entry => ({ ...entry, id: `second-${entry.id}` }));
  const call = second[1]!.message, response = second[2]!.message;
  if (call.role === "assistant" && call.content[0]?.type === "toolCall") call.content[0].id = "second-call";
  if (response.role === "toolResult") response.toolCallId = "second-call";
  spec.dataRefs = []; spec.criteria.push({ ...spec.criteria[0]!, id: "alternative", parameters: args });
  const state = projectResearchState([declaration(spec), ...first, ...second], ["run_backtest"]);
  expect(state.task?.criteria.map(item => item.status)).toEqual(["satisfied", "satisfied"]);
  expect(state.task?.status).toBe("blocked"); expect(state.task?.reasons.join(" ")).toContain("Conflicting observation versions");
});

it("binds the factor's requested dates even when changing them would keep all observed rows in range", async () => {
  await backtestFixture();
  const args = { symbol: "AAPL", factor: "momentum" as const, period: 2, start: "2026-01-01", end: "2026-02-09" };
  const result = await computeFactorTool.execute("factor", args);
  const entries = researchEntries(researchMessages("compute_factor", args, result.details));
  expect(projectResearchState(entries, ["compute_factor"]).operations[0]?.status).toBe("verified");
  const changed = researchEntries(researchMessages("compute_factor", { ...args, start: "2025-12-31" }, result.details));
  expect(projectResearchState(changed, ["compute_factor"]).operations[0]?.status).toBe("unverified");
  expect(projectResearchState(changed, ["compute_factor"]).operations[0]?.findings).toBeUndefined();
});

it("resolves bare fund codes only for fund operations and keeps equity identities distinct", () => {
  const task = taskSpec(); task.scope.symbols = ["270042.OF"]; task.scope.market = "A";
  task.constraints.allowedTools = ["fund_dca_backtest", "check_risk"];
  expect(checkResearchTaskCall(task, "fund_dca_backtest", { symbol: "270042" })).toBeNull();
  expect(checkResearchTaskCall(task, "check_risk", { symbol: "270042" })).toContain("outside the task scope");
  expect(checkResearchTaskCall(task, "fund_dca_backtest", { symbol: "000001" })).toContain("outside the task scope");
  expect(checkResearchTaskCall(task, "fund_dca_backtest", { symbol: "270042.SH" })).toContain("Fund symbol");
  const args = { symbol: "270042.SH" };
  task.criteria = [{ id: "bad-fund", description: "Invalid instrument remains inspectable", tool: "fund_dca_backtest", parameters: args, metrics: [] }];
  const state = projectResearchState([declaration(task), ...researchEntries(researchMessages("fund_dca_backtest", args, {}, true))], task.constraints.allowedTools);
  expect(state.task?.status).toBe("blocked"); expect(state.task?.criteria[0]?.reason).toContain("Fund symbol");
});
