/**
 * Deterministic stand-in for the Host.
 *
 * The fixture is intentionally boring: it produces the same transcript, the
 * same missing market data and the same timing on every load, so interface
 * states can be screenshotted and diffed. It is replaced by the real client
 * when #46/#75 land; until then it keeps the UI honest about what it does and
 * does not know.
 *
 * Two workspaces exist on purpose. One is empty, which is the truthful state
 * when no data source is configured. The other carries sample output so the
 * conclusion, evidence and artifact panels can be reviewed; every value in it
 * is labelled 示例 and none of it is presented as market data.
 */
import type {
  Conclusion,
  MarketSnapshot,
  Release,
  SubmitRequest,
  SubmitResult,
  Turn,
  WorkbenchClient,
  WorkbenchEvent,
  WorkspaceIdentity,
  WorkspaceOutput,
  WorkspaceSummary,
} from "./contract.ts";

const EMPTY_WORKSPACE = "ws-demo-002048";
const SAMPLE_WORKSPACE = "ws-sample-300308";
const SESSION_ID = "session-demo-1";

/** Missing data is represented as null, never as a plausible zero. */
const EMPTY_MARKET: MarketSnapshot = {
  refreshedAt: "2026-10-22T15:27:00+08:00",
  quotes: [
    { code: "000001.SH", name: "上证指数", value: null, change: null },
    { code: "399001.SZ", name: "深证成指", value: null, change: null },
    { code: "000300.SH", name: "沪深300", value: null, change: null },
    { code: "000905.SH", name: "中证500", value: null, change: null },
    { code: "399006.SZ", name: "创业板指", value: null, change: null },
  ],
  source: { provider: null, updatedAt: null, available: 0, total: 5 },
};

const WORKSPACES: readonly WorkspaceSummary[] = [
  {
    workspaceId: EMPTY_WORKSPACE,
    code: "002048.SZ",
    name: "结构跟踪",
    runCount: 0,
    state: "idle",
  },
  {
    workspaceId: SAMPLE_WORKSPACE,
    code: "300308.SZ",
    name: "回撤结构（示例）",
    runCount: 2,
    state: "settled",
  },
];

const EMPTY_OUTPUT: WorkspaceOutput = {
  conclusion: { statement: null, confidence: null, boundary: null, settled: false },
  evidence: [
    { id: "ev-bars", label: "日线行情", source: null, asOf: null, available: false },
    { id: "ev-finance", label: "财务快照", source: null, asOf: null, available: false },
    { id: "ev-news", label: "公告与新闻", source: null, asOf: null, available: false },
  ],
  artifacts: [],
};

/** Everything below is sample text: sources say 示例, no number claims a source. */
const SAMPLE_CONCLUSION: Conclusion = {
  statement:
    "示例结论：本轮回撤未破坏中期结构，但量能没有跟上，属于「结构未破、动能不足」，不足以支持加仓判断。",
  confidence: "medium",
  boundary: "若收盘价跌破前一轮低点且成交量同步放大，当前判断失效，需要重新取证。",
  settled: true,
};

const SAMPLE_OUTPUT: WorkspaceOutput = {
  conclusion: SAMPLE_CONCLUSION,
  evidence: [
    { id: "ev-bars", label: "日线行情（示例）", source: "示例", asOf: "2026-10-21", available: true },
    { id: "ev-finance", label: "财务快照（示例）", source: "示例", asOf: "2026-09-30", available: true },
    { id: "ev-news", label: "公告与新闻（示例）", source: "示例", asOf: "2026-10-20", available: false },
  ],
  artifacts: [
    {
      id: "art-1",
      title: "300308.SZ 回撤结构（示例）",
      version: 1,
      sha256: "0000000000000000000000000000000000000000000000000000000000000001",
      createdAt: "2026-10-21T14:02:00+08:00",
    },
    {
      id: "art-2",
      title: "300308.SZ 回撤结构（示例）",
      version: 2,
      sha256: "0000000000000000000000000000000000000000000000000000000000000002",
      createdAt: "2026-10-22T09:41:00+08:00",
    },
  ],
};

export interface FixtureOptions {
  /** Settlement delay in ms. Tests pass 0; the demo uses the default. */
  readonly settleAfterMs?: number;
}

export function createFixtureClient(options: FixtureOptions = {}): WorkbenchClient {
  const settleAfterMs = options.settleAfterMs ?? 900;

  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const transcript: Turn[] = [];
  const outputs = new Map<string, WorkspaceOutput>([
    [EMPTY_WORKSPACE, EMPTY_OUTPUT],
    [SAMPLE_WORKSPACE, SAMPLE_OUTPUT],
  ]);
  let identity: WorkspaceIdentity = {
    workspaceId: EMPTY_WORKSPACE,
    sessionId: SESSION_ID,
    runId: null,
  };
  let counter = 0;

  const emit = (event: WorkbenchEvent) => {
    for (const listener of listeners) listener(event);
  };

  const push = (turn: Turn) => {
    const index = transcript.findIndex(candidate => candidate.id === turn.id);
    if (index === -1) transcript.push(turn);
    else transcript[index] = turn;
    emit({ type: "turn", turn });
  };

  const settle = (runId: string, assistantId: string, text: string) => {
    push({ id: assistantId, role: "assistant", text, state: "settled", at: new Date().toISOString() });
    identity = { ...identity, runId: null };
    emit({ type: "state", identity, state: "settled" });
    void runId;
  };

  return {
    async identity() {
      return identity;
    },

    async workspaces() {
      return WORKSPACES;
    },

    async transcript() {
      return [...transcript];
    },

    async market() {
      return EMPTY_MARKET;
    },

    async output(workspaceId: string) {
      return outputs.get(workspaceId) ?? EMPTY_OUTPUT;
    },

    async submit(request: SubmitRequest): Promise<SubmitResult> {
      counter += 1;
      const runId = `run-fixture-${counter}`;
      const userId = `turn-u-${counter}`;
      const assistantId = `turn-a-${counter}`;

      push({ id: userId, role: "user", text: request.text, state: "settled", at: new Date().toISOString() });
      push({ id: assistantId, role: "assistant", text: "", state: "running", at: new Date().toISOString() });

      identity = { workspaceId: request.workspaceId, sessionId: SESSION_ID, runId };
      emit({ type: "state", identity, state: "running" });

      // No model is called: the fixture explains why, rather than inventing an answer.
      setTimeout(() => {
        settle(
          runId,
          assistantId,
          "契约演示：这里本该由 Host 返回研究结论。当前没有连接 Host，所以只完成了提交、运行与结算这条链路。",
        );
      }, settleAfterMs);

      return { sessionId: SESSION_ID, runId };
    },

    async cancel(runId: string) {
      identity = { ...identity, runId: null };
      emit({ type: "state", identity, state: "cancelled" });
      void runId;
    },

    subscribe(listener) {
      listeners.add(listener);
      const release: Release = () => {
        // Detach only. Cancelling is `cancel`, never a side effect of release.
        listeners.delete(listener);
      };
      return release;
    },
  };
}
