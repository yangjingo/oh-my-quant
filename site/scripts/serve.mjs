import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadContent, renderPage, renderRuntimeMessages, routes } from "./render.mjs";
import { articlePath, articleDirectory } from "./article.mjs";

const preview = process.argv.includes("--dist");
const root = fileURLToPath(
  new URL(
    preview ? "../dist/" : "../public/",
    import.meta.url,
  ),
);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".mp4": "video/mp4",
};
const deployment = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
const server = createServer(async (req, res) => {
  for (const rule of deployment.headers ?? []) {
    if (rule.source === "/(.*)") for (const header of rule.headers) res.setHeader(header.key, header.value);
  }
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const redirect = (deployment.redirects ?? []).find(entry => entry.source === pathname.replace(/\/$/, ""));
    if (redirect) {
      const target = new URL(redirect.destination, "http://localhost");
      target.search = new URL(req.url, "http://localhost").search;
      res.writeHead(308, { Location: `${target.pathname}${target.search}${target.hash}` }).end();
      return;
    }
    const route = routes.find((entry) => entry.path === pathname);
    if (!pathname.endsWith("/") && routes.some((entry) => entry.path === `${pathname}/`)) {
      res.writeHead(308, { Location: `${pathname}/${new URL(req.url, "http://localhost").search}` }).end();
      return;
    }
    if (!preview && (route || pathname === "/messages.js")) {
      const content = await loadContent();
      const body = route ? renderPage(content, route) : renderRuntimeMessages(content);
      res.writeHead(200, {
        "Content-Type": route ? mime[".html"] : mime[".js"],
        "Cache-Control": "no-store",
      }).end(body);
      return;
    }
    const articleAsset = !preview && pathname.startsWith(articlePath) && !route;
    const assetRoot = articleAsset ? articleDirectory : root;
    const file = path.resolve(assetRoot, articleAsset ? `.${pathname.slice(articlePath.length - 1)}` : `.${route ? `${pathname}index.html` : pathname}`);
    if (!file.startsWith(assetRoot)) {
      res.writeHead(403).end();
      return;
    }
    const body = await readFile(file);
    res
      .writeHead(200, {
        "Content-Type": mime[path.extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      })
      .end(body);
  } catch {
    res
      .writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
      .end("Not found");
  }
});
const port = Number(process.env.PORT || 4173);
server.listen(port, "127.0.0.1", () =>
  console.log(`WhyJ Quant website: http://127.0.0.1:${port}`),
);
