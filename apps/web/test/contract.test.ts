import { describe, expect, test } from "bun:test";
import type { WorkbenchEvent } from "../src/contract.ts";
import { createFixtureClient } from "../src/fixtures.ts";

const WORKSPACE = "ws-demo-002048";

describe("WorkbenchClient contract", () => {
  test("releasing a subscription detaches without cancelling the run", async () => {
    const client = createFixtureClient({ settleAfterMs: 60_000 });
    const events: WorkbenchEvent[] = [];
    const release = client.subscribe(event => events.push(event));

    const { runId } = await client.submit({ workspaceId: WORKSPACE, text: "研究回撤结构" });
    expect(events.some(event => event.type === "state" && event.state === "running")).toBe(true);

    const delivered = events.length;
    release();

    // The work is still owned by the client: detaching is not cancelling.
    expect((await client.identity()).runId).toBe(runId);

    // Nothing new reaches the released listener, not even the later cancel.
    await client.cancel(runId);
    expect(events.length).toBe(delivered);
    expect((await client.identity()).runId).toBeNull();
  });

  test("cancelling is an explicit command with its own event", async () => {
    const client = createFixtureClient({ settleAfterMs: 60_000 });
    const events: WorkbenchEvent[] = [];
    const release = client.subscribe(event => events.push(event));

    const { runId } = await client.submit({ workspaceId: WORKSPACE, text: "研究回撤结构" });
    await client.cancel(runId);

    const states = events.filter(event => event.type === "state").map(event => (event.type === "state" ? event.state : ""));
    expect(states).toEqual(["running", "cancelled"]);
    release();
  });

  test("submitting records the question before the answer", async () => {
    const client = createFixtureClient({ settleAfterMs: 60_000 });
    await client.submit({ workspaceId: WORKSPACE, text: "相对沪深300的回撤结构如何？" });

    const turns = await client.transcript("session-demo-1");
    expect(turns.map(turn => turn.role)).toEqual(["user", "assistant"]);
    expect(turns[0]?.text).toBe("相对沪深300的回撤结构如何？");
    expect(turns[1]?.state).toBe("running");
  });

  test("missing market data stays missing instead of becoming a number", async () => {
    const client = createFixtureClient({ settleAfterMs: 0 });
    const snapshot = await client.market();

    expect(snapshot.source.available).toBe(0);
    expect(snapshot.source.provider).toBeNull();
    for (const quote of snapshot.quotes) {
      expect(quote.value).toBeNull();
      expect(quote.change).toBeNull();
    }
  });

  test("an empty workspace reports no conclusion rather than an unverified one", async () => {
    const client = createFixtureClient({ settleAfterMs: 0 });
    const output = await client.output("ws-demo-002048");

    expect(output.conclusion.statement).toBeNull();
    expect(output.conclusion.settled).toBe(false);
    expect(output.artifacts).toHaveLength(0);
    expect(output.evidence.every(item => item.available === false)).toBe(true);
  });

  test("sample output is labelled as a sample, not as market data", async () => {
    const client = createFixtureClient({ settleAfterMs: 0 });
    const output = await client.output("ws-sample-300308");

    expect(output.conclusion.settled).toBe(true);
    for (const item of output.evidence) {
      expect(item.label).toContain("示例");
      expect(item.source).toBe("示例");
    }
    for (const artifact of output.artifacts) {
      expect(artifact.title).toContain("示例");
      expect(artifact.sha256).toHaveLength(64);
    }
  });
});
