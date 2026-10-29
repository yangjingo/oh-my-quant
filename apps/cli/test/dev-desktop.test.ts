import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { superviseDesktop } from "../dev/desktop.ts";

test("development shutdown asks its own child to quit and waits for cleanup", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-dev-desktop-")), fixture = join(root, "child.cjs"), ready = join(root, "ready"), done = join(root, "done");
  writeFileSync(fixture, `const fs = require("node:fs");\nprocess.on("message", m => { if (m?.type === "whyj-development-quit") { fs.writeFileSync(process.argv[3], "quit"); process.exit(0); } });\nfs.writeFileSync(process.argv[2], "ready");\nsetInterval(() => {}, 1000);`);
  const controller = new AbortController();
  try {
    const completion = superviseDesktop(process.execPath, [fixture, ready, done], root, controller.signal);
    for (let n = 0; n < 250 && !existsSync(ready); n++) await Bun.sleep(20);
    expect(existsSync(ready)).toBe(true);
    controller.abort(); expect(await completion).toBe(0);
    expect(readFileSync(done, "utf8")).toBe("quit");
  } finally { controller.abort(); rmSync(root, { recursive: true, force: true }); }
}, 15000);

test("a Desktop child failure is returned to the caller", async () => {
  expect(await superviseDesktop(process.execPath, ["-e", "process.exit(7)"], process.cwd())).toBe(7);
});
