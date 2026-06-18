import { describe, expect, it, mock } from "bun:test";
import type { QuantAgentSession } from "../src/session.ts";
import { dispatchUserMessage, enqueueAgentMessage, isAgentTurnActive } from "../src/dispatch.ts";

function mockAgent(overrides: Partial<{
  isStreaming: boolean;
  pendingTools: number;
  prompt: () => Promise<void>;
  steer: (msg: unknown) => void;
  followUp: (msg: unknown) => void;
}> = {}): QuantAgentSession {
  const pendingToolCalls = new Set<string>();
  for (let i = 0; i < (overrides.pendingTools ?? 0); i++) pendingToolCalls.add(`t${i}`);
  return {
    state: {
      isStreaming: overrides.isStreaming ?? false,
      pendingToolCalls,
    },
    prompt: overrides.prompt ?? mock(async () => {}),
    steer: overrides.steer ?? mock(() => {}),
    followUp: overrides.followUp ?? mock(() => {}),
  } as unknown as QuantAgentSession;
}

describe("dispatchUserMessage", () => {
  it("calls prompt when idle", async () => {
    const prompt = mock(async () => {});
    const agent = mockAgent({ prompt });
    const mode = await dispatchUserMessage(agent, "hello");
    expect(mode).toBe("prompt");
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("followUp when streaming without pending tools", async () => {
    const followUp = mock(() => {});
    const agent = mockAgent({ isStreaming: true, followUp });
    const mode = await dispatchUserMessage(agent, "also check risk");
    expect(mode).toBe("followUp");
    expect(followUp).toHaveBeenCalledTimes(1);
  });

  it("steer when streaming with pending tools", async () => {
    const steer = mock(() => {});
    const agent = mockAgent({ isStreaming: true, pendingTools: 1, steer });
    const mode = await dispatchUserMessage(agent, "stop and summarize");
    expect(mode).toBe("steer");
    expect(steer).toHaveBeenCalledTimes(1);
  });

  it("falls back to followUp when prompt races activeRun", async () => {
    const followUp = mock(() => {});
    const agent = mockAgent({
      followUp,
      prompt: mock(async () => {
        throw new Error("Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.");
      }),
    });
    const mode = await dispatchUserMessage(agent, "race");
    expect(mode).toBe("followUp");
    expect(followUp).toHaveBeenCalledTimes(1);
  });

  it("waits for followUp queueing before returning", async () => {
    let queued = false;
    const followUp = mock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      queued = true;
    });
    const agent = mockAgent({ isStreaming: true, followUp });

    const mode = await dispatchUserMessage(agent, "queue this next");

    expect(mode).toBe("followUp");
    expect(queued).toBe(true);
  });
});

describe("isAgentTurnActive", () => {
  it("returns false when agent is null", () => {
    expect(isAgentTurnActive(null)).toBe(false);
  });
});

describe("enqueueAgentMessage", () => {
  it("routes to steer with pending tool calls", async () => {
    const steer = mock(() => {});
    const agent = mockAgent({ isStreaming: true, pendingTools: 2, steer });
    await expect(enqueueAgentMessage(agent, "x")).resolves.toBe("steer");
  });
});
