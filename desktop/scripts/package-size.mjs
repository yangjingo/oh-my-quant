import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const app = resolve(process.argv[2] ?? join(root, "release/win-unpacked"));
const manifest = JSON.parse(readFileSync(join(root, "desktop/package.json"), "utf8"));
const version = manifest.version;
const installer = resolve(process.argv[3] ?? join(root, "release", `WhyJ-Quant-Setup-${version}-win-x64.exe`));
const output = resolve(process.argv[4] ?? join(root, "output/desktop-size/package-size.json"));
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile()) files.push({ path: relative(app, path).replaceAll("\\", "/"), bytes: statSync(path).size });
    else throw new Error(`Unexpected package entry: ${path}`);
  }
}
walk(app);
function groups(key) {
  const sizes = new Map();
  for (const file of files) {
    const name = key(file.path);
    if (name) sizes.set(name, (sizes.get(name) ?? 0) + file.bytes);
  }
  return [...sizes].map(([name, bytes]) => ({ name, bytes })).sort((a, b) => b.bytes - a.bytes);
}
const hash = createHash("sha256");
for await (const chunk of createReadStream(installer)) hash.update(chunk);
const report = {
  revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim(),
  toolchain: { platform: process.platform, arch: process.arch, node: process.version,
    bun: execFileSync("bun", ["--version"], { encoding: "utf8", windowsHide: true }).trim(),
    electron: manifest.devDependencies.electron, electronBuilder: manifest.devDependencies["electron-builder"] },
  trackedChanges: execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8", windowsHide: true }).trim(),
  installer: { name: relative(dirname(installer), installer), bytes: statSync(installer).size, sha256: hash.digest("hex") },
  unpacked: { bytes: files.reduce((sum, file) => sum + file.bytes, 0), files: files.length },
  components: groups(path => path.startsWith("resources/runtime/") ? path.split("/").slice(0, 3).join("/") : path.startsWith("resources/") ? path.split("/").slice(0, 2).join("/") : "Electron"),
  pythonPackages: groups(path => path.startsWith("resources/runtime/python/Lib/site-packages/") ? path.split("/")[5] : null),
  largestFiles: [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 20),
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
const mib = bytes => (bytes / 1024 / 1024).toFixed(2);
const summary = `### Desktop package size\n\nRevision: \`${report.revision}\`\n\nInstaller: **${mib(report.installer.bytes)} MiB**; unpacked files: **${mib(report.unpacked.bytes)} MiB** (${report.unpacked.files} files). These are file bytes, not filesystem allocation.\n\n| Component | MiB |\n| --- | ---: |\n${report.components.map(row => `| ${row.name} | ${mib(row.bytes)} |`).join("\n")}\n`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
