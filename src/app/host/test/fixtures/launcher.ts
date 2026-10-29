import { join } from "node:path";
import { connectWorkspaceHost } from "../../../bootstrap.ts";
const connection = await connectWorkspaceHost({ workspaceRoot: process.env.OHQUANT_DIR,
  entrypoint: join(import.meta.dir, "host.ts"), timeoutMs: 10_000 });
console.log(JSON.stringify({ instanceId: connection.instanceId, started: connection.started }));
