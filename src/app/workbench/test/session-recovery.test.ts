import { expect, test } from "bun:test";
import { recoverSnapshot } from "../session-recovery.ts";
import type { SessionSnapshot } from "../../../types/workbench.ts";

test("recovery preserves known results, does not invent timestamps, and gates only the interrupted run", () => {
  const snapshot: SessionSnapshot = { identity: { workspaceId: "w", sessionId: "s", runId: "new" }, revision: 8, state: "running",
    turns: [{ id: "old-assistant", role: "assistant", text: "old", at: "2026-10-25", state: "interrupted", activity: [{ id: "old-tool", name: "old", state: "unconfirmed" }] },
      { id: "new-assistant", role: "assistant", text: "partial", thinking: "已保存的思考片段", at: "2026-10-26", state: "running", activity: [{ id: "p", name: "prepare", state: "preparing" }, { id: "c", name: "done", state: "completed", elapsedMs: 50 }] }],
    market: { refreshedAt: "", quotes: [], source: { provider: null, updatedAt: null, available: 0, total: 0 } },
    output: { conclusion: { statement: null, confidence: null, boundary: null, settled: false }, evidence: [], artifacts: [] } };
  const recovered = recoverSnapshot(snapshot);
  expect(recovered.recovery).toMatchObject({ runId: "new", unconfirmedTools: 0, acknowledgementRequired: false });
  expect(recovered.turns[1]).toMatchObject({ text: "partial", thinking: "已保存的思考片段", state: "interrupted", activity: [{ id: "p", name: "prepare", state: "not-run" }, { id: "c", name: "done", state: "completed", elapsedMs: 50 }] });
  expect(recovered.turns[1]?.endedAt).toBeUndefined();
  expect(snapshot.state).toBe("running");
});
