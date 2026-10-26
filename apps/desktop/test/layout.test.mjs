import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { onlineIdentity } from "../scripts/build-online.mjs";

test("distribution paths stay at the repository root regardless of the caller directory", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const cwd = process.cwd();
  const temporary = mkdtempSync(join(tmpdir(), "whyj-desktop-layout-"));
  try {
    process.chdir(temporary);
    assert.equal(onlineIdentity("1.4.0").output, join(root, "release/WhyJ-Quant-Online-1.4.0-win-x64.exe"));
    assert.equal(onlineIdentity("1.4.0", "http://127.0.0.1:1234/payload").output,
      join(root, "output/desktop-online/online-fixture-test.exe"));
  } finally {
    process.chdir(cwd);
    assert.equal(resolve(temporary, ".."), resolve(tmpdir()));
    rmSync(temporary, { recursive: true, force: true });
  }
});
