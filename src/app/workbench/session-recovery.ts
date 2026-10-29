import type { RunState, SessionSnapshot, Turn } from "../../types/workbench.ts";

/** Missing or ambiguous execution history is not evidence that no tool ran. */
export function completeRunActivity(turns: readonly Turn[], runId: string, state: RunState): boolean {
  const matching = turns.filter(turn => turn.id === runId + "-assistant");
  const prior = matching[0];
  return matching.length === 1 && prior?.role === "assistant" && prior.state === state && !!prior.activity
    && new Set(prior.activity.map(item => item.id)).size === prior.activity.length
    && prior.activity.every(item => !!item.id.trim() && !!item.name.trim());
}

/** Reading an abandoned run never retries it or invents a tool outcome. */
export function recoverSnapshot(saved: SessionSnapshot, hasEffects: (name: string) => boolean = () => true): SessionSnapshot {
  if (["cancelled", "failed", "settled", "needs_input", "interrupted"].includes(saved.state) && saved.identity.runId && !saved.recovery) {
    const incomplete = !completeRunActivity(saved.turns, saved.identity.runId, saved.state);
    const count = saved.turns.filter(turn => turn.id === saved.identity.runId + "-assistant")
      .flatMap(turn => turn.activity ?? []).filter(item => item.state === "unconfirmed" || ["running", "cancelled", "failed"].includes(item.state) && hasEffects(item.name)).length;
    if (incomplete || count > 0) return { ...saved, recovery: { runId: saved.identity.runId, unconfirmedTools: count, acknowledgementRequired: true } };
  }
  if (saved.state !== "running") return saved;
  const turns = saved.turns.map(turn => turn.state !== "running" ? turn : {
    ...turn, state: "interrupted" as const,
    activity: turn.activity?.map(item => item.state === "preparing" ? { ...item, state: "not-run" as const }
      : item.state === "running" ? { ...item, state: "unconfirmed" as const, elapsedMs: undefined } : item),
  });
  const count = turns.filter(turn => turn.id === saved.identity.runId + "-assistant")
    .flatMap(turn => turn.activity ?? []).filter(item => item.state === "unconfirmed" || item.state === "failed" && hasEffects(item.name)).length;
  const incomplete = !completeRunActivity(saved.turns, saved.identity.runId!, "running");
  return { ...saved, state: "interrupted", turns, recovery: { runId: saved.identity.runId!, unconfirmedTools: count, acknowledgementRequired: count > 0 || incomplete } };
}
