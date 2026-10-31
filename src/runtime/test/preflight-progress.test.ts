import { expect, test } from "bun:test";
import { monitorPreflight } from "./preflight-progress.ts";

test("preflight progress separates output completion from process exit without logging data", async () => {
  let closeStderr = () => {};
  const stdout = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("PRIVATE_OUTPUT")); controller.close(); } });
  const stderr = new ReadableStream<Uint8Array>({ start(controller) { closeStderr = () => controller.close(); } });
  const exited = Promise.withResolvers<number>();
  const progress = monitorPreflight({ stdout, stderr, exited: exited.promise }, performance.now()), records: string[] = [];
  expect(await progress.stdout).toBe("PRIVATE_OUTPUT");
  progress.report("teardown", message => records.push(message));
  const partial = JSON.parse(records[0]!.slice("WHYJ_PREFLIGHT_PROGRESS ".length));
  expect(partial.stdoutMs).toBeNumber(); expect(partial.stderrMs).toBeNull(); expect(partial.exitMs).toBeNull();
  expect(records[0]).not.toContain("PRIVATE_OUTPUT");
  closeStderr(); exited.resolve(1);
  await Promise.all([progress.stderr, progress.exit]);
  progress.report("watchdog", message => records.push(message));
  const completed = JSON.parse(records[1]!.slice("WHYJ_PREFLIGHT_PROGRESS ".length));
  expect(completed.stderrMs).toBeNumber(); expect(completed.exitMs).toBeNumber();
});

test("preflight progress records a live child and its closed streams after exit", async () => {
  const started = performance.now();
  const child = Bun.spawn([process.execPath, "-e", "process.stdout.end('PRIVATE_OUTPUT'); setInterval(() => {}, 1000)"], { stdout: "pipe", stderr: "pipe" });
  const progress = monitorPreflight(child, started), records: string[] = [];
  const watchdog = setTimeout(() => child.kill(), 5000);
  try {
    await Bun.sleep(100);
    progress.report("teardown", message => records.push(message));
    const pending = JSON.parse(records[0]!.slice("WHYJ_PREFLIGHT_PROGRESS ".length));
    expect(pending.reason).toBe("teardown");
    expect(pending.stdoutMs).toBeNull();
    expect(pending.stderrMs).toBeNull();
    expect(pending.exitMs).toBeNull();
    expect(records[0]).not.toContain("PRIVATE_OUTPUT");
    // A broken diagnostic sink must not change subprocess cleanup.
    expect(() => progress.report("watchdog", () => { throw new Error("sink failed"); })).not.toThrow();
  } finally {
    clearTimeout(watchdog); child.kill();
    await Promise.all([progress.stdout, progress.stderr, progress.exit]);
  }
  progress.report("watchdog", message => records.push(message));
  const settled = JSON.parse(records[1]!.slice("WHYJ_PREFLIGHT_PROGRESS ".length));
  expect(settled.stdoutMs).toBeNumber();
  expect(settled.stderrMs).toBeNumber();
  expect(settled.exitMs).toBeNumber();
}, 10000);
