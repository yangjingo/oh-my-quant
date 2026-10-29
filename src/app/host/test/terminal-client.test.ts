import { expect, test } from "bun:test";
import { createHostClient, type HostFetch } from "../client.ts";
import { createTerminalClient } from "../terminal-client.ts";
import type { HostConnection } from "../../bootstrap.ts";
import type { WorkbenchEvent } from "../../../types/workbench.ts";
import type { TerminalContext } from "../../../types/terminal.ts";
import { resolve } from "node:path";
import type { ResearchTaskSpec } from "../../../types/research-task.ts";

const connection: HostConnection = { url: "http://127.0.0.1:12345", workspaceId: "workspace", instanceId: "instance",
  token: "a".repeat(64), controlToken: "b".repeat(64), protocolVersion: 1, serviceContractVersion: 3,
  applicationVersion: "1.4.0", started: false };
const input = { workspaceId: connection.workspaceId, sessionId: "session", requestId: "once", expectedRevision: 0, text: "Request" };

test("private terminal context validates identity and renderer data without accepting a forged snapshot", async () => {
  const context: TerminalContext = { session: { identity: { workspaceId: "workspace", sessionId: "session", runId: null }, revision: 0, state: "idle", turns: [],
    market: { refreshedAt: "", quotes: [], source: { provider: null, updatedAt: null, available: 0, total: 0 } },
    output: { conclusion: { statement: null, confidence: null, boundary: null, settled: false }, evidence: [], artifacts: [] } },
    cwd: "workspace-directory", activeModel: null, latency: { ttftMs: null, tpotMs: null }, coreSessionId: null, messages: [{ role: "user", text: "Private terminal input" }], thinkingText: "", turnCount: 1, contextUsage: null, currentSession: null, composerQueue: [] };
  for (const result of [null, { ...context, cwd: "" }, { ...context, activeModel: { id: "", label: "model" } }, { ...context, latency: { ttftMs: -1, tpotMs: null } }, { ...context, coreSessionId: "" }, { ...context, thinkingText: {} }, { ...context, turnCount: -1 }, { ...context, turnCount: 1.5 }, { ...context, contextUsage: { tokens: -1 } },
    { ...context, composerQueue: [null] }, { ...context, composerQueue: undefined },
    { ...context, currentSession: {} }, { ...context, currentSession: { id: "other", createdAt: "now", usage: null, entryCount: { messages: 0, compactions: 0, branches: 0 } } },
    { ...context, session: { ...context.session, identity: { ...context.session.identity, sessionId: "other" } } },
    { ...context, messages: [{ role: "tool", tool: { name: "bash", status: "running" } }] },
    { ...context, messages: [{ role: "assistant", text: {} }] }]) {
    let calls = 0;
    const client = createTerminalClient(connection, { fetch: async () => { calls++; return Response.json({ ok: true, result }); } });
    await expect(client.context(input)).rejects.toThrow("invalid"); expect(calls).toBe(1);
  }
  const client = createTerminalClient(connection, { fetch: async (_url, init) => {
    expect(new Headers(init?.headers).get("x-host-control-token")).toBe(connection.controlToken);
    expect(JSON.parse(String(init?.body))).toEqual({ instanceId: connection.instanceId, method: "context", input: { workspaceId: "workspace", sessionId: "session" } });
    return Response.json({ ok: true, result: context });
  } });
  expect(await client.context(input)).toEqual(context);
});

test("terminal queue validates its original run and request receipt and never retries an unknown result", async () => {
  const queued = { workspaceId: "workspace", sessionId: "session", runId: "run", requestId: "queue-once", text: "Queued" };
  const valid = { workspaceId: "workspace", sessionId: "session", runId: "run", requestId: "queue-once", mode: "followUp" };
  for (const result of [null, { ...valid, runId: "other" }, { ...valid, requestId: "other" }, { ...valid, workspaceId: "other" },
    { ...valid, sessionId: "other" }, { ...valid, mode: "prompt" }]) {
    let calls = 0;
    const client = createTerminalClient(connection, { fetch: async () => { calls++; return Response.json({ ok: true, result }); } });
    await expect(client.enqueue(queued)).rejects.toThrow("invalid"); expect(calls).toBe(1);
  }
  let calls = 0;
  const client = createTerminalClient(connection, { fetch: async (_url, init) => {
    calls++; expect(new Headers(init?.headers).get("x-host-control-token")).toBe(connection.controlToken);
    expect(JSON.parse(String(init?.body))).toEqual({ instanceId: connection.instanceId, method: "enqueue", input: queued });
    throw new Error("Accepted but response lost");
  } });
  await expect(client.enqueue(queued)).rejects.toThrow("outcome is unknown"); expect(calls).toBe(1);
});

test("private reference suggestions validate identity and fill text without changing the public reference method", async () => {
  const input = { workspaceId: "workspace", sessionId: "session", input: "@evidence:" };
  const valid = { workspaceId: "workspace", sessionId: "session", runId: null, items: [{ kind: "evidence" as const, label: "Tool result", fill: "@evidence:core/entry " }] };
  for (const result of [{ ...valid, workspaceId: "other" }, { ...valid, sessionId: "other" }, { ...valid, runId: "" },
    { ...valid, items: [{ kind: "tool", label: "Invalid", fill: "wrong" }] }, { ...valid, items: [{ kind: "file", label: "Invalid", fill: {} }] }]) {
    const client = createTerminalClient(connection, { fetch: async () => Response.json({ ok: true, result }) });
    await expect(client.suggestReferences(input)).rejects.toThrow("invalid");
  }
  const seen: string[] = [];
  const client = createTerminalClient(connection, { fetch: async (url, init) => {
    seen.push(String(url));
    if (String(url).endsWith("/api/host/terminal")) {
      expect(JSON.parse(String(init?.body))).toEqual({ instanceId: connection.instanceId, method: "suggestReferences", input });
      expect(new Headers(init?.headers).get("x-host-control-token")).toBe(connection.controlToken);
      return Response.json({ ok: true, result: valid });
    }
    expect(new Headers(init?.headers).get("x-host-control-token")).toBeNull();
    return Response.json({ ok: true, result: [] });
  } });
  expect(await client.suggestReferences(input)).toEqual(valid);
  expect(await client.references("session", "query")).toEqual([]);
  expect(seen).toEqual([connection.url + "/api/host/terminal", connection.url + "/api/workbench/rpc"]);
});

test("terminal report receipts require the original identity, successful selection and an absolute local path", async () => {
  const request = { workspaceId: "workspace", sessionId: "session", requestId: "once", expectedRevision: 1, reportId: "saved@hash" };
  const valid = { workspaceId: "workspace", sessionId: "session", requestId: "once", revision: 1, selectedSessionId: "target",
    result: { success: true, message: "Restored", effects: [{ type: "sessionChanged" as const }] }, filePath: resolve("report.html") };
  for (const result of [{ ...valid, requestId: "other" }, { ...valid, selectedSessionId: "" }, { ...valid, filePath: "relative.html" },
    { ...valid, filePath: undefined }, { ...valid, result: { success: false, message: "Failure" } },
    { ...valid, result: { success: true, message: "Restored", effects: [{ type: "resetAgent" }] } }]) {
    const client = createTerminalClient(connection, { fetch: async () => Response.json({ ok: true, result }) });
    await expect(client.restoreReport(request)).rejects.toThrow("invalid");
  }
  let calls = 0;
  const client = createTerminalClient(connection, { fetch: async (_url, init) => {
    calls++; expect(new Headers(init?.headers).get("x-host-control-token")).toBe(connection.controlToken);
    expect(JSON.parse(String(init?.body))).toEqual({ instanceId: connection.instanceId, method: "restoreReport", input: request });
    return Response.json({ ok: true, result: valid });
  } });
  expect(await client.restoreReport(request)).toEqual(valid); expect(calls).toBe(1);
});

test("structured research uses the private capability and rejects a forged or empty run identity", async () => {
  const request = { workspaceId: "workspace", sessionId: "session", requestId: "task-once", expectedRevision: 0,
    expectedTaskRevision: null, task: { request: "fixture" } as ResearchTaskSpec };
  for (const result of [{ sessionId: "other", runId: "run" }, { sessionId: "session", runId: "" }, { sessionId: "session", runId: "x".repeat(161) }]) {
    const client = createTerminalClient(connection, { fetch: async () => Response.json({ ok: true, result }) });
    await expect(client.submitResearch(request)).rejects.toThrow();
  }
  let calls = 0;
  const client = createTerminalClient(connection, { fetch: async (_url, init) => {
    calls++; expect(new Headers(init?.headers).get("x-host-control-token")).toBe(connection.controlToken);
    expect(JSON.parse(String(init?.body))).toEqual({ instanceId: connection.instanceId, method: "submitResearch", input: request });
    throw new Error("Response lost after acceptance");
  } });
  await expect(client.submitResearch(request)).rejects.toThrow("outcome is unknown"); expect(calls).toBe(1);
});

test("terminal submission sends private capability only to its instance-bound endpoint and never retries", async () => {
  const paths: string[] = [];
  const client = createTerminalClient(connection, { fetch: (async (url, init) => {
    paths.push(String(url));
    expect(new Headers(init?.headers).get("x-host-control-token")).toBe(connection.controlToken);
    expect(new Headers(init?.headers).get("x-host-instance-id")).toBe(connection.instanceId);
    expect(init?.redirect).toBe("error");
    expect(JSON.parse(String(init?.body))).toEqual({ instanceId: connection.instanceId, method: "submit", input });
    throw new Error("Response lost after commit");
  }) as HostFetch });
  await expect(client.submit(input)).rejects.toThrow("outcome is unknown");
  expect(paths).toEqual([connection.url + "/api/host/terminal"]);
});

test("a bound observer never obtains replacement credentials or accepts another instance's stream", async () => {
  const events: WorkbenchEvent[] = [], paths: string[] = [];
  const client = createHostClient({ baseUrl: connection.url, connection, retryMs: 10000,
    fetch: (async (url, init) => {
      paths.push(String(url));
      expect(new Headers(init?.headers).get("x-host-control-token")).toBeNull();
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"ready","workspaceId":"workspace","instanceId":"replacement"}\n\n'));
      } }), { headers: { "content-type": "text/event-stream" } });
    }) as HostFetch });
  let detach!: () => void;
  await new Promise<void>(resolve => { detach = client.subscribe(event => {
    events.push(event); if (event.type === "connection" && !event.connected) { detach(); resolve(); }
  }); });
  expect(events).toEqual([{ type: "connection", connected: false, error: expect.any(String) }]);
  expect(paths).toEqual([connection.url + "/api/workbench/events"]);
});

test("detaching during a stream frame prevents delivery of remaining frames to a later subscriber", async () => {
  let connects = 0, laterEvents = 0, releaseLater: (() => void) | undefined;
  const client = createHostClient({ baseUrl: connection.url, connection,
    fetch: (async () => new Response(new ReadableStream({ start(controller) {
      if (++connects === 1) controller.enqueue(new TextEncoder().encode([
        { type: "ready", workspaceId: "workspace", instanceId: "instance" },
        { type: "session-error", identity: { workspaceId: "workspace", sessionId: "old", runId: null }, instanceId: "instance", message: "Old view error" },
      ].map(value => "data: " + JSON.stringify(value) + "\n\n").join("")));
    } }), { headers: { "content-type": "text/event-stream" } })) as HostFetch });
  let release!: () => void;
  await new Promise<void>(resolve => { release = client.subscribe(event => {
    if (event.type === "connection" && event.connected) {
      release(); releaseLater = client.subscribe(() => { laterEvents++; }); resolve();
    }
  }); });
  await new Promise(resolve => setTimeout(resolve, 20)); releaseLater?.();
  expect(laterEvents).toBe(0);
});

test("incompatible Host and invalid accepted replies cannot masquerade as terminal readiness", async () => {
  expect(() => createTerminalClient({ ...connection, serviceContractVersion: 1 })).toThrow("different workspace or protocol");
  expect(() => createTerminalClient({ ...connection, serviceContractVersion: 2 })).toThrow("different workspace or protocol");
  for (const reply of [null, {}, { ok: true, result: { sessionId: "other", runId: "run" } }]) {
    const client = createTerminalClient(connection, { fetch: (async () => Response.json(reply)) as HostFetch });
    await expect(client.submit(input)).rejects.toThrow("refused");
  }
});

test("terminal command receipt validates workspace, session, request and supported effects without a retry", async () => {
  const valid = { workspaceId: connection.workspaceId, sessionId: input.sessionId, requestId: input.requestId,
    revision: 1, result: { success: true, message: "Compacted", effects: [{ type: "compactSession" as const }] } };
  for (const receipt of [{ ...valid, workspaceId: "other" }, { ...valid, sessionId: "other" }, { ...valid, requestId: "other" },
    { ...valid, revision: -1 }, { ...valid, selectedSessionId: "" }, { ...valid, result: { success: true, message: "Invalid", effects: [{ type: "resetAgent" }] } }]) {
    let calls = 0;
    const client = createTerminalClient(connection, { fetch: async () => { calls++; return Response.json({ ok: true, result: receipt }); } });
    await expect(client.command(input)).rejects.toThrow("invalid"); expect(calls).toBe(1);
  }
  const client = createTerminalClient(connection, { fetch: async (_url, init) => {
    expect(new Headers(init?.headers).get("x-host-control-token")).toBe(connection.controlToken);
    expect(JSON.parse(String(init?.body)).method).toBe("command");
    return Response.json({ ok: true, result: valid });
  } });
  expect(await client.command(input)).toEqual(valid);
});
