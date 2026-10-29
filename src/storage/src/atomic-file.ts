import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { open as openAsync, rename as renameAsync, unlink as unlinkAsync } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { lock, lockSync } from "proper-lockfile";

// All callers use the same lease. Only local commit IO belongs under this lock.
const LOCK_OPTIONS = { realpath: false, stale: 10_000, update: 2_000 };
export type AsyncFileLock = (path: string, options: typeof LOCK_OPTIONS) => Promise<() => Promise<void>>;

function isWindowsLockDirectoryRace(error: NodeJS.ErrnoException, path: string): boolean {
  return process.platform === "win32" && ["EPERM", "EACCES", "EBUSY"].includes(error.code ?? "")
    && error.syscall === "mkdir" && typeof error.path === "string" && resolve(error.path) === resolve(`${path}.lock`);
}

/** Fail visibly on contention; synchronous UI saves must not freeze the event loop. */
export function withFileLock<T>(path: string, operation: () => T): T {
  let release: () => void;
  const windowsRetryDeadline = Date.now() + 250;
  for (;;) {
    try {
      release = lockSync(path, LOCK_OPTIONS);
      break;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException;
      if (failure.code === "ELOCKED") {
        throw Object.assign(new Error(`${basename(path)} is being updated by another process. Retry the operation.`), { code: "ELOCKED" });
      }
      // Windows may deny mkdir while another process releases this exact lock directory.
      // Wait only for acquisition; never repeat the protected write.
      if (!isWindowsLockDirectoryRace(failure, path) || Date.now() >= windowsRetryDeadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return operation(); } finally { release(); }
}

/** Retry only lock acquisition. The operation runs once after cancellation check. */
export async function withFileLockAsync<T>(path: string, operation: () => T | Promise<T>, signal?: AbortSignal): Promise<T> {
  return withFileLockAsyncUsing(path, operation, signal, lock);
}

/** Dependency-bearing form used to exercise platform-specific acquisition failures deterministically. */
export async function withFileLockAsyncUsing<T>(
  path: string, operation: () => T | Promise<T>, signal: AbortSignal | undefined, acquire: AsyncFileLock,
): Promise<T> {
  const deadline = Date.now() + 12_000;
  let windowsRetryDeadline: number | undefined;
  for (;;) {
    signal?.throwIfAborted();
    let release: () => Promise<void>;
    try {
      release = await acquire(path, LOCK_OPTIONS);
    } catch (error) {
      const failure = error as NodeJS.ErrnoException;
      // Windows can deny mkdir briefly while another process releases the lock directory.
      // Retry acquisition only, never the protected operation or a different filesystem error.
      const windowsLockRace = isWindowsLockDirectoryRace(failure, path);
      if (windowsLockRace) windowsRetryDeadline ??= Date.now() + 250;
      if ((!windowsLockRace && failure.code !== "ELOCKED") || Date.now() >= deadline || windowsLockRace && Date.now() >= windowsRetryDeadline!) throw error;
      await delay(25 + Math.floor(Math.random() * 25), undefined, { signal });
      continue;
    }
    try {
      signal?.throwIfAborted();
      return await operation();
    } finally { await release(); }
  }
}

/** Complete file or previous file after process death; temporary files are never read. */
export function atomicWriteJson(path: string, value: unknown): number {
  return atomicWriteText(path, JSON.stringify(value, null, 2));
}

export function atomicWriteText(path: string, text: string): number {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, text, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    // Windows readers or scanners can briefly deny replacement even with our writer
    // lock held. Retry rename only; never unlink the committed destination first.
    const renameDeadline = Date.now() + 250;
    for (;;) {
      try { renameSync(temporary, path); break; } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "") || Date.now() >= renameDeadline) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    // Windows does not support opening directories through the fs API for fsync.
    if (process.platform !== "win32") {
      const directory = openSync(dirname(path), "r");
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
    return Buffer.byteLength(text);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export async function atomicWriteJsonAsync(path: string, value: unknown, signal?: AbortSignal): Promise<number> {
  return atomicWriteTextAsync(path, JSON.stringify(value, null, 2), signal);
}

/** Async durable replacement for request paths that must leave the event loop cancellable. */
export async function atomicWriteTextAsync(path: string, text: string, signal?: AbortSignal): Promise<number> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof openAsync>> | undefined;
  try {
    signal?.throwIfAborted();
    handle = await openAsync(temporary, "wx", 0o600);
    await handle.writeFile(text, { encoding: "utf8", signal });
    await handle.sync();
    await handle.close();
    handle = undefined;
    signal?.throwIfAborted();
    const renameDeadline = Date.now() + 250;
    for (;;) {
      try { await renameAsync(temporary, path); break; } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "") || Date.now() >= renameDeadline) throw error;
        await delay(10, undefined, { signal });
      }
    }
    if (process.platform !== "win32") {
      const directory = await openAsync(dirname(path), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    }
    return Buffer.byteLength(text);
  } finally {
    if (handle) await handle.close();
    try { await unlinkAsync(temporary); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
