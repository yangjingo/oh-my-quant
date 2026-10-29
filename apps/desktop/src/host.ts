import { runWorkspaceHost } from "../../../src/app/host/run.ts";

const assetsRoot = process.env.WHYJ_DESKTOP_ASSETS;
if (!assetsRoot) throw new Error("Desktop workbench assets are missing.");
const port = process.env.WHYJ_WEB_PORT ? Number(process.env.WHYJ_WEB_PORT) : 0;
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid Host port.");
await runWorkspaceHost({ port, assetsRoot });
