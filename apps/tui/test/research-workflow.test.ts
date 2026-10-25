import { expect, it, spyOn } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setImmediate } from "node:timers/promises";
import { AppRuntime, createInitialAppState, createRuntimeAgent } from "../../../src/app-runtime.ts";
import { QuantTui } from "../src/tui.ts";
import { PanelController } from "../src/panel.ts";
import { nextInputAction, type InputAction } from "../src/input.ts";
import { createDefaultSessionDependencies } from "../../../src/runtime/session-dependencies.ts";
import { createQuantResearchAgent } from "../../../src/runtime/quant-harness.ts";
import { generateCurrentSessionArtifact, listRestorableArtifactReports, restoreArtifactReport } from "../../../src/runtime/research/artifact-reports.ts";
import { loadPanelPortfolio, loadSettings, saveSettings } from "../../../src/storage/index.ts";
import { DEFAULT_SETTINGS } from "../../../src/types/config.ts";
import * as source from "../../../src/source/index.ts";

type FixtureCall = { name: string; args: Record<string, unknown> };

function researchTaskDetails(payload: Record<string, unknown>): {
  expectedRevision: string;
  latestRequest: { entryId: string };
} {
  const messages = payload.messages as Array<{ role: string; content: string }>;
  const result = messages.findLast(message => message.role === "tool"
    && typeof message.content === "string"
    && message.content.includes("\nTask details: "));
  if (!result) throw new Error("Missing model-visible task state");
  return JSON.parse(result.content.split("\nTask details: ")[1]!);
}

it("produces the same verified Quant Harness task through the real TUI and headless entry", async () => {
  const previous = process.env.OHQUANT_DIR, noProxy = process.env.NO_PROXY;
  process.env.NO_PROXY = "127.0.0.1,localhost";
  const roots: string[] = [];
  const runtimes: AppRuntime[] = [];
  const agents: ReturnType<typeof createQuantResearchAgent>[] = [];
  let steps: Array<(payload: Record<string, unknown>) => FixtureCall | undefined> = [];
  const request = "研究 AAPL，2026-01-01 至 2026-02-09，核验同一窗口的年化波动率和最大回撤。";
  const riskArgs = { symbol: "AAPL", start: "2026-01-01", end: "2026-02-09" };
  const task = {
    id: "same-entry-risk",
    goal: "Verify AAPL risk from one archived observation",
    scope: { symbols: ["AAPL"], market: "US", start: riskArgs.start, end: riskArgs.end },
    constraints: { allowedTools: ["check_risk"], notes: ["Synthetic observations; research only"] },
    dataRefs: [],
    reportRequired: false,
    criteria: [{ id: "risk", description: "Risk from the requested window", tool: "check_risk",
      parameters: riskArgs, metrics: ["Annual volatility", "Maximum drawdown"] }],
  };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(incoming) {
    const payload = await incoming.json() as Record<string, unknown>;
    const call = steps.shift()?.(payload);
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: `same-entry-${steps.length}`, type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.args) } }] }
      : { role: "assistant", content: "AAPL risk is verified from the requested archived window." };
    const chunk = { id: "same-entry", object: "chat.completion.chunk", created: 0, model: "same-entry-fixture" };
    return new Response([{ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] }]
      .map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } });
  } });
  const fetchBars = source.fetchBars;
  const adapter = { async fetchBars() {
    return Array.from({ length: 40 }, (_, index) => {
      const close = 100 + index;
      return { date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
        open: close, high: close, low: close, close, volume: 10, amount: 1000 };
    });
  } };
  const transport = spyOn(source, "fetchBars").mockImplementation((symbol, market, from, to, preferred, options = {}) =>
    fetchBars(symbol, market, from, to, preferred, { ...options, providers: { ...options.providers, adapters: {
      akshare: adapter, tushare: adapter, "llmquant-data": adapter, "financial-datasets": adapter,
    } } }));
  const run = async (mode: "headless" | "tui") => {
    const root = mkdtempSync(join(tmpdir(), `whyj-same-entry-${mode}-`)); roots.push(root); process.env.OHQUANT_DIR = root;
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.provider = "custom"; settings.model = "same-entry-fixture"; settings.thinkingLevel = "off";
    settings.providers = { custom: { api: "openai-completions", baseUrl: `${server.url}v1`, apiKey: "fixture" } };
    settings.preferences.source = "financial-datasets"; saveSettings(settings);
    const agent = createQuantResearchAgent({ cwd: root, sessionsRoot: join(root, "sessions") }); agents.push(agent);
    steps = [() => ({ name: "research_task", args: { action: "read" } }), payload => {
      const details = researchTaskDetails(payload);
      return { name: "research_task", args: { action: "declare", expectedRevision: details.expectedRevision,
        requestEntryId: details.latestRequest.entryId, task } };
    }, () => ({ name: "check_risk", args: riskArgs }), () => ({ name: "research_task", args: { action: "read" } })];
    let visible = "";
    if (mode === "headless") await agent.prompt(request);
    else {
      const tui = new QuantTui(createInitialAppState("same-entry-fixture"));
      tui.screen.out = { columns: 80, rows: 24, write: () => true } as unknown as NodeJS.WriteStream; tui.screen.resize();
      const runtime = new AppRuntime({ onMessages: messages => tui.update({ messages }), onActivity: activity => tui.update({ activity }),
        onComposerStatus: composerStatus => tui.update({ composerStatus }), onModel: model => tui.update(model),
        onLocalState: state => tui.update(state), onPanel: (panel, panelLoading) => tui.update({ panel, panelLoading }) },
      async () => [], async () => [], () => agent); runtimes.push(runtime);
      const pending: Promise<unknown>[] = []; tui.onSubmit(text => { pending.push(runtime.submit(text)); });
      await runtime.bootstrap();
      const dispatch = Reflect.get(tui, "handleKeyAction").bind(tui) as (action: Extract<InputAction, { type: "key" }>) => void;
      let input = request + "\r";
      while (input) {
        const decoded = nextInputAction(input); input = decoded.rest;
        if (!decoded.action) throw new Error("Incomplete fixture input");
        if (decoded.action.type === "key") dispatch(decoded.action);
      }
      while (pending.length) await Promise.all(pending.splice(0));
      Reflect.get(tui, "paint").call(tui); visible = tui.screen.buf.toPlain().join("\n");
      expect(tui.state.messages.some(message => message.text?.includes("AAPL risk is verified"))).toBe(true);
      (Reflect.get(tui, "panel") as PanelController).close();
    }
    expect(steps).toHaveLength(0);
    const state = await agent.getResearchState();
    expect(state.taskErrors).toEqual([]); expect(state.unresolved).toEqual([]); expect(state.task?.status).toBe("complete");
    expect(state.task?.criteria.map(item => ({ id: item.id, status: item.status }))).toEqual([{ id: "risk", status: "satisfied" }]);
    const metrics = Object.fromEntries(state.operations[0]!.findings!.metrics.map(metric => [metric.label, metric.value]));
    return { spec: state.task!.spec, criteria: state.task!.criteria.map(item => ({ id: item.id, status: item.status })),
      operations: state.operations.map(operation => ({ tool: operation.tool, status: operation.status })), metrics, visible };
  };
  try {
    const headless = await run("headless"), tui = await run("tui");
    expect(tui.spec).toEqual(headless.spec); expect(tui.criteria).toEqual(headless.criteria);
    expect(tui.operations).toEqual(headless.operations); expect(tui.metrics).toEqual(headless.metrics);
    expect(tui.visible).toContain("AAPL risk is verified");
  } finally {
    for (const runtime of runtimes) await runtime.shutdown();
    for (const agent of agents) { agent.abort(); await agent.waitForIdle(); }
    transport.mockRestore(); server.stop(true);
    if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
    if (noProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = noProxy;
    for (const root of roots) {
      if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected workflow fixture path");
      rmSync(root, { recursive: true, force: true });
    }
  }
}, 30000);

// Real key decoding, TUI, Pi loop, calculations, archives and report restoration.
// The model's scripted SSE and provider observations are deterministic fixtures.
it.each([80, 120])("completes single-portfolio research, automatic report and recovery at width %s", async width => {
  const previous = process.env.OHQUANT_DIR, noProxy = process.env.NO_PROXY;
  const root = mkdtempSync(join(tmpdir(), "whyj-tui-workflow-"));
  process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
  let requestCount = 0, sourceCalls = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const payload = await request.json() as { tools?: Array<{ function: { name: string } }> };
    expect(payload.tools?.some(tool => tool.function.name === "compare_portfolios")).not.toBe(true);
    const research = payload.tools?.some(tool => tool.function.name === "check_risk") ?? false;
    const call = research && ++requestCount === 1;
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: "workflow-comparison", type: "function", function: {
      name: "check_risk", arguments: JSON.stringify({ symbol: "AAPL", start: "2026-01-01", end: "2026-02-09" }),
    } }] } : { role: "assistant", content: research
      ? "Fixture research completed. Synthetic observations; no investment recommendation." : "Model connection verified." };
    const chunk = { id: "workflow", object: "chat.completion.chunk", created: 0, model: "workflow-fixture" };
    return new Response([{ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] }]
      .map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const dataServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ prices: [
    { date: new Date().toISOString().slice(0, 10), open: 10, high: 10, low: 10, close: 10, volume: 1 },
  ] }) });
  const fetchBars = source.fetchBars;
  const adapter = { async fetchBars(request: { symbol: string }) {
    sourceCalls++;
    return Array.from({ length: 40 }, (_, index) => {
      const close = 100 + index * (request.symbol === "AAPL" ? 1 : request.symbol === "SPY" ? 0.5 : 0);
      return { date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10), open: close, high: close, low: close, close, volume: 10, amount: 1000 };
    });
  } };
  const transport = spyOn(source, "fetchBars").mockImplementation((symbol, market, from, to, preferred, options = {}) =>
    fetchBars(symbol, market, from, to, preferred, { ...options, providers: { ...options.providers, adapters: {
      akshare: adapter, tushare: adapter, "llmquant-data": adapter, "financial-datasets": adapter,
    } } }));
  let tui: QuantTui | undefined, runtime: AppRuntime | undefined;
  try {
    expect(loadSettings().providers?.custom?.apiKey).toBeUndefined();
    const dependencies = createDefaultSessionDependencies({ cwd: process.cwd(), sessionsRoot: join(root, "sessions") });
    const agent = createRuntimeAgent({ ...dependencies, loadSkills: async () => [],
      tools: dependencies.tools.filter(tool => ["check_risk", "compare_portfolios"].includes(tool.name)) });
    const opened: string[] = [];
    tui = new QuantTui(createInitialAppState("workflow-fixture"));
    tui.screen.out = { columns: width, rows: width === 80 ? 24 : 32, write: () => true } as unknown as NodeJS.WriteStream;
    tui.screen.resize();
    runtime = new AppRuntime({ onMessages: messages => tui!.update({ messages }), onActivity: activity => tui!.update({ activity }),
      onComposerStatus: composerStatus => tui!.update({ composerStatus }), onConfigRequest: () => tui!.openConfig(),
      onDoctorRequest: doctor => tui!.openDoctor(doctor),
      onPortfolioRequest: () => tui!.openPortfolio(), onArtifactRequest: () => tui!.openArtifact(), onModel: model => tui!.update(model),
      onLocalState: state => tui!.update(state), onPanel: (panel, panelLoading) => tui!.update({ panel, panelLoading }) },
      async () => [], async () => [], () => agent,
      session => generateCurrentSessionArtifact({ agentSession: session, openFile: path => opened.push(path) }),
      (id, session) => restoreArtifactReport(id, { agentSession: session, openFile: path => opened.push(path) }));
    const pending: Promise<unknown>[] = [];
    tui.onSubmit(text => { pending.push(runtime!.submit(text)); });
    tui.onConfigurationChange(() => runtime!.refreshConfiguration());
    tui.onPanelRefresh(() => { pending.push(runtime!.refreshOverviewPanel()); });
    tui.onArtifactRestore(id => { pending.push(runtime!.restoreArtifact(id)); });
    const dispatch = Reflect.get(tui, "handleKeyAction").bind(tui) as (action: Extract<InputAction, { type: "key" }>) => void;
    const raw = (input: string) => {
      while (input) {
        const { action, rest } = nextInputAction(input); input = rest;
        if (!action) throw new Error("Incomplete fixture input");
        if (action.type === "key") dispatch(action);
      }
    };
    const visible = () => { Reflect.get(tui!, "paint").call(tui); return tui!.screen.buf.toPlain().join("\n"); };
    const select = (label: string) => {
      for (let count = 0; count < 30; count++) {
        if (visible().includes(`> ${label} `)) return;
        raw("\x1b[B");
      }
      throw new Error(`Visible setting not found: ${label}\n${visible()}`);
    };
    const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
    const command = async (text: string) => { raw(text + "\r"); await settle(); };
    await runtime.bootstrap(); await agent.waitForIdle(); await settle();
    await command("/config");
    select("Model"); raw("\r");
    select("Provider"); raw("\r(custom)\r");
    select("Model"); raw("\r\x1b[A\r" + "\x7f".repeat("deepseek-v4-pro".length) + "workflow-fixture\r");
    select("API key"); raw("\rfixture\r");
    select("Base URL"); raw(`\r${server.url}v1\r`);
    select("Save & Verify"); raw("\r"); await settle();
    expect(loadSettings()).toMatchObject({ provider: "custom", model: "workflow-fixture" });
    expect(tui.state.model).toBe("workflow-fixture");
    expect(visible()).toContain("model pass");
    raw("\x1b");
    await command("/config");
    select("Market Data"); raw("\r");
    expect(visible()).toContain("Sources for US:");
    select("Source"); raw("\r"); expect(visible()).toContain("financial-datasets");
    select("API key"); raw("\rfixture-data\r");
    select("Endpoint"); raw(`\r${String(dataServer.url).replace(/\/$/, "")}\r`);
    select("Check data"); raw("\r");
    const dataDeadline = Date.now() + 3000;
    while (!visible().includes("1 valid rows")) {
      if (Date.now() > dataDeadline) throw new Error(`First-run data check did not pass: ${visible()}`);
      await setImmediate();
    }
    select("Save verified"); raw("\r"); await settle(); raw("\x1b");
    expect(loadSettings().preferences.source).toBe("financial-datasets");
    await command("/config");
    for (let count = 0; !visible().includes("> Auto Artifacts "); count++) { if (count >= 15) throw new Error("Auto Artifacts unreachable"); raw("\x1b[B"); }
    raw("\r\x1b"); expect(loadSettings().artifactGeneration.auto).toBe(true);
    // Tab accepts the public command; every portfolio edit goes through the visible panel.
    raw("/port\t\r"); await settle(); expect(visible()).toContain("Create portfolio");
    raw("\rCore\r\rAAPL Apple\r\x1b"); await settle();
    expect(visible()).toContain("Core");
    raw("\rStable\r\rMSFT Microsoft\r"); raw("\x1b"); raw("\x1b"); await settle();
    const groups = loadPanelPortfolio().groups;
    expect(groups.map(group => [group.name, group.symbolCodes])).toEqual([["Core", ["AAPL"]], ["Stable", ["MSFT"]]]);
    expect((Reflect.get(tui, "panel") as PanelController).isOpen()).toBe(false);
    await command("研究当前 Core 组合，2026-01-01 至 2026-02-09，输出风险报告。");
    expect(tui.state.messages.filter(message => message.role === "error")).toEqual([]);
    expect(tui.state.model).toBe("workflow-fixture");
    expect(requestCount).toBe(2); expect(opened).toHaveLength(1);
    const state = await agent.getResearchState();
    expect(state.operations).toHaveLength(1); expect(state.operations[0]!.status).toBe("verified");
    const metrics = state.operations[0]!.findings!.metrics;
    expect(state.operations[0]!.tool).toBe("check_risk");
    expect(metrics.find(metric => metric.label === "Maximum drawdown")!.value).toBe(0);
    expect(visible()).toContain("Fixture research completed");
    const reports = listRestorableArtifactReports(); expect(reports).toHaveLength(1);
    const original = readFileSync(opened[0]!, "utf8"); expect(original).toContain("check_risk");
    const sourceSession = (await agent.getSessionMetadata())!.id, callsBeforeRestore = sourceCalls;
    await command("/clear"); expect(tui.state.messages.some(message => message.text?.includes("Fixture research completed"))).toBe(false);
    await command("/artifact"); expect(visible()).toContain("Artifacts"); raw("\r"); await settle();
    expect(opened).toEqual([opened[0]!, opened[0]!]); expect(sourceCalls).toBe(callsBeforeRestore);
    expect((await agent.getSessionMetadata())!.id).toBe(sourceSession);
    expect((await agent.getResearchState()).operations[0]!.status).toBe("verified");
    expect(readFileSync(opened[1]!, "utf8")).toBe(original);
    expect(tui.state.messages.some(message => message.text?.includes("Restored artifact"))).toBe(true);
    expect((Reflect.get(tui, "panel") as PanelController).isOpen()).toBe(false);
  } finally {
    await runtime?.shutdown();
    if (tui) (Reflect.get(tui, "panel") as PanelController).close();
    transport.mockRestore(); server.stop(true); dataServer.stop(true);
    if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
    if (noProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = noProxy;
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected workflow fixture path");
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
