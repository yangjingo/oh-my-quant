import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { createHostRuntimeStore, hostProcessState } from "../../../storage/index.ts";

let root: string;
const children: ReturnType<typeof Bun.spawn>[] = [];
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "whyj-host-owner-")); });
afterEach(async () => {
  for (const child of children.splice(0)) { if (child.exitCode === null) child.kill(); await child.exited; }
  rmSync(root, { recursive: true, force: true });
});
function launch(mode = "owner") {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/lock-owner.ts"), mode], {
    env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe",
  });
  children.push(child); return child;
}
async function waitFor(path: string) {
  const deadline = Date.now() + 5000;
  while (!existsSync(path)) { if (Date.now() > deadline) throw new Error("fixture did not acquire ownership"); await delay(10); }
}

test("an old mtime cannot steal a live process lock; crashed owner can be reclaimed", async () => {
  const child = launch(); await waitFor(join(root, "child-ready.json"));
  const store = createHostRuntimeStore(root), previous = store.readOwner("owner")!;
  const old = new Date("2000-01-01T00:00:00Z"); utimesSync(join(root, ".host/owner.lock"), old, old);
  expect(() => store.acquire("owner")).toThrow("active Host owner");
  expect(store.readOwner("owner")).toEqual(previous);
  child.kill("SIGKILL"); await child.exited;
  expect(hostProcessState(previous.pid)).toBe("dead");
  const lease = store.acquire("owner");
  try { expect(lease.instanceId).not.toBe(previous.instanceId); lease.assertOwned(); }
  finally { lease.release(); }
  expect(store.readOwner("owner")).toBeUndefined();
});

test("concurrent process contenders never overlap their protected execution", async () => {
  const running = Array.from({ length: 8 }, () => launch("race"));
  const result = await Promise.all(running.map(async child => ({ code: await child.exited, out: await new Response(child.stdout).text(), err: await new Response(child.stderr).text() })));
  expect(result).toEqual(Array.from({ length: 8 }, () => ({ code: 0, out: "exclusive\n", err: "" })));
  expect(createHostRuntimeStore(root).readOwner("owner")).toBeUndefined();
}, 15_000);

test("malformed lock and registry bytes are preserved instead of acquiring a second owner", () => {
  const store = createHostRuntimeStore(root);
  const lock = join(root, ".host/owner.lock"); mkdirSync(lock); writeFileSync(join(lock, "unknown"), "retain me");
  expect(() => store.acquire("owner")).toThrow("unknown contents");
  expect(readFileSync(join(lock, "unknown"), "utf8")).toBe("retain me");
  const registry = join(root, ".host/registry.json"); writeFileSync(registry, "{broken");
  expect(() => store.read()).toThrow("unreadable");
  expect(readFileSync(registry, "utf8")).toBe("{broken");
  expect(readdirSync(join(root, ".host")).some(name => name.startsWith(".candidate-"))).toBe(false);
});

test("late duplicate release cannot remove a replacement owner", () => {
  const store = createHostRuntimeStore(root), first = store.acquire("owner"); first.release();
  const second = store.acquire("owner");
  try { first.release(); expect(store.readOwner("owner")?.instanceId).toBe(second.instanceId); second.assertOwned(); }
  finally { second.release(); }
});

test("a legacy mtime-only Host lock is preserved for explicit diagnosis", () => {
  const store = createHostRuntimeStore(root), legacy = join(root, ".workbench-host.lock");
  mkdirSync(legacy); const old = new Date("2000-01-01T00:00:00Z"); utimesSync(legacy, old, old);
  expect(() => store.acquire("owner")).toThrow("legacy Workbench lock");
  expect(existsSync(legacy)).toBe(true); expect(store.readOwner("owner")).toBeUndefined();
});

test("a crashed startup launcher can be recovered without expiring a live launcher", async () => {
  const child = launch("startup"); await waitFor(join(root, "child-ready.json"));
  const store = createHostRuntimeStore(root);
  expect(() => store.acquire("startup")).toThrow("active Host owner");
  child.kill("SIGKILL"); await child.exited;
  const recovered = store.acquire("startup"); recovered.release();
});
