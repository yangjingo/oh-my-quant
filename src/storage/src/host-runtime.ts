import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "./atomic-file.ts";
import { resolveOhquantDir } from "./dirs.ts";

export interface HostOwner {
  schemaVersion: 1;
  instanceId: string;
  pid: number;
  startedAt: string;
}
export interface HostRegistration extends HostOwner {
  workspaceId: string;
  url: string;
  protocolVersion: number;
  serviceContractVersion: number;
  applicationVersion: string;
  token: string;
  controlToken: string;
}
export type HostLockKind = "startup" | "owner";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
const failure = (code: string, message: string) => Object.assign(new Error(message), { code });

export function hostProcessState(pid: number): "alive" | "dead" | "unknown" {
  try { process.kill(pid, 0); return "alive"; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH" ? "dead" : "unknown"; }
}

function owner(value: unknown): HostOwner {
  const item = value as Partial<HostOwner> | null;
  if (!item || item.schemaVersion !== 1 || typeof item.instanceId !== "string" || !uuid.test(item.instanceId)
    || !Number.isSafeInteger(item.pid) || item.pid! <= 0 || typeof item.startedAt !== "string" || !Number.isFinite(Date.parse(item.startedAt))) {
    throw failure("HOST_METADATA_INVALID", "Host metadata is damaged or has an unsupported schema; it was preserved.");
  }
  return item as HostOwner;
}

/** Private process metadata only. Conversation state remains in its existing stores. */
export function createHostRuntimeStore(root = resolveOhquantDir()) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const canonicalRoot = realpathSync.native(root), directory = join(canonicalRoot, ".host");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink()) throw failure("HOST_METADATA_INVALID", "Host metadata directory cannot be a link.");
  const registryPath = join(directory, "registry.json");
  function readJson(path: string): unknown {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384) throw failure("HOST_METADATA_INVALID", "Host metadata must be a bounded regular file.");
    const text = readFileSync(path, "utf8");
    try { return JSON.parse(text); }
    catch { throw failure("HOST_METADATA_INVALID", "Host metadata is unreadable; it was preserved."); }
  }
  function readOwner(kind: HostLockKind): HostOwner | undefined {
    const deadline = Date.now() + 250;
    for (;;) {
      try { return inspectOwner(kind); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const transition = code === "HOST_LOCK_TRANSITION";
        const windowsRace = process.platform === "win32" && ["EPERM", "EACCES", "EBUSY"].includes(code ?? "");
        if ((!transition && !windowsRace) || Date.now() >= deadline) {
          if (transition) throw failure("HOST_METADATA_INVALID", "Host lock has incomplete contents; it was preserved.");
          throw error;
        }
        // Windows can deny scandir briefly while another process removes the
        // old directory. Retry observation only; no owner or write is retried.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
    }
  }
  function inspectOwner(kind: HostLockKind): HostOwner | undefined {
    const path = join(directory, kind + ".lock");
    let entries: string[];
    try {
      if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw failure("HOST_METADATA_INVALID", "Host lock must be a private directory.");
      entries = readdirSync(path);
    } catch (error) { if (absent(error)) return; throw error; }
    if (!entries.length) throw failure("HOST_LOCK_TRANSITION", "Host ownership directory is changing.");
    if (entries.length !== 1 || !uuid.test(entries[0]!.replace(/\.json$/, "")) || !entries[0]!.endsWith(".json")) {
      throw failure("HOST_METADATA_INVALID", "Host lock has unknown contents; it was preserved.");
    }
    let record: HostOwner;
    try { record = owner(readJson(join(path, entries[0]!))); }
    catch (error) { if (absent(error)) throw failure("HOST_LOCK_TRANSITION", "Host ownership record changed during observation."); throw error; }
    if (entries[0] !== record.instanceId + ".json") throw failure("HOST_METADATA_INVALID", "Host lock identity does not match its record.");
    return record;
  }
  function removeOwner(kind: HostLockKind, record: HostOwner) {
    const path = join(directory, kind + ".lock");
    // Never remove a replacement owner's file. A replacement is published as a
    // nonempty directory, so a late rmdir cannot delete a newly acquired lock.
    try { unlinkSync(join(path, record.instanceId + ".json")); }
    catch (error) { if (!absent(error)) throw error; }
    try { rmdirSync(path); }
    catch (error) { if (!absent(error) && !["ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
  }
  function acquire(kind: HostLockKind) {
    if (kind === "owner" && existsSync(join(canonicalRoot, ".workbench-host.lock"))) {
      throw failure("HOST_LEGACY_LOCK", "A legacy Workbench lock exists without process ownership metadata. Stop and verify that older Host before removing its lock; no replacement was started.");
    }
    const record: HostOwner = { schemaVersion: 1, instanceId: randomUUID(), pid: process.pid, startedAt: new Date().toISOString() };
    const destination = join(directory, kind + ".lock"), candidate = join(directory, ".candidate-" + record.instanceId);
    const filename = record.instanceId + ".json";
    mkdirSync(candidate, { mode: 0o700 });
    try {
      writeFileSync(join(candidate, filename), JSON.stringify(record), { flag: "wx", mode: 0o600 });
      for (let attempt = 0; attempt < 8; attempt++) {
        const previous = readOwner(kind);
        if (previous) {
          const state = hostProcessState(previous.pid);
          if (state !== "dead") throw failure("HOST_LOCKED", state === "alive"
            ? "This workspace already has an active Host owner or launcher."
            : "Host owner liveness cannot be established; refusing a second writer.");
          removeOwner(kind, previous);
        }
        try {
          // Same-filesystem rename atomically publishes a populated directory.
          // No valid live lock is ever an empty, stealable directory.
          renameSync(candidate, destination);
          let released = false;
          return { ...record, release() { if (!released) { removeOwner(kind, record); released = true; } }, assertOwned() {
            if (released || readOwner(kind)?.instanceId !== record.instanceId) throw failure("HOST_OWNERSHIP_LOST", "Host ownership changed; this instance must stop.");
          } };
        } catch (error) {
          if (!["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
          // A concurrent winner is inspected on the next iteration. Permission
          // failures without a winner are not treated as permission to overwrite.
          if (!readOwner(kind)) throw error;
        }
      }
      throw failure("HOST_LOCKED", "Host ownership changed during acquisition; retry discovery.");
    } finally {
      try { unlinkSync(join(candidate, filename)); } catch (error) { if (!absent(error)) throw error; }
      try { rmdirSync(candidate); } catch (error) { if (!absent(error)) throw error; }
    }
  }
  function read(): HostRegistration | undefined {
    let value: unknown;
    try { value = readJson(registryPath); } catch (error) { if (absent(error)) return; throw error; }
    const base = owner(value), entry = value as HostRegistration;
    let url: URL;
    try { url = new URL(entry.url); } catch { throw failure("HOST_METADATA_INVALID", "Invalid Host registration URL."); }
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.search || url.hash
      || url.pathname !== "/" || entry.url !== url.origin || !/^[a-f0-9]{24}$/.test(entry.workspaceId)
      || !Number.isSafeInteger(entry.protocolVersion) || entry.protocolVersion < 1
      || !Number.isSafeInteger(entry.serviceContractVersion) || entry.serviceContractVersion < 1
      || typeof entry.applicationVersion !== "string" || !entry.applicationVersion || entry.applicationVersion.length > 80
      || !/^[a-f0-9]{64}$/.test(entry.token) || !/^[a-f0-9]{64}$/.test(entry.controlToken)) {
      throw failure("HOST_METADATA_INVALID", "Host registration is invalid; it was preserved.");
    }
    return { ...entry, ...base };
  }
  return { root: canonicalRoot, acquire, readOwner, read,
    publish(entry: HostRegistration, lease: ReturnType<typeof acquire>) {
      lease.assertOwned();
      if (entry.instanceId !== lease.instanceId || entry.pid !== lease.pid || readOwner("owner")?.instanceId !== lease.instanceId) {
        throw failure("HOST_OWNERSHIP_LOST", "Only the execution owner may publish Host readiness.");
      }
      const previous = read();
      if (previous && previous.instanceId !== entry.instanceId && hostProcessState(previous.pid) !== "dead") {
        throw failure("HOST_REGISTRY_CONFLICT", "An existing Host registration is still live or cannot be verified.");
      }
      atomicWriteJson(registryPath, entry);
    },
    unpublish(instanceId: string) {
      if (read()?.instanceId === instanceId) unlinkSync(registryPath);
    },
  };
}
