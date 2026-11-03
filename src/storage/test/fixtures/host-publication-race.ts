import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHostRuntimeStore } from "../../src/host-runtime.ts";

// Run in a separate process: the hook inserts an entry immediately before the
// real Windows move and may remove it before acquire observes the conflict.
const [root, mode] = process.argv.slice(2);
assert.ok(root && (mode === "unknown-file" || mode === "vanishing-directory" || mode === "access-denied"));
const store = createHostRuntimeStore(root), target = join(root, ".host", "owner.lock");
const native = require("koffi/build/koffi/win32_x64/koffi.node");
const load = native.load;
let calls = 0;
native.load = (name: string) => {
  const library = load(name), func = library.func.bind(library);
  return { func(...args: unknown[]) {
    if (args[1] === "GetLastError" && mode === "access-denied") return () => 5;
    const move = func(...args);
    if (args[1] !== "MoveFileW") return move;
    return (...paths: string[]) => {
      calls++;
      if (mode === "access-denied") return 0;
      if (calls !== 1) return move(...paths);
      if (mode === "unknown-file") writeFileSync(target, "unknown", { flag: "wx" });
      else { mkdirSync(target); writeFileSync(join(target, "sentinel"), "temporary"); }
      assert.equal(move(...paths), 0);
      if (mode === "vanishing-directory") { unlinkSync(join(target, "sentinel")); rmdirSync(target); }
      return 0;
    };
  } };
};

if (mode === "access-denied") {
  let code: string | undefined;
  try { store.acquire("owner"); } catch (error) { code = (error as NodeJS.ErrnoException).code; }
  assert.equal(code, "EPERM"); assert.equal(calls, 1); assert.equal(existsSync(target), false);
} else if (mode === "unknown-file") {
  let code: string | undefined;
  try { store.acquire("owner"); } catch (error) { code = (error as NodeJS.ErrnoException).code; }
  assert.equal(code, "HOST_METADATA_INVALID");
  assert.equal(readFileSync(target, "utf8"), "unknown");
  assert.equal(calls, 1);
} else {
  const lease = store.acquire("owner");
  try { lease.assertOwned(); assert.equal(calls, 2); } finally { lease.release(); }
  assert.equal(existsSync(target), false);
}
