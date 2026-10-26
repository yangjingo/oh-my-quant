import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const configPath = join(process.cwd(), "bunfig.toml");
const config = readFileSync(configPath, "utf-8");
const required = [
  "[test]",
  'root = "."',
  '"**/gen-*.test.ts"',
  '"**/dev/**"',
  '"reference/**"',
  '"apps/desktop/**"',
  '"site/**"',
  '"output/**"',
  '".ohquant/**"',
  '"**/node_modules/**"',
];

const missing = required.filter((entry) => !config.includes(entry));
if (missing.length > 0) {
  throw new Error(`Test fence is incomplete in bunfig.toml: ${missing.join(", ")}`);
}

const srcRoot = join(process.cwd(), "src");
if (existsSync(join(process.cwd(), "scripts"))) throw new Error("Root scripts/ is retired; maintenance entrypoints belong to their src module.");
const rootTests = readdirSync(srcRoot, { withFileTypes: true })
  .filter(entry => entry.isFile() && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name));
if (rootTests.length) throw new Error(`Application entry tests must live under tests/app/: ${rootTests.map(entry => entry.name).join(", ")}`);

for (const module of readdirSync(srcRoot, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name !== "test").map(entry => entry.name)) {
  const moduleRoot = join(srcRoot, module);
  const scattered = readdirSync(moduleRoot, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name))
    .map(entry => relative(moduleRoot, join(entry.parentPath, entry.name)).replace(/\\/g, "/"))
    .filter(path => !path.startsWith("test/") && !(module === "source" && path.startsWith("tests/"))
      && !(module === "app" && /^[^/]+\/test\//.test(path)));
  if (scattered.length) throw new Error(`${module.toUpperCase()} tests must live under src/${module}/test/: ${scattered.join(", ")}`);
}

const tuiRoot = join(process.cwd(), "apps", "tui");
if (existsSync(tuiRoot)) {
  const scattered = readdirSync(tuiRoot, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name))
    .map(entry => relative(tuiRoot, join(entry.parentPath, entry.name)).replace(/\\/g, "/"))
    .filter(path => !path.startsWith("test/") && !path.startsWith("node_modules/"));
  if (scattered.length) throw new Error(`TUI tests must live under apps/tui/test/: ${scattered.join(", ")}`);
}

console.log("Test fence verified: grouped src/apps tests retained; module dev entrypoints and manual artifact generators excluded; no root scripts/.");
