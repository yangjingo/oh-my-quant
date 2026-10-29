import { join } from "node:path";
import { writeFileSync } from "node:fs";

if (process.env.WHYJ_HOST_TEST_HANG === "1") {
  writeFileSync(join(process.env.OHQUANT_DIR!, "hung-pid"), String(process.pid));
  setInterval(() => {}, 1000);
} else {
  const { runWorkspaceHost } = await import("../../run.ts");
  await runWorkspaceHost({ port: 0, assetsRoot: join(process.env.OHQUANT_DIR!, "assets") });
}
