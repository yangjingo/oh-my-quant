import { join } from "node:path";
import { runWorkspaceHost } from "../../../../src/app/host/run.ts";

if (!process.env.WHYJ_TEST_PROJECT || !process.env.OHQUANT_DIR) throw new Error("Missing isolated fixture directory");
process.chdir(process.env.WHYJ_TEST_PROJECT);
await runWorkspaceHost({ port: 0, assetsRoot: join(process.env.OHQUANT_DIR, "assets") });
