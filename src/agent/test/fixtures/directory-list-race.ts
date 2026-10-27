import { mock } from "bun:test";
import * as fs from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const [root, mode] = process.argv.slice(2) as [string, string];
const original = { ...fs }, controller = new AbortController();
const transient = join(root, "transient.lock");
mock.module("node:fs/promises", () => ({
  ...original,
  async lstat(path: Parameters<typeof fs.lstat>[0], ...rest: unknown[]) {
    if (resolve(String(path)) === resolve(transient)) {
      if (mode === "vanished" || mode === "cancel-during-stat") {
        // Remove only this fixture's empty directory after enumeration found it.
        await original.rmdir(transient);
        if (mode === "cancel-during-stat") controller.abort();
      } else if (mode === "denied" || mode === "io-error") {
        throw Object.assign(new Error("Injected child stat failure"), { code: mode === "denied" ? "EACCES" : "EIO" });
      }
    }
    return (original.lstat as (...args: unknown[]) => unknown)(path, ...rest);
  },
}));
const { NodeExecutionEnv } = await import("../../src/session-runtime/node.ts");
if (mode === "cancel-before-list") controller.abort();
const result = await new NodeExecutionEnv({ cwd: root }).listDir(mode === "missing-parent" ? join(root, "missing") : root, controller.signal);
process.stdout.write(JSON.stringify(result.ok ? { ok: true, names: result.value.map(entry => basename(entry.path)).sort() }
  : { ok: false, code: result.error.code, path: result.error.path, message: result.error.message }));
