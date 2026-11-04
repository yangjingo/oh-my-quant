import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

// A detached checkout lets the measurement enforce clean source even when the
// developer's working tree contains intentional edits. Dependencies are read
// from the already-installed checkout; the Host workspace is separately isolated.
test("resource duration receipts detect retained Agents and swallowed cleanup failures", async () => {
  const repo = resolve(import.meta.dir, "../../../..");
  const scratch = mkdtempSync(join(tmpdir(), "whyj-resource-test-"));
  const scratchReal = realpathSync(scratch), tempReal = realpathSync(tmpdir());
  if (dirname(scratchReal) !== tempReal || !basename(scratchReal).startsWith("whyj-resource-test-")) throw new Error("Unexpected test directory");
  const checkout = join(scratch, "checkout"), modules = join(checkout, "node_modules");
  const harness = join(repo, "src/app/host/test/resource-duration.ts");
  const source = readFileSync(harness, "utf8");
  const git = async (...args: string[]) => {
    const child = Bun.spawn(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe", timeout: 20_000, killSignal: "SIGKILL" });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()]);
    if (code !== 0) throw new Error(`Git worktree operation failed (${code}): ${stderr}`);
  };
  let checkoutAdded = false;
  try {
    await git("worktree", "add", "--detach", checkout, "HEAD");
    checkoutAdded = true;
    symlinkSync(realpathSync(join(repo, "node_modules")), modules, process.platform === "win32" ? "junction" : "dir");
    const run = async (file: string, label: string) => {
      const receipt = join(scratch, `${label}.jsonl`), canary = "resource-test-canary-49ec";
      const child = Bun.spawn([process.execPath, file, checkout, receipt, "1000", "3000"], {
        cwd: repo, env: { ...process.env, WHYJ_RESOURCE_TEST_CANARY: canary }, stdout: "pipe", stderr: "pipe", timeout: 15_000, killSignal: "SIGKILL",
      });
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      if (code !== 0) throw new Error(`Fixture ${label} exited ${code}: ${stderr}`);
      const text = readFileSync(receipt, "utf8"), records = text.trim().split("\n").map(line => JSON.parse(line));
      expect(text).not.toContain(canary);
      expect(text).not.toContain(scratch);
      const root = stdout.match(/^Synthetic workspace: (.+)$/m)?.[1]?.trim();
      expect(root).toBeDefined(); expect(existsSync(root!)).toBe(false);
      const samples = records.filter(record => record.type === "sample");
      expect(samples.length).toBeGreaterThanOrEqual(2);
      return { samples, end: records.at(-1) };
    };
    const original = await run(harness, "normal");
    expect(original.end.outcome).toBe("completed");
    for (const sample of original.samples) {
      expect(sample.agentsCreated).toBe(sample.completed);
      expect(sample.failedCleanups).toBe(0);
      expect(sample.observers).toBe(0);
      expect(sample.activeRuns).toBe(0);
      expect(sample.settled).toBe(true);
    }

    const weakDeclaration = "const weakAgents: WeakRef<object>[] = [];";
    const weakCapture = "weakAgents.push(new WeakRef(agent)); return agent;";
    if (!source.includes(weakDeclaration) || !source.includes(weakCapture)) throw new Error("Weak reference fixture changed");
    const retainedFile = join(scratch, "retained.ts");
    writeFileSync(retainedFile, source.replace(weakDeclaration, weakDeclaration + "\nconst strongAgents: object[] = [];")
      .replace(weakCapture, "weakAgents.push(new WeakRef(agent)); strongAgents.push(agent); return agent;"));
    const retained = await run(retainedFile, "retained");
    for (const sample of retained.samples) expect(sample.weakAgentsAliveAfterGc).toBe(sample.agentsCreated);

    const cleanup = "await cleanup(); cleaned++;";
    if (!source.includes(cleanup)) throw new Error("Cleanup fixture changed");
    const failureFile = join(scratch, "failure.ts");
    writeFileSync(failureFile, source.replace(cleanup, 'throw new Error("synthetic cleanup failure");'));
    const failed = await run(failureFile, "failed");
    expect(failed.end.outcome).toBe("incomplete");
    expect(failed.end.failedCleanups).toBeGreaterThan(0);
    expect(failed.end.unsettledSamples).toBeGreaterThan(0);

    // A clock jump models an interrupted interval without waiting in real time.
    // It validates the receipt decision, not multi-day operation.
    const clock = "const now = performance.now(), wall = Date.now();";
    if (!source.includes(clock)) throw new Error("Clock fixture changed");
    const gapFile = join(scratch, "gap.ts");
    writeFileSync(gapFile, source.replace(clock, "const now = performance.now(), wall = Date.now() + (completed ? 120000 : 0);"));
    const gap = await run(gapFile, "gap");
    expect(gap.end.outcome).toBe("incomplete");
    expect(gap.end.gaps).toBeGreaterThan(0);
  } finally {
    if (existsSync(modules)) unlinkSync(modules);
    if (checkoutAdded) await git("worktree", "remove", checkout);
    if (!checkoutAdded && existsSync(checkout)) throw new Error(`Partial checkout retained for inspection: ${checkout}`);
    if (realpathSync(scratch) !== scratchReal || dirname(scratchReal) !== tempReal) throw new Error("Test directory changed before cleanup");
    rmSync(scratchReal, { recursive: true });
  }
}, 150_000);
