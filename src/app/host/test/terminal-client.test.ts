import { expect, test } from "bun:test";
import { createHostClient, type HostFetch } from "../client.ts";
import { createTerminalClient } from "../terminal-client.ts";
import type { HostConnection } from "../../bootstrap.ts";
import type { WorkbenchEvent } from "../../../types/workbench.ts";
import type { TerminalContext } from "../../../types/terminal.ts";
import { resolve } from "node:path";
import type { ResearchTaskSpec } from "../../../types/research-task.ts";
import { HOST_MAX_REQUEST_BYTES } from "../../../types/workbench-host.ts";
import { startNodeHttpServer } from "../../workbench/http-server.ts";

const connection: HostConnection = { url: "http://127.0.0.1:12345", workspaceId: "workspace", instanceId: "instance",
  token: "a".repeat(64), controlToken: "b".repeat(64), protocolVersion: 1, serviceContractVersion: 4,
  applicationVersion: "1.4.0", started: false };
const input = { workspaceId: connection.workspaceId, sessionId: "session", requestId: "once", expectedRevision: 0, text: "Request" };

test("terminal requests isolate only bodies over the Host UTF-8 byte limit", async () => {
  const reference = { workspaceId: connection.workspaceId, sessionId: "session", input: "" };
  const size = (text: string) => new TextEncoder().encode(JSON.stringify({ instanceId: connection.instanceId, method: "suggestReferences", input: { ...reference, input: text } })).byteLength;
  const overhead = size("");
  for (const [text, expectedBytes, isolated] of [
    ["x".repeat(HOST_MAX_REQUEST_BYTES - overhead - 1), HOST_MAX_REQUEST_BYTES - 1, false],
    ["x".repeat(HOST_MAX_REQUEST_BYTES - overhead), HOST_MAX_REQUEST_BYTES, false],
    ["x".repeat(HOST_MAX_REQUEST_BYTES - overhead + 1), HOST_MAX_REQUEST_BYTES + 1, true],
    ["界".repeat(Math.floor((HOST_MAX_REQUEST_BYTES - overhead + 1) / 3)) + "x".repeat((HOST_MAX_REQUEST_BYTES - overhead + 1) % 3), HOST_MAX_REQUEST_BYTES + 1, true],
  ] as const) {
    let calls = 0;
    const client = createTerminalClient(connection, { fetch: async (_url, init) => {
      calls++;
      expect(new TextEncoder().encode(String(init?.body)).byteLength).toBe(expectedBytes);
      expect(init?.keepalive).toBe(isolated ? false : undefined);
      return isolated ? Response.json({ ok: false, error: { code: "BODY_TOO_LARGE", message: "Request body exceeds 32768 bytes." } }, { status: 413 })
        : Response.json({ ok: true, result: { ...reference, runId: null, items: [] } });
    } });
    if (isolated) await expect(client.suggestReferences({ ...reference, input: text })).rejects.toMatchObject({ code: "BODY_TOO_LARGE", message: "Request body exceeds 32768 bytes." });
    else expect((await client.suggestReferences({ ...reference, input: text })).items).toEqual([]);
    expect(calls).toBe(1);
  }
  let calls = 0;
  const client = createTerminalClient(connection, { fetch: async (_url, init) => {
    calls++; expect(init?.keepalive).toBe(false);
    throw Object.assign(new Error("Controlled transport failure"), { code: "ECONNRESET" });
  } });
  await expect(client.enqueue({ ...input, runId: "run", text: "x".repeat(HOST_MAX_REQUEST_BYTES) })).rejects.toThrow("outcome is unknown");
  expect(calls).toBe(1);
});

test("only a connection-bound shared Host client isolates an oversized RPC", async () => {
  for (const bound of [false, true]) {
    const seen: Array<{ body: string; keepalive: boolean | undefined }> = [];
    const client = createHostClient({ baseUrl: connection.url, ...(bound ? { connection } : {}), fetch: async (url, init) => {
      if (String(url).endsWith("/api/workbench/bootstrap")) return Response.json({ version: 1, token: connection.token, protocolVersion: 1, serviceContractVersion: 4 });
      seen.push({ body: String(init?.body), keepalive: init?.keepalive });
      return Response.json({ ok: false, error: { code: "BODY_TOO_LARGE", message: "Request body exceeds 32768 bytes." } }, { status: 413 });
    } });
    await expect(client.references("session", "x".repeat(HOST_MAX_REQUEST_BYTES))).rejects.toThrow("Request body exceeds 32768 bytes.");
    expect(seen).toHaveLength(1);
    expect(new TextEncoder().encode(seen[0]!.body).byteLength).toBeGreaterThan(HOST_MAX_REQUEST_BYTES);
    expect(seen[0]!.keepalive).toBe(bound ? false : undefined);
  }
});

test("terminal client preserves a 413 and the next identity read with a Node Host", async () => {
  const server = startNodeHttpServer({ port: 0, async fetch(request) {
    const value = await request.json() as { method: string };
    return Response.json({ ok: true, result: value.method === "identity" ? { workspaceId: connection.workspaceId, sessionId: "session", runId: null } : null });
  } });
  await server.ready;
  try {
    for (const stripIsolation of [false, true]) {
      let poisoned = false, calls = 0;
      const client = createTerminalClient({ ...connection, url: server.url.origin }, { fetch: async (url, init) => {
        calls++;
        const body = String(init?.body);
        if (body.includes('"method":"identity"') && poisoned) throw Object.assign(new Error("Controlled closed connection reuse"), { code: "ECONNRESET" });
        const oversized = new TextEncoder().encode(body).byteLength > HOST_MAX_REQUEST_BYTES;
        if (oversized && (stripIsolation || init?.keepalive !== false)) poisoned = true;
        return fetch(url, stripIsolation && oversized ? { ...init, keepalive: undefined } : init);
      } });
      await expect(client.suggestReferences({ workspaceId: connection.workspaceId, sessionId: "session", input: "x".repeat(HOST_MAX_REQUEST_BYTES) }))
        .rejects.toMatchObject({ code: "BODY_TOO_LARGE", message: "Request body exceeds 32768 bytes." });
      if (stripIsolation) await expect(client.identity()).rejects.toThrow("请求结果未确认");
      else expect(await client.identity()).toEqual({ workspaceId: connection.workspaceId, sessionId: "session", runId: null });
      expect(calls).toBe(2);
    }
    for (const stripIsolation of [false, true]) {
      let poisoned = false, calls = 0;
      const client = createHostClient({ baseUrl: server.url.origin, connection, fetch: async (url, init) => {
        calls++;
        const body = String(init?.body);
        if (body.includes('"method":"identity"') && poisoned) throw Object.assign(new Error("Controlled closed connection reuse"), { code: "ECONNRESET" });
        const oversized = new TextEncoder().encode(body).byteLength > HOST_MAX_REQUEST_BYTES;
        if (oversized && (stripIsolation || init?.keepalive !== false)) poisoned = true;
        return fetch(url, stripIsolation && oversized ? { ...init, keepalive: undefined } : init);
      } });
      await expect(client.references("session", "x".repeat(HOST_MAX_REQUEST_BYTES))).rejects.toThrow("Request body exceeds 32768 bytes.");
      if (stripIsolation) await expect(client.identity()).rejects.toThrow("请求结果未确认");
      else expect(await client.identity()).toEqual({ workspaceId: connection.workspaceId, sessionId: "session", runId: null });
      expect(calls).toBe(2);
    }
  } finally { await server.stop(true); }
});

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
  expect(() => createTerminalClient({ ...connection, serviceContractVersion: 3 })).toThrow("different workspace or protocol");
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
