import type { MarketSnapshot, Preferences, ReferenceCandidate, SessionSnapshot, WorkbenchClient, WorkbenchEvent, WorkspaceOutput, WorkspaceSummary } from "../src/client/contract";

const EMPTY_OUTPUT: WorkspaceOutput = {
  conclusion: { statement: null, confidence: null, boundary: null, settled: false },
  evidence: [], artifacts: [],
};
const SAMPLE_OUTPUT: WorkspaceOutput = {
  conclusion: {
    statement: "示例结论：回撤已经出现，相对强弱尚未同步走坏。",
    confidence: "medium", boundary: "若相对强弱持续下行且出现放量破位，应重新取证。", settled: true,
  },
  evidence: [
    { id: "ev-bars", label: "日线行情（示例）", source: "合成示例", asOf: "2026-10-24", available: true },
    { id: "ev-relative", label: "相对强弱（示例）", source: "合成示例", asOf: "2026-10-24", available: true },
    { id: "ev-news", label: "公告核验（示例缺失）", source: null, asOf: null, available: false },
  ],
  artifacts: [1, 2].map(version => ({
    id: "demo-report-" + version, title: "回撤结构研究（示例）", version,
    sha256: String(version).padStart(64, "0"), createdAt: "2026-10-24T14:32:00+08:00",
  })),
};
const quotes = [
  { code: "300308.SZ", name: "中际旭创", value: null, change: 1.84 },
  { code: "300502.SZ", name: "新易盛", value: null, change: .92 },
  { code: "002281.SZ", name: "光迅科技", value: null, change: -.34 },
  { code: "000063.SZ", name: "中兴通讯", value: null, change: .65 },
  { code: "000001.SH", name: "上证指数", value: null, change: .12 },
  { code: "399001.SZ", name: "深证成指", value: null, change: -.14 },
  { code: "000300.SH", name: "沪深300", value: null, change: -.54 },
  { code: "000905.SH", name: "中证500", value: null, change: .60 },
  { code: "399006.SZ", name: "创业板指", value: null, change: -.26 },
];
const sampleMarket: MarketSnapshot = {
  refreshedAt: "2026-10-24 14:32", quotes: quotes.map((quote, index) => ({ ...quote, group: index < 4 ? "watchlist" : "market" })),
  source: { provider: "本地合成 · 示例", updatedAt: "2026-10-24", available: quotes.length, total: quotes.length },
};
const emptyMarket: MarketSnapshot = {
  refreshedAt: "", quotes: [], source: { provider: null, updatedAt: null, available: 0, total: 0 },
};

/** Explicit development adapter. No component imports it; production never loads it. */
export function createDemoClient(options: { settleAfterMs?: number; storage?: Pick<Storage, "getItem" | "setItem"> } = {}): WorkbenchClient {
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const sessions = new Map<string, SessionSnapshot>();
  const summaries = new Map<string, WorkspaceSummary>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let serial = 0;
  let prefs: Preferences = { model: "", source: "demo", portfolio: "光通信观察组" };
  try {
    const saved = JSON.parse(options.storage?.getItem("quant-web.demo-preferences") || "{}");
    prefs = {
      model: typeof saved.model === "string" ? saved.model.slice(0, 80) : "",
      source: ["none", "demo", "akshare"].includes(saved.source) ? saved.source : "demo",
      portfolio: saved.portfolio === "宽基指数观察组" ? saved.portfolio : "光通信观察组",
    };
  } catch { /* Corrupt or blocked optional browser preferences are not application state. */ }
  const seed = (id: string, code: string, name: string, sample = false) => {
    summaries.set(id, { workspaceId: "demo-workspace", sessionId: id, code, name, runCount: sample ? 1 : 0, state: sample ? "settled" : "idle" });
    sessions.set(id, {
      identity: { workspaceId: "demo-workspace", sessionId: id, runId: null },
      state: sample ? "settled" : "idle",
      turns: sample ? [
        { id: "sample-user", role: "user", text: "中际旭创最近的回撤，是市场波动，还是自身结构变弱？", state: "settled", at: "14:32 · 示例" },
        { id: "sample-answer", role: "assistant", text: "在这组演示数据中，标的从阶段高点回落 7.2%，但区间表现仍高于沪深300。当前更适合把它视为上涨后的回撤观察；仅凭价格变化，还不足以判断基本面是否转弱。\n\n相对基准仍有超额表现，回撤阶段没有持续放量。需要继续观察这一关系是否保持。", state: "settled", at: "14:32 · 示例" },
      ] : [],
      market: sample ? sampleMarket : emptyMarket, output: sample ? SAMPLE_OUTPUT : EMPTY_OUTPUT,
    });
  };
  seed("sample", "300308.SZ", "回撤结构研究", true);
  seed("empty", "002048.SZ", "结构跟踪");
  const requireSession = (id: string) => {
    const session = sessions.get(id);
    if (!session) throw new Error("会话不存在");
    return session;
  };
  const emit = (event: WorkbenchEvent) => listeners.forEach(listener => listener(structuredClone(event)));
  const publish = (id: string, snapshot: SessionSnapshot) => {
    sessions.set(id, snapshot);
    const summary = summaries.get(id)!;
    summaries.set(id, { ...summary, state: snapshot.state });
  };
  const read = (id: string): SessionSnapshot => {
    const snapshot = requireSession(id);
    const market = prefs.source !== "demo" ? emptyMarket : snapshot.market;
    return structuredClone({ ...snapshot, market: prefs.portfolio === "宽基指数观察组" ? { ...market, quotes: market.quotes.filter(q => q.code.endsWith(".SH")) } : market });
  };
  return {
    mode: "demo",
    async identity() { return structuredClone(requireSession("sample").identity); },
    async workspaces() { return structuredClone([...summaries.values()]); },
    async session(id) { return read(id); },
    async transcript(id) { return read(id).turns; },
    async market() { return read("sample").market; },
    async output(id) { return read(sessions.has(id) ? id : "sample").output; },
    async createSession() { const id = "new-" + ++serial; seed(id, "", "新研究"); return summaries.get(id)!; },
    async renameSession(id, title) {
      requireSession(id);
      if (!title.trim()) throw new Error("请输入会话名称");
      summaries.set(id, { ...summaries.get(id)!, name: title.trim().slice(0, 100) });
    },
    async preferences() { return { ...prefs, availablePortfolios: ["光通信观察组", "宽基指数观察组"] }; },
    async updatePreferences(next) {
      if (!["none", "demo", "akshare"].includes(next.source)) throw new Error("未知数据源");
      prefs = { ...next, model: next.model.trim().slice(0, 80) };
      try { options.storage?.setItem("quant-web.demo-preferences", JSON.stringify(prefs)); } catch { /* Optional persistence. */ }
    },
    async references(id, query) {
      const session = read(id);
      const refs: ReferenceCandidate[] = [
        { id: "reports", label: "reports/", token: "@reports/", kind: "directory", description: "示例目录" },
        { id: "readme", label: "README.md", token: "@file:README.md", kind: "file", description: "示例工作区文件" },
        { id: "report", label: "reports/研究笔记.md", token: '@"file:reports/研究笔记.md"', kind: "file", description: "示例文件，不读取本机" },
        ...[...summaries.values()].map(s => ({ id: s.sessionId, label: s.name, token: "@session:" + s.sessionId, kind: "session" as const, description: "示例会话" })),
        ...session.output.evidence.map(e => ({ id: e.id, label: e.label, token: "@evidence:" + id + "/" + e.id, kind: "evidence" as const, description: e.available ? "已记录的示例证据" : "示例证据缺失" })),
      ];
      return refs.filter(r => (r.label + " " + r.token).toLowerCase().includes(query.toLowerCase()));
    },
    async submit(request) {
      const current = requireSession(request.sessionId);
      if (request.workspaceId !== current.identity.workspaceId) throw new Error("工作区不匹配");
      if (current.state === "running") throw new Error("该会话仍在运行");
      if (!request.text.trim()) throw new Error("请输入问题");
      const runId = "demo-run-" + ++serial;
      const identity = { ...current.identity, runId };
      const user = { id: runId + "-user", role: "user" as const, text: request.text, state: "settled" as const, at: "示例" };
      const assistant = { id: runId + "-assistant", role: "assistant" as const, text: "", state: "running" as const, at: "示例" };
      publish(request.sessionId, { ...current, identity, state: "running", turns: [...current.turns, user, assistant] });
      emit({ type: "state", identity, state: "running" });
      emit({ type: "turn", identity, turn: user });
      emit({ type: "turn", identity, turn: assistant });
      timers.set(runId, setTimeout(() => {
        timers.delete(runId);
        const latest = requireSession(request.sessionId);
        if (latest.identity.runId !== runId || latest.state !== "running") return;
        const answer = { ...assistant, state: "settled" as const, text: "演示运行已结束。这是独立的开发适配器，没有调用模型、读取本地文件或核验新证据。真实研究由 Host 执行。" };
        publish(request.sessionId, { ...latest, state: "settled", turns: latest.turns.map(t => t.id === answer.id ? answer : t) });
        emit({ type: "turn", identity, turn: answer });
        emit({ type: "state", identity, state: "settled" });
      }, options.settleAfterMs ?? 1800));
      return { sessionId: request.sessionId, runId };
    },
    async cancel(runId) {
      const entry = [...sessions].find(([, s]) => s.identity.runId === runId);
      if (!entry) throw new Error("运行不存在");
      const [id, current] = entry;
      if (current.state !== "running") return;
      clearTimeout(timers.get(runId)); timers.delete(runId);
      const turns = current.turns.map(t => t.state === "running" ? { ...t, state: "cancelled" as const, text: "已停止示例运行。" } : t);
      publish(id, { ...current, state: "cancelled", turns });
      turns.filter(t => t.state === "cancelled").forEach(turn => emit({ type: "turn", identity: current.identity, turn }));
      emit({ type: "state", identity: current.identity, state: "cancelled" });
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
