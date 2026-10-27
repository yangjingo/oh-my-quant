import { isWorkbenchSnapshot, type Preferences, type WorkbenchClient, type WorkbenchEvent } from "./contract";

const failure = "研究服务连接已中断，请重新连接核对当前会话。关闭页面不会停止服务中的研究。";
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function createHostClient(options: { baseUrl?: string; fetch?: typeof fetch; retryMs?: number } = {}): WorkbenchClient {
  const baseUrl = options.baseUrl ?? location.origin, request = options.fetch ?? globalThis.fetch;
  let bootstrap: Promise<string> | undefined, observer: AbortController | undefined;
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const emit = (event: WorkbenchEvent) => { for (const listener of listeners) { try { listener(structuredClone(event)); } catch { /* A detached observer cannot affect shared work. */ } } };
  const token = () => bootstrap ??= (async () => {
    try {
      const response = await request(new URL("/api/workbench/bootstrap", baseUrl), { cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error(failure);
      const value: unknown = await response.json();
      if (!object(value) || value.version !== 1 || typeof value.token !== "string" || !/^[a-f0-9]{64}$/.test(value.token)) throw new Error("研究服务启动信息无效，请检查服务版本。");
      return value.token;
    } catch (error) { bootstrap = undefined; throw error; }
  })();
  const rpc = async <T>(method: string, args: unknown[] = []): Promise<T> => {
    let response: Response;
    try { response = await request(new URL("/api/workbench/rpc", baseUrl), { method: "POST", credentials: "omit", cache: "no-store",
      headers: { "Content-Type": "application/json", "x-workbench-token": await token() }, body: JSON.stringify({ method, args }) }); }
    catch { throw new Error("请求结果未确认，请重新连接核对会话后再操作；界面不会自动重复提交。"); }
    if (response.status === 401) bootstrap = undefined;
    let value: unknown;
    try { value = await response.json(); } catch { throw new Error("研究服务返回了无效响应。"); }
    if (!response.ok || !object(value) || value.ok !== true || !Object.hasOwn(value, "result")) {
      const message = object(value) && object(value.error) && typeof value.error.message === "string" ? value.error.message.slice(0, 500) : failure;
      throw new Error(message);
    }
    return value.result as T;
  };
  const pause = (signal: AbortSignal) => new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, options.retryMs ?? 1500); signal.addEventListener("abort", done, { once: true });
    if (signal.aborted) done();
  });
  const observe = async (signal: AbortSignal) => {
    let connected = false;
    while (!signal.aborted) {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const response = await request(new URL("/api/workbench/events", baseUrl), { credentials: "omit", cache: "no-store", signal, headers: { "x-workbench-token": await token() } });
        if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) throw new Error(failure);
        reader = response.body.getReader();
        const decoder = new TextDecoder(); let buffer = "";
        while (!signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error(failure);
          buffer += decoder.decode(chunk.value, { stream: true });
          if (buffer.length > 8 * 1024 * 1024) throw new Error("研究会话快照过大，请重新连接。");
          const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
            if (!data) continue;
            const event: unknown = JSON.parse(data);
            if (object(event) && event.type === "ready" && typeof event.workspaceId === "string" && event.workspaceId.length > 0) {
              if (!connected) { connected = true; emit({ type: "connection", connected: true }); }
              continue;
            }
            if (object(event) && event.type === "session-error" && object(event.identity) && typeof event.identity.workspaceId === "string"
              && typeof event.identity.sessionId === "string" && (event.identity.runId === null || typeof event.identity.runId === "string")
              && typeof event.message === "string" && event.message.length <= 500) {
              emit({ type: "session-error", identity: { workspaceId: event.identity.workspaceId, sessionId: event.identity.sessionId, runId: event.identity.runId }, message: event.message });
              continue;
            }
            if (!object(event) || event.type !== "snapshot" || !isWorkbenchSnapshot(event.snapshot) || !object(event.identity)
              || event.identity.workspaceId !== event.snapshot.identity.workspaceId || event.identity.sessionId !== event.snapshot.identity.sessionId || event.identity.runId !== event.snapshot.identity.runId) throw new Error("研究服务事件无效，请重新连接。");
            if (!connected) { connected = true; emit({ type: "connection", connected: true }); }
            emit({ type: "snapshot", identity: event.snapshot.identity, snapshot: event.snapshot });
          }
        }
      } catch {
        if (signal.aborted) break;
        bootstrap = undefined;
        if (connected) { connected = false; emit({ type: "connection", connected: false, error: failure }); }
        else emit({ type: "connection", connected: false, error: failure });
      } finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
      if (!signal.aborted) await pause(signal);
    }
  };
  return {
    mode: "host",
    identity: () => rpc("identity"), workspaces: () => rpc("workspaces"), preferences: () => rpc("preferences"), market: () => rpc("market"),
    session: async id => { const value: unknown = await rpc("session", [id]); if (!isWorkbenchSnapshot(value)) throw new Error("研究服务会话无效。"); return value; },
    transcript: id => rpc("transcript", [id]), output: id => rpc("output", [id]), createSession: () => rpc("createSession"),
    renameSession: value => rpc("renameSession", [value]), references: (id, query) => rpc("references", [id, query]),
    updatePreferences: (next: Preferences) => rpc("updatePreferences", [{ revision: next.revision, model: next.model, source: next.source, portfolio: next.portfolio, ...(next.thinkingLevel === undefined ? {} : { thinkingLevel: next.thinkingLevel }) }]),
    submit: value => rpc("submit", [value]), cancel: id => rpc("cancel", [id]),
    continue: value => rpc("continue", [value]), followup: value => rpc("followup", [value]),
    save: value => rpc("save", [value]), reload: value => rpc("reload", [value]),
    review: value => rpc("review", [value]),
    deleteSession: value => rpc("deleteSession", [value]),
    acknowledgeInterruption: id => rpc("acknowledgeInterruption", [id]),
    subscribe(listener) {
      listeners.add(listener);
      if (!observer) { observer = new AbortController(); void observe(observer.signal); }
      return () => { listeners.delete(listener); if (!listeners.size) { observer?.abort(); observer = undefined; } };
    },
  };
}
