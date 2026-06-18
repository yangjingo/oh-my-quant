/**
 * User-message dispatch — mirrors pi agent-harness steer/followUp/prompt split.
 * Reference: reference/pi/packages/agent/src/harness/agent-harness.ts
 */
import type { AgentMessage } from "./pi/index.ts";
import type { QuantAgentSession } from "./session.ts";

export type AgentDispatchMode = "prompt" | "steer" | "followUp";

function createUserMessage(text: string): AgentMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

/** Queue while a turn is active. Tools running → steer; otherwise → followUp. */
export async function enqueueAgentMessage(agent: QuantAgentSession, text: string): Promise<AgentDispatchMode> {
  const message = createUserMessage(text);
  if (agent.state.pendingToolCalls.size > 0) {
    await agent.steer(message);
    return "steer";
  }
  await agent.followUp(message);
  return "followUp";
}

/** Idle → prompt(); active turn → steer/followUp queue (never double prompt). */
export async function dispatchUserMessage(agent: QuantAgentSession, text: string): Promise<AgentDispatchMode> {
  if (agent.state.isStreaming) {
    return await enqueueAgentMessage(agent, text);
  }
  try {
    await agent.prompt(text);
    return "prompt";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already processing")) {
      return await enqueueAgentMessage(agent, text);
    }
    throw err;
  }
}

export function isAgentTurnActive(agent: QuantAgentSession | null | undefined): boolean {
  return agent?.state.isStreaming ?? false;
}
