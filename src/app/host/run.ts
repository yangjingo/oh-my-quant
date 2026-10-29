import { startWorkbenchServer } from "../workbench/server.ts";

/** Child entry. Tokens are written only to private storage, never argv/stdout. */
export async function runWorkspaceHost(options: { port?: number; assetsRoot?: string } = {}) {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let published = false;
  const host = startWorkbenchServer({ ...options,
    onStopping() { deadline ??= setTimeout(() => process.exit(1), 10_000); },
    onStopped() { clearTimeout(deadline); if (published) process.exit(0); },
  });
  const stop = () => { void host.close().catch(() => process.exit(1)); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  const startupDeadline = setTimeout(() => process.exit(1), 15_000);
  let entry;
  try { entry = await host.ready; }
  catch (error) {
    // A failed listen is asynchronous under Node. Drain the owner before the
    // entrypoint exits; otherwise a dead child leaves its ownership record.
    await host.close(); throw error;
  } finally { clearTimeout(startupDeadline); }
  published = true;
  console.log(JSON.stringify({ type: "ready", instanceId: entry.instanceId }));
}

if (import.meta.main) {
  try {
    const port = process.env.WHYJ_WEB_PORT ? Number(process.env.WHYJ_WEB_PORT) : 0;
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("WHYJ_WEB_PORT must be a valid local port");
    await runWorkspaceHost({ port });
  } catch (error) {
    // A parent receives a stable diagnostic, never configuration or credential data.
    const code = (error as { code?: string })?.code;
    console.error(JSON.stringify({ type: "failed", code: typeof code === "string" && /^[A-Z_]+$/.test(code) ? code : "HOST_START_FAILED" }));
    process.exit(1);
  }
}
