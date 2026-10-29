import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createQuantResearchAgent } from "../../runtime/quant-harness.ts";
import { localProvider } from "../../runtime/test/fixtures/local-provider.ts";
import type { QuantAgentSession } from "../src/session.ts";
import { JsonlSessionRepo } from "../src/session-runtime/index.ts";
import { NodeExecutionEnv } from "../src/session-runtime/node.ts";
import { annualComparisonFixture } from "../../research/test/annual-fixture.ts";
import { listAnnualReports } from "../../runtime/research/annual-reports.ts";
import { readResearchDecisions } from "../../runtime/research/research-decisions.ts";
import { loadAnnualReport, saveSettings } from "../../storage/index.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";

let root: string, previous: string | undefined, noProxy: string | undefined;
let server: ReturnType<typeof localProvider>, agent: QuantAgentSession;
let source: ReturnType<Awaited<ReturnType<typeof annualComparisonFixture>>["save"]>;
let stop: AbortController, setup: Promise<void>, pending: Promise<void> | undefined;
let bodySettled: boolean;
const owned = (body: () => Promise<void>) => pending = Promise.resolve().then(body).finally(() => { bodySettled = true; });
const prompt = (text: string) => agent.prompt(text, { signal: stop.signal });
let steps: { name: string; args: Record<string, unknown> }[], requests: Record<string, unknown>[];
let hold: boolean, onRequest: (() => void) | undefined;
beforeEach(() => setup = (async () => {
  previous = process.env.OHQUANT_DIR; noProxy = process.env.NO_PROXY;
  root = mkdtempSync(join(tmpdir(), "whyj-annual-pi-")); process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
  steps = []; requests = []; hold = false; onRequest = undefined; pending = undefined; bodySettled = false; stop = new AbortController();
  server = localProvider(async incoming => {
    requests.push(await incoming.json() as Record<string, unknown>); onRequest?.();
    if (hold) return new Response(new ReadableStream<Uint8Array>({ start() {} }), { headers: { "content-type": "text/event-stream" } });
    const call = steps.shift();
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: `annual-${requests.length}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] }
      : { role: "assistant", content: "固定传输测试响应；不声称实际模型已验证解释质量。" };
    const chunk = { id: "annual-fixture", object: "chat.completion.chunk", created: 0, model: "annual-fixture" };
    return new Response([{ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] }]
      .map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  });
  const settings = structuredClone(DEFAULT_SETTINGS); settings.provider = "custom"; settings.model = "annual-fixture"; settings.thinkingLevel = "off";
  settings.providers = { custom: { baseUrl: `${server.url}v1`, api: "openai-completions", apiKey: "synthetic-test-key" } };
  saveSettings(settings);
  source = (await annualComparisonFixture()).save();
  agent = createQuantResearchAgent({ cwd: root, sessionsRoot: join(root, "sessions") });
  await agent.waitForIdle();
})(), 30_000);
afterEach(async () => {
  // Runner deadlines do not cancel the body or archive writes.
  if (pending && !bodySettled) console.error("Annual fixture body still active at teardown", { requests: requests.length, remainingTools: steps.map(step => step.name), hold });
  stop.abort(); await setup.catch(() => {}); agent?.abort();
  const closed = server.close();
  await pending?.catch(() => {});
  agent?.abort(); await agent?.waitForIdle(); await closed;
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (noProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = noProxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected annual Pi fixture");
  rmSync(root, { recursive: true, force: true });
}, 30_000);

test("real Pi calls default annual tools, then rebuilds the original report binding after lossy compaction and restart", () => owned(async () => {
  const args = { comparison_id: source.id, year: 2025, valuation_cutoff: "2025-12-31" };
  steps = [{ name: "annual_report", args }];
  await prompt(`用比较 ${source.id} 生成 2025 年报，截至 2025-12-31；不要写成实际账户业绩。`);
  expect(steps).toHaveLength(0); expect(requests).toHaveLength(2);
  const state = await agent.getResearchState(), operation = state.operations[0]!;
  expect(operation).toMatchObject({ tool: "annual_report", status: "recorded", parameters: args, recordedScope: {
    request: { comparisonId: source.id, year: 2025, valuationCutoff: "2025-12-31" }, accountPerformance: "not-connected", strategyHistory: "not-connected" } });
  const id = String(operation.recordedScope!.id), artifact = loadAnnualReport(id), metadata = (await agent.getSessionMetadata())!;
  const htmlPath = join(root, "reports", "annual", `${id}.html`);
  expect(operation.recordedScope!.comparisonHash).toBe(artifact.comparisonHash);
  expect(JSON.stringify(requests[1])).toContain(id);
  expect(JSON.stringify(requests[1])).toContain(artifact.comparisonHash);
  expect(JSON.stringify(requests[1])).not.toContain("<!DOCTYPE html>");
  for (const note of ["4 common valuation dates form 3 adjacent return intervals", "88 to 184 calendar days", "not risk-adjusted alpha", "descriptive sample estimates", "Zero observed drawdown does not mean zero risk"]) {
    expect(JSON.stringify(requests[1])).toContain(note);
    expect(artifact.html).toContain(note);
  }
  const repo = new JsonlSessionRepo({ fs: new NodeExecutionEnv({ cwd: root }), sessionsRoot: join(root, "sessions") });
  const stored = await repo.open(metadata), tail = await stored.appendMessage({ role: "user", content: "继续那份年报", timestamp: 0 });
  await stored.appendCompaction("摘要故意省略所有报告标识、比较和日期。", tail, 50000);
  expect(JSON.stringify((await stored.buildContext()).messages)).not.toContain(id);
  writeFileSync(htmlPath, "edited preview");
  writeFileSync(join(root, "panel-portfolio.json"), "New preferences must not be loaded for report restore");
  agent = createQuantResearchAgent({ cwd: root, sessionsRoot: join(root, "sessions") });
  await agent.resumeSession(metadata.id);
  expect((await agent.getResearchState()).operations[0]).toEqual(operation);
  const beforeRequests = requests.length;
  steps = [{ name: "annual_reports", args: { id } }];
  await prompt("恢复刚才的年报，保留原组合和截止日。");
  const payload = JSON.stringify(requests[beforeRequests]);
  for (const value of [id, source.id, "2025-12-31", artifact.comparisonHash, "not-connected"]) expect(payload).toContain(value);
  const restoredPayload = JSON.stringify(requests.at(-1));
  for (const note of ["Current interpretation of original verified inputs", "4 common valuation dates form 3 adjacent return intervals", "88 to 184 calendar days", "not risk-adjusted alpha", "descriptive sample estimates"]) expect(restoredPayload).toContain(note);
  expect(readFileSync(htmlPath, "utf8")).toBe(artifact.html);
  const restored = await agent.getResearchState();
  expect(restored.operations.map(item => item.status)).toEqual(["recorded", "recorded"]);
  expect(restored.operations[1]!.recordedScope!.id).toBe(id);
  expect(restored.operations[1]!.findings).toBeUndefined();
  expect(listAnnualReports().items).toHaveLength(1);
}));

test("missing source archive returns a persisted Pi tool error and never substitutes a report or current data", () => owned(async () => {
  steps = [{ name: "annual_report", args: { comparison_id: source.id, year: 2025, valuation_cutoff: "2025-12-31" } }];
  await prompt("生成已选比较的年度研究报告");
  const state = await agent.getResearchState(), id = String(state.operations[0]!.recordedScope!.id), original = loadAnnualReport(id);
  const ref = source.result.input.prices[0]!.dataset!;
  unlinkSync(join(root, "data", ref.source, ref.symbol, "revisions", `${ref.revision}.json`));
  steps = [{ name: "annual_reports", args: { id } }];
  await prompt("恢复同一报告，并重新核对原始数据。");
  const failed = (await agent.getResearchState()).operations.at(-1)!;
  expect(failed).toMatchObject({ tool: "annual_reports", status: "failed", parameters: { id } });
  expect(failed.reason).toContain("Dataset revision unavailable");
  expect(JSON.stringify(requests.at(-1))).toContain("Dataset revision unavailable");
  expect(loadAnnualReport(id)).toEqual(original);
  expect(listAnnualReports()).toMatchObject({ items: [], unavailable: [{ file: `${id}.json` }] });
}));

test("invalid annual window fails through the Pi schema/tool boundary without publishing", () => owned(async () => {
  steps = [{ name: "annual_report", args: { comparison_id: source.id, year: 2025, valuation_cutoff: "2025-09-30" } }];
  await prompt("把年度比较改成截至九月底的报告");
  const operation = (await agent.getResearchState()).operations[0]!;
  expect(operation.status).toBe("failed"); expect(operation.reason).toContain("Comparison window must be");
  expect(listAnnualReports().items).toHaveLength(0);
  expect(existsSync(join(root, "reports", "annual"))).toBe(false);
}));

test("cancelling an in-flight Pi request cannot publish an annual report", () => owned(async () => {
  steps = [{ name: "annual_report", args: { comparison_id: source.id, year: 2025, valuation_cutoff: "2025-12-31" } }];
  hold = true;
  const requested = new Promise<void>(resolve => { onRequest = resolve; });
  const pending = prompt("生成年度报告").catch(() => {});
  await Promise.race([requested, pending]); stop.signal.throwIfAborted();
  expect(requests).toHaveLength(1); // A startup failure must not masquerade as cancellation of an in-flight request.
  agent.abort(); await pending; await agent.waitForIdle();
  expect(listAnnualReports().items).toHaveLength(0); expect(steps).toHaveLength(1);
  expect(existsSync(join(root, "reports", "annual"))).toBe(false);
}));

test("Pi records a decision once, recovers its evidence after compaction and selects it for annual research", () => owned(async () => {
  const decision = { requestId: "pi-review-2025-001", comparisonId: source.id, declaredDate: "2025-12-31", choice: "defer", rationale: "补录：仍需更多证据，未执行交易。" };
  steps = [{ name: "research_decisions", args: { action: "record", decision } }];
  await prompt("把这次研究选择记录为暂缓，保留比较和理由；这是补录，不是成交。");
  const operation = (await agent.getResearchState()).operations[0]!, entry = readResearchDecisions().items[0]!;
  expect(operation).toMatchObject({ tool: "research_decisions", status: "recorded", parameters: { action: "record", decision },
    recordedScope: { decision: entry.decision, hash: entry.hash, retrospective: true, evidenceAfterDeclaredDate: true } });
  expect(operation.findings).toBeUndefined();
  const payload = JSON.stringify(requests.at(-1));
  for (const value of [decision.rationale, entry.decision.id, entry.hash, entry.decision.recordedAt]) expect(payload).toContain(value);
  const metadata = (await agent.getSessionMetadata())!;
  const repo = new JsonlSessionRepo({ fs: new NodeExecutionEnv({ cwd: root }), sessionsRoot: join(root, "sessions") });
  const stored = await repo.open(metadata), tail = await stored.appendMessage({ role: "user", content: "继续上次研究", timestamp: 0 });
  await stored.appendCompaction("故意丢弃决策标识、理由和引用。", tail, 50000);
  expect(JSON.stringify((await stored.buildContext()).messages)).not.toContain(entry.decision.id);
  agent = createQuantResearchAgent({ cwd: root, sessionsRoot: join(root, "sessions") });
  await agent.resumeSession(metadata.id);
  expect((await agent.getResearchState()).operations[0]).toEqual(operation);
  const at = requests.length;
  steps = [
    { name: "research_decisions", args: { action: "record", decision } },
    { name: "research_decisions", args: { action: "read", id: entry.decision.id } },
    { name: "annual_report", args: { comparison_id: source.id, year: 2025, valuation_cutoff: "2025-12-31", decision_ids: [entry.decision.id] } },
  ];
  await prompt("重试同一请求，然后读取决策并纳入年报。");
  expect(steps).toHaveLength(0);
  expect(JSON.stringify(requests[at])).toContain(entry.hash);
  expect(readResearchDecisions()).toEqual({ items: [entry], unavailable: [] });
  const annual = (await agent.getResearchState()).operations.at(-1)!;
  expect(annual).toMatchObject({ tool: "annual_report", status: "recorded", recordedScope: {
    strategyHistory: "recorded-research-decisions", accountPerformance: "not-connected", decisionHashes: [{ id: entry.decision.id, hash: entry.hash }] } });
  expect(loadAnnualReport(String(annual.recordedScope!.id)).html).toContain(decision.rationale);
  unlinkSync(join(root, "research", "decisions", `${entry.decision.id}.json`));
  steps = [{ name: "annual_reports", args: { id: annual.recordedScope!.id } }];
  await prompt("重新核对并恢复这份年报");
  expect((await agent.getResearchState()).operations.at(-1)?.status).toBe("failed");
  expect(listAnnualReports().unavailable).toHaveLength(1);
}));

test("Pi rejects account fields in the decision schema before committing", () => owned(async () => {
  steps = [{ name: "research_decisions", args: { action: "record", decision: {
    requestId: "pi-invalid-001", comparisonId: source.id, declaredDate: "2025-12-31", choice: "retain", rationale: "fixture", quantity: 100,
  } } }];
  await prompt("fixture invalid decision");
  expect((await agent.getResearchState()).operations[0]?.status).toBe("failed");
  expect(readResearchDecisions().items).toHaveLength(0);
  expect(existsSync(join(root, "research", "decisions"))).toBe(false);
}));
