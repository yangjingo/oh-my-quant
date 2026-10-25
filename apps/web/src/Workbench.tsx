import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { WorkbenchClient } from "./client/contract";
import { createWorkbenchStore } from "./state/workbench-store";
import { Composer } from "./components/Composer";
import { Header, Sessions, Footer } from "./components/Chrome";
import { Transcript, Overview } from "./components/Research";
import { Settings, type DialogPage } from "./components/Settings";

/** Browser and Electron mount the same presentation with an entry-supplied client. */
export function Workbench({ client }: { client: WorkbenchClient }) {
  const store = useMemo(() => createWorkbenchStore(client), [client]);
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => store.connect(), [store]);
  const [sidebar, setSidebar] = useState(false);
  const [overview, setOverview] = useState(() => window.innerWidth > 760);
  const [dialog, setDialog] = useState<DialogPage | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [positions] = useState(() => new Map<string, number>());
  const [fontSize, setFontSize] = useState(13);
  const session = view.sessions.find(s => s.sessionId === view.selected);
  const snapshot = view.snapshot;
  const running = snapshot?.state === "running";
  const selected = view.selected ?? "";
  const command = (name: string) => {
    if (name === "clear") { void store.create(); return true; }
    if (name === "resume") { setSidebar(true); return true; }
    const pages: Record<string, DialogPage> = { config: "reading", evidence: "evidence", artifact: "report", help: "help", portfolio: "portfolio" };
    if (pages[name]) { setDialog(pages[name]!); return true; }
    return false;
  };
  return <div id="app" className={"app " + (sidebar ? "sidebar-open " : "") + (overview ? "" : "no-panel")} style={{ "--answer-font-size": fontSize + "px" } as React.CSSProperties}>
    <Header title={session?.name ?? "研究工作台"} code={session?.code ?? ""} running={!!running} mode={client.mode}
      sidebar={sidebar} onSidebar={() => setSidebar(!sidebar)} onNew={() => void store.create()}
      onSettings={() => setDialog("reading")} onOverview={() => setOverview(!overview)} />
    <div className="workspace">
      {sidebar && <Sessions sessions={view.sessions} active={selected} onSelect={id => void store.select(id)} onNew={() => void store.create()} onClose={() => setSidebar(false)} />}
      <main className="session-panel">
        <div className="section-label"><button id="sessionTitle" onClick={() => setDialog("session")}><span className="dot">◉</span>{session?.name ?? "研究会话"}</button><small role="status">{running ? "Thinking…" : snapshot?.state ?? "未连接"}</small></div>
        {view.error && <div role="alert" className="connection-error">{view.error} <button onClick={() => void store.load()}>重新连接</button><button aria-label="关闭提示" onClick={store.clearError}>×</button></div>}
        {view.phase === "loading" && <p role="status" className="empty-state">正在读取会话…</p>}
        {snapshot && <Transcript key={selected} snapshot={snapshot} positions={positions} onEvidence={() => setDialog("evidence")} onReport={() => setDialog("report")} />}
        {!snapshot && view.phase !== "loading" && <div className="empty-state"><h2>连接工作区后开始研究</h2><p>界面不会用演示记录替代缺失的 Host 数据。</p></div>}
      </main>
      {overview && <Overview snapshot={snapshot?.market ?? null} portfolio={view.preferences.portfolio} demo={client.mode === "demo"} onClose={() => setOverview(false)} />}
    </div>
    <Composer key={selected} client={client} sessionId={selected} text={drafts[selected] ?? ""}
      onText={text => setDrafts(current => ({ ...current, [selected]: text }))}
      disabled={!snapshot || view.phase !== "ready"} running={!!running} onCancel={() => void store.cancel()} onCommand={command}
      onSubmit={async text => {
        const accepted = await store.submit(text);
        if (accepted) setDrafts(current => current[selected] === text ? { ...current, [selected]: "" } : current);
        return accepted;
      }} />
    <Footer preferences={view.preferences} mode={client.mode} onOpen={setDialog} />
    {dialog && <Settings page={dialog} setPage={setDialog} onClose={() => setDialog(null)} preferences={view.preferences}
      onPreferences={p => store.preferences(p)} snapshot={snapshot} title={session?.name ?? ""} onRename={title => store.rename(title)}
      fontSize={fontSize} onFontSize={setFontSize} onStop={() => void store.cancel()} mode={client.mode} />}
  </div>;
}
