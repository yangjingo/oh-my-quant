import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

test("Windows shortcut resources and Shell icons match the shared brand", { skip: process.platform !== "win32", timeout: 30_000 }, t => {
  const root = mkdtempSync(join(tmpdir(), "whyj-icon-fixture-"));
  const realRoot = realpathSync(root), realTemp = realpathSync(tmpdir());
  t.after(() => {
    assert.equal(realpathSync(root), realRoot);
    assert.equal(dirname(realRoot), realTemp);
    assert.ok(basename(realRoot).startsWith("whyj-icon-fixture-"));
    rmSync(realRoot, { recursive: true });
  });
  const fixture = fileURLToPath(new URL("./shell-icons-fixture.ps1", import.meta.url));
  const icon = fileURLToPath(new URL("../assets/app-icon.ico", import.meta.url));
  const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", fixture, "-Root", root, "-Icon", icon],
    { encoding: "utf8", windowsHide: true, timeout: 20_000 });
  if (result.error) throw Object.assign(result.error, { stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS Unicode shortcut identity/);
  for (const stage of ["start", "helper-loaded", "shortcut-checks-complete", "large-start", "large-complete", "small-start", "small-complete"]) {
    assert.ok(result.stderr.includes(`WHYJ_ICON_STAGE=${stage}`), `Missing icon stage ${stage}`);
  }
});
