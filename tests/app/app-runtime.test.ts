import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JsonlSessionRepo } from "../../src/agent/src/session-runtime/index.ts";
import { NodeExecutionEnv } from "../../src/agent/src/session-runtime/node.ts";
import { loadPanelPortfolio, resolveSkillsDir, savePanelPortfolio, saveSettings } from "../../src/storage/index.ts";
import { DEFAULT_SETTINGS } from "../../src/types/config.ts";
import { AppRuntime, createInitialAppState, createRuntimeAgent } from "../../src/app-runtime.ts";
import type { AppState, PanelSection, UIMessage } from "../../src/types/ui.ts";
import { editPortfolio } from "../../src/runtime/research/portfolio.ts";

const runtimes: AppRuntime[] = [];
const OHQ = join(process.cwd(), ".ohquant-test-app-runtime");

beforeEach(() => {
  process.env.OHQUANT_DIR = OHQ;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
  mkdirSync(OHQ, { recursive: true });
  savePanelPortfolio({
    updated: "",
    symbols: [{ code: "510300.SH", name: "沪深300ETF", added: "2026-06-10" }],
    groups: [],
  });
});

afterEach(() => {
  for (const runtime of runtimes.splice(0)) {
    const agent = (runtime as unknown as { agent: { abort?: () => void } | null }).agent;
    if (agent && !agent.abort) agent.abort = () => {};
    runtime.dispose();
  }
  delete process.env.OHQUANT_DIR;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
});

describe("initial app state", () => {
  it("keeps the raw default model from settings env", () => {
    saveSettings({
      version: 1,
      env: {
        WHYJ_DEFAULT_SONNET_MODEL: "deepseek-v4-pro[1m]",
      },
      model: "sonnet",
      thinkingLevel: "high",
      showPortfolioPanel: true,
      artifactGeneration: { auto: false },
      skillIntegrations: {
        external: false,
      },
      permissions: {},
      preferences: {
        defaultMarket: "A",
        defaultBenchmark: "000300.SH",
        defaultCash: 100_000,
        defaultFast: 20,
        defaultSlow: 60,
        currentPortfolioFile: "holdings.json",
        source: "llmquant-data",
      },
    });

    const state = createInitialAppState("1.0.0");
    expect(state.model).toBe("deepseek-v4-pro[1m]");
  });
});

function harness(
  quoteFetcher: ConstructorParameters<typeof AppRuntime>[1] = async () => [],
  holdingFetcher: ConstructorParameters<typeof AppRuntime>[2] = async () => [],
  agentFactory: ConstructorParameters<typeof AppRuntime>[3] | undefined = undefined,
  autoArtifactRunner: ConstructorParameters<typeof AppRuntime>[4] | undefined = undefined,
  artifactRestoreRunner: ConstructorParameters<typeof AppRuntime>[5] | undefined = undefined,
  marketRefreshTimeoutMs: ConstructorParameters<typeof AppRuntime>[6] | undefined = undefined,
  marketRefreshIntervalMs = 0,
) {
  const messages: UIMessage[][] = [];
  const activities: AppState["activity"][] = [];
  const statuses: AppState["composerStatus"][] = [];
  const panels: Array<{ panel: PanelSection[]; loading: boolean }> = [];
  const queues: string[][] = [];
  const localStates: Array<Pick<AppState, "activePortfolio" | "source" | "showPortfolioPanel">> = [];
  const huds: Array<AppState["hud"]> = [];
  let configOpened = 0;
  let resumeOpened = 0;
  let portfolioOpened = 0;
  const runtime = new AppRuntime(
    {
      onMessages: (m) => messages.push(m),
      onActivity: (a) => activities.push(a),
      onLocalState: (s) => localStates.push(s),
      onComposerStatus: (s) => statuses.push(s),
      onComposerQueue: (q) => queues.push(q),
      onConfigRequest: () => { configOpened++; },
      onResumeRequest: () => { resumeOpened++; },
      onPortfolioRequest: () => { portfolioOpened++; },
      onPanel: (panel, loading = false) => panels.push({ panel, loading }),
      onHud: (hud) => huds.push(hud),
    },
    quoteFetcher,
    holdingFetcher,
    agentFactory,
    autoArtifactRunner,
    artifactRestoreRunner,
    marketRefreshTimeoutMs,
    marketRefreshIntervalMs,
  );
  runtimes.push(runtime);
  return { runtime, messages, activities, statuses, panels, queues, localStates, huds, get configOpened() { return configOpened; }, get resumeOpened() { return resumeOpened; }, get portfolioOpened() { return portfolioOpened; } };
}

type RuntimeAgentEvent = { type: string; [key: string]: unknown };

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

function makeFakeAgent(promptImpl: (agent: any, input: string) => Promise<void>) {
  const listeners: Array<(event: RuntimeAgentEvent) => void | Promise<void>> = [];
  const agent = {
    state: {
      isStreaming: false,
      pendingToolCalls: new Set<string>(),
      messages: [] as unknown[],
      thinkingText: "",
    },
    subscribe(listener: (event: RuntimeAgentEvent) => void | Promise<void>) {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
    async emit(event: RuntimeAgentEvent) {
      for (const listener of listeners) await listener(event);
    },
    async prompt(input: string) {
      await promptImpl(agent, input);
    },
    steer() {},
    followUp() {},
    abort() {},
    clearAllQueues() {},
    reset() {},
    waitForIdle: async () => {},
  };
  return agent;
}

describe("AppRuntime.submit", () => {
  it("passes file snapshots to the model while preserving the typed reference as display text, including queued requests", async () => {
    const h = harness(), path = join(OHQ, "reference.txt");
    writeFileSync(path, "reference-only evidence 12345");
    const calls: Array<{ text: string; displayText: string }> = [];
    const queued: any[] = [];
    const agent = { state: { isStreaming: false, messages: [], pendingToolCalls: new Set<string>() },
      prompt: async (text: string, options: { displayText: string }) => { calls.push({ text, displayText: options.displayText }); },
      followUp: async (message: unknown) => { queued.push(message); }, abort() {} };
    (h.runtime as any).agent = agent;
    const input = `分析 @"file:${path}"`;
    await h.runtime.submit(input);
    expect(calls[0]!.text).toContain("reference-only evidence 12345");
    expect(calls[0]!.displayText).toBe(input);
    agent.state.isStreaming = true;
    await h.runtime.submit(input);
    expect(queued[0].displayText).toBe(input);
    expect(JSON.stringify(queued[0].content)).toContain("reference-only evidence 12345");
    const queueUpdates = h.queues.length;
    const pendingArtifact = (h.runtime as any).pendingAutoArtifactInput;
    await h.runtime.submit(`分析 @"file:${path}.missing"`);
    expect(calls).toHaveLength(1);
    expect(queued).toHaveLength(1);
    expect(h.queues).toHaveLength(queueUpdates);
    expect((h.runtime as any).pendingAutoArtifactInput).toBe(pendingArtifact);
    expect(h.statuses.at(-1)?.kind).toBe("error");
  });

  it("interrupts a running research request when the selected portfolio changes", async () => {
    const first = editPortfolio({ type: "create", name: "Core" }).groups[0]!;
    const second = editPortfolio({ type: "create", name: "Growth" }).groups[1]!;
    editPortfolio({ type: "select", group: first.id });
    let started!: () => void, finish!: () => void, aborts = 0;
    const began = new Promise<void>(resolve => { started = resolve; });
    const agent = makeFakeAgent(async agent => {
      agent.state.isStreaming = true;
      started();
      await new Promise<void>(resolve => { finish = resolve; });
      agent.state.isStreaming = false;
    });
    agent.abort = () => { aborts++; finish(); };
    const { runtime, localStates } = harness(undefined, undefined, () => agent as any);
    await runtime.bootstrap();
    const research = runtime.submit("研究当前组合");
    await began;
    editPortfolio({ type: "select", group: second.id });
    await runtime.refreshOverviewPanel(); await research;
    expect(aborts).toBe(1);
    expect(localStates.at(-1)?.activePortfolio).toBe("Growth");
  });

  it("builds the default runtime agent with installed project skill paths", async () => {
    const skillsDir = join(resolveSkillsDir(), "__runtime-test-repo__", "llmquant-crypto");
    mkdirSync(skillsDir, { recursive: true });
    try {
      writeFileSync(join(skillsDir, "SKILL.md"), `---
name: llmquant-crypto
description: Use for crypto market analysis.
---

# LLMQuant Crypto
`, "utf-8");

      const agent = createRuntimeAgent();
      await agent.waitForIdle();

      const skills = await agent.getSkills();
      expect(skills.some((skill) => skill.name === "llmquant-crypto")).toBe(true);
    } finally {
      rmSync(join(resolveSkillsDir(), "__runtime-test-repo__"), { recursive: true, force: true });
    }
  });

  it("returns exit for exit commands", async () => {
    const h = harness();
    expect(await h.runtime.submit("/exit")).toBe("exit");
    expect(await h.runtime.submit("/quit")).toBe("exit");
  });

  it("handles help and config locally without agent initialization", async () => {
    const h = harness();
    expect(await h.runtime.submit("/help")).toBe("continue");
    expect(h.messages.at(-1)?.at(-1)).toEqual(expect.objectContaining({
      role: "assistant",
      text: expect.stringContaining("Commands"),
    }));
    expect(h.statuses.at(-1)).toBeNull();
    expect(h.activities.at(-1)).toBe("ready");

    expect(await h.runtime.submit("/config")).toBe("continue");
    expect(h.configOpened).toBe(1);
    expect(h.activities.at(-1)).toBe("ready");
  });

  it("auto-generates an artifact after a completed quant analysis turn", async () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      artifactGeneration: { auto: true },
    });
    const fakeAgent = makeFakeAgent(async (agent) => {
      agent.state.isStreaming = false;
      await agent.emit({ type: "agent_end", messages: [] });
    });
    const autoArtifactRunner = mock(async () => ({ success: true, message: "300308 research" }));
    const h = harness(async () => [], async () => [], () => fakeAgent as never, autoArtifactRunner as never);

    await h.runtime.bootstrap();
    await h.runtime.submit("分析 300308.SZ 的技术面和风险");

    expect(autoArtifactRunner).toHaveBeenCalledTimes(1);
    expect(h.statuses.at(-1)).toEqual({ kind: "info", text: "Artifact ready · 300308 research" });
  });

  it("does not auto-generate artifacts for ordinary chat", async () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      artifactGeneration: { auto: true },
    });
    const fakeAgent = makeFakeAgent(async (agent) => {
      agent.state.isStreaming = false;
      await agent.emit({ type: "agent_end", messages: [] });
    });
    const autoArtifactRunner = mock(async () => ({ success: true, message: "unused" }));
    const h = harness(async () => [], async () => [], () => fakeAgent as never, autoArtifactRunner as never);

    await h.runtime.bootstrap();
    await h.runtime.submit("你好，请介绍一下你自己");

    expect(autoArtifactRunner).not.toHaveBeenCalled();
  });

  it("flags a fund answer contradicted by the current verified task and skips its automatic artifact", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, artifactGeneration: { auto: true } });
    const parameters = { symbol: "270042", start_date: "2026-02-01", end_date: "2026-03-01", invest_amount: 100,
      frequency: "monthly", invest_day: 1, purchase_fee_rate: 0, purchase_fee_unit: "decimal" };
    const research = { task: { status: "complete", spec: { criteria: ["Principal return", "Time-weighted return", "Maximum drawdown (TWR)"].map(
      (label, index) => ({ id: `c${index + 1}`, tool: "fund_dca_backtest", metrics: [label], parameters })) } },
      operations: [{ tool: "fund_dca_backtest", status: "verified", parameters,
        findings: { metrics: [{ label: "Principal return", value: 0.25 }, { label: "Time-weighted return", value: 0.5 },
          { label: "Maximum drawdown (TWR)", value: 0 }] } }] };
    let answer = "Principal return 20.00%; Time-weighted return 50.00%; Maximum drawdown (TWR) 0.00%.";
    const fakeAgent = Object.assign(makeFakeAgent(async agent => {
      await agent.emit({ type: "message_start", message: { role: "assistant", content: [] } });
      await agent.emit({ type: "message_end", message: { role: "assistant", stopReason: "stop",
        content: [{ type: "text", text: answer }], usage: { output: 10 } } });
      agent.state.isStreaming = false;
      await agent.emit({ type: "agent_end", messages: [] });
    }), { getResearchState: async () => research });
    const autoArtifactRunner = mock(async () => ({ success: true, message: "fund report" }));
    const h = harness(async () => [], async () => [], () => fakeAgent as never, autoArtifactRunner as never);
    await h.runtime.bootstrap();
    await h.runtime.submit("分析基金 270042.OF 的定投收益和回撤");
    expect(autoArtifactRunner).not.toHaveBeenCalled();
    expect(h.messages.at(-1)?.at(-1)).toEqual(expect.objectContaining({ role: "error", text: expect.stringContaining("本金收益率与已核验工具结果不一致") }));
    expect(h.statuses.at(-1)?.kind).toBe("error");

    answer = "Principal return 25.00% （末期模拟市值 200 − 投入 200 本金）/ 200";
    await h.runtime.submit("继续分析基金 270042.OF 的定投收益和回撤");
    expect(autoArtifactRunner).not.toHaveBeenCalled();
    expect(h.messages.at(-1)?.at(-1)?.text).toContain("本金收益公式与已核验工具结果不一致");

    answer = "Principal return 25.00%; Time-weighted return 50.00%; Maximum drawdown (TWR) 0.00%.";
    await h.runtime.submit("继续分析基金 270042.OF 的定投收益和回撤");
    expect(autoArtifactRunner).toHaveBeenCalledTimes(1);
    expect(h.statuses.at(-1)).toEqual({ kind: "info", text: "Artifact ready · fund report" });
  });

  it("flags an unsupported factor conclusion in the current task and pauses its automatic artifact", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, artifactGeneration: { auto: true } });
    const parameters = { symbol: "AAPL", factor: "momentum", period: 2, start: "2026-01-01", end: "2026-02-09" };
    const evidence = { callId: "factor-1", callEntryId: "factor-entry-1" };
    const research = { task: { status: "complete", spec: { scope: { symbols: ["AAPL"], market: "US",
      start: "2026-01-01", end: "2026-02-09" }, criteria: [{ id: "factor", tool: "compute_factor", parameters, metrics: ["Latest"] }] },
      criteria: [{ id: "factor", status: "satisfied", evidence }] },
      operations: [{ ...evidence, tool: "compute_factor", status: "verified", parameters,
        findings: { kind: "factor", metrics: [{ label: "Latest", value: 139 / 137 - 1, unit: "number" }] } }] };
    let answer = "动量分位 0%，属短周期均值回归型特征。";
    const fakeAgent = Object.assign(makeFakeAgent(async agent => {
      await agent.emit({ type: "message_start", message: { role: "assistant", content: [] } });
      await agent.emit({ type: "message_end", message: { role: "assistant", stopReason: "stop",
        content: [{ type: "text", text: answer }], usage: { output: 10 } } });
      agent.state.isStreaming = false;
      await agent.emit({ type: "agent_end", messages: [] });
    }), { getResearchState: async () => research });
    const autoArtifactRunner = mock(async () => ({ success: true, message: "factor report" }));
    const h = harness(async () => [], async () => [], () => fakeAgent as never, autoArtifactRunner as never);
    await h.runtime.bootstrap();
    await h.runtime.submit("分析 AAPL 的动量和风险");
    expect(autoArtifactRunner).not.toHaveBeenCalled();
    expect(h.messages.at(-1)?.at(-1)?.text).toContain("不能据此断言均值回归");
    expect(h.statuses.at(-1)?.kind).toBe("error");

    answer = "Latest 0.0946。";
    await h.runtime.submit("继续分析 AAPL 的动量和风险");
    expect(autoArtifactRunner).not.toHaveBeenCalled();
    expect(h.messages.at(-1)?.at(-1)?.text).toContain("最新因子值与已核验工具结果不一致");

    answer = "Latest 0.0146。动量分位 0% 不构成均值回归或未来收益证据。";
    await h.runtime.submit("继续分析 AAPL 的动量和风险");
    expect(autoArtifactRunner).toHaveBeenCalledTimes(1);
    expect(h.statuses.at(-1)).toEqual({ kind: "info", text: "Artifact ready · factor report" });
  });

  it("flags a risk percentage that contradicts the selected task evidence and pauses its automatic artifact", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, artifactGeneration: { auto: true } });
    const parameters = { symbol: "AAPL", market: "US", start: "2026-01-01", end: "2026-02-09" };
    const evidence = { callId: "risk-1", callEntryId: "risk-entry-1" };
    const research = { task: { status: "complete", spec: { scope: { symbols: ["AAPL"], market: "US",
      start: "2026-01-01", end: "2026-02-09" }, criteria: [{ id: "risk", tool: "check_risk", parameters }] },
      criteria: [{ id: "risk", status: "satisfied", evidence }] }, operations: [{ ...evidence, tool: "check_risk",
      status: "verified", parameters, findings: { kind: "risk", metrics: [
        { label: "Annual volatility", value: 0.013038293078614618, unit: "percent" },
        { label: "Maximum drawdown", value: -0.08, unit: "percent" },
        { label: "Downside volatility", value: 0.01, unit: "percent" },
        { label: "VaR 95%", value: -0.03, unit: "percent" },
        { label: "CVaR 95%", value: -0.04, unit: "percent" },
        { label: "Drawdown duration", value: 3, unit: "periods" },
      ] } }] };
    let answer = "Annual volatility 9.00%; Max DD 8.00%.";
    const fakeAgent = Object.assign(makeFakeAgent(async agent => {
      await agent.emit({ type: "message_start", message: { role: "assistant", content: [] } });
      await agent.emit({ type: "message_end", message: { role: "assistant", stopReason: "stop",
        content: [{ type: "text", text: answer }], usage: { output: 10 } } });
      agent.state.isStreaming = false;
      await agent.emit({ type: "agent_end", messages: [] });
    }), { getResearchState: async () => research });
    const autoArtifactRunner = mock(async () => ({ success: true, message: "risk report" }));
    const h = harness(async () => [], async () => [], () => fakeAgent as never, autoArtifactRunner as never);
    await h.runtime.bootstrap();
    await h.runtime.submit("分析 AAPL 年化波动率和最大回撤");
    expect(autoArtifactRunner).not.toHaveBeenCalled();
    expect(h.messages.at(-1)?.at(-1)?.text).toContain("年化波动率与已核验工具结果不一致");
    expect(h.statuses.at(-1)?.kind).toBe("error");

    answer = "CVaR 95% -9.00%; 回撤持续期 4 期。";
    await h.runtime.submit("继续分析 AAPL 尾部风险");
    expect(autoArtifactRunner).not.toHaveBeenCalled();
    expect(h.messages.at(-1)?.at(-1)?.text).toContain("CVaR 95%、回撤持续期与已核验工具结果不一致");

    answer = "Annual volatility 1.30%; Max DD 8.00%; CVaR 95% -4.00%; 回撤持续期 3 期。";
    await h.runtime.submit("继续分析 AAPL 风险");
    expect(autoArtifactRunner).toHaveBeenCalledTimes(1);
    expect(h.statuses.at(-1)).toEqual({ kind: "info", text: "Artifact ready · risk report" });
  });

  it("keeps an unsupported news price basis visible and pauses its automatic artifact until corrected", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, artifactGeneration: { auto: true } });
    const parameters = { symbol: "AAPL", market: "US", start: "2026-09-01", end: "2026-09-10" };
    const document = { articleId: "fixture-1", requestedUrl: "https://example.test/news", status: "available",
      contentHash: "a".repeat(64), paragraphs: [{ id: "p1", text: "Publisher revenue guidance claim." }] };
    const research = { requests: [{ entryId: "news-request", text: "分析 AAPL 新闻与价格" }], task: null,
      operations: [{ callId: "news-call", callEntryId: "news-entry", resultEntryId: "news-result",
        requestEntryId: "news-request", tool: "research_news", status: "unverified", parameters,
        recordedScope: { ...parameters, documents: [document], citations: [{ id: "N-fixture-1", articleId: document.articleId,
          requestedUrl: document.requestedUrl, status: document.status, contentHash: document.contentHash, paragraphIds: ["p1"] }], price: { status: "available", dataset: {
          version: 1, kind: "daily-bars", symbol: "AAPL", market: "US", requested: { start: parameters.start, end: parameters.end },
          adjustment: "provider-unspecified" } } } }] };
    let answer = "AAPL 收盘价非复权价。[N-fixture-1/p1]";
    const fakeAgent = Object.assign(makeFakeAgent(async agent => {
      await agent.emit({ type: "message_start", message: { role: "assistant", content: [] } });
      await agent.emit({ type: "message_end", message: { role: "assistant", stopReason: "stop",
        content: [{ type: "text", text: answer }], usage: { output: 10 } } });
      agent.state.isStreaming = false;
      await agent.emit({ type: "agent_end", messages: [] });
    }), { getResearchState: async () => research });
    const autoArtifactRunner = mock(async () => ({ success: true, message: "news report" }));
    const h = harness(async () => [], async () => [], () => fakeAgent as never, autoArtifactRunner as never);
    await h.runtime.bootstrap();
    await h.runtime.submit("分析 AAPL 新闻与价格走势");
    expect(autoArtifactRunner).not.toHaveBeenCalled();
    expect(h.messages.at(-1)).toContainEqual(expect.objectContaining({ role: "assistant", text: answer }));
    expect(h.messages.at(-1)?.at(-1)?.text).toContain("新闻回答需要复核");
    expect(h.statuses.at(-1)?.kind).toBe("error");

    answer = "AAPL 复权口径未知；计算使用 close。[N-fixture-1/p1]";
    await h.runtime.submit("继续分析 AAPL 新闻与价格走势");
    expect(autoArtifactRunner).toHaveBeenCalledTimes(1);
    expect(h.statuses.at(-1)).toEqual({ kind: "info", text: "Artifact ready · news report" });

    research.operations[0]!.recordedScope.price.dataset.adjustment = "unadjusted";
    answer = "AAPL 收盘价非复权价。[N-fixture-1/p1]";
    await h.runtime.submit("分析 AAPL 已记录的新闻与价格口径");
    expect(autoArtifactRunner).toHaveBeenCalledTimes(2);

    fakeAgent.getResearchState = async () => { throw new Error("fixture evidence unavailable"); };
    await h.runtime.submit("继续分析 AAPL 新闻与价格走势");
    expect(autoArtifactRunner).toHaveBeenCalledTimes(2);
    expect(h.messages.at(-1)?.at(-1)?.text).toContain("当前无法读取研究证据");
  });

  it("keeps a wrong portfolio comparison answer visible but pauses its automatic artifact", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, artifactGeneration: { auto: true } });
    const evidence = { callId: "compare-1", callEntryId: "entry-1" };
    const parameters = { group_a: "core", group_b: "stable", start: "2026-01-01", end: "2026-02-09", benchmark: "SPY" };
    const research = { task: { status: "complete", spec: { scope: { symbols: ["AAPL", "MSFT"], market: "US",
      start: "2026-01-01", end: "2026-02-09" }, criteria: [{ id: "returns", tool: "compare_portfolios", parameters }] },
      criteria: [{ id: "returns", status: "satisfied", evidence }] }, operations: [{ ...evidence, tool: "compare_portfolios",
      status: "verified", parameters, findings: { kind: "portfolio-comparison", metrics: [
        { label: "Portfolio A / Total return", value: 0.39 }, { label: "Portfolio B / Total return", value: 0 },
        { label: "Portfolio A / Max drawdown", value: -0.08 }, { label: "Portfolio B / Max drawdown", value: 0 },
      ] }, comparison: { groups: [{ id: "core", name: "Core" }, { id: "stable", name: "Stable" }] } }] };
    let answer = "Core 累计收益 +38.00%，最大回撤 8.00%；Stable 累计收益 0.00%，最大回撤 0.00%。";
    const fakeAgent = Object.assign(makeFakeAgent(async agent => {
      await agent.emit({ type: "message_start", message: { role: "assistant", content: [] } });
      await agent.emit({ type: "message_end", message: { role: "assistant", stopReason: "stop",
        content: [{ type: "text", text: answer }], usage: { output: 10 } } });
      agent.state.isStreaming = false;
      await agent.emit({ type: "agent_end", messages: [] });
    }), { getResearchState: async () => research });
    const autoArtifactRunner = mock(async () => ({ success: true, message: "comparison report" }));
    const h = harness(async () => [], async () => [], () => fakeAgent as never, autoArtifactRunner as never);
    await h.runtime.bootstrap();
    await h.runtime.submit("分析 Core 与 Stable 组合的累计收益和风险");
    expect(autoArtifactRunner).not.toHaveBeenCalled();
    expect(h.messages.at(-1)?.at(-1)?.text).toContain("组合 A 累计收益与已核验工具结果不一致");
    expect(h.statuses.at(-1)?.kind).toBe("error");

    answer = "| Series | TR | DD |\n| Core | 38% | 8% |\n| Stable | 0% | 0% |";
    await h.runtime.submit("按表格复核 Core 与 Stable 的收益和回撤");
    expect(autoArtifactRunner).not.toHaveBeenCalled();
    expect(h.messages.at(-1)?.at(-1)?.text).toContain("组合 A 累计收益与已核验工具结果不一致");

    answer = "Core 累计收益 +39.00%，最大回撤 8.00%；Stable 累计收益 0.00%，最大回撤 0.00%。";
    await h.runtime.submit("继续分析 Core 与 Stable 组合的累计收益和风险");
    expect(autoArtifactRunner).toHaveBeenCalledTimes(1);
    expect(h.statuses.at(-1)).toEqual({ kind: "info", text: "Artifact ready · comparison report" });
  });

  it("restores an artifact panel selection without submitting a second-level slash command", async () => {
    const fakeAgent = makeFakeAgent(async () => {});
    const artifactRestoreRunner = mock(async (reportId: string) => ({
      success: true,
      message: `Restored ${reportId}`,
    }));
    const h = harness(
      async () => [],
      async () => [],
      () => fakeAgent as never,
      undefined,
      artifactRestoreRunner as never,
    );

    await h.runtime.bootstrap();
    await h.runtime.restoreArtifact("report-1");

    expect(artifactRestoreRunner).toHaveBeenCalledTimes(1);
    expect(artifactRestoreRunner.mock.calls[0]![0]).toBe("report-1");
    expect(h.statuses.at(-1)).toEqual({ kind: "info", text: "Restored report-1" });
  });
  it("averages TTFT and TPOT across assistant turns", async () => {
    const originalNow = Date.now;
    let now = 1_000;
    let turn = 0;
    Date.now = () => now;
    try {
      const fakeAgent = makeFakeAgent(async (agent) => {
        turn += 1;
        agent.state.isStreaming = true;
        await agent.emit({
          type: "message_start",
          message: { role: "displayUser", content: [{ type: "text", text: "" }], displayText: `average turn ${turn}` },
        });
        await agent.emit({ type: "message_start", message: { role: "assistant", content: [] } });
        if (turn === 1) {
          now = 3_200;
          await agent.emit({
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: "A" },
            message: { role: "assistant", content: [{ type: "text", text: "A" }] },
          });
          now = 4_000;
          await agent.emit({
            type: "message_end",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Alpha" }],
              usage: { output: 11 },
            },
          });
        } else {
          now = 5_000;
          await agent.emit({
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: "B" },
            message: { role: "assistant", content: [{ type: "text", text: "B" }] },
          });
          now = 5_400;
          await agent.emit({
            type: "message_end",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Beta" }],
              usage: { output: 6 },
            },
          });
        }
        agent.state.isStreaming = false;
        await agent.emit({ type: "agent_end", messages: [] });
      });
      const h = harness(async () => [], async () => [], () => fakeAgent as never);

      await h.runtime.bootstrap();
      await h.runtime.submit("first average turn");
      now = 4_200;
      await h.runtime.submit("second average turn");

      expect(h.huds.at(-1)).toEqual(expect.objectContaining({
        ttftMs: 1500,
        tpotMs: 80,
      }));
    } finally {
      Date.now = originalNow;
    }
  });
  it("bridges agent quant tool errors into polite conversation output", async () => {
    const fakeAgent = makeFakeAgent(async (agent) => {
      agent.state.isStreaming = true;
      await agent.emit({
        type: "message_start",
        message: { role: "displayUser", content: [{ type: "text", text: "" }], displayText: "check 000300 risk" },
      });
      await agent.emit({ type: "message_start", message: { role: "assistant", content: [] } });
      await agent.emit({
        type: "tool_execution_start",
        toolCallId: "risk-1",
        toolName: "check_risk",
        args: { symbol: "000300.SH" },
      });
      await agent.emit({
        type: "tool_execution_end",
        toolCallId: "risk-1",
        toolName: "check_risk",
        result: textResult("No cached data for this symbol"),
        isError: true,
      });
      await agent.emit({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "I could not compute risk from cache." }] },
      });
      agent.state.isStreaming = false;
      await agent.emit({ type: "agent_end", messages: [] });
    });
    const h = harness(async () => [], async () => [], () => fakeAgent as never);

    await h.runtime.bootstrap();
    await h.runtime.submit("check 000300 risk");

    const latest = h.messages.at(-1) ?? [];
    expect(latest).toEqual([
      { role: "user", text: "check 000300 risk" },
      { role: "assistant", text: "I could not compute risk from cache." },
      expect.objectContaining({
        role: "tool",
        tool: expect.objectContaining({
          name: "check_risk",
          label: "Quant.Risk · 000300.SH",
          args: "000300.SH",
          status: "error",
          result: "No cached data for this symbol",
        }),
      }),
    ]);
    expect(h.activities).toContain("running tool");
    expect(h.activities.at(-1)).toBe("ready");
  });

  it("updates completed write tool labels to an edit summary", async () => {
    const fakeAgent = makeFakeAgent(async (agent) => {
      agent.state.isStreaming = true;
      await agent.emit({
        type: "message_start",
        message: { role: "displayUser", content: [{ type: "text", text: "" }], displayText: "update the catalog" },
      });
      await agent.emit({ type: "message_start", message: { role: "assistant", content: [] } });
      await agent.emit({
        type: "tool_execution_start",
        toolCallId: "bash-write-1",
        toolName: "bash",
        args: { command: "Set-Content src/tools/catalog.ts value" },
      });
      await agent.emit({
        type: "tool_execution_end",
        toolCallId: "bash-write-1",
        toolName: "bash",
        result: textResult("@@ -1,2 +1,2 @@\n-old value\n+new value"),
        isError: false,
      });
      await agent.emit({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Updated catalog." }] },
      });
      agent.state.isStreaming = false;
      await agent.emit({ type: "agent_end", messages: [] });
    });
    const h = harness(async () => [], async () => [], () => fakeAgent as never);

    await h.runtime.bootstrap();
    await h.runtime.submit("update the catalog");

    const latest = h.messages.at(-1) ?? [];
    const tool = latest.find((message) => message.role === "tool");
    expect(tool).toEqual(expect.objectContaining({
      role: "tool",
      tool: expect.objectContaining({
        label: "Edited src/tools/catalog.ts (+1 -1)",
        args: "Set-Content src/tools/catalog.ts value",
        status: "done",
      }),
    }));
  });

  it("adds a specific hint below agent API endpoint errors", async () => {
    const fakeAgent = makeFakeAgent(async () => {
      throw new Error("fetch failed: connect ECONNREFUSED 127.0.0.1:11434");
    });
    const h = harness(async () => [], async () => [], () => fakeAgent as never);

    await h.runtime.bootstrap();
    await h.runtime.submit("hello");

    const latest = h.messages.at(-1) ?? [];
    expect(latest.at(-1)).toEqual({
      role: "error",
      text: expect.stringContaining("Hint: Agent API endpoint is unreachable."),
    });
  });

  it("adds a reconnect-oriented hint below generic connection errors", async () => {
    const fakeAgent = makeFakeAgent(async (agent) => {
      agent.state.isStreaming = true;
      await agent.emit({
        type: "message_start",
        message: { role: "displayUser", content: [{ type: "text", text: "" }], displayText: "你是谁" },
      });
      await agent.emit({ type: "message_start", message: { role: "assistant", content: [] } });
      await agent.emit({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "" }],
          stopReason: "error",
          errorMessage: "Connection error.",
        },
      });
      agent.state.isStreaming = false;
      await agent.emit({ type: "agent_end", messages: [] });
    });
    const h = harness(async () => [], async () => [], () => fakeAgent as never);

    await h.runtime.bootstrap();
    await h.runtime.submit("你是谁");

    const latest = h.messages.at(-1) ?? [];
    expect(latest).toEqual([
      { role: "user", text: "你是谁" },
      {
        role: "error",
        text: expect.stringContaining(
          "Hint: Network connection to the agent provider failed. The client may already have retried automatically;",
        ),
      },
    ]);
  });

  it("clears active animation as soon as assistant output ends", async () => {
    const fakeAgent = makeFakeAgent(async (agent) => {
      agent.state.isStreaming = true;
      await agent.emit({
        type: "message_start",
        message: { role: "displayUser", content: [{ type: "text", text: "" }], displayText: "finish without agent_end" },
      });
      await agent.emit({ type: "message_start", message: { role: "assistant", content: [] } });
      agent.state.thinkingText = "Need to answer directly.";
      await agent.emit({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
      });
    });
    const h = harness(async () => [], async () => [], () => fakeAgent as never);

    await h.runtime.bootstrap();
    await h.runtime.submit("finish without agent_end");

    expect(h.messages.at(-1)).toEqual([
      { role: "user", text: "finish without agent_end" },
      expect.objectContaining({ role: "thinking", text: "Need to answer directly.", thinkingLive: false }),
      { role: "assistant", text: "Done." },
    ]);
    expect(h.activities).toContain("thinking");
    expect(h.activities.at(-1)).toBe("ready");
  });

  it("loads overview explicitly without making help fetch market data", async () => {
    const marketSeen: string[][] = [];
    const portfolioSeen: string[][] = [];
    const h = harness(
      async (entries, _meta) => {
        marketSeen.push(entries.map((entry) => entry.code));
        return entries.map(entry => ({ ...entry, price: 3000, pct: 1 }));
      },
      async (entries, _meta) => {
        portfolioSeen.push(entries.map((entry) => entry.code));
        return entries.map(entry => ({ ...entry, price: 4.2, pct: -0.5 }));
      },
    );
    await h.runtime.submit("/help");
    expect(marketSeen).toHaveLength(0);
    await h.runtime.refreshOverviewPanel();
    expect(marketSeen[0]).toContain("000300.SH");
    expect(portfolioSeen[0]).toEqual(expect.arrayContaining(["510300.SH"]));
    expect(h.panels[0]).toMatchObject({ loading: true });
    expect(h.panels.at(-1)?.loading).toBe(false);
    const latestPanel = h.panels.at(-1)?.panel ?? [];
    expect(latestPanel[0]).toMatchObject({ kind: "holdings", title: "Portfolio" });
    expect(latestPanel.some((section) => section.title === "Market")).toBe(true);
    expect(latestPanel.some((section) => section.title === "Source")).toBe(false);
    expect(latestPanel[0]!.refresh?.status).toBe("success");
  });

  it("clears the refreshing state and keeps the last good overview when a refresh fails", async () => {
    let failRefresh = false;
    const h = harness(
      async entries => {
        if (failRefresh) throw new Error("market source unavailable");
        return entries.map(entry => ({ ...entry, price: 3000, pct: 1 }));
      },
      async entries => entries.map(entry => ({ ...entry, price: 4.2, pct: -0.5 })),
    );

    await h.runtime.refreshOverviewPanel();
    failRefresh = true;
    await h.runtime.refreshOverviewPanel();

    expect(h.panels.at(-2)).toMatchObject({ loading: true });
    expect(h.panels.at(-1)?.loading).toBe(false);
    const retainedMarket = h.panels.at(-1)?.panel.find(section => section.kind === "quotes");
    expect(retainedMarket).toMatchObject({ rows: expect.arrayContaining([
      expect.objectContaining({ code: "000001.SH", price: 3000, refreshState: "stale" }),
    ]) });
    expect(h.panels.at(-1)?.panel[0].refresh).toMatchObject({ status: "error" });
  });

  it("recovers from a timed-out pull and ignores its stale late result", async () => {
    let quoteCalls = 0;
    let resolveFirstPull: ((quotes: Array<{ code: string; name: string; price: number; pct: number }>) => void) | undefined;
    const h = harness(
      async () => {
        quoteCalls++;
        if (quoteCalls === 1) {
          return new Promise((resolve) => { resolveFirstPull = resolve; });
        }
        return [{ code: "000001.SH", name: "上证指数", price: 3200, pct: 2 }];
      },
      async () => [{ code: "510300.SH", name: "沪深300ETF", price: 4.3, pct: 0.5 }],
      undefined,
      undefined,
      undefined,
      10,
    );

    await h.runtime.refreshOverviewPanel();
    expect(h.panels.at(-1)).toMatchObject({ loading: false });
    await h.runtime.refreshOverviewPanel();

    const successfulPanel = h.panels.at(-1)!.panel;
    expect(quoteCalls).toBe(2);
    expect(successfulPanel?.some((section) => section.title === "Source")).toBe(false);
    expect(successfulPanel[0]!.refresh?.status).toBe("partial");
    const panelUpdates = h.panels.length;

    resolveFirstPull?.([{ code: "000001.SH", name: "stale", price: 1, pct: -99 }]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(h.panels).toHaveLength(panelUpdates);
    expect(h.panels.at(-1)).toEqual({ panel: successfulPanel, loading: false });
  });

  it("syncs resumed session messages into conversation", async () => {
    const h = harness();
    const agent = {
      state: {
        isStreaming: false,
        messages: [] as Array<{ role: string; content: string }>,
      },
      resumeSession: async (sessionId: string) => {
        agent.state.messages = [
          { role: "user", content: "resume me" },
          { role: "assistant", content: `session ${sessionId} restored` },
        ];
        return { id: sessionId, createdAt: "2026-06-09T00:00:00.000Z", cwd: "C:/tmp", path: `C:/tmp/${sessionId}.jsonl` };
      },
    };
    (h.runtime as unknown as { agent: object }).agent = agent;
    await h.runtime.submit("/resume s0");
    expect(h.messages.at(-1)).toEqual([
      { role: "user", text: "resume me" },
      { role: "assistant", text: "session s0 restored" },
      expect.objectContaining({
        role: "assistant",
        text: expect.stringContaining("Resumed\n"),
      }),
    ]);
    expect(h.messages.at(-1)?.[1]).toEqual(expect.objectContaining({
      role: "assistant",
      text: "session s0 restored",
    }));
    expect(h.statuses.at(-1)).toBeNull();
  });

  it("resumes a real stored JSONL session through the default runtime agent", async () => {
    const sessionsRoot = join(OHQ, "sessions");
    const env = new NodeExecutionEnv({ cwd: process.cwd() });
    const repo = new JsonlSessionRepo({ fs: env, sessionsRoot });

    const older = await repo.create({ cwd: process.cwd() });
    const olderMeta = await older.getMetadata();
    await older.appendMessage({
      role: "user",
      content: [{ type: "text", text: "older session question" }],
      timestamp: Date.now(),
    } as any);
    await older.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "older session answer" }],
      provider: "openai",
      model: "openai/gpt-5.5",
      api: "responses",
      usage: {
        input: 10,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 20,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "end_turn",
      timestamp: Date.now(),
    } as any);

    await new Promise((resolve) => setTimeout(resolve, 25));

    const newer = await repo.create({ cwd: process.cwd() });
    await newer.appendMessage({
      role: "user",
      content: [{ type: "text", text: "newer session question" }],
      timestamp: Date.now(),
    } as any);
    await newer.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "newer session answer" }],
      provider: "openai",
      model: "openai/gpt-5.5",
      api: "responses",
      usage: {
        input: 10,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 20,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "end_turn",
      timestamp: Date.now(),
    } as any);

    const h = harness();
    await h.runtime.bootstrap();
    await h.runtime.submit(`/resume ${olderMeta.id}`);

    expect(h.messages.at(-1)).toEqual([
      { role: "user", text: "older session question" },
      { role: "assistant", text: "older session answer" },
      expect.objectContaining({
        role: "assistant",
        text: expect.stringContaining(`id: ${olderMeta.id}`),
      }),
    ]);
  });

  it("syncs compacted session messages into conversation", async () => {
    const h = harness();
    const agent = {
      state: {
        isStreaming: false,
        messages: [
          { role: "user", content: "old question" },
          { role: "assistant", content: "kept summary" },
        ] as Array<{ role: string; content: string }>,
        pendingToolCalls: new Set<string>(),
      },
      compact: async () => {
        agent.state.messages = [
          { role: "user", content: "new compacted context" },
          { role: "assistant", content: "summary after compact" },
        ];
        return { summary: "summary after compact", firstKeptEntryId: "e2", tokensBefore: 42 };
      },
      waitForIdle: async () => {},
    };
    (h.runtime as unknown as { agent: object }).agent = agent;
    await h.runtime.submit("/compact keep portfolio facts");
    expect(h.messages.at(-1)).toEqual([
      { role: "user", text: "new compacted context" },
      { role: "assistant", text: "summary after compact" },
      expect.objectContaining({ role: "assistant", text: expect.stringContaining("Compacted") }),
    ]);
  });

  it("waits for active agent turns before compacting", async () => {
    const h = harness();
    const waitForIdle = mock(async () => {});
    const compact = mock(async () => ({ summary: "summary after idle", firstKeptEntryId: "e2", tokensBefore: 42 }));
    const agent = {
      state: {
        isStreaming: true,
        messages: [] as Array<{ role: string; content: string }>,
        pendingToolCalls: new Set<string>(),
      },
      waitForIdle,
      compact,
    };
    (h.runtime as unknown as { agent: object }).agent = agent;

    await h.runtime.submit("/compact");

    expect(waitForIdle).toHaveBeenCalled();
    expect(compact).toHaveBeenCalledWith(undefined);
    expect(h.activities).toContain("compacting");
    expect(h.messages.at(-1)?.at(-1)).toEqual(expect.objectContaining({
      role: "assistant",
      text: expect.stringContaining("Compacted"),
    }));
  });

  it("shows compacting status while the slash command is running", async () => {
    const h = harness();
    let release = () => {};
    const compact = mock(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { summary: "summary after compact", firstKeptEntryId: "e2", tokensBefore: 42 };
    });
    const agent = {
      state: {
        isStreaming: false,
        messages: [] as Array<{ role: string; content: string }>,
        pendingToolCalls: new Set<string>(),
      },
      waitForIdle: mock(async () => {}),
      compact,
    };
    (h.runtime as unknown as { agent: object }).agent = agent;

    const submitPromise = h.runtime.submit("/compact keep quant context");
    await Promise.resolve();

    expect(h.activities).toContain("compacting");
    expect(h.statuses.at(-1)).toEqual({
      kind: "info",
      text: "Compacting the current session context...",
    });

    release();
    await submitPromise;
  });

  it("shows nothing-to-compact as an info status", async () => {
    const h = harness();
    const agent = {
      state: {
        isStreaming: false,
        messages: [] as Array<{ role: string; content: string }>,
        pendingToolCalls: new Set<string>(),
      },
      waitForIdle: mock(async () => {}),
      compact: mock(async () => {
        throw new Error("Nothing to compact");
      }),
    };
    (h.runtime as unknown as { agent: object }).agent = agent;

    await h.runtime.submit("/compact");

    expect(h.statuses.at(-1)).toEqual({
      kind: "info",
      text: "Nothing to compact. The current session context is already small enough.",
    });
  });

  it("opens resume panel for bare resume command before agent initialization", async () => {
    const h = harness();
    expect(await h.runtime.submit("/resume")).toBe("continue");
    expect(h.resumeOpened).toBe(1);
    expect(h.activities.at(-1)).toBe("ready");
  });

  it("maps missing resumed sessions to a user-facing slash error", async () => {
    const h = harness();
    const agent = {
      state: {
        isStreaming: false,
        messages: [] as Array<{ role: string; content: string }>,
        pendingToolCalls: new Set<string>(),
      },
      resumeSession: async () => {
        throw new Error("Session not found: missing-session");
      },
    };
    (h.runtime as unknown as { agent: object }).agent = agent;

    await h.runtime.submit("/resume missing-session");

    expect(h.statuses.at(-1)).toEqual({
      kind: "error",
      text: 'Could not find session "missing-session". Run /resume to see saved sessions, then choose one of them.',
    });
  });

  it("opens portfolio panel for bare portfolio command before agent initialization", async () => {
    const h = harness();
    expect(await h.runtime.submit("/portfolio")).toBe("continue");
    expect(h.portfolioOpened).toBe(1);
    expect(h.activities.at(-1)).toBe("ready");
  });

  it("renders portfolio groups even when only group codes are present", async () => {
    savePanelPortfolio({
      ...loadPanelPortfolio(),
      updated: "2026-06-10",
      symbols: [],
      groups: [{ id: "group-1", name: "核心组合", symbolCodes: ["510300.SH"] }],
    });
    const holdingSeen: string[][] = [];
    const h = harness(async () => [], async (entries) => {
      holdingSeen.push(entries.map((entry) => entry.code));
      return [];
    });
    await h.runtime.refreshOverviewPanel();
    const latestPanel = h.panels.at(-1)?.panel ?? [];
    const portfolioSection = latestPanel.find((section) => section.kind === "group" && section.title === "核心组合") as Extract<PanelSection, { kind: "group" }> | undefined;
    expect(portfolioSection).toBeTruthy();
    expect(portfolioSection?.rows.map((row) => row.code)).toEqual(["510300.SH"]);
    expect(holdingSeen.at(-1)).toEqual(expect.arrayContaining(["510300.SH"]));
  });
  it("selects local portfolio storage and refreshes overview state", async () => {
    mkdirSync(join(OHQ, "portfolio"), { recursive: true });
    await Bun.write(join(OHQ, "portfolio", "holdings_alpha.json"), JSON.stringify({
      name: "Alpha组合",
      updated: "2026-06-01",
      funds: [{ code: "510300", name: "沪深300ETF" }],
    }, null, 2));
    const instrumentsSeen: Array<string | undefined> = [];
    const h = harness(
      async () => [],
      async (entries) => {
        instrumentsSeen.push(...entries.map((entry) => entry.instrument));
        return entries.map((entry) => ({ code: entry.code, name: entry.name, price: 1, pct: 0 }));
      },
    );
    await h.runtime.submit("/portfolio import Alpha组合");
    // The command schedules refresh; let the immediate fixture response publish without requesting another round.
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(h.localStates.at(-1)?.activePortfolio).toBe("Alpha组合");
    expect(loadPanelPortfolio().symbols.map((item) => item.code)).toEqual(["510300.SH", "510300"]);
    expect(loadPanelPortfolio().symbols.at(-1)?.instrument).toBe("fund");
    expect(instrumentsSeen).toContain("fund");
    const latestPanel = h.panels.at(-1)?.panel ?? [];
    expect(latestPanel.some((section) => section.title === "Alpha组合")).toBe(true);
  });

  it("never infers instrument identity from legacy holdings during refresh", async () => {
    mkdirSync(join(OHQ, "portfolio"), { recursive: true });
    await Bun.write(join(OHQ, "portfolio", "holdings_semicon.json"), JSON.stringify({
      name: "聚焦半导体",
      funds: [{ code: "022364", name: "永赢科技智选发起A" }],
    }));
    saveSettings({
      ...DEFAULT_SETTINGS,
      preferences: { ...DEFAULT_SETTINGS.preferences, currentPortfolioFile: "holdings_semicon.json", source: "akshare" },
    });
    savePanelPortfolio({
      updated: "2026-07-15",
      revision: loadPanelPortfolio().revision,
      symbols: [
        { code: "022364", name: "永赢科技智选发起A", added: "2026-07-15" },
        { code: "000001", name: "平安银行", added: "2026-07-15" },
      ],
      groups: [{ id: "default", name: "聚焦半导体", symbolCodes: ["022364"] }],
    });
    const instrumentsSeen = new Map<string, string | undefined>();
    const h = harness(async () => [], async (entries) => {
      for (const entry of entries) instrumentsSeen.set(entry.code, entry.instrument);
      return [];
    });

    await h.runtime.refreshOverviewPanel();

    expect(instrumentsSeen.get("022364")).toBeUndefined();
    expect(instrumentsSeen.get("000001")).toBeUndefined();
  });

  it("redraws overview after /clear without refetching data", async () => {
    const marketSeen: string[][] = [];
    const h = harness(async (entries) => {
      marketSeen.push(entries.map((entry) => entry.code));
      return [];
    });
    await h.runtime.submit("hello");
    const panelsBefore = h.panels.length;
    await h.runtime.submit("/clear");
    expect(h.messages.at(-1)).toEqual([]);
    expect(h.panels.length).toBeGreaterThan(panelsBefore);
    expect(marketSeen).toHaveLength(0);
  });
});




it("refreshes automatically after a failure and stops immediately on disposal", async () => {
  let calls = 0;
  let secondPull: (() => void) | undefined;
  const observed = new Promise<void>(resolve => { secondPull = resolve; });
  const h = harness(async () => {
    calls++;
    if (calls === 1) throw new Error("offline");
    secondPull?.();
    return [];
  }, async () => [], undefined, undefined, undefined, 100, 10);
  await h.runtime.refreshOverviewPanel();
  await Promise.race([observed, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("No automatic refresh")), 500))]);
  h.runtime.dispose();
  const count = calls;
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(calls).toBe(count);
});

it("coalesces repeated refreshes and uses the latest portfolio in the next pull", async () => {
  let finish: (() => void) | undefined;
  const symbolsSeen: string[][] = [];
  let calls = 0;
  const h = harness(async () => {
    if (++calls === 1) await new Promise<void>(resolve => { finish = resolve; });
    return [];
  }, async entries => { symbolsSeen.push(entries.map(entry => entry.code)); return []; });
  const first = h.runtime.refreshOverviewPanel();
  const queued = h.runtime.refreshOverviewPanel();
  const alsoQueued = h.runtime.refreshOverviewPanel();
  savePanelPortfolio({ ...loadPanelPortfolio(), updated: "", symbols: [{ code: "AAPL", name: "Apple", added: "" }], groups: [] });
  finish?.();
  await Promise.all([first, queued, alsoQueued]);
  expect(calls).toBe(2);
  expect(symbolsSeen).toEqual([["510300.SH"], ["AAPL"]]);
});

it("disposal aborts pending I/O, settles refresh, and prevents late UI updates", async () => {
  let signal: AbortSignal | undefined;
  const h = harness(async (_entries, meta) => {
    signal = meta.signal;
    return new Promise(() => {});
  });
  const pending = h.runtime.refreshOverviewPanel();
  const updates = h.panels.length;
  h.runtime.dispose();
  await pending;
  expect(signal?.aborted).toBe(true);
  await h.runtime.refreshOverviewPanel();
  expect(h.panels).toHaveLength(updates);
});
