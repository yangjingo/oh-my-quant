import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

for (const mode of ["vanished", "denied", "io-error", "missing-parent", "cancel-before-list", "cancel-during-stat", "normal"]) {
  test(`directory listing preserves its result boundary: ${mode}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "whyj-directory-list-"));
    const fixture = join(import.meta.dir, "fixtures", "directory-list-race.ts");
    let child: ReturnType<typeof Bun.spawn> | undefined;
    try {
      writeFileSync(join(root, "surviving.jsonl"), "fixture"); mkdirSync(join(root, "transient.lock"));
      const spawned = Bun.spawn([process.execPath, fixture, root, mode], { stdout: "pipe", stderr: "pipe" });
      child = spawned;
      const [code, output, error] = await Promise.all([spawned.exited, new Response(spawned.stdout).text(), new Response(spawned.stderr).text()]);
      expect(code).toBe(0); expect(error).toBe("");
      const result = JSON.parse(output);
      if (mode === "vanished") expect(result).toEqual({ ok: true, names: ["surviving.jsonl"] });
      else if (mode === "normal") expect(result).toEqual({ ok: true, names: ["surviving.jsonl", "transient.lock"] });
      else {
        expect(result.ok).toBe(false);
        expect(result.code).toBe(mode.startsWith("cancel") ? "aborted" : mode === "missing-parent" ? "not_found" : mode === "denied" ? "permission_denied" : "unknown");
        expect(result.path).toBe(mode.startsWith("cancel") ? root : join(root, mode === "missing-parent" ? "missing" : "transient.lock"));
      }
    } finally {
      if (child && child.exitCode === null) child.kill(9);
      await child?.exited;
      if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected directory fixture path");
      rmSync(root, { recursive: true, force: true });
    }
  });
}
