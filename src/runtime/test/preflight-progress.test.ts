import { expect, test } from "bun:test";
import { join } from "node:path";
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
  expect(partial.runtimeReadyMs).toBeNull();
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

test.each([{ withPreload: true }, { withPreload: false }])("preflight child readiness with preload=$withPreload", async ({ withPreload }) => {
  const started = performance.now();
  let runtimeReadyMs: number | null = null;
  const args = withPreload ? ["--preload", join(import.meta.dir, "preflight-child-ready.ts")] : [];
  const child = Bun.spawn([process.execPath, ...args, "-e", "process.stdout.write('PRIVATE_OUTPUT'); setTimeout(() => process.exit(7), 100)"], {
    stdout: "pipe", stderr: "pipe",
    ipc(message) {
      if (message === "WHYJ_PREFLIGHT_BUN_READY" && runtimeReadyMs === null) runtimeReadyMs = Math.round(performance.now() - started);
    },
  });
  const progress = monitorPreflight(child, started, () => runtimeReadyMs), records: string[] = [];
  const watchdog = setTimeout(() => child.kill(), 5000);
  try {
    const [out, err, code] = await Promise.all([progress.stdout, progress.stderr, progress.exit]);
    expect(out).toBe("PRIVATE_OUTPUT"); expect(err).toBe(""); expect(code).toBe(7);
    progress.report("watchdog", message => records.push(message));
    const snapshot = JSON.parse(records[0]!.slice("WHYJ_PREFLIGHT_PROGRESS ".length));
    if (withPreload) expect(snapshot.runtimeReadyMs).toBeNumber();
    else expect(snapshot.runtimeReadyMs).toBeNull();
    expect(snapshot.exitMs).toBeNumber();
    expect(records[0]).not.toContain("PRIVATE_OUTPUT");
  } finally { clearTimeout(watchdog); child.kill(); await child.exited; }
}, 10000);

test("a watchdog snapshot distinguishes a ready Bun preload from a pending child", async () => {
  const started = performance.now(), ready = Promise.withResolvers<void>();
  let runtimeReadyMs: number | null = null;
  const child = Bun.spawn([process.execPath, "--preload", join(import.meta.dir, "preflight-child-ready.ts"), "-e",
    "process.stdout.write('PRIVATE_OUTPUT'); setInterval(() => {}, 1000)"], {
    stdout: "pipe", stderr: "pipe",
    ipc(message) {
      if (message === "WHYJ_PREFLIGHT_BUN_READY" && runtimeReadyMs === null) {
        runtimeReadyMs = Math.round(performance.now() - started); ready.resolve();
      }
    },
  });
  const progress = monitorPreflight(child, started, () => runtimeReadyMs), records: string[] = [];
  const watchdog = setTimeout(() => child.kill(), 5000);
  try {
    await Promise.race([ready.promise, progress.exit.then(() => { throw new Error("Child exited before preload readiness"); })]);
    progress.report("watchdog", message => records.push(message));
    const snapshot = JSON.parse(records[0]!.slice("WHYJ_PREFLIGHT_PROGRESS ".length));
    expect(snapshot.runtimeReadyMs).toBeNumber(); expect(snapshot.exitMs).toBeNull();
    expect(snapshot.stdoutMs).toBeNull(); expect(snapshot.stderrMs).toBeNull();
    expect(records[0]).not.toContain("PRIVATE_OUTPUT");
  } finally {
    clearTimeout(watchdog); child.kill();
    await Promise.all([progress.stdout, progress.stderr, progress.exit]);
  }
}, 10000);
