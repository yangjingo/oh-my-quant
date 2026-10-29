import { copyFileSync, cpSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const outdir = resolve(root, "dist");
// dist is generated output; discard old content-addressed chunks on every build.
rmSync(outdir, { recursive: true, force: true });
const result = await Bun.build({ entrypoints: [resolve(root, "apps/cli/src/index.ts")], outdir, target: "node", splitting: true });
if (!result.success) {
  console.error(...result.logs);
  process.exit(1);
}
console.log(`Built ${result.outputs.length} files (${result.outputs.reduce((sum, file) => sum + file.size, 0)} bytes).`);
const host = await Bun.build({ entrypoints: [resolve(root, "apps/cli/src/host-entry.ts")], outdir,
  naming: "host.js", target: "node" });
if (!host.success) { console.error(...host.logs); process.exit(1); }
copyFileSync(resolve(root, "src/app/host/windows-launch.ps1"), resolve(outdir, "windows-launch.ps1"));
const web = Bun.spawnSync([process.execPath, "run", "--cwd", resolve(root, "apps/web"), "build"],
  { cwd: root, stdout: "inherit", stderr: "inherit" });
if (web.exitCode !== 0) process.exit(web.exitCode || 1);
cpSync(resolve(root, "apps/web/dist"), resolve(outdir, "web"), { recursive: true });
