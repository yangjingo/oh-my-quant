// Throwaway UI study: three layouts for one Agent research task. No live services.
if (process.env.NODE_ENV === "production") {
  throw new Error("Research workspace prototype is development-only.");
}

const root = new URL("./", import.meta.url);
const files: Record<string, URL> = {
  "/prototype/research-workspace/": new URL("index.html", root),
  "/prototype/research-workspace/style.css": new URL("style.css", root),
  "/prototype/research-workspace/app.js": new URL("app.js", root),
  "/fonts/geist-regular.ttf": new URL("../../public/fonts/geist-regular.ttf", root),
  "/fonts/geist-semibold.ttf": new URL("../../public/fonts/geist-semibold.ttf", root),
  "/fonts/geist-mono.ttf": new URL("../../public/fonts/geist-mono.ttf", root),
};

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 4174,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/prototype/research-workspace") {
      return Response.redirect(new URL(`/prototype/research-workspace/${url.search}`, url), 302);
    }
    const file = files[url.pathname];
    if (!file || request.method !== "GET") return new Response("Not found", { status: 404 });
    return new Response(Bun.file(file), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
});
console.log(`Research prototype: ${server.url}prototype/research-workspace/?variant=A`);
