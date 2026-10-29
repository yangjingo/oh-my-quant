import { fileURLToPath } from "node:url";
import { runWorkspaceHost } from "../../../src/app/host/run.ts";

// Separate child bundle; Node and Bun use the same routes and execution owner.
try {
  const port = process.env.WHYJ_WEB_PORT ? Number(process.env.WHYJ_WEB_PORT) : 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid local port.");
  await runWorkspaceHost({ port, assetsRoot: fileURLToPath(new URL("./web", import.meta.url)) });
} catch (error) {
  const code = (error as { code?: string })?.code;
  console.error(JSON.stringify({ type: "failed", code: typeof code === "string" && /^[A-Z_]+$/.test(code) ? code : "HOST_START_FAILED" }));
  process.exit(1);
}
