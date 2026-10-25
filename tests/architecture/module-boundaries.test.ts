import { afterEach, beforeEach, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

const project = resolve(import.meta.dir, "../..");
let root: string;

function file(path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "whyj-module-boundaries-"));
  mkdirSync(join(root, "tests", "architecture"), { recursive: true });
  mkdirSync(join(root, "src"));
  for (const name of ["check-architecture.ts", "check-test-fence.ts"]) {
    copyFileSync(join(project, "tests", "architecture", name), join(root, "tests", "architecture", name));
  }
  file("package.json", JSON.stringify({ dependencies: {
    "@earendil-works/pi-agent-core": "1.2.0", "@earendil-works/pi-ai": "1.2.0",
  } }));
  file("tsconfig.json", "{}");
  file("bunfig.toml", '[test]\nroot = "."\npathIgnorePatterns = ["**/gen-*.test.ts", "**/dev/**", "reference/**", "desktop/**", "site/**", "output/**", ".ohquant/**", "**/node_modules/**"]\n');
});

afterEach(() => {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected boundary fixture root.");
  rmSync(root, { recursive: true, force: true });
});

function check(script = "check-architecture.ts") {
  const result = Bun.spawnSync([process.execPath, join(root, "tests", "architecture", script)], {
    cwd: root, stdout: "pipe", stderr: "pipe", timeout: 10_000,
  });
  return { code: result.exitCode, error: new TextDecoder().decode(result.stderr) };
}

test.each(["performance", "alpha", "execution", "extensions", "skill", "quant"])("%s consumers use the public entry, including type exports", feature => {
  file(`src/${feature}/internal.ts`, "export type Contract = string;");
  file(`src/${feature}/index.ts`, 'export type { Contract } from "./internal.ts";');
  file("src/runtime/host.ts", `import type { Contract } from "../${feature}/index.ts";`);
  expect(check().code).toBe(0);
  file("src/runtime/host.ts", `export type { Contract } from "../${feature}/internal.ts";`);
  const rejected = check();
  expect(rejected.code).toBe(1);
  expect(rejected.error).toContain("feature-public-entry");
});

test.each(["../other/test/fixture.ts", "./fixture.test.ts", "./tests/fixture.ts", "../../tests/architecture/fixture.ts", "../../tests/app/fixtures/fixture.ts", "bun:test"])("production cannot import %s", specifier => {
  if (specifier !== "bun:test") file(`src/runtime/${specifier}`, "export const fixture = 1;");
  file("src/runtime/host.ts", `import "${specifier}";`);
  expect(check()).toMatchObject({ code: 1, error: expect.stringContaining("production-does-not-import-tests") });
});

test("performance can consume pure helpers; file IO and new feature dependencies fail closed", () => {
  file("src/quant/performance.ts", "export const metric = 1;");
  file("src/quant/index.ts", 'export { metric } from "./performance.ts";');
  file("src/performance/read.ts", 'import { isDeepStrictEqual } from "node:util"; import { metric } from "../quant/index.ts";');
  expect(check().code).toBe(0);
  for (const specifier of ["node:fs", "fs/promises", "some-provider", "../new-feature/index.ts"]) {
    file("src/new-feature/index.ts", "export const provider = 1;");
    file("src/performance/read.ts", `import "${specifier}";`);
    expect(check()).toMatchObject({ code: 1, error: expect.stringContaining("performance-consumes-explicit-inputs") });
  }
});

test("research cannot consume private account results even through the public entry", () => {
  file("src/performance/index.ts", "export const result = 1;");
  file("src/research/report.ts", 'import { result } from "../performance/index.ts";');
  expect(check()).toMatchObject({ code: 1, error: expect.stringContaining("private-account-data-stays-out-of-research") });
});

test.each(["cli", "skill", "quant", "insight", "runtime", "tools", "research", "market", "new-feature"])("%s test fence accepts grouped tests and rejects root or handler tests", module => {
  file(`src/${module}/test/handlers/command.test.ts`, "// grouped test");
  expect(check("check-test-fence.ts").code).toBe(0);
  for (const path of [`src/${module}/command.test.ts`, `src/${module}/handlers/command.spec.ts`]) {
    file(path, "// scattered test");
    expect(check("check-test-fence.ts")).toMatchObject({ code: 1, error: expect.stringContaining(`${module.toUpperCase()} tests must live under src/${module}/test/`) });
    rmSync(join(root, path));
  }
});

test("skill permits the archive parser but rejects arbitrary external dependencies", () => {
  file("src/skill/service.ts", 'import { extract } from "tar";');
  expect(check().code).toBe(0);
  file("src/skill/service.ts", 'import host from "some-host";');
  expect(check()).toMatchObject({ code: 1, error: expect.stringContaining("skill-is-independent-of-host") });
});

test.each(["agent", "runtime", "source", "storage", "cli", "new-feature"])("skill cannot import the %s host, even as a type", module => {
  file(`src/${module}/host.ts`, "export type Host = string;");
  file("src/skill/service.ts", `import type { Host } from "../${module}/host.ts";`);
  expect(check()).toMatchObject({ code: 1, error: expect.stringContaining("skill-is-independent-of-host") });
});

test("skill cannot hide a CLI result dependency behind shared types", () => {
  file("src/types/commands.ts", "export type CommandResult = string;");
  file("src/skill/service.ts", 'import type { CommandResult } from "../types/commands.ts";');
  expect(check()).toMatchObject({ code: 1, error: expect.stringContaining("skill-is-independent-of-host") });
});

test.each(["../insight/index.ts", "../runtime/host.ts", "../new-feature/index.ts", "node:fs", "fs/promises", "bun", "some-provider", "../types/commands.ts"])("quant cannot import or re-export host dependencies: %s", specifier => {
  if (specifier.startsWith(".")) file(`src/quant/${specifier}`, "export type Host = string;");
  file("src/quant/index.ts", `export type { Host } from "${specifier}";`);
  expect(check()).toMatchObject({ code: 1, error: expect.stringContaining("quant-consumes-explicit-data") });
});

test("quant accepts explicit data contracts and market normalization, but JS specifiers cannot bypass its public entry", () => {
  file("src/types/data.ts", "export type Price = number;");
  file("src/market/bars.ts", "export const normalize = (n: number) => n;");
  file("src/quant/internal.ts", 'import type { Price } from "../types/data.ts"; import { normalize } from "../market/bars.ts"; export const calculate = normalize;');
  file("src/quant/index.ts", 'export { calculate } from "./internal.ts";');
  file("src/runtime/host.ts", 'import { calculate } from "../quant/index.js";');
  expect(check().code).toBe(0);
  file("src/runtime/host.ts", 'import { calculate } from "../quant/internal.js";');
  expect(check()).toMatchObject({ code: 1, error: expect.stringContaining("feature-public-entry") });
});

test.each(["cli", "tui"])("runtime cannot import %s implementation or UI-owned contracts", module => {
  file(`src/${module}/types.ts`, "export type State = string;");
  file("src/runtime/host.ts", `import type { State } from "../${module}/types.ts";`);
  expect(check()).toMatchObject({ code: 1, error: expect.stringContaining("runtime-does-not-depend-on-ui") });
});

test.each(["runtime", "tools", "cli", "tui"])("agent cannot import %s host composition", module => {
  file(`src/${module}/host.ts`, "export const host = 1;");
  file("src/agent/session.ts", `import { host } from "../${module}/host.ts";`);
  expect(check()).toMatchObject({ code: 1, error: expect.stringContaining("agent-does-not-compose-application") });
});

test("test fence preserves source and app feature ownership and rejects loose application entry tests", () => {
  file("src/source/tests/provider.test.ts", "// provider");
  file("src/app/paper/test/adapter.test.ts", "// app feature");
  file("tests/app/entry.test.ts", "// application host");
  expect(check("check-test-fence.ts").code).toBe(0);
  file("src/entry.test.ts", "// loose test");
  expect(check("check-test-fence.ts")).toMatchObject({ code: 1, error: expect.stringContaining("Application entry tests must live under tests/app/") });
});

test("evaluation consumes answer checks without becoming a dependency of the application", () => {
  file("src/runtime/evidence/claims.ts", "export const check = () => [];");
  file("src/runtime/evaluation/runner.ts", 'import { check } from "../evidence/claims.ts"; export const run = check;');
  expect(check().code).toBe(0);
  file("src/runtime/evidence/claims.ts", 'export { run } from "../evaluation/runner.ts";');
  const rejected = check();
  expect(rejected.code).toBe(1);
  expect(rejected.error).toContain("evaluation-is-not-runtime-dependency");
  expect(rejected.error).toContain("answer-evidence-is-independent");
});

test("module-local dev consumers may compose hosts, but production cannot import them", () => {
  file("src/cli/registry.ts", "export const command = 1;");
  file("src/tui/view.ts", "export const view = 1;");
  file("src/runtime/dev/check.ts", 'import { command } from "../../cli/registry.ts"; import { view } from "../../tui/view.ts"; import "bun:test";');
  expect(check().code).toBe(0);
  for (const source of [
    'import "./dev/check.ts";',
    'export type { Check } from "./dev/check.ts";',
    'const probe = import("./dev/check.ts");',
  ]) {
    file("src/runtime/host.ts", source);
    expect(check()).toMatchObject({ code: 1, error: expect.stringContaining("production-does-not-import-dev") });
  }
});

test("test fence rejects root maintenance scripts and a missing dev exclusion", () => {
  expect(check("check-test-fence.ts").code).toBe(0);
  file("scripts/old.ts", "// retired layout");
  expect(check("check-test-fence.ts")).toMatchObject({ code: 1, error: expect.stringContaining("Root scripts/ is retired") });
  rmSync(join(root, "scripts"), { recursive: true });
  file("bunfig.toml", '[test]\nroot = "src"\npathIgnorePatterns = ["**/gen-*.test.ts"]\n');
  expect(check("check-test-fence.ts")).toMatchObject({ code: 1, error: expect.stringContaining("Test fence is incomplete") });
});
