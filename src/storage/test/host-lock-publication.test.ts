import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishHostLock } from "../src/host-lock-publication.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "whyj-host-publication-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test.skipIf(process.platform !== "win32")("Windows publication preserves existing files and directories", () => {
  const source = join(root, "candidate"), target = join(root, "owner.lock");
  mkdirSync(source); writeFileSync(join(source, "record"), "candidate");
  for (const kind of ["file", "empty-directory", "directory"]) {
    if (kind === "file") writeFileSync(target, "unknown");
    else {
      mkdirSync(target);
      if (kind === "directory") writeFileSync(join(target, "unknown"), "unknown");
    }
    expect(() => publishHostLock(source, target)).toThrow(expect.objectContaining({ code: "EEXIST" }));
    expect(readFileSync(join(source, "record"), "utf8")).toBe("candidate");
    if (kind === "file") expect(readFileSync(target, "utf8")).toBe("unknown");
    if (kind === "directory") expect(readFileSync(join(target, "unknown"), "utf8")).toBe("unknown");
    rmSync(target, { recursive: true });
  }
  publishHostLock(source, target);
  expect(readFileSync(join(target, "record"), "utf8")).toBe("candidate");
  expect(existsSync(source)).toBe(false);
});

test.skipIf(process.platform !== "win32")("Windows publication supports long paths and reports missing sources", () => {
  let base = root;
  for (let i = 0; i < 4; i++) base = join(base, `segment-${i}-${"x".repeat(55)}`);
  mkdirSync(base, { recursive: true });
  const source = join(base, "candidate"), target = join(base, "owner.lock");
  mkdirSync(source); writeFileSync(join(source, "record"), "candidate");
  expect(source.length).toBeGreaterThan(260);
  publishHostLock(source, target);
  expect(readFileSync(join(target, "record"), "utf8")).toBe("candidate");
  expect(() => publishHostLock(source, join(base, "another.lock"))).toThrow(expect.objectContaining({ code: "ENOENT" }));
});

test.skipIf(process.platform !== "win32" || process.arch !== "x64")("Host acquisition preserves unknown data, handles a vanishing conflict, and rejects denied moves", async () => {
  for (const mode of ["unknown-file", "vanishing-directory", "access-denied"]) {
    const workspace = join(root, mode); mkdirSync(workspace);
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/host-publication-race.ts"), workspace, mode], {
      stdout: "pipe", stderr: "pipe", timeout: 5_000,
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
  }
}, 20_000);
