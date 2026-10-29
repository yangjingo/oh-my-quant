import { writeFileSync } from "node:fs";
import { QuantTui } from "../src/tui.ts";
import type { AppState } from "../../../src/types/ui.ts";
import type { SessionSnapshot } from "../../../src/types/workbench.ts";

// This is a synthetic view fixture; it does not connect to a Host or execute tools.
const state: AppState = { model: "fixture", modelLabel: "fixture", version: "test", user: "fixture", activity: "ready", cost: 0, cacheHit: 0,
  messages: [{ role: "user", text: "隔离示例：检查上一次工具调用" }], panel: [], panelLoading: false, input: "", composerQueue: [],
  composerStatus: null, activePortfolio: "", source: "fixture", showPortfolioPanel: false };
const snapshot: SessionSnapshot = { identity: { workspaceId: "fixture-workspace", sessionId: "fixture-session", runId: "fixture-run" },
  revision: 4, state: "interrupted", recovery: { runId: "fixture-run", unconfirmedTools: 1, acknowledgementRequired: true },
  turns: [{ id: "fixture-run-assistant", role: "assistant", state: "interrupted", text: "", at: "2026-10-29T00:00:00Z",
    activity: [{ id: "fixture-tool", name: "fixture_tool", state: "unconfirmed" }] }],
  market: { refreshedAt: "", quotes: [], source: { provider: null, updatedAt: null, available: 0, total: 0 } },
  output: { conclusion: { statement: null, confidence: null, boundary: null, settled: false }, evidence: [], artifacts: [] } };
const tui = new QuantTui(state);
tui.onSubmit(text => {
  if (text === "EXIT_FIXTURE") { tui.stop(); process.exit(0); }
  writeFileSync(process.env.WHYJ_TUI_SUBMIT!, text);
});
tui.onRecoveryConfirm(async target => {
  writeFileSync(process.env.WHYJ_TUI_ACK!, JSON.stringify(target));
  tui.setRecoverySnapshot({ ...snapshot, revision: 5, recovery: { ...snapshot.recovery!, acknowledgementRequired: false } });
  return true;
});
tui.setRecoverySnapshot(snapshot); tui.start();
