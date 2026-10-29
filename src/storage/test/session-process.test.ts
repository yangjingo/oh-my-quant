import { afterEach, beforeEach, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { JsonlSessionRepo } from "../../agent/src/session-runtime/index.ts";
import { NodeExecutionEnv } from "../../agent/src/session-runtime/node.ts";

let root: string;
let repo: JsonlSessionRepo;
const writerPath = join(import.meta.dir, "fixtures", "session-writer.ts");
const preload = join(import.meta.dir, "fixtures", "session-crash-preload.ts");
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ohq-session-process-"));
  repo = new JsonlSessionRepo({ fs: new NodeExecutionEnv({ cwd: root }), sessionsRoot: root });
});
afterEach(() => {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected session process test directory");
  rmSync(root, { recursive: true, force: true });
});

it("allows exactly one of eight writers from the same research version to commit", async () => {
  const session = await repo.create({ cwd: root });
  await session.appendMessage({ role: "user", content: "Common research", timestamp: 1 });
  const meta = await session.getMetadata();
  const writers = Array.from({ length: 8 }, (_, i) => Bun.spawn([process.execPath, writerPath, root, meta.path, "race", String(i)], { stdout: "pipe", stderr: "pipe" }));
  try {
    const deadline = Date.now() + 10_000;
    while (writers.some((_, i) => !existsSync(join(root, `ready-${i}`))) && Date.now() < deadline) {
      if (writers.some(writer => writer.exitCode !== null)) break;
      await Bun.sleep(10);
    }
    expect(writers.every((_, i) => existsSync(join(root, `ready-${i}`)))).toBe(true);
    writeFileSync(join(root, "go"), "go");
    for (let i = 0; i < 20; i++) {
      const entries = await (await repo.open(meta)).getEntries();
      expect([1, 2]).toContain(entries.length);
      await Bun.sleep(5);
    }
    const outcomes = await Promise.all(writers.map(async writer => ({ code: await writer.exited, out: await new Response(writer.stdout).text(), err: await new Response(writer.stderr).text() })));
    expect(outcomes.every(result => result.code === 0 && result.err === "")).toBe(true);
    const states = outcomes.map(result => JSON.parse(result.out).status as string);
    expect(states.filter(state => state === "committed")).toHaveLength(1);
    expect(states.filter(state => state === "conflict")).toHaveLength(7);
    const reopened = await repo.open(meta);
    expect(await reopened.getBranch()).toHaveLength(2);
    await reopened.appendMessage({ role: "user", content: "Reviewed latest research", timestamp: 3 });
    expect(await reopened.getBranch()).toHaveLength(3);
  } finally {
    for (const writer of writers) if (writer.exitCode === null) writer.kill(9);
    await Promise.all(writers.map(writer => writer.exited));
  }
}, 20_000);

for (const mode of ["append", "fork"] as const) {
  for (const point of ["before", "after"] as const) {
    it(`survives a killed ${mode} writer ${point} rename with a complete published transcript`, async () => {
      const session = await repo.create({ cwd: root });
      await session.appendMessage({ role: "user", content: "Original research", timestamp: 1 });
      await session.appendMessage({ role: "user", content: "Follow-up research", timestamp: 2 });
      const meta = await session.getMetadata();
      const original = readFileSync(meta.path, "utf8");
      const entries = await session.getEntries();
      const writer = Bun.spawn([process.execPath, "--preload", preload, writerPath, root, meta.path, mode], {
        env: { ...process.env, SESSION_CRASH_ROOT: root, SESSION_CRASH_POINT: point }, stdout: "pipe", stderr: "pipe",
      });
      try {
        const marker = join(root, "checkpoint");
        const deadline = Date.now() + 10_000;
        while (!existsSync(marker) && Date.now() < deadline && writer.exitCode === null) await Bun.sleep(10);
        expect(existsSync(marker)).toBe(true);
        const checkpoint = JSON.parse(readFileSync(marker, "utf8")) as { source: string; destination: string };
        expect(existsSync(checkpoint.source)).toBe(point === "before");
        writer.kill(9);
        await writer.exited;
        const listing = await repo.list();
        if (mode === "fork") {
          expect(readFileSync(meta.path, "utf8")).toBe(original);
          expect(listing).toHaveLength(point === "before" ? 1 : 2);
          for (const listed of listing) expect(await (await repo.open(listed)).getEntries()).toEqual(entries);
        } else {
          const restored = await repo.open(meta);
          expect(await restored.getEntries()).toHaveLength(point === "before" ? 2 : 3);
          if (point === "before") expect(readFileSync(meta.path, "utf8")).toBe(original);
          else expect((await restored.getEntries()).slice(0, 2)).toEqual(entries);
          // Expire a crashed owner's lease only after the process is confirmed terminal.
          const lock = meta.path + ".lock";
          if (existsSync(lock)) utimesSync(lock, new Date(0), new Date(0));
          await restored.appendMessage({ role: "user", content: "Recovered", timestamp: 4 });
          expect(await (await repo.open(meta)).getEntries()).toHaveLength(point === "before" ? 3 : 4);
        }
      } finally {
        if (writer.exitCode === null) writer.kill(9);
        await writer.exited;
      }
    }, 20_000);
  }
}

for (const point of ["retry", "denied", "reader-release", "cancel"] as const) {
  it.skipIf(process.platform !== "win32")(`handles Windows rename ${point} without unlinking the committed session`, async () => {
    const session = await repo.create({ cwd: root });
    await session.appendMessage({ role: "user", content: "Original", timestamp: 1 });
    const meta = await session.getMetadata();
    const original = readFileSync(meta.path, "utf8");
    const writer = Bun.spawn([process.execPath, "--preload", preload, writerPath, root, meta.path, point === "cancel" ? "cancel" : "append"], {
      env: { ...process.env, SESSION_CRASH_ROOT: root, SESSION_CRASH_POINT: point }, stdout: "pipe", stderr: "pipe",
    });
    try {
      const code = await writer.exited;
      const error = await new Response(writer.stderr).text();
      const checkpoint = JSON.parse(readFileSync(join(root, "checkpoint"), "utf8")) as { attempts: number; previous: string; released: boolean };
      expect(checkpoint.previous).toBe(original);
      expect(checkpoint.attempts).toBeGreaterThanOrEqual(point === "cancel" ? 1 : point === "reader-release" ? 2 : 4);
      expect(code).toBe(point === "denied" ? 1 : 0);
      expect(readdirSync(root, { recursive: true }).some(name => String(name).endsWith(".tmp") || String(name).endsWith(".lock"))).toBe(false);
      if (point === "cancel") {
        expect(error).toBe("");
        expect(JSON.parse(await new Response(writer.stdout).text()).status).toBe("cancelled");
        expect(readFileSync(meta.path, "utf8")).toBe(original);
        await session.appendMessage({ role: "user", content: "After cancellation", timestamp: 3 });
        expect(await (await repo.open(meta)).getEntries()).toHaveLength(2);
      } else if (point !== "denied") {
        if (point === "reader-release") expect(checkpoint.released).toBe(true);
        expect(error).toBe("");
        expect(await (await repo.open(meta)).getEntries()).toHaveLength(2);
      } else {
        expect(error).toContain("Injected rename EPERM");
        expect(readFileSync(meta.path, "utf8")).toBe(original);
        await session.appendMessage({ role: "user", content: "Successful retry", timestamp: 3 });
        expect(await (await repo.open(meta)).getEntries()).toHaveLength(2);
      }
    } finally {
      if (writer.exitCode === null) writer.kill(9);
      await writer.exited;
    }
  }, 10_000);
}
