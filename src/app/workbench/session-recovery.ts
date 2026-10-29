import type { SessionSnapshot } from "../../types/workbench.ts";

/** Reading an abandoned run never retries it or invents a tool outcome. */
export function recoverSnapshot(saved: SessionSnapshot): SessionSnapshot {
  if (saved.state !== "running") return saved;
  const turns = saved.turns.map(turn => turn.state !== "running" ? turn : {
    ...turn, state: "interrupted" as const,
    activity: turn.activity?.map(item => item.state === "preparing" ? { ...item, state: "not-run" as const }
      : item.state === "running" ? { ...item, state: "unconfirmed" as const, elapsedMs: undefined } : item),
  });
  const count = turns.filter(turn => turn.id === saved.identity.runId + "-assistant")
    .flatMap(turn => turn.activity ?? []).filter(item => item.state === "unconfirmed").length;
  return { ...saved, state: "interrupted", turns, recovery: { runId: saved.identity.runId!, unconfirmedTools: count, acknowledgementRequired: count > 0 } };
}
