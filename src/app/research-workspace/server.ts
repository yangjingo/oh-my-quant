import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { createWorkspaceManager, type WorkspacePorts } from "./manager.ts";
import type { WorkspaceScope } from "../../types/workspace.ts";
import {
  loadWorkspaceMetadata,
  saveWorkspaceMetadata,
  resolveProjectDirPath,
  type WorkspaceMetadata,
} from "../../storage/index.ts";
import { revealInFileManager } from "./reveal.ts";

/** Local-only composition. No model credentials, raw provider events, or arbitrary files cross this boundary. */
export function startWorkspaceServer(
  options: WorkspacePorts & { port?: number } = {},
) {
  const manager = createWorkspaceManager(options),
    token = randomBytes(32).toString("hex");
  const assets: Record<string, string> = {
    "/": "index.html",
    "/app.js": "app.js",
    "/style.css": "style.css",
    "/markdown.js": "markdown.js",
  };
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  };
  const json = (data: unknown, status = 200) =>
    Response.json(data, { status, headers });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? 4175,
    idleTimeout: 60,
    maxRequestBodySize: 16000,
    async fetch(request) {
      const url = new URL(request.url),
        origin = server.url.origin;
      if (
        url.origin !== origin ||
        request.headers.get("host") !== server.url.host ||
        request.headers.get("sec-fetch-site") === "cross-site" ||
        (request.headers.get("origin") &&
          request.headers.get("origin") !== origin)
      )
        return json({ error: "只接受本机工作台请求。" }, 403);
      if (
        request.method === "POST" &&
        (request.headers.get("x-workspace-token") !== token ||
          !request.headers.get("content-type")?.startsWith("application/json"))
      )
        return json({ error: "请求校验失败，请刷新页面。" }, 403);
      try {
        if (request.method === "GET" && assets[url.pathname])
          return new Response(
            Bun.file(join(import.meta.dir, "web", assets[url.pathname]!)),
            { headers },
          );
        if (request.method === "GET" && url.pathname === "/api/status")
          return json({
            token,
            task: "单股历史日线结构观察",
            local: true,
            current: manager.current(),
          });
        if (request.method === "GET" && url.pathname === "/api/workspace/meta")
          return json(loadWorkspaceMetadata());
        if (request.method === "GET" && url.pathname === "/api/studies")
          return json(
            manager.list().map((r) => ({
              id: r.id,
              question: r.question,
              scope: r.scope,
              createdAt: r.createdAt,
              parentId: r.parentId,
              conversationId: r.conversationId ?? r.id,
              turns: (r.history?.length ?? 0) + 1,
            })),
          );
        if (request.method === "POST") {
          if (Number(request.headers.get("content-length") ?? 0) > 16000)
            return json({ error: "请求过大。" }, 413);
          const text = await request.text();
          if (text.length > 16000) return json({ error: "请求过大。" }, 413);
          if (url.pathname === "/api/workspace/meta") {
            const meta = JSON.parse(text) as WorkspaceMetadata;
            return json(saveWorkspaceMetadata(meta));
          }
          if (url.pathname === "/api/workspace/reveal") {
            const payload = JSON.parse(text) as {
              type: "project" | "study";
              id: string;
              symbol?: string;
            };
            if (payload.type === "study") {
              const run = manager.get(payload.id);
              const target = manager.store.filePath(run.id);
              revealInFileManager(target);
              return json({ ok: true, path: target });
            }
            if (payload.type === "project") {
              const symbol = payload.symbol || payload.id;
              const dir = resolveProjectDirPath(symbol);
              revealInFileManager(dir);
              return json({ ok: true, path: dir });
            }
            return json({ error: "不支持的打开类型。" }, 400);
          }
          const body = JSON.parse(text) as {
            question: string;
            scope: WorkspaceScope;
            end?: string;
          };
          if (url.pathname === "/api/runs")
            return json(manager.start(body.question, body.scope), 202);
          const match =
            /^\/api\/runs\/([a-f0-9-]{36})\/(cancel|continue|save|review|followup|delete)$/.exec(
              url.pathname,
            );
          if (match) {
            const id = match[1]!;
            if (match[2] === "delete") {
              const result = manager.delete(id);
              try {
                const meta = loadWorkspaceMetadata();
                if (meta.studies[id]) {
                  delete meta.studies[id];
                  saveWorkspaceMetadata(meta);
                }
              } catch {}
              return json(result);
            }
            if (match[2] === "followup")
              return json(manager.followup(id, body.question), 202);
            if (match[2] === "review") {
              const old = manager.get(id);
              if (!old.saved)
                return json(
                  { error: "请先保存本次研究，再发起独立复核。" },
                  409,
                );
              return json(
                manager.start(
                  old.history?.[0]?.question ?? old.question,
                  { ...old.scope, end: body.end ?? old.scope.end },
                  id,
                ),
                202,
              );
            }
            return json(
              manager[match[2] as "cancel" | "continue" | "save"](id),
            );
          }
        }
        const match = /^\/api\/runs\/([a-f0-9-]{36})(\/events|\/latest)?$/.exec(
          url.pathname,
        );
        if (request.method === "GET" && match) {
          const id = match[1]!,
            run = manager.get(id);
          if (!match[2]) return json(run);
          if (match[2] === "/latest") return json(manager.latest(id));
          const encoder = new TextEncoder();
          let unsubscribe = () => {};
          let heartbeat: ReturnType<typeof setInterval> | undefined;
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              const send = (value: unknown) =>
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(value)}\n\n`),
                );
              send(run);
              unsubscribe = manager.subscribe((value) => {
                if (value.id === id) send(value);
              });
              heartbeat = setInterval(
                () => controller.enqueue(encoder.encode(": heartbeat\n\n")),
                15000,
              );
            },
            cancel() {
              unsubscribe();
              clearInterval(heartbeat);
            },
          });
          return new Response(stream, {
            headers: {
              ...headers,
              "Content-Type": "text/event-stream",
              Connection: "keep-alive",
            },
          });
        }
        return json({ error: "未找到。" }, 404);
      } catch {
        return json(
          {
            error:
              "操作未完成。请检查范围、运行状态、数据源和本地配置；已有保存版本保留。",
          },
          400,
        );
      }
    },
  });
  return { server, manager };
}
if (import.meta.main) {
  const { server } = startWorkspaceServer();
  console.log(
    `WhyJ Research Workspace: ${server.url}（仅本机；Ctrl+C 停止服务）`,
  );
}
