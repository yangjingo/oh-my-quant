import { rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const outdir = resolve(root, "dist");
// dist is generated output; discard old content-addressed chunks on every build.
rmSync(outdir, { recursive: true, force: true });
const result = await Bun.build({ entrypoints: [resolve(root, "src/index.ts")], outdir, target: "node", splitting: true });
if (!result.success) {
  console.error(...result.logs);
  process.exit(1);
}
console.log(`Built ${result.outputs.length} files (${result.outputs.reduce((sum, file) => sum + file.size, 0)} bytes).`);
