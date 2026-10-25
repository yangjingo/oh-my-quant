import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dir, "../..");
function list(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? list(join(directory, entry.name)) : [join(directory, entry.name)]);
}

test("all module-local TypeScript development tools retain resolvable import closures without execution", async () => {
  const entries = [...list(join(root, "src")), ...list(join(root, "apps/tui"))].filter(path => path.replaceAll("\\", "/").includes("/dev/") && path.endsWith(".ts"));
  expect(entries.length).toBeGreaterThan(0);
  const built = await Bun.build({ entrypoints: entries, target: "bun" });
  expect(built.logs.filter(log => log.level === "error")).toEqual([]);
  expect(built.success).toBe(true);
}, 30000);

test("the shipped CLI does not include module development tools or repository test code", async () => {
  const loaded: string[] = [];
  const built = await Bun.build({ entrypoints: [join(root, "src/index.ts")], target: "node",
    plugins: [{ name: "inspect-production-closure", setup(build) {
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, args => {
        const path = relative(root, args.path).replaceAll("\\", "/");
        if (path.startsWith("src/") || path.startsWith("apps/") || path.startsWith("tests/")) loaded.push(path);
      });
    } }],
  });
  expect(built.success).toBe(true);
  expect(loaded).toContain("src/index.ts");
  expect(loaded).toContain("apps/tui/src/tui.ts");
  expect(loaded.filter(path => path.startsWith("tests/") || /\/(?:dev|test|tests)\//.test(path))).toEqual([]);
}, 30000);

test("default and npm test discovery include moved TUI tests but exclude manual, vendored and generated trees", () => {
  const fixture = mkdtempSync(join(tmpdir(), "whyj-test-discovery-"));
  function file(path: string, text: string): void {
    const target = join(fixture, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  try {
    file("bunfig.toml", readFileSync(join(root, "bunfig.toml"), "utf8"));
    const pass = 'import { test } from "bun:test"; test("selected fixture", () => {});';
    file("src/example/test/module.test.ts", pass);
    file("tests/app/integration.test.ts", pass);
    file("apps/tui/test/render.test.ts", pass);
    for (const directory of ["src/example/dev", "apps/tui/dev", "apps/tui/node_modules/example", "reference", "desktop", "site", "output", ".ohquant", "node_modules/example"]) {
      file(`${directory}/unwanted.test.ts`, 'throw new Error("manual or external tree must not execute");');
    }
    file("src/example/test/gen-example.test.ts", 'throw new Error("manual artifact must not execute");');
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const npmScope = manifest.scripts.test.split("bun test ")[1].trim().split(/\s+/);
    for (const scope of [[], npmScope]) {
      const run = Bun.spawnSync([process.execPath, "test", ...scope], { cwd: fixture, stdout: "pipe", stderr: "pipe", timeout: 10000 });
      const output = new TextDecoder().decode(run.stderr);
      expect(run.exitCode).toBe(0);
      expect(output).toContain("3 pass");
      expect(output).toContain("0 fail");
    }
  } finally {
    if (!resolve(fixture).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected discovery fixture directory");
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("npm script entrypoints keep source and root integration scopes explicit", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const name of ["dev", "build", "start", "test", "check", "typecheck", "check:architecture", "test:fence", "test:modules", "test:integration", "docs:build", "check:docs"]) {
    expect(typeof manifest.scripts[name]).toBe("string");
  }
  expect(manifest.scripts.test).toContain("bun test ./src ./apps/tui ./tests");
  expect(manifest.scripts["test:modules"]).toBe("bun test ./src ./apps/tui");
  expect(manifest.scripts["test:integration"]).toBe("bun test ./tests");
  expect(manifest.scripts.start).toBe("node dist/index.js");
  expect(Object.values(manifest.scripts).filter(command => typeof command === "string" && /\b(?:run|node) scripts\//.test(command))).toEqual([]);
});
