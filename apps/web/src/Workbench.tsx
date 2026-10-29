import { lazy, Suspense, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { WorkbenchClient } from "./client/contract";
import { createWorkbenchStore } from "./state/workbench-store";
import { Composer } from "./components/Composer";
import { Header, Sessions, Footer } from "./components/Chrome";
import { Transcript, Overview } from "./components/Research";
import type { DialogPage } from "./components/Settings";
import type { ResearchPage } from "./components/ResearchDialog";
import { runLabels } from "./presentation";

const Settings = lazy(() => import("./components/Settings").then(module => ({ default: module.Settings })));
const ResearchDialog = lazy(() => import("./components/ResearchDialog").then(module => ({ default: module.ResearchDialog })));

/** Browser and Electron mount the same presentation with an entry-supplied client. */
export function Workbench({ client }: { client: WorkbenchClient }) {
  const store = useMemo(() => createWorkbenchStore(client), [client]);
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => store.connect(), [store]);
  const [sidebar, setSidebar] = useState(false);
  const [overview, setOverview] = useState(() => window.innerWidth > 760);
  const [dialog, setDialog] = useState<DialogPage | null>(null);
  const [research, setResearch] = useState<ResearchPage | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [positions] = useState(() => new Map<string, number>());
  const [fontSize, setFontSize] = useState(15);
  const session = view.sessions.find(s => s.sessionId === view.selected);
  const snapshot = view.snapshot;
  const running = snapshot?.state === "running";
  const selected = view.selected ?? "";
  const openSettings = (page: DialogPage) => { setResearch(null); setDialog(page); };
  const openResearch = (page: ResearchPage) => { setDialog(null); setResearch(page); };
  const focusInput = () => requestAnimationFrame(() => document.getElementById("input")?.focus());
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 760px)");
    const resize = () => { if (narrow.matches) { setOverview(false); setSidebar(false); } };
    narrow.addEventListener("change", resize);
    return () => narrow.removeEventListener("change", resize);
  }, []);
  useEffect(() => {
    const stop = (event: KeyboardEvent) => {
      if (running && event.ctrlKey && !event.altKey && !event.metaKey && !event.repeat && !event.isComposing && event.key.toLowerCase() === "g") {
        event.preventDefault(); void store.cancel();
      }
    };
    window.addEventListener("keydown", stop);
    return () => window.removeEventListener("keydown", stop);
  }, [running, store]);
  const command = (name: string) => {
    if (name === "clear") { void store.create().then(focusInput); return true; }
    if (name === "resume") { if (window.innerWidth <= 760) setOverview(false); setSidebar(true); return true; }
    if (name === "evidence" || name === "artifact") { openResearch(name === "evidence" ? "evidence" : "report"); return true; }
    const pages: Record<string, DialogPage> = { config: "reading", help: "help", portfolio: "portfolio" };
    if (pages[name]) { openSettings(pages[name]!); return true; }
    return false;
  };
  return <div id="app" className={"app " + (sidebar ? "sidebar-open " : "") + (overview ? "" : "no-panel")} style={{ "--answer-font-size": fontSize + "px" } as React.CSSProperties}>
    <Header title={session?.name ?? "研究工作台"} code={session?.code ?? ""} running={!!running} mode={client.mode}
      sidebar={sidebar} onSidebar={() => { if (window.innerWidth <= 760) setOverview(false); setSidebar(!sidebar); }} onNew={() => void store.create().then(focusInput)}
      onSettings={() => openSettings("reading")} onOverview={() => { setSidebar(false); setOverview(!overview); }} />
    <div className="workspace">
      {sidebar && <Sessions sessions={view.sessions} active={selected} onSelect={id => void store.select(id).then(() => { if (window.innerWidth <= 760) setSidebar(false); focusInput(); })} onNew={() => void store.create().then(() => { if (window.innerWidth <= 760) setSidebar(false); focusInput(); })} onClose={() => setSidebar(false)} />}
      <main className="session-panel">
        <div className="section-label"><button id="sessionTitle" title="会话设置" onClick={() => openSettings("session")}><span className="dot">◉</span>{session?.name ?? "研究会话"}</button><div className="session-actions">{snapshot && <button className="text-action" onClick={() => openResearch("conclusion")}>研究成果</button>}<small className="run-badge" data-state={snapshot?.state} role="status">{snapshot ? runLabels[snapshot.state] : "未连接"}</small></div></div>
        {view.error && <div role="alert" className="connection-error">{view.error} <button onClick={() => void store.load()}>重新连接</button><button aria-label="关闭提示" onClick={store.clearError}>×</button></div>}
        {view.phase === "loading" && <p role="status" className="empty-state">正在读取会话…</p>}
        {snapshot && <Transcript key={selected} snapshot={snapshot} positions={positions} mode={client.mode} onEvidence={() => openResearch("evidence")} onReport={() => openResearch("report")} onSuggestion={text => { setDrafts(current => ({ ...current, [selected]: text })); focusInput(); }} />}
        {!snapshot && view.phase !== "loading" && <div className="empty-state research-welcome"><span className="eyebrow">先连接，再开始</span><h2>连接工作区后开始研究</h2><p>当前界面还没有接入研究服务，暂时不能运行模型、获取行情或打开历史研究。</p><div className="welcome-actions"><button className="action" onClick={() => openSettings("about")}>了解当前连接方式</button><button className="text-action" onClick={() => void store.load()}>重试连接</button></div><p className="supporting">界面不会用演示记录替代缺失的 Host 数据。</p></div>}
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
    <Footer preferences={view.preferences} mode={client.mode} onOpen={openSettings} />
    <Suspense fallback={<div className="overlay-loading" role="status">正在打开面板…</div>}>
    {dialog && <Settings page={dialog} setPage={setDialog} onClose={() => setDialog(null)} preferences={view.preferences}
      onPreferences={p => store.preferences(p)} snapshot={snapshot} title={session?.name ?? ""} onRename={title => store.rename(title)}
      fontSize={fontSize} onFontSize={setFontSize} onStop={() => void store.cancel()} mode={client.mode} />}
    {research && snapshot && <ResearchDialog page={research} setPage={setResearch} snapshot={snapshot} title={session?.name ?? "当前研究"} demo={client.mode === "demo"} onClose={() => setResearch(null)} />}
    </Suspense>
  </div>;
}
