import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { connectWorkspaceHost } from "../../../src/app/bootstrap.ts";

async function runChild(args: string[], cwd: string, signal?: AbortSignal, env = process.env): Promise<number> {
  if (signal?.aborted) return 0;
  const child = Bun.spawn([process.execPath, ...args], { cwd, env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  let stopping = false;
  const stop = () => { if (!stopping) { stopping = true; child.kill(); } };
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  try { const code = await child.exited; return stopping ? 0 : code; }
  finally { signal?.removeEventListener("abort", stop); }
}

/** Host also serves production assets; bootstrap them once on a fresh checkout. */
export async function ensureDevelopmentAssets(web: string, vite: string, signal?: AbortSignal): Promise<number> {
  if (existsSync(join(web, "dist/index.html"))) return 0;
  if (!existsSync(vite)) throw new Error("Web dependencies are missing. Run bun install --cwd apps/web --frozen-lockfile.");
  console.log("Building initial Web assets for the shared Host.");
  const code = await runChild([vite, "build"], web, signal);
  if (code === 0 && !signal?.aborted && !existsSync(join(web, "dist/index.html"))) throw new Error("Web build did not produce dist/index.html.");
  return code;
}

/** Local development owns Vite only; the shared Host survives this process. */
export async function runWebDevelopment(signal?: AbortSignal): Promise<number> {
  const value = process.env.WHYJ_DEV_WEB_PORT ?? "4176", port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("WHYJ_DEV_WEB_PORT must be between 1 and 65535.");
  const web = fileURLToPath(new URL("../../web/", import.meta.url));
  const vite = fileURLToPath(new URL("../../web/node_modules/vite/bin/vite.js", import.meta.url));
  if (!existsSync(vite)) throw new Error("Web dependencies are missing. Run bun install --cwd apps/web --frozen-lockfile.");
  const built = await ensureDevelopmentAssets(web, vite, signal);
  if (built !== 0 || signal?.aborted) return built;
  const connection = await connectWorkspaceHost();
  if (signal?.aborted) return 0;
  console.log(`Workspace Host ${connection.started ? "started" : "reused"}: ${connection.url}`);
  return await runChild([vite], web, signal, { ...process.env, WHYJ_DEV_HOST_URL: connection.url, WHYJ_DEV_WEB_PORT: String(port) });
}

if (import.meta.main) {
  const controller = new AbortController(), stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  runWebDevelopment(controller.signal).then(code => { process.exitCode = code; }, error => {
    console.error(`Web development failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1;
  }).finally(() => { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); });
}
