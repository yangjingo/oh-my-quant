import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const desktop = resolve(import.meta.dir, "..");
const root = resolve(desktop, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const appManifest = JSON.parse(readFileSync(resolve(desktop, "package.json"), "utf8"));
if (manifest.version !== appManifest.version) throw new Error("CLI and desktop versions must match");
mkdirSync(resolve(desktop, "dist"), { recursive: true });
mkdirSync(resolve(desktop, "runtime"), { recursive: true });
for (const entry of ["main", "preload"]) {
  const result = await Bun.build({ entrypoints: [resolve(desktop, `src/${entry}.ts`)], outdir: resolve(desktop, "dist"),
    target: "node", format: "cjs", naming: `${entry}.cjs`, external: ["electron", "node-pty"] });
  if (!result.success) throw new AggregateError(result.logs, `${entry} build failed`);
}
const renderer = await Bun.build({ entrypoints: [resolve(desktop, "src/renderer.ts")], outdir: resolve(desktop, "dist"),
  target: "browser", format: "iife", minify: true });
if (!renderer.success) throw new AggregateError(renderer.logs, "Renderer build failed");
for (const name of ["index.html", "style.css"]) copyFileSync(resolve(desktop, "src", name), resolve(desktop, "dist", name));
copyFileSync(resolve(desktop, "node_modules/@xterm/xterm/css/xterm.css"), resolve(desktop, "dist/xterm.css"));
copyFileSync(resolve(desktop, "assets/app-icon.ico"), resolve(desktop, "dist/app-icon.ico"));
copyFileSync(resolve(desktop, "assets/logo-mark.svg"), resolve(desktop, "dist/logo-mark.svg"));
const child = Bun.spawn([process.execPath, "build", resolve(root, "src/index.ts"), "--compile", "--target=bun-windows-x64-baseline",
  "--compile-executable-path", resolve(desktop, ".downloads/bun/bun-windows-x64-baseline/bun.exe"),
  "--outfile", resolve(desktop, "runtime/whyj.exe")], { cwd: root, stdout: "inherit", stderr: "inherit" });
if (await child.exited !== 0) throw new Error("Standalone CLI build failed");
mkdirSync(resolve(desktop, "runtime/notes/quant"), { recursive: true });
for (const name of ["funder.md", "notes.md"]) copyFileSync(resolve(root, "notes/quant", name), resolve(desktop, "runtime/notes/quant", name));
copyFileSync(resolve(root, "LICENSE"), resolve(desktop, "runtime/LICENSE"));
console.log(`Desktop ${manifest.version} built`);
