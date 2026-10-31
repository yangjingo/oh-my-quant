import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

test("a timed-out preflight child settles before fixture state is reused", async () => {
  const tempRoot = resolve(tmpdir()), cwd = mkdtempSync(join(tempRoot, "whyj-preflight-lifetime-"));
  if (dirname(cwd) !== tempRoot || !basename(cwd).startsWith("whyj-preflight-lifetime-")) throw new Error("Unexpected fixture path");
  try {
    const helper = fileURLToPath(new URL("../../app/services/test/fixture-lifetime.ts", import.meta.url));
    const fixture = join(cwd, "preflight-timeout.test.ts");
    writeFileSync(fixture, `import { afterEach, test } from "bun:test";
import { createFixtureLifetime } from ${JSON.stringify(helper)};
const mode = process.env.PROBE_MODE;
const lifetime = createFixtureLifetime(mode === "stuck" ? 200 : 2000);
let phase = "first", draining = false, child: ReturnType<typeof Bun.spawn> | undefined;
const trace: string[] = [];
process.on("exit", () => { try { child?.kill(); } catch {} });
const body = async () => {
  if (mode === "early-reject") throw new Error("Controlled early child failure");
  child = Bun.spawn([process.execPath, "-e", mode === "stuck" ? "setTimeout(() => {}, 30000)" : "setTimeout(() => {}, 300)"], { stdout: "ignore", stderr: "ignore" });
  try {
    await child.exited;
    if (mode === "stuck") await new Promise(() => {});
    trace.push("body:" + phase);
    if (phase !== "first") throw new Error("Synthetic child resumed after fixture restoration");
    if (mode === "owned-reject") throw new Error("Controlled late child failure");
  } finally { child.kill(); }
};
const ownedBody = lifetime.track(async () => {
  try { await body(); } catch (error) { if (!draining) throw error; console.error("WHYJ_PREFLIGHT_LATE_FAILURE"); }
});
afterEach(async () => { draining = true; if (mode !== "unsafe") await lifetime.drain(); trace.push("after:" + phase); phase = "next"; });
test("timed-out child", mode === "unsafe" ? body : ownedBody, mode === "early-reject" ? 3000 : 50);
test("observe", async () => { await Bun.sleep(400); console.log("TRACE:" + JSON.stringify(trace)); }, 3000);
`);
    for (const [mode, expected] of [["unsafe", ["after:first", "body:next"]], ["owned", ["body:first", "after:first"]], ["owned-reject", ["body:first", "after:first"]]] as const) {
      const child = Bun.spawn([process.execPath, "test", fixture], { cwd, env: { ...process.env, PROBE_MODE: mode }, stdout: "pipe", stderr: "pipe" });
      const watchdog = setTimeout(() => child.kill(), 10000);
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]).finally(() => clearTimeout(watchdog));
      expect(code).toBe(1);
      expect(out + err).toContain("timed out after 50ms");
      expect(out + err).toContain(`TRACE:${JSON.stringify(expected)}`);
      if (mode === "unsafe") expect(out + err).toContain("error: Synthetic child resumed after fixture restoration");
      else expect(out + err).not.toContain("error: Synthetic child resumed after fixture restoration");
      if (mode === "owned-reject") {
        expect(out + err).toContain("WHYJ_PREFLIGHT_LATE_FAILURE");
        expect(out + err).not.toContain("Unhandled error between tests");
      }
    }
    const early = Bun.spawn([process.execPath, "test", fixture], { cwd, env: { ...process.env, PROBE_MODE: "early-reject" }, stdout: "pipe", stderr: "pipe" });
    const earlyWatchdog = setTimeout(() => early.kill(), 10000);
    const [earlyCode, earlyOut, earlyErr] = await Promise.all([early.exited, new Response(early.stdout).text(), new Response(early.stderr).text()]).finally(() => clearTimeout(earlyWatchdog));
    expect(earlyCode).toBe(1);
    expect(earlyOut + earlyErr).toContain("error: Controlled early child failure");
    expect(earlyOut + earlyErr).not.toContain("WHYJ_PREFLIGHT_LATE_FAILURE\n");
    const stuck = Bun.spawn([process.execPath, "test", fixture], { cwd, env: { ...process.env, PROBE_MODE: "stuck" }, stdout: "pipe", stderr: "pipe" });
    const watchdog = setTimeout(() => stuck.kill(), 10000);
    const [code, out, err] = await Promise.all([stuck.exited, new Response(stuck.stdout).text(), new Response(stuck.stderr).text()]).finally(() => clearTimeout(watchdog));
    expect(code).toBe(1);
    expect(out + err).toContain("Timed-out fixture body did not settle; stopping the test process");
    expect(out + err).not.toContain("(pass) observe");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}, 30000);
