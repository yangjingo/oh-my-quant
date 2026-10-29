import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function files(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = prefix + entry.name;
    if (entry.isDirectory()) return files(join(dir, entry.name), path + "/");
    if (entry.isFile()) return [path];
    throw Error(`Unexpected package entry: ${path}`);
  });
}

/** Inspect the unpacked package, ASAR file list and exact generated Web build. */
export function checkPackageLayout({ app, runtime, sourceWeb, archivePaths }) {
  const packagePaths = [...files(app), ...archivePaths.map(path => path.replaceAll("\\", "/"))];
  for (const path of packagePaths) {
    assert.ok(!/(^|\/)node_modules\/(?:node-pty|@xterm)(?:\/|$)/.test(path), `Development terminal dependency shipped: ${path}`);
    assert.ok(!/(^|\/)(?:\.ohquant|\.git)(?:\/|$)|(^|\/)\.env(?:\.(?:local|development|production|test))?$|(^|\/)(?:sessions|history)\/[^/]+\.jsonl$/.test(path), `Private workspace or environment file shipped: ${path}`);
  }
  const packageWeb = join(runtime, "web"), sourceFiles = files(sourceWeb).sort(), packagedFiles = files(packageWeb).sort();
  assert.deepEqual(packagedFiles, sourceFiles, "Packaged Web assets differ from the current build");
  const sha256 = path => createHash("sha256").update(readFileSync(path)).digest("hex");
  for (const path of sourceFiles) assert.equal(sha256(join(packageWeb, path)), sha256(join(sourceWeb, path)), `Changed packaged Web asset: ${path}`);
}
