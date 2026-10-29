import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

/**
 * The workbench is loaded by two entries: a browser tab served by the workspace
 * Host, and the Electron window. Both consume the same built assets, so the
 * bundle uses relative asset URLs and keeps no absolute origin.
 */
function connectedDevelopment(target: string): Plugin {
  const url = new URL(target);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("Development Host must be a loopback HTTP origin.");
  return {
    name: "whyj-connected-development",
    transformIndexHtml(html) { return html.replace("</head>", '<meta name="whyj-workbench-host" content="1"></head>'); },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith("/api/")) return next();
        const address = server.httpServer?.address();
        const host = address && typeof address !== "string" ? `127.0.0.1:${address.port}` : "";
        const origin = request.headers.origin;
        const allowed = (request.method === "GET" && ["/api/workbench/bootstrap", "/api/workbench/events"].includes(request.url))
          || (request.method === "POST" && request.url === "/api/workbench/rpc");
        if (!allowed || request.headers.host !== host || (origin && origin !== `http://${host}`)
          || request.headers["sec-fetch-site"] === "cross-site") {
          response.writeHead(403, { "Content-Type": "text/plain", "Cache-Control": "no-store" }); response.end("Development request denied."); return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const target = command === "serve" && mode !== "demo" ? process.env.WHYJ_DEV_HOST_URL : undefined;
  const port = command === "serve" && process.env.WHYJ_DEV_WEB_PORT ? Number(process.env.WHYJ_DEV_WEB_PORT) : 4176;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("WHYJ_DEV_WEB_PORT must be between 1 and 65535.");
  return {
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version) },
  plugins: [react(), ...(target ? [connectedDevelopment(target)] : [])],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    ...(target ? { proxy: { "^/api/workbench/(bootstrap|rpc|events)$": {
      target, changeOrigin: true,
      configure(proxy) { proxy.on("proxyReq", (outgoing, request) => {
        outgoing.removeHeader("x-host-control-token");
        if (request.headers.origin) outgoing.setHeader("origin", target);
      }); },
    } } } : {}),
  },
};
});
