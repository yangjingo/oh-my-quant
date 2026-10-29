import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPackageLayout, files } from "./package-layout.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const app = resolve(process.argv[2] ?? join(root, "release/win-unpacked"));
const runtime = join(app, "resources/runtime");
assert.equal(existsSync(join(runtime, "git")), false, "Git must not be bundled, including stale preparation output");
assert.deepEqual(JSON.parse(readFileSync(join(runtime, "sources.json"), "utf8")).map(source => source.Name).sort(), ["bun", "python"]);
for (const name of ["tar", "chownr", "minipass", "minizlib", "yallist", "@isaacs/fs-minipass"]) {
  assert.ok(readdirSync(join(runtime, "licenses", name)).some(file => file.startsWith("LICENSE")), `Missing archive dependency license: ${name}`);
}
const packages = join(runtime, "python/Lib/site-packages");
assert.deepEqual(readdirSync(join(app, "locales")).filter(name => name.endsWith(".pak")).sort(), ["en-US.pak", "zh-CN.pak", "zh-TW.pak"]);
// Validate the actual archive and unpacked package, not just the build configuration.
const asar = createRequire(import.meta.url)("@electron/asar");
checkPackageLayout({ app, runtime, sourceWeb: join(root, "apps/web/dist"), archivePaths: asar.listPackage(join(app, "resources/app.asar")) });
for (const name of ["numpy", "pandas", "pyarrow"]) {
  for (const path of files(join(packages, name))) assert.ok(!/(^|\/)tests\//.test(path), `Dependency tests shipped: ${name}/${path}`);
}
for (const path of files(join(packages, "pyarrow"))) {
  assert.ok(!/^(include|includes|src)\//.test(path) && !/\.(lib|pxd|pyx|pxi|h)$/.test(path), `Arrow build file shipped: ${path}`);
}
for (const folder of ["plotly/labextension/static", "share/jupyter/labextensions/jupyterlab-plotly/static"]) {
  assert.ok(files(join(packages, folder)).every(path => !path.endsWith(".js")), `Unbundled JupyterLab extension shipped: ${folder}`);
  assert.ok(existsSync(join(packages, folder, "third-party-licenses.json")), `Missing Plotly extension license: ${folder}`);
}
// Package metadata/licenses and all non-test native/data assets must survive.
const sourcePackages = join(root, "apps/desktop/runtime/python/Lib/site-packages");
for (const path of files(sourcePackages)) {
  if (/(^|\/)tests\//.test(path) || /(^|\/)__pycache__\//.test(path)) continue;
  if (/^[^/]+\.dist-info\//.test(path) || /\.(dll|pyd|dat)$/.test(path)) {
    assert.ok(existsSync(join(packages, path)), `Missing Python metadata/native resource: ${path}`);
  }
}
const options = { cwd: root, stdio: "inherit", windowsHide: true, timeout: 180_000,
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } };
execFileSync(join(runtime, "python/python.exe"), [join(root, "apps/desktop/scripts/check-python-runtime.py")], options);
execFileSync("bun", ["run", "src/alpha/dev/check-akquant.ts", "--python", join(runtime, "python/python.exe")], options);
console.log("PASS packaged layout, licenses, native resources and Python runtime behavior");
