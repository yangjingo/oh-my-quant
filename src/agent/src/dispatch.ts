/**
 * User-message dispatch — mirrors pi agent-harness steer/followUp/prompt split.
 * Reference: reference/pi/packages/agent/src/harness/agent-harness.ts
 */
import type { AgentMessage } from "./pi/index.ts";
import { createDisplayUserMessage } from "./pi/harness/messages.ts";
import type { QuantAgentSession } from "./session.ts";

export type AgentDispatchMode = "prompt" | "steer" | "followUp";

function createUserMessage(text: string, displayText = text): AgentMessage {
  return createDisplayUserMessage(text, displayText);
}

/** Queue while a turn is active. Tools running → steer; otherwise → followUp. */
export async function enqueueAgentMessage(
  agent: QuantAgentSession,
  text: string,
  displayText = text,
): Promise<AgentDispatchMode> {
  const message = createUserMessage(text, displayText);
  if (agent.state.pendingToolCalls.size > 0) {
    await agent.steer(message);
    return "steer";
  }
  await agent.followUp(message);
  return "followUp";
}

/** Idle → prompt(); active turn → steer/followUp queue (never double prompt). */
export async function dispatchUserMessage(
  agent: QuantAgentSession,
  text: string,
  displayText = text,
): Promise<AgentDispatchMode> {
  if (agent.state.isStreaming) {
    return await enqueueAgentMessage(agent, text, displayText);
  }
  try {
    await agent.prompt(text, { displayText });
    return "prompt";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already processing")) {
      return await enqueueAgentMessage(agent, text, displayText);
    }
    throw err;
  }
}

export function isAgentTurnActive(agent: QuantAgentSession | null | undefined): boolean {
  return agent?.state.isStreaming ?? false;
}
