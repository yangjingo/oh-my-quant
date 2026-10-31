import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFixtureLifetime } from "./fixture-lifetime.ts";

test("pending diagnostics cannot interrupt draining and completed fixtures stay quiet", async () => {
  const lifetime = createFixtureLifetime(1000);
  let completed = false, callbacks = 0;
  const operation = lifetime.track(async () => { await Bun.sleep(10); completed = true; })();
  await lifetime.drain(() => { callbacks++; throw new Error("controlled diagnostic failure"); });
  expect(completed).toBe(true); expect(callbacks).toBe(1);
  await operation;
  await lifetime.drain(() => { callbacks++; });
  expect(callbacks).toBe(1);
});

test("a timed-out fixture body drains before the next test reuses state", async () => {
  const tempRoot = resolve(tmpdir());
  const cwd = mkdtempSync(join(tempRoot, "whyj-fixture-lifetime-"));
  if (dirname(cwd) !== tempRoot || !basename(cwd).startsWith("whyj-fixture-lifetime-")) throw new Error("Unexpected temporary path");
  try {
    const helper = fileURLToPath(new URL("./fixture-lifetime.ts", import.meta.url));
    const fixture = join(cwd, "timeout.test.ts");
    writeFileSync(fixture, `import { afterEach, test } from "bun:test";
import { createFixtureLifetime } from ${JSON.stringify(helper)};
const lifetime = createFixtureLifetime(process.env.HANG_FIXTURE === "true" ? 200 : 2000);
let phase = "first";
const trace = [];
afterEach(async () => { if (process.env.DRAIN_FIXTURE === "true") await lifetime.drain(() => { trace.push("pending:" + phase); console.error("FIXTURE_PENDING:" + phase); }); trace.push("after:" + phase); phase = "next"; });
test("timed-out body", lifetime.track(async () => { if (process.env.HANG_FIXTURE === "true") await Bun.sleep(30000); await Bun.sleep(250); trace.push("body:" + phase); }), 50);
test("observe", async () => { await Bun.sleep(300); console.log("TRACE:" + JSON.stringify(trace)); }, 2000);
`);
    for (const [drain, expected] of [[false, ["after:first", "body:next"]], [true, ["pending:first", "body:first", "after:first"]]] as const) {
      const child = Bun.spawn({ cmd: [process.execPath, "test", fixture], cwd,
        env: { ...process.env, DRAIN_FIXTURE: String(drain), HANG_FIXTURE: "false" }, stdout: "pipe", stderr: "pipe" });
      const watchdog = setTimeout(() => child.kill(), 3000);
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]).finally(() => clearTimeout(watchdog));
      expect(code).toBe(1); // The first child test is intentionally timed out.
      expect(stderr + stdout).toContain("timed out after 50ms");
      expect(stderr + stdout).toContain(`TRACE:${JSON.stringify(expected)}`);
      if (drain) expect(stderr + stdout).toContain("FIXTURE_PENDING:first");
      else expect(stderr + stdout).not.toContain("FIXTURE_PENDING:");
      expect(stderr + stdout).toContain("(pass) observe");
    }
    const stuck = Bun.spawn({ cmd: [process.execPath, "test", fixture], cwd,
      env: { ...process.env, DRAIN_FIXTURE: "true", HANG_FIXTURE: "true" }, stdout: "pipe", stderr: "pipe" });
    const watchdog = setTimeout(() => stuck.kill(), 3000);
    const [code, stdout, stderr] = await Promise.all([stuck.exited, new Response(stuck.stdout).text(), new Response(stuck.stderr).text()]).finally(() => clearTimeout(watchdog));
    expect(code).toBe(1);
    expect(stderr + stdout).toContain("FIXTURE_PENDING:first");
    expect(stderr + stdout).toContain("Timed-out fixture body did not settle; stopping the test process");
    expect(stderr + stdout).not.toContain("(pass) observe");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}, 10000);
