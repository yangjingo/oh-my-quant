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
  assert.match(result.stdout, /saved mismatch evidence/);
  const phases = ["start", "shell-read", "overlay-compare", "overlay-record", "mismatch-compare", "mismatch-record", "evidence-read", "final-record", "complete"];
  const expectedStages = ["start", "helper-enter", "helper-drawing-load", "helper-interop-init", "helper-interop-ready", "helper-loaded", "shortcut-checks-complete", ...["large", "small"].flatMap(size => phases.map(phase => `${size}-${phase}`))];
  const stages = [...result.stderr.matchAll(/^WHYJ_ICON_STAGE=([a-z-]+)\r?$/gm)].map(match => match[1]);
  assert.deepEqual(stages, expectedStages);
});

test("Windows Shell icon helper emits no fixture diagnostics by default", { skip: process.platform !== "win32", timeout: 30_000 }, () => {
  const helper = fileURLToPath(new URL("../scripts/shell-icons.ps1", import.meta.url));
  const command = `. '${helper.replaceAll("'", "''")}'; [Console]::Out.WriteLine('helper-ready')`;
  const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", windowsHide: true, timeout: 20_000 });
  if (result.error) throw Object.assign(result.error, { stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "helper-ready");
  assert.equal(result.stderr, "");
});
