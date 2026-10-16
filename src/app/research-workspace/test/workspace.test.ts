import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { JsonlSessionRepo } from "../../../agent/src/session-runtime/index.ts";
import { NodeExecutionEnv } from "../../../agent/src/session-runtime/node.ts";
import type { QuantAgentDependencies } from "../../../agent/src/session-contracts.ts";
import {
  createWorkspaceStore,
  workspaceHash,
  subscribeFileEvents,
  type WorkspaceMetadata,
} from "../../../storage/index.ts";
import { buildResearchReport } from "../../../research/input.ts";
import { startWorkspaceServer } from "../server.ts";
import { calculateMetrics } from "../metrics.ts";
import type {
  WorkspaceEvidence,
  WorkspaceRun,
} from "../../../types/workspace.ts";

const roots: string[] = [],
  servers: Array<{ stop(force?: boolean): unknown }> = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.stop(true);
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep))
      throw new Error("Unsafe test cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
const scope = {
  symbol: "002048.SZ",
  benchmark: "000300.SH",
  start: "2026-01-01",
  end: "2026-02-01",
};
function evidence(symbol: string, factor = 1): WorkspaceEvidence {
  const bars = Array.from({ length: 25 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    open: (100 + i) * factor,
    close: (100 + i) * factor,
    high: (102 + i) * factor,
    low: (99 + i) * factor,
    volume: i === 24 ? 200 : 100,
    amount: null,
  }));
  return {
    id: symbol === scope.symbol ? "E1" : "E2",
    kind: "prices",
    symbol,
    source: "fixture",
    fetchedAt: "2026-02-01T00:00:00Z",
    contentHash: workspaceHash(bars),
    bars,
    sessions: bars.map((b) => b.date),
    adjustment: "fixture",
    limitations: [],
  };
}
async function fixture(mode = "normal") {
  const root = mkdtempSync(join(tmpdir(), "whyj-workspace-"));
  roots.push(root);
  let requests = 0,
    reads = 0;
  let compositions = 0;
  const payloads: unknown[] = [];
  const names = [
    "get_market_evidence",
    "calculate_research",
    "publish_research",
  ];
  const modelServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as {
        tools: Array<{ function: { name: string } }>;
      };
      payloads.push(body);
      expect(body.tools.map((t) => t.function.name).sort()).toEqual(
        [...names, "ask_user"].sort(),
      );
      const n = requests++;
      if (mode === "followup-stall" && n === 3) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"id":"stall","object":"chat.completion.chunk","created":0,"model":"fixture","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
                ),
              );
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }
      if (
        mode === "plain-first" ||
        (mode === "clarify-plain" && n > 0) ||
        ((mode === "plain-followup" || mode === "bad-plain-followup") && n >= 3)
      ) {
        const content =
          mode === "bad-plain-followup"
            ? "错误引用 E99。"
            : "根据 E3，缩量仅描述成交量变化，不能证明交易者意图；需结合结构与后续证据。";
        const chunk = {
          id: `plain-${n}`,
          object: "chat.completion.chunk",
          created: 0,
          model: "fixture",
        };
        return new Response(
          [
            {
              ...chunk,
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant", content },
                  finish_reason: null,
                },
              ],
            },
            {
              ...chunk,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            },
          ]
            .map((value) => `data: ${JSON.stringify(value)}\n\n`)
            .join("") + "data: [DONE]\n\n",
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }
      const answer = {
        summary: "固定样本结构观察",
        classification: "上涨后观察",
        signal: "观察",
        claims: [
          {
            text: "样本收益由工具计算。",
            evidence: [mode === "bad-citation" ? "E99" : "E3"],
          },
        ],
        next: ["跟踪后续日线"],
        limitations: [],
      };
      const name =
        mode.startsWith("clarify") && n === 0
          ? "ask_user"
          : names[Math.min(mode.startsWith("clarify") ? n - 1 : n, 2)]!;
      const args =
        name === "ask_user"
          ? { question: "请说明想进一步了解量比还是均线。" }
          : name === "publish_research"
            ? answer
            : {};
      const chunk = {
        id: "fixture",
        object: "chat.completion.chunk",
        created: 0,
        model: "fixture",
      };
      const parts = [
        {
          ...chunk,
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: `t${n}`,
                    type: "function",
                    function: { name, arguments: JSON.stringify(args) },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          ...chunk,
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        },
      ];
      return new Response(
        parts.map((p) => `data: ${JSON.stringify(p)}\n\n`).join("") +
          "data: [DONE]\n\n",
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  servers.push(modelServer);
  const model: Model<"openai-completions"> = {
    id: "fixture",
    name: "fixture",
    api: "openai-completions",
    provider: "custom",
    baseUrl: `${modelServer.url}v1`,
    reasoning: false,
    input: ["text"],
    contextWindow: 128000,
    maxTokens: 1000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const env = new NodeExecutionEnv({ cwd: root });
  const dependencies = (): QuantAgentDependencies => {
    compositions++;
    return {
      env,
      sessions: new JsonlSessionRepo({
        fs: env,
        sessionsRoot: join(root, "sessions"),
      }),
      tools: [],
      readConnection: () => ({
        model,
        thinkingLevel: "off",
        compactTriggerTokens: 100000,
        getAuth: async () => ({ apiKey: "fixture-key" }),
      }),
      loadSkills: async () => [],
      prompts: { system: () => "", turn: (s) => s, skill: () => "" },
      verifyResearch: buildResearchReport,
    };
  };
  const store = createWorkspaceStore(join(root, "saved"));
  const ports = {
    dependencies,
    store,
    timeoutMs: mode === "timeout" ? 100 : 5000,
    async fetchPrices(
      symbol: string,
      _scope: typeof scope,
      signal: AbortSignal,
    ) {
      reads++;
      if (
        ((mode === "slow" || mode === "timeout") && reads === 1) ||
        (mode === "slow-base" && reads === 2)
      )
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          ),
        );
      signal.throwIfAborted();
      if (mode === "broken")
        throw new Error("private provider failure fixture-key");
      const e = evidence(symbol);
      return {
        bars: e.bars!,
        sessions: e.sessions!,
        source: e.source,
        fetchedAt: e.fetchedAt,
        adjustment: e.adjustment!,
      };
    },
  };
  const app = startWorkspaceServer({ port: 0, ...ports });
  servers.push(app.server);
  const url = app.server.url;
  const { token } = (await (
    await fetch(new URL("api/status", url))
  ).json()) as { token: string };
  const post = (path: string, value: unknown = {}) =>
    fetch(new URL(path, url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Token": token,
      },
      body: JSON.stringify(value),
    });
  const wait = async (id: string) => {
    for (let i = 0; i < 150; i++) {
      const r = app.manager.get(id);
      if (r.status !== "running") return r;
      await Bun.sleep(20);
    }
    throw new Error("Fixture did not settle");
  };
  return {
    ...app,
    post,
    wait,
    root,
    url,
    store,
    ports,
    payloads,
    compositions: () => compositions,
    reads: () => reads,
    reset: () => {
      requests = 0;
    },
  };
}
test("real Pi loop → tools → citations → immutable save → reload → linked review", async () => {
  const f = await fixture();
  const response = await f.post("api/runs", {
    question: "研究固定样本",
    scope,
  });
  expect(response.status).toBe(202);
  const started = (await response.json()) as WorkspaceRun;
  const run = await f.wait(started.id);
  expect(run.status).toBe("complete");
  expect(run.answer?.claims[0]?.evidence).toEqual(["E3"]);
  expect(run.evidence[2]?.result?.returnPct).toBeCloseTo(24);
  expect(run.evidence[2]?.result?.volumeRatio).toBe(2);
  expect(run.answer?.limitations.join(" ")).toContain("板块");
  expect((await f.post(`api/runs/${run.id}/save`)).status).toBe(200);
  expect((await f.post(`api/runs/${run.id}/save`)).status).toBe(200);
  const before = f.store.load(run.id);
  f.reset();
  const reviewed = (await (
    await f.post(`api/runs/${run.id}/review`, { end: scope.end })
  ).json()) as WorkspaceRun;
  const review = await f.wait(reviewed.id);
  expect(review.status).toBe("complete");
  expect(review.parentId).toBe(run.id);
  expect(review.evidence[2]?.result?.historicalRevisions).toEqual([]);
  expect(review.evidence[2]?.result?.previousBoundary).toEqual(
    run.evidence[2]?.result?.structuralLow,
  );
  expect(f.store.load(run.id)).toEqual(before);
  expect(createWorkspaceStore(join(f.root, "saved")).list()).toHaveLength(1);
}, 10000);
test("follow-up retains real Agent context and evidence without rewriting a saved turn", async () => {
  const f = await fixture();
  const first = (await (
    await f.post("api/runs", {
      question: "记录研究代号 ORBIT-ALPHA，再研究样本",
      scope,
    })
  ).json()) as WorkspaceRun;
  await f.wait(first.id);
  await f.post(`api/runs/${first.id}/save`);
  const original = f.store.load(first.id);
  const next = (await (
    await f.post(`api/runs/${first.id}/followup`, {
      question: "解释刚才的量比和研究代号",
    })
  ).json()) as WorkspaceRun;
  const reply = await f.wait(next.id);
  expect(reply.status).toBe("complete");
  expect(reply.id).not.toBe(first.id);
  expect(reply.conversationId).toBe(first.id);
  expect(reply.history).toHaveLength(1);
  expect(reply.history![0]!.question).toContain("ORBIT-ALPHA");
  expect(reply.evidence).toEqual(original.evidence);
  expect(f.reads()).toBe(2);
  expect(f.compositions()).toBe(1);
  expect(JSON.stringify(f.payloads.at(-1))).toContain("ORBIT-ALPHA");
  expect(JSON.stringify(f.payloads.at(-1))).toContain("固定样本结构观察");
  expect(f.store.load(first.id)).toEqual(original);
  expect((await f.post(`api/runs/${next.id}/save`)).status).toBe(200);
  expect(f.store.load(next.id).history![0]!.answer).toEqual(original.answer);
  expect(f.manager.latest(first.id).id).toBe(next.id);
  expect(f.manager.latest(first.id).saved).toBe(true);
}, 10000);

test("a clarification is part of the conversation and the next message can answer it", async () => {
  const f = await fixture("clarify");
  const first = (await (
    await f.post("api/runs", { question: "请帮我研究", scope })
  ).json()) as WorkspaceRun;
  const asked = await f.wait(first.id);
  expect(asked.status).toBe("needs_input");
  expect(asked.clarification).toContain("量比");
  const next = (await (
    await f.post(`api/runs/${first.id}/followup`, { question: "请先解释量比" })
  ).json()) as WorkspaceRun;
  const reply = await f.wait(next.id);
  expect(reply.status).toBe("complete");
  expect(reply.history![0]!.clarification).toBe(asked.clarification);
  expect(f.compositions()).toBe(1);
  expect(f.reads()).toBe(2);
}, 10000);

test("saved conversations reconstruct context after restart with no fresh price fetch", async () => {
  const f = await fixture();
  const first = (await (
    await f.post("api/runs", { question: "研究代号 REOPEN-BETA", scope })
  ).json()) as WorkspaceRun;
  await f.wait(first.id);
  await f.post(`api/runs/${first.id}/save`);
  f.server.stop(true);
  const restarted = startWorkspaceServer({ port: 0, ...f.ports });
  servers.push(restarted.server);
  const next = restarted.manager.followup(first.id, "继续解释原结论的证据边界");
  for (
    let i = 0;
    i < 150 && restarted.manager.get(next.id).status === "running";
    i++
  )
    await Bun.sleep(20);
  const reply = restarted.manager.get(next.id);
  expect(reply.status).toBe("complete");
  expect(reply.history![0]!.question).toContain("REOPEN-BETA");
  expect(reply.events[0]!.kind).toBe("context_restore");
  expect(f.reads()).toBe(2);
  expect(f.compositions()).toBe(2);
  expect(JSON.stringify(f.payloads.at(-1))).toContain("REOPEN-BETA");
}, 10000);

test("ordinary follow-up prose is kept as conversation, saved and restored without inventing a new research artifact", async () => {
  const f = await fixture("plain-followup");
  const first = (await (
    await f.post("api/runs", { question: "样本研究", scope })
  ).json()) as WorkspaceRun;
  await f.wait(first.id);
  const next = (await (
    await f.post(`api/runs/${first.id}/followup`, {
      question: "解释缩量的含义",
    })
  ).json()) as WorkspaceRun;
  const reply = await f.wait(next.id);
  expect(reply.status).toBe("complete");
  expect(reply.reply).toContain("不能证明");
  expect(reply.answer).toBeNull();
  expect(reply.history![0]!.answer).not.toBeNull();
  expect(f.reads()).toBe(2);
  await f.post(`api/runs/${reply.id}/save`);
  expect(f.store.load(reply.id).reply).toBe(reply.reply);
  const original = f.store.load(reply.id);
  const third = (await (
    await f.post(`api/runs/${reply.id}/followup`, {
      question: "延续上一条解释",
    })
  ).json()) as WorkspaceRun;
  const final = await f.wait(third.id);
  expect(final.status).toBe("complete");
  expect(final.history![1]!.reply).toBe(reply.reply);
  expect(JSON.stringify(f.payloads.at(-1))).toContain("不能证明");
  expect(f.store.load(reply.id)).toEqual(original);
}, 10000);

test("first-task prose and invented references cannot be saved as a completed conversation", async () => {
  const f = await fixture("plain-first");
  const first = (await (
    await f.post("api/runs", { question: "研究", scope })
  ).json()) as WorkspaceRun;
  expect((await f.wait(first.id)).status).toBe("failed");
  expect((await f.post(`api/runs/${first.id}/save`)).status).toBe(400);
  const bad = await fixture("bad-plain-followup");
  const base = (await (
    await bad.post("api/runs", { question: "研究", scope })
  ).json()) as WorkspaceRun;
  await bad.wait(base.id);
  const next = (await (
    await bad.post(`api/runs/${base.id}/followup`, { question: "解释" })
  ).json()) as WorkspaceRun;
  expect((await bad.wait(next.id)).status).toBe("failed");
  expect((await bad.post(`api/runs/${next.id}/save`)).status).toBe(400);
}, 10000);

test("an old turn cannot cancel a live follow-up; the current turn can cancel and continue", async () => {
  const f = await fixture("followup-stall");
  const first = (await (
    await f.post("api/runs", { question: "研究", scope })
  ).json()) as WorkspaceRun;
  await f.wait(first.id);
  const next = (await (
    await f.post(`api/runs/${first.id}/followup`, { question: "追问" })
  ).json()) as WorkspaceRun;
  for (let i = 0; i < 80 && f.payloads.length < 4; i++) await Bun.sleep(20);
  expect((await f.post(`api/runs/${first.id}/cancel`)).status).toBe(400);
  expect(f.manager.get(next.id).status).toBe("running");
  expect((await f.post(`api/runs/${next.id}/cancel`)).status).toBe(200);
  expect((await f.wait(next.id)).status).toBe("cancelled");
  expect((await f.post(`api/runs/${next.id}/continue`)).status).toBe(200);
  expect((await f.wait(next.id)).status).toBe("complete");
  expect(f.manager.get(first.id).status).toBe("complete");
  expect(f.reads()).toBe(2);
}, 10000);

test("clarification history alone cannot turn first-research prose into an archivable completed task", async () => {
  const f = await fixture("clarify-plain");
  const first = (await (
    await f.post("api/runs", { question: "研究", scope })
  ).json()) as WorkspaceRun;
  expect((await f.wait(first.id)).status).toBe("needs_input");
  const next = (await (
    await f.post(`api/runs/${first.id}/followup`, {
      question: "解释量比并完成研究",
    })
  ).json()) as WorkspaceRun;
  const reply = await f.wait(next.id);
  expect(reply.status).toBe("failed");
  expect(reply.answer).toBeNull();
  expect(reply.evidence).toHaveLength(0);
  expect((await f.post(`api/runs/${reply.id}/save`)).status).toBe(400);
  expect(() => f.store.save({ ...reply, status: "complete" })).toThrow(
    "Only completed",
  );
}, 10000);

test("unknown citations never become a saved completed report", async () => {
  const f = await fixture("bad-citation");
  const r = (await (
    await f.post("api/runs", { question: "test", scope })
  ).json()) as WorkspaceRun;
  const run = await f.wait(r.id);
  expect(run.status).toBe("failed");
  expect(run.answer).toBeNull();
  expect((await f.post(`api/runs/${r.id}/save`)).status).toBe(400);
}, 10000);
test("cancel aborts tool fetch; explicit continue reuses session and completes", async () => {
  const f = await fixture("slow");
  const r = (await (
    await f.post("api/runs", { question: "test", scope })
  ).json()) as WorkspaceRun;
  for (let i = 0; i < 50 && f.reads() === 0; i++) await Bun.sleep(20);
  expect((await f.post(`api/runs/${r.id}/cancel`)).status).toBe(200);
  expect((await f.wait(r.id)).status).toBe("cancelled");
  f.reset();
  expect((await f.post(`api/runs/${r.id}/continue`)).status).toBe(200);
  expect((await f.wait(r.id)).status).toBe("complete");
}, 10000);
test("local API rejects cross-origin, missing token, and malformed scope", async () => {
  const f = await fixture();
  expect(
    (await fetch(new URL("api/runs", f.url), { method: "POST", body: "{}" }))
      .status,
  ).toBe(403);
  expect(
    (
      await fetch(new URL("api/status", f.url), {
        headers: { Origin: "https://evil.example" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await f.post("api/runs", {
        question: "test",
        scope: { ...scope, symbol: "300001.SZ" },
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await f.post("api/runs", {
        question: "test",
        scope: { ...scope, end: "2030-01-01" },
      })
    ).status,
  ).toBe(400);
});
test("partial evidence survives cancellation and a second run cannot race the active one", async () => {
  const f = await fixture("slow-base");
  const r = (await (
    await f.post("api/runs", { question: "test", scope })
  ).json()) as WorkspaceRun;
  for (let i = 0; i < 80 && f.reads() < 2; i++) await Bun.sleep(20);
  expect(f.manager.get(r.id).evidence).toHaveLength(1);
  expect(
    (await f.post("api/runs", { question: "another", scope })).status,
  ).toBe(400);
  await f.post(`api/runs/${r.id}/cancel`);
  const stopped = await f.wait(r.id);
  expect(stopped.status).toBe("cancelled");
  expect(stopped.evidence).toHaveLength(1);
  const hash = stopped.evidence[0]!.contentHash;
  f.reset();
  await f.post(`api/runs/${r.id}/continue`);
  const completed = await f.wait(r.id);
  expect(completed.status).toBe("complete");
  expect(completed.evidence[0]!.contentHash).toBe(hash);
  expect(f.reads()).toBe(3);
}, 10000);

test("timeout leaves an explicit incomplete task; source failures cannot masquerade as analysis", async () => {
  const f = await fixture("timeout");
  const r = (await (
    await f.post("api/runs", { question: "test", scope })
  ).json()) as WorkspaceRun;
  const stopped = await f.wait(r.id);
  expect(stopped.status).toBe("cancelled");
  expect(stopped.error).toContain("时限");
  expect((await f.post(`api/runs/${r.id}/save`)).status).toBe(400);
  const broken = await fixture("broken");
  const b = (await (
    await broken.post("api/runs", { question: "test", scope })
  ).json()) as WorkspaceRun;
  const failed = await broken.wait(b.id);
  expect(failed.status).toBe("failed");
  expect(failed.answer).toBeNull();
  expect(JSON.stringify(failed)).not.toContain("fixture-key");
}, 10000);

test("closing progress stream does not cancel the research", async () => {
  const f = await fixture();
  const r = (await (
    await f.post("api/runs", { question: "test", scope })
  ).json()) as WorkspaceRun;
  const stream = await fetch(new URL(`api/runs/${r.id}/events`, f.url));
  expect(stream.headers.get("content-type")).toBe("text/event-stream");
  const reader = stream.body!.getReader();
  expect((await reader.read()).value?.length).toBeGreaterThan(0);
  await reader.cancel();
  expect((await f.wait(r.id)).status).toBe("complete");
}, 10000);

test("metrics use preceding volume and common dates; revisions preserve original boundary", () => {
  const stock = evidence(scope.symbol),
    base = evidence(scope.benchmark, 2);
  const m = calculateMetrics(stock, base);
  expect(m.ma20).toBeCloseTo(114.5);
  expect(m.volumeRatio).toBe(2);
  expect(m.relativeReturnPp).toBe(0);
  expect(m.drawdownPct).toBe(0);
  expect(m.comparison.previousEnd).toBeNull();
  expect(m.comparison.comparable).toBe(false);
  const previous = {
    evidence: [structuredClone(stock), { result: m }],
  } as WorkspaceRun;
  stock.bars![0]!.close += 0.1;
  const review = calculateMetrics(stock, base, previous);
  expect(review.historicalRevisions).toEqual(["2026-01-01"]);
  expect(review.previousBoundary).toEqual(m.structuralLow);
});

test("missing forward sessions and regressed coverage cannot validate an old boundary", () => {
  const stock = evidence(scope.symbol),
    base = evidence(scope.benchmark);
  const previous = {
    evidence: [
      structuredClone(stock),
      { result: calculateMetrics(stock, base) },
    ],
  } as WorkspaceRun;
  stock.bars!.push({
    date: "2026-01-27",
    open: 90,
    high: 91,
    low: 89,
    close: 90,
    volume: 100,
    amount: null,
  });
  stock.sessions!.push("2026-01-26", "2026-01-27");
  const missing = calculateMetrics(stock, base, previous);
  expect(missing.comparison.advanced).toBe(true);
  expect(missing.close).toBeLessThan(missing.previousBoundary!.price);
  expect(missing.comparison.comparable).toBe(false);
  stock.bars!.splice(-2);
  const regressed = calculateMetrics(stock, base, previous);
  expect(regressed.comparison.comparable).toBe(false);
  expect(regressed.limitations.join(" ")).toContain("倒退");
  expect(regressed.limitations.join(" ")).not.toContain("截止日相同");
});

test("successful file activities are observable and idempotent saves do not invent writes", async () => {
  const f = await fixture();
  const r = (await (
    await f.post("api/runs", { question: "test", scope })
  ).json()) as WorkspaceRun;
  await f.wait(r.id);
  const operations: string[] = [];
  const unsubscribe = subscribeFileEvents((event) => {
    if (event.path.startsWith(join(f.root, "saved")))
      operations.push(event.operation);
  });
  try {
    await f.post(`api/runs/${r.id}/save`);
    f.store.list();
    expect(operations).toContain("MKDIR");
    expect(operations).toContain("READ");
    expect(operations.filter((op) => op === "WRITE")).toHaveLength(1);
    await f.post(`api/runs/${r.id}/save`);
    expect(operations.filter((op) => op === "WRITE")).toHaveLength(1);
  } finally {
    unsubscribe();
  }
}, 10000);
test("saved checksum detects corruption without overwriting original", async () => {
  const f = await fixture();
  const r = (await (
    await f.post("api/runs", { question: "test", scope })
  ).json()) as WorkspaceRun;
  await f.wait(r.id);
  await f.post(`api/runs/${r.id}/save`);
  const path = join(f.root, "saved", `${r.id}.json`),
    text = readFileSync(path, "utf8");
  writeFileSync(path, text.replace("固定样本结构观察", "tampered"));
  expect(() => f.store.load(r.id)).toThrow("integrity");
  expect((await f.post(`api/runs/${r.id}/save`)).status).toBe(400);
}, 10000);

test("workspace meta supports project pinning, study custom titles, and study deletion", async () => {
  const f = await fixture();
  // 1. Check default metadata
  const metaRes = await fetch(new URL("api/workspace/meta", f.url));
  expect(metaRes.status).toBe(200);
  const initialMeta = (await metaRes.json()) as WorkspaceMetadata;
  expect(initialMeta.projects.length).toBeGreaterThanOrEqual(1);

  // 2. Update metadata with pinned project and custom study title
  const updatedMeta = {
    projects: [
      {
        id: "002048.SZ",
        symbol: "002048.SZ",
        name: "002048.SZ 宁波华翔跟踪",
        benchmark: "000300.SH",
        pinned: true,
        pinnedAt: new Date().toISOString(),
      },
    ],
    studies: {
      "test-study-id": {
        customTitle: "华翔回撤结构研判",
        projectId: "002048.SZ",
        archived: true,
      },
    },
  };
  const saveMetaRes = await f.post("api/workspace/meta", updatedMeta);
  expect(saveMetaRes.status).toBe(200);
  const savedMeta = (await saveMetaRes.json()) as WorkspaceMetadata;
  expect(savedMeta.projects[0].pinned).toBe(true);
  expect(savedMeta.studies["test-study-id"].archived).toBe(true);

  // 3. Test study creation, save, and deletion
  const r = (await (
    await f.post("api/runs", { question: "test delete", scope })
  ).json()) as WorkspaceRun;
  await f.wait(r.id);
  await f.post(`api/runs/${r.id}/save`);
  expect(f.store.list().some((s) => s.id === r.id)).toBe(true);

  // Delete the study
  const delRes = await f.post(`api/runs/${r.id}/delete`);
  expect(delRes.status).toBe(200);
  expect(f.store.list().some((s) => s.id === r.id)).toBe(false);
}, 10000);

