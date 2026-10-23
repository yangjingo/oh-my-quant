import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "./components/Composer.tsx";
import { FeedbackDialog, SettingsDialog, type DialogName } from "./components/Dialogs.tsx";
import { InsightPanel } from "./components/InsightPanel.tsx";
import { Rail } from "./components/Rail.tsx";
import { Thread } from "./components/Thread.tsx";
import type {
  MarketSnapshot,
  RunState,
  Turn,
  WorkbenchClient,
  WorkspaceIdentity,
  WorkspaceOutput,
  WorkspaceSummary,
} from "./contract.ts";

interface WorkbenchProps {
  readonly client: WorkbenchClient;
}

type Phase = "loading" | "ready" | "error";

const LOADING_MARKET: MarketSnapshot = {
  refreshedAt: new Date().toISOString(),
  quotes: [],
  source: { provider: null, updatedAt: null, available: 0, total: 0 },
};

const EMPTY_OUTPUT: WorkspaceOutput = {
  conclusion: { statement: null, confidence: null, boundary: null, settled: false },
  evidence: [],
  artifacts: [],
};

export function Workbench({ client }: WorkbenchProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [identity, setIdentity] = useState<WorkspaceIdentity | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceSummary[]>([]);
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [market, setMarket] = useState<MarketSnapshot>(LOADING_MARKET);
  const [output, setOutput] = useState<WorkspaceOutput>(EMPTY_OUTPUT);
  const [state, setState] = useState<RunState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogName>(null);

  // Latest load wins: a slow first attempt must not overwrite a retry.
  const attempt = useRef(0);

  const load = useCallback(async () => {
    const current = attempt.current + 1;
    attempt.current = current;
    setPhase("loading");
    setError(null);

    try {
      const [nextIdentity, nextWorkspaces, nextMarket] = await Promise.all([
        client.identity(),
        client.workspaces(),
        client.market(),
      ]);
      const [nextTurns, nextOutput] = await Promise.all([
        client.transcript(nextIdentity.sessionId),
        client.output(nextIdentity.workspaceId),
      ]);
      if (attempt.current !== current) return;
      setIdentity(nextIdentity);
      setActiveId(nextIdentity.workspaceId);
      setWorkspaces(nextWorkspaces);
      setMarket(nextMarket);
      setTurns(nextTurns);
      setOutput(nextOutput);
      setPhase("ready");
    } catch (cause) {
      if (attempt.current !== current) return;
      setError(cause instanceof Error ? cause.message : "无法读取工作区");
      setPhase("error");
    }
  }, [client]);

  useEffect(() => {
    void load();

    // Releasing the subscription detaches; it must not cancel shared work.
    const release = client.subscribe(event => {
      if (event.type === "turn") {
        setTurns(currentTurns => {
          const index = currentTurns.findIndex(turn => turn.id === event.turn.id);
          if (index === -1) return [...currentTurns, event.turn];
          const next = [...currentTurns];
          next[index] = event.turn;
          return next;
        });
      }
      if (event.type === "state") {
        setIdentity(event.identity);
        setState(event.state);
      }
      if (event.type === "market") setMarket(event.snapshot);
    });

    return release;
  }, [client, load]);

  // Reading another workspace replaces the panel; it never cancels the run.
  const select = useCallback(
    async (workspaceId: string) => {
      setActiveId(workspaceId);
      try {
        setOutput(await client.output(workspaceId));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "无法读取研究产出");
      }
    },
    [client],
  );

  const submit = useCallback(
    (text: string) => {
      if (!activeId) return;
      setError(null);
      setState("running");
      void client.submit({ workspaceId: activeId, text }).catch(cause => {
        setState("failed");
        setError(cause instanceof Error ? cause.message : "提交失败");
        setPhase("error");
      });
    },
    [activeId, client],
  );

  const cancel = useCallback(() => {
    const runId = identity?.runId;
    if (!runId) return;
    void client.cancel(runId).then(() => setState("cancelled"));
  }, [client, identity?.runId]);

  const activeCode = useMemo(() => workspaces.find(item => item.workspaceId === activeId)?.code ?? null, [activeId, workspaces]);

  const crumb = useMemo(() => {
    const workspace = workspaces.find(item => item.workspaceId === activeId);
    return workspace ? `${workspace.code} ${workspace.name}` : "新研究";
  }, [activeId, workspaces]);

  const running = state === "running";

  return (
    <div className="workbench">
      <Rail
        workspaces={workspaces}
        activeId={activeId}
        onSelect={workspaceId => void select(workspaceId)}
        onNew={() => undefined}
        onFeedback={() => setDialog("feedback")}
        onSettings={() => setDialog("settings")}
      />

      <main className="main">
        <header className="main__head">
          <span>WhyJ</span>
          <span>/</span>
          <span>{crumb}</span>
          <span>/</span>
          <span className="main__crumb--current">对话</span>
        </header>

        <div className="main__thread">
          {phase === "loading" ? <p className="empty__body">读取工作区…</p> : null}

          {phase === "error" ? (
            <div className="empty__example" role="alert">
              <p style={{ margin: 0 }}>连接中断：{error ?? "未知原因"}。</p>
              <button type="button" className="composer__send" onClick={() => void load()}>
                重新连接
              </button>
            </div>
          ) : null}

          {phase === "ready" ? <Thread turns={turns} code={activeCode} /> : null}
        </div>

        <Composer
          running={running}
          status={`fixture client · ${market.source.provider ?? "数据源未配置"} · ${workspaces.length} 个工作区`}
          onSubmit={submit}
          onCancel={cancel}
        />
      </main>

      <InsightPanel market={market} output={output} />

      {dialog === "settings" ? <SettingsDialog onClose={() => setDialog(null)} /> : null}
      {dialog === "feedback" ? <FeedbackDialog onClose={() => setDialog(null)} /> : null}
    </div>
  );
}


