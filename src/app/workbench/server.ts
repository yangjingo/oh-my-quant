import { randomBytes } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createHostRuntimeStore, ensureDirs, type HostRegistration } from "../../storage/index.ts";
import manifest from "../../../package.json";
import { HOST_PROTOCOL_VERSION, HOST_SERVICE_CONTRACT_VERSION, publicHostIdentity } from "../host/protocol.ts";
import { createHostClients } from "../host/clients.ts";
import type { WorkbenchEvent } from "../../types/workbench.ts";
import { createWorkbenchService } from "./service.ts";
import { dispatchWorkbench } from "./rpc.ts";
import { publicError, WorkbenchError } from "./errors.ts";

export const WORKBENCH_ASSETS_ROOT = resolve(import.meta.dir, "../../..", "apps/web/dist");

/** Local connection; restoring a checkpoint never starts an Agent request. */
export function startWorkbenchServer(options: { port?: number; assetsRoot?: string; service?: ReturnType<typeof createWorkbenchService>; onStopping?: () => void; onStopped?: () => void } = {}) {
  ensureDirs();
  const requestedAssets = options.assetsRoot ?? WORKBENCH_ASSETS_ROOT;
  if (!existsSync(join(requestedAssets, "index.html"))) throw new WorkbenchError("ASSETS_MISSING", "请先运行 bun run web:build。", 503);
  const assetsRoot = realpathSync(requestedAssets);
  const registry = createHostRuntimeStore();
  let lease: ReturnType<typeof registry.acquire>;
  try { lease = registry.acquire("owner"); }
  catch (error) {
    if ((error as { code?: string }).code === "HOST_LOCKED") throw new WorkbenchError("HOST_IN_USE", "此工作区已有本地研究服务或启动进程，请复用原服务。", 409);
    throw error;
  }
  let service: ReturnType<typeof createWorkbenchService>;
  try { service = options.service ?? createWorkbenchService(); } catch (error) { lease.release(); throw error; }
  const token = randomBytes(32).toString("hex"), controlToken = randomBytes(32).toString("hex"), encoder = new TextEncoder();
  let closing: Promise<void> | undefined, stopping = false, operations = 0;
  const clients = createHostClients(lease.instanceId);
  let registration: HostRegistration;
  let ready: Promise<HostRegistration>;
  const streams = new Set<() => void>();
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
  let server: ReturnType<typeof Bun.serve>;
  try { server = Bun.serve({ hostname: "127.0.0.1", port: options.port ?? 4182, idleTimeout: 60, maxRequestBodySize: 32768,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.origin !== server.url.origin || request.headers.get("host") !== server.url.host || request.headers.get("sec-fetch-site") === "cross-site"
        || (request.headers.get("origin") && request.headers.get("origin") !== server.url.origin)) return json({ ok: false, error: { code: "ORIGIN_DENIED", message: "只接受当前本机研究页面的请求。" } }, 403);
      try {
        if (stopping) throw new WorkbenchError("HOST_STOPPING", "工作区后端正在停止，未接受新操作。", 503);
        if (request.method === "GET" && url.pathname === "/api/workbench/bootstrap") {
          await ready;
          return json({ version: 1, token, ...publicHostIdentity(registration) });
        }
        if (url.pathname.startsWith("/api/")) {
          if (request.headers.get("x-workbench-token") !== token) return json({ ok: false, error: { code: "TOKEN_INVALID", message: "服务连接已变化，请重新连接。" } }, 401);
          await ready;
          lease.assertOwned();
          if (request.method === "GET" && url.pathname === "/api/host/ready") return json(publicHostIdentity(registration));
          if (request.method === "GET" && url.pathname === "/api/host/status") {
            const sessions = await service.client.workspaces();
            return json({ ...publicHostIdentity(registration), clients: clients.count(), observers: streams.size, activeRuns: sessions.filter(item => item.state === "running").length });
          }
          if (request.method === "POST" && url.pathname === "/api/host/clients") return json(clients.update(await hostBody(request)));
          if (request.method === "POST" && url.pathname === "/api/host/shutdown") {
            if (request.headers.get("x-host-control-token") !== controlToken) throw new WorkbenchError("CONTROL_TOKEN_INVALID", "停止后端需要本机启动能力。", 403);
            const payload = await hostBody(request) as { instanceId?: string; mode?: string };
            if (payload?.instanceId !== lease.instanceId || !["explicit", "if-idle"].includes(payload?.mode ?? "")
              || Object.keys(payload).some(key => key !== "instanceId" && key !== "mode")) throw new WorkbenchError("INPUT_INVALID", "请指定当前后端实例和停止方式。");
            const sessions = await service.client.workspaces();
            if (payload.mode === "if-idle" && (operations || clients.count() || streams.size || sessions.some(item => item.state === "running"))) {
              throw new WorkbenchError("HOST_BUSY", "其他客户端或研究仍在使用后端，未停止。", 409);
            }
            stopping = true;
            setTimeout(() => { void close().catch(() => { /* The owning process handles bounded shutdown. */ }); }, 25);
            return json({ stopping: true, instanceId: lease.instanceId });
          }
          if (request.method === "POST" && url.pathname === "/api/workbench/rpc") {
            if (!request.headers.get("content-type")?.startsWith("application/json")) throw new WorkbenchError("INPUT_INVALID", "请使用 JSON 请求。");
            let payload: unknown;
            try { payload = JSON.parse(await request.text()); } catch { throw new WorkbenchError("INPUT_INVALID", "请求不是有效 JSON。"); }
            operations++;
            try { return json({ ok: true, result: (await dispatchWorkbench(service.client, payload)) ?? null }); }
            finally { operations--; }
          }
          if (request.method === "GET" && url.pathname === "/api/workbench/events") {
            let detach: (() => void) | undefined, heartbeat: ReturnType<typeof setInterval> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
            let ended = false, controller: ReadableStreamDefaultController<Uint8Array>;
            const pending = new Map<string, WorkbenchEvent>();
            const cleanup = () => {
              if (ended) return; ended = true; detach?.(); clearInterval(heartbeat); clearTimeout(timer); pending.clear();
              request.signal.removeEventListener("abort", cleanup); streams.delete(cleanup);
              try { controller?.close(); } catch { /* Reader already detached. */ }
            };
            const flush = () => {
              timer = undefined;
              if (ended) return;
              try {
                for (const [id, event] of pending) {
                  if ((controller.desiredSize ?? 0) <= 0) break;
                  controller.enqueue(encoder.encode("data: " + JSON.stringify({ ...event, instanceId: lease.instanceId }) + "\n\n")); pending.delete(id);
                }
              } catch { cleanup(); }
            };
            const queue = (event: WorkbenchEvent) => {
              if ((event.type !== "snapshot" && event.type !== "session-error" && event.type !== "market") || ended) return;
              pending.set(event.identity.sessionId + ":" + event.type, event);
              if (event.type !== "snapshot" || event.snapshot.state !== "running") { clearTimeout(timer); flush(); }
              else timer ??= setTimeout(flush, 50);
            };
            const stream = new ReadableStream<Uint8Array>({ start(value) {
              controller = value;
              if (request.signal.aborted) { cleanup(); return; }
              streams.add(cleanup); request.signal.addEventListener("abort", cleanup, { once: true });
              detach = service.client.subscribe(queue);
              // A small handshake lets the client fetch only its selected history.
              controller.enqueue(encoder.encode("data: " + JSON.stringify({ type: "ready", ...publicHostIdentity(registration) }) + "\n\n"));
              heartbeat = setInterval(() => { if (!ended && (controller.desiredSize ?? 0) > 0) { try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch { cleanup(); } } }, 15000);
            }, pull: flush, cancel: cleanup });
            return new Response(stream, { headers: { ...headers, "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" } });
          }
          throw new WorkbenchError("NOT_FOUND", "没有这个研究接口。", 404);
        }
        if (request.method !== "GET" && request.method !== "HEAD") throw new WorkbenchError("NOT_FOUND", "没有这个页面。", 404);
        const name = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\//, "");
        if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.split("/").some(part => part === ".." || part === ".") || (name !== "index.html" && !name.startsWith("assets/"))) throw new WorkbenchError("NOT_FOUND", "没有这个页面。", 404);
        const file = join(assetsRoot, name);
        if (!existsSync(file) || !statSync(file).isFile()) throw new WorkbenchError("NOT_FOUND", "没有这个页面。", 404);
        const contained = relative(assetsRoot, realpathSync(file));
        if (isAbsolute(contained) || contained.startsWith("..")) throw new WorkbenchError("NOT_FOUND", "没有这个页面。", 404);
        if (name === "index.html") return new Response((await Bun.file(file).text()).replace("</head>", '<meta name="whyj-workbench-host" content="1"></head>'), { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
        return new Response(Bun.file(file), { headers });
      } catch (error) { const failure = publicError(error); return json({ ok: false, error: { code: failure.code, message: failure.message } }, failure.status); }
    },
  }); } catch (error) { lease.release(); void service.close(); throw error; }
  ready = (async () => {
    await service.client.identity();
    if (stopping) throw new WorkbenchError("HOST_STOPPING", "后端已停止启动。", 503);
    registration = { schemaVersion: 1, instanceId: lease.instanceId, pid: lease.pid, startedAt: lease.startedAt,
      workspaceId: service.workspaceId, url: server.url.origin, protocolVersion: HOST_PROTOCOL_VERSION,
      serviceContractVersion: HOST_SERVICE_CONTRACT_VERSION, applicationVersion: manifest.version, token, controlToken };
    registry.publish(registration, lease);
    return registration;
  })();
  // Failure is retained for the launcher/request, while immediately closing the
  // unsuccessful listener. No rejected startup promise is left unobserved.
  void ready.catch(() => { void close().catch(() => {}); });
  function close() {
    stopping = true;
    return closing ??= (async () => {
      options.onStopping?.();
      clients.clear();
      for (const end of [...streams]) end();
      await service.close();
      await server.stop(true);
      try { registry.unpublish(lease.instanceId); } finally { lease.release(); }
      options.onStopped?.();
    })();
  }
  return { server, service, ready, close };
}

async function hostBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new WorkbenchError("INPUT_INVALID", "请使用 JSON 请求。");
  let value: unknown;
  try { value = await request.json(); } catch { throw new WorkbenchError("INPUT_INVALID", "请求不是有效 JSON。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkbenchError("INPUT_INVALID", "后端请求参数无效。");
  return value as Record<string, unknown>;
}

if (import.meta.main) {
  const port = process.env.WHYJ_WEB_PORT ? Number(process.env.WHYJ_WEB_PORT) : 4182;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("WHYJ_WEB_PORT must be a valid local port");
  const host = startWorkbenchServer({ port });
  await host.ready;
  console.log("WhyJ Agent workbench: " + host.server.url.origin);
  const stop = () => { void host.close().then(() => process.exit(0)); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
}
