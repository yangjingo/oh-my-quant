import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface LocalHttpServer {
  readonly url: URL;
  readonly port: number;
  ready: Promise<void>;
  timeout(request: Request, seconds: number): void;
  stop(force?: boolean): Promise<void>;
}

/** Transport only. Both runtimes call the same authenticated routes and services. */
export function startLocalHttpServer(options: {
  port: number;
  fetch(request: Request): Promise<Response>;
}): LocalHttpServer {
  if (process.versions.bun) {
    const server = Bun.serve({ ...options, hostname: "127.0.0.1", idleTimeout: 60, maxRequestBodySize: 32768 });
    return { get url() { return server.url; }, get port() { return server.port!; }, ready: Promise.resolve(),
      timeout: (request, seconds) => { server.timeout(request, seconds); }, stop: async force => { await server.stop(force); } };
  }
  return startNodeHttpServer(options);
}

/** Exported for transport regressions; production selects it only under Node. */
export function startNodeHttpServer(options: { port: number; fetch(request: Request): Promise<Response> }): LocalHttpServer {
  const responses = new WeakMap<Request, ServerResponse>();
  let origin: URL | undefined;
  const server = createServer({ requestTimeout: 60_000, headersTimeout: 10_000 }, (incoming, outgoing) => {
    const abort = new AbortController();
    const disconnected = () => { if (!outgoing.writableFinished) abort.abort(); };
    incoming.once("aborted", disconnected); outgoing.once("close", disconnected);
    void (async () => {
      try {
        const bytes = await readBody(incoming);
        if (abort.signal.aborted) return;
        const headers = new Headers();
        for (let i = 0; i < incoming.rawHeaders.length; i += 2) headers.append(incoming.rawHeaders[i]!, incoming.rawHeaders[i + 1]!);
        const method = incoming.method ?? "GET";
        const request = new Request(new URL(incoming.url ?? "/", origin).href, { method, headers, signal: abort.signal,
          ...(method === "GET" || method === "HEAD" ? {} : { body: Uint8Array.from(bytes).buffer }) });
        responses.set(request, outgoing);
        const response = await options.fetch(request);
        if (abort.signal.aborted) { await response.body?.cancel(); return; }
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        if (method === "HEAD" || !response.body) { await response.body?.cancel(); outgoing.end(); }
        // DOM and Node declare the same WHATWG stream with different ambient
        // extensions; fromWeb consumes their shared runtime stream contract.
        else await pipeline(Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>), outgoing);
      } catch (error) {
        if (outgoing.destroyed) return;
        if (outgoing.headersSent) { outgoing.destroy(); return; }
        const large = (error as { code?: string })?.code === "BODY_TOO_LARGE";
        outgoing.writeHead(large ? 413 : 400, { "content-type": "application/json", "cache-control": "no-store", "connection": "close" });
        outgoing.end(JSON.stringify({ ok: false, error: { code: large ? "BODY_TOO_LARGE" : "INPUT_INVALID",
          message: large ? "Request body exceeds 32768 bytes." : "Invalid local HTTP request." } }));
      } finally { incoming.removeListener("aborted", disconnected); outgoing.removeListener("close", disconnected); }
    })();
  });
  server.setTimeout(60_000);
  const ready = new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { reject(new Error("Missing local HTTP address.")); return; }
      origin = new URL(`http://127.0.0.1:${address.port}/`); resolve();
    });
  });
  // The owner also observes ready; avoid an unhandled rejection during setup.
  void ready.catch(() => {});
  let stopping: Promise<void> | undefined;
  return {
    get url() { if (!origin) throw new Error("Local HTTP listener is not ready."); return origin; },
    get port() { return Number(this.url.port); }, ready,
    timeout(request, seconds) { responses.get(request)?.setTimeout(seconds * 1000); },
    stop(force = false) {
      return stopping ??= new Promise<void>((resolve, reject) => {
        server.close(error => { if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(error); else resolve(); });
        if (force) server.closeAllConnections();
      });
    },
  };
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => { request.removeListener("data", data); request.removeListener("end", end); request.removeListener("error", fail); };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > 32768) { fail(Object.assign(new Error("Body too large"), { code: "BODY_TOO_LARGE" })); request.resume(); }
      else chunks.push(chunk);
    };
    request.on("data", data); request.once("end", end); request.once("error", fail);
  });
}
