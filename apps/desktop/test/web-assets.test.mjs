import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { replaceWebAssets } from "../scripts/web-assets.mts";

test("repeated builds replace stale Web assets without touching other runtime files", () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-web-assets-"));
  try {
    const desktop = join(root, "desktop"), source = join(root, "source"), runtime = join(desktop, "runtime");
    mkdirSync(source, { recursive: true }); mkdirSync(join(runtime, "web"), { recursive: true });
    writeFileSync(join(source, "index.html"), "current"); writeFileSync(join(runtime, "web/stale.js"), "old");
    writeFileSync(join(runtime, "other-runtime"), "keep");
    assert.throws(() => replaceWebAssets(desktop, join(root, "missing")));
    assert.equal(readFileSync(join(runtime, "web/stale.js"), "utf8"), "old");
    replaceWebAssets(desktop, source);
    assert.equal(readFileSync(join(runtime, "web/index.html"), "utf8"), "current");
    assert.equal(existsSync(join(runtime, "web/stale.js")), false);
    assert.equal(readFileSync(join(runtime, "other-runtime"), "utf8"), "keep");
    writeFileSync(join(source, "index.html"), "updated"); replaceWebAssets(desktop, source);
    assert.equal(readFileSync(join(runtime, "web/index.html"), "utf8"), "updated");
  } finally {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw Error("Unexpected fixture root");
    rmSync(root, { recursive: true, force: true });
  }
});

test("a linked Web destination is refused and its external content stays intact", t => {
  const root = mkdtempSync(join(tmpdir(), "whyj-web-link-"));
  try {
    const desktop = join(root, "desktop"), source = join(root, "source"), runtime = join(desktop, "runtime"), outside = join(root, "outside");
    for (const path of [source, runtime, outside]) mkdirSync(path, { recursive: true });
    writeFileSync(join(outside, "keep.txt"), "keep"); writeFileSync(join(source, "index.html"), "current");
    try { symlinkSync(outside, join(runtime, "web"), process.platform === "win32" ? "junction" : "dir"); }
    catch (error) { if (["EPERM", "EACCES"].includes(error.code)) return t.skip("Directory links unavailable"); throw error; }
    assert.throws(() => replaceWebAssets(desktop, source), /Invalid Desktop Web runtime directory/);
    assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "keep");
  } finally {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw Error("Unexpected fixture root");
    rmSync(root, { recursive: true, force: true });
  }
});
