import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { checkPackageLayout } from "../scripts/package-layout.mjs";

test("package check rejects stale, modified, private and PTY assets", () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-package-layout-"));
  try {
    const app = join(root, "app"), runtime = join(app, "resources/runtime"), sourceWeb = join(root, "web"), packageWeb = join(runtime, "web");
    mkdirSync(sourceWeb, { recursive: true }); mkdirSync(packageWeb, { recursive: true });
    writeFileSync(join(sourceWeb, "index.html"), "current"); writeFileSync(join(packageWeb, "index.html"), "current");
    const check = (archivePaths = []) => checkPackageLayout({ app, runtime, sourceWeb, archivePaths });
    assert.doesNotThrow(() => check(["/dist/main.cjs"]));
    writeFileSync(join(packageWeb, "stale.js"), "stale"); assert.throws(() => check(), /Packaged Web assets differ/);
    rmSync(join(packageWeb, "stale.js")); writeFileSync(join(packageWeb, "index.html"), "different"); assert.throws(() => check(), /Changed packaged Web asset/);
    writeFileSync(join(packageWeb, "index.html"), "current"); writeFileSync(join(runtime, ".env"), "fixture");
    assert.throws(() => check(), /Private workspace or environment file shipped/); rmSync(join(runtime, ".env"));
    assert.throws(() => check(["\\node_modules\\node-pty\\index.js"]), /Development terminal dependency shipped/);
    assert.throws(() => check(["/workspace/.ohquant/settings.json"]), /Private workspace or environment file shipped/);
    assert.throws(() => check(["/workspace/sessions/session.jsonl"]), /Private workspace or environment file shipped/);
  } finally {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw Error("Unexpected fixture root");
    rmSync(root, { recursive: true, force: true });
  }
});
