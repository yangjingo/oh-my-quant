import { mock } from "bun:test";
import * as fs from "node:fs";
import * as promises from "node:fs/promises";
import { join } from "node:path";

// Fault injection at the OS rename boundary, isolated to this child process.
// Real open/write/fsync have already run; no production test hooks are needed.
const original = { ...fs };
const originalPromises = { ...promises };
const root = process.env.SESSION_CRASH_ROOT!;
const point = process.env.SESSION_CRASH_POINT!;
let attempts = 0;
let released = false;
function intercept(source: fs.PathLike, destination: fs.PathLike, replace: () => unknown): unknown {
  if (!String(destination).endsWith(".jsonl")) return replace();
  if (point === "retry" || point === "denied" || point === "reader-release" || point === "cancel") {
    attempts++;
    if (point === "reader-release" && attempts === 1) setTimeout(() => { released = true; }, 20);
    original.writeFileSync(join(root, "checkpoint"), JSON.stringify({ attempts, previous: original.readFileSync(destination, "utf8"), released }));
    if (point === "denied" || point === "cancel" || (point === "reader-release" ? !released : attempts <= 3))
      throw Object.assign(new Error("Injected rename EPERM"), { code: "EPERM" });
    return replace();
  }
  // The crash barrier deliberately blocks until the parent kills this process.
  // For the after case the async replacement must complete before publishing it.
  const checkpoint = () => {
    original.writeFileSync(join(root, "checkpoint"), JSON.stringify({ source: String(source), destination: String(destination), point }));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  };
  if (point === "after") {
    const result = replace();
    return result instanceof Promise ? result.then(checkpoint) : checkpoint();
  }
  return checkpoint();
}
mock.module("node:fs", () => ({
  ...original,
  renameSync: (source: fs.PathLike, destination: fs.PathLike) => intercept(source, destination, () => original.renameSync(source, destination)),
}));
mock.module("node:fs/promises", () => ({
  ...originalPromises,
  rename: async (source: fs.PathLike, destination: fs.PathLike) => intercept(source, destination, () => originalPromises.rename(source, destination)),
}));
