import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const app = resolve(process.argv[2] ?? join(root, "release/win-unpacked"));
const runtime = join(app, "resources/runtime");
const packages = join(runtime, "python/Lib/site-packages");
const pty = join(app, "resources/app.asar.unpacked/node_modules/node-pty");
assert.deepEqual(readdirSync(join(app, "locales")).filter(name => name.endsWith(".pak")).sort(), ["en-US.pak", "zh-CN.pak", "zh-TW.pak"]);
function files(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = prefix + entry.name;
    return entry.isDirectory() ? files(join(dir, entry.name), path + "/") : [path];
  });
}
// Validate the actual packager output, including resources loaded dynamically.
for (const path of ["LICENSE", "deps/winpty/LICENSE", "lib/index.js", "lib/conpty_console_list_agent.js",
  "prebuilds/win32-x64/conpty.node", "prebuilds/win32-x64/conpty_console_list.node",
  "prebuilds/win32-x64/pty.node", "prebuilds/win32-x64/winpty.dll", "prebuilds/win32-x64/winpty-agent.exe",
  "prebuilds/win32-x64/conpty/conpty.dll", "prebuilds/win32-x64/conpty/OpenConsole.exe"]) {
  assert.ok(existsSync(join(pty, path)), `Missing PTY runtime/license: ${path}`);
}
for (const path of files(pty)) {
  assert.ok(!/^(src|scripts|third_party|typings)\//.test(path) && !/\.test\.js(?:\.map)?$/.test(path), `PTY development file shipped: ${path}`);
  assert.ok(!/^prebuilds\/(?!win32-x64\/)/.test(path), `Wrong-platform PTY file: ${path}`);
}
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
const sourcePackages = join(root, "desktop/runtime/python/Lib/site-packages");
for (const path of files(sourcePackages)) {
  if (/(^|\/)tests\//.test(path) || /(^|\/)__pycache__\//.test(path)) continue;
  if (/^[^/]+\.dist-info\//.test(path) || /\.(dll|pyd|dat)$/.test(path)) {
    assert.ok(existsSync(join(packages, path)), `Missing Python metadata/native resource: ${path}`);
  }
}
const options = { cwd: root, stdio: "inherit", windowsHide: true, timeout: 180_000,
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } };
execFileSync(join(runtime, "python/python.exe"), [join(root, "desktop/scripts/check-python-runtime.py")], options);
execFileSync("bun", ["run", "src/alpha/dev/check-akquant.ts", "--python", join(runtime, "python/python.exe")], options);
console.log("PASS packaged layout, licenses, native resources and Python runtime behavior");
