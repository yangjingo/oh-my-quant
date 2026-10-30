import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

test("a timed-out CLI cwd fixture drains its child before the next test", async () => {
  const tempRoot = resolve(tmpdir());
  const cwd = mkdtempSync(join(tempRoot, "whyj-cli-owner-"));
  if (dirname(cwd) !== tempRoot || !basename(cwd).startsWith("whyj-cli-owner-")) throw new Error("Unexpected temporary path");
  try {
    const helper = fileURLToPath(new URL("../../src/app/services/test/fixture-lifetime.ts", import.meta.url));
    const fixture = join(cwd, "cwd.test.ts");
    writeFileSync(fixture, `import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createFixtureLifetime } from ${JSON.stringify(helper)};
const lifetime = createFixtureLifetime(3000), original = process.cwd(), tempRoot = resolve(tmpdir());
const foreign = mkdtempSync(join(tempRoot, "whyj-cli-owned-cwd-"));
if (dirname(foreign) !== tempRoot || !basename(foreign).startsWith("whyj-cli-owned-cwd-")) throw new Error("Unexpected temporary path");
let childExited = false, bodyDone = false;
afterEach(async () => { if (process.env.DRAIN_CWD === "true") await lifetime.drain(); });
test("timed-out CLI", lifetime.track(async () => {
  try {
    process.chdir(foreign);
    const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(1000)"], { cwd: original, stdout: "pipe", stderr: "pipe", timeout: 2000 });
    await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    childExited = true;
    await Bun.sleep(250);
  } finally { process.chdir(original); rmSync(foreign, { recursive: true, force: true }); bodyDone = true; }
}), 50);
test("next", async () => {
  const leaked = process.cwd() === foreign, doneBeforeNext = bodyDone;
  await Bun.sleep(400);
  console.log("CWD_TRACE:" + JSON.stringify({ leaked, doneBeforeNext, restored: process.cwd() === original, childExited }));
}, 3000);
`);
    for (const [drain, expected] of [[false, { leaked: true, doneBeforeNext: false, restored: true, childExited: true }],
      [true, { leaked: false, doneBeforeNext: true, restored: true, childExited: true }]] as const) {
      const child = Bun.spawn({ cmd: [process.execPath, "test", fixture], cwd,
        env: { ...process.env, DRAIN_CWD: String(drain) }, stdout: "pipe", stderr: "pipe" });
      const watchdog = setTimeout(() => child.kill(), 5000);
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]).finally(() => clearTimeout(watchdog));
      expect(code).toBe(1); // The first child test deliberately times out.
      expect(stderr + stdout).toContain("timed out after 50ms");
      expect(stderr + stdout).toContain(`CWD_TRACE:${JSON.stringify(expected)}`);
      expect(stderr + stdout).toContain("(pass) next");
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}, 12000);
