import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { userInfo } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { atomicWriteJson } from "./atomic-file.ts";
import { createHostRuntimeStore, hostProcessState } from "./host-runtime.ts";

type Mode = "read" | "write";
export type ResourceLeaseRequest = { directory: string; mode: Mode };
type Holder = { id: string; pid: number; mode: Mode };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail = (message: string, code: string) => Object.assign(new Error(message), { code });

/** Resolve existing aliases without creating a resource directory merely to read it. */
function resourceIdentity(directory: string): string {
  let ancestor = resolve(directory); const missing: string[] = [];
  for (;;) {
    try { lstatSync(ancestor); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.unshift(basename(ancestor)); ancestor = parent;
    }
  }
  const canonical = realpathSync.native(ancestor), stat = statSync(canonical);
  if (!stat.isDirectory()) throw fail("Resource path ancestor is not a directory.", "RESOURCE_LEASE_INVALID");
  let result = join(canonical, ...missing);
  if (process.platform === "win32") {
    const alternate = canonical.replace(/[a-z]/gi, char => char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase());
    const other = statSync(alternate, { throwIfNoEntry: false });
    if (other && stat.dev === other.dev && stat.ino === other.ino) result = result.toLowerCase();
  }
  return result;
}

/** Per-account shared namespace. Override exists for isolated tests and must match across cooperating processes. */
export function resourceLeaseMetadataPath(directory: string): string {
  const configured = process.env.WHYJ_RESOURCE_LEASE_ROOT;
  if (configured && !isAbsolute(configured)) throw fail("Resource lease root must be absolute.", "RESOURCE_LEASE_INVALID");
  const base = configured ? resolve(configured) : join(userInfo().homedir, ".whyj-quant", "resource-leases");
  return join(base, createHash("sha256").update(resourceIdentity(directory)).digest("hex"));
}
function registryPath(directory: string): string {
  const metadata = resourceLeaseMetadataPath(directory);
  mkdirSync(metadata, { recursive: true, mode: 0o700 });
  const stat = lstatSync(metadata);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail("Resource lease directory is invalid; it was preserved.", "RESOURCE_LEASE_INVALID");
  return join(metadata, "holders.json");
}

function readHolders(path: string): Holder[] {
  let text: string;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw fail("Resource lease registry is invalid; it was preserved.", "RESOURCE_LEASE_INVALID");
    text = readFileSync(path, "utf8");
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw fail("Resource lease registry is unreadable; it was preserved.", "RESOURCE_LEASE_INVALID"); }
  if (!value || typeof value !== "object" || Array.isArray(value) || (value as { version?: unknown }).version !== 1
    || !Array.isArray((value as { holders?: unknown }).holders)) throw fail("Resource lease registry is invalid; it was preserved.", "RESOURCE_LEASE_INVALID");
  const holders = (value as { holders: unknown[] }).holders;
  if (holders.some(item => !item || typeof item !== "object" || Array.isArray(item)
    || Object.keys(item).sort().join(",") !== "id,mode,pid"
    || !uuid.test(String((item as Holder).id)) || !Number.isSafeInteger((item as Holder).pid) || (item as Holder).pid <= 0
    || !["read", "write"].includes((item as Holder).mode))
    || new Set(holders.map(item => (item as Holder).id)).size !== holders.length)
    throw fail("Resource lease holders are invalid; they were preserved.", "RESOURCE_LEASE_INVALID");
  return holders as Holder[];
}

/** Serialize registry edits with a process-owned gate, not a time-based stale lease. */
async function withRegistryGate<T>(path: string, operation: () => T, signal?: AbortSignal): Promise<T> {
  const store = createHostRuntimeStore(dirname(path)), deadline = Date.now() + 12_000;
  for (;;) {
    signal?.throwIfAborted();
    let gate: ReturnType<typeof store.acquire>;
    try { gate = store.acquire("owner"); }
    catch (error) {
      if ((error as { code?: string }).code !== "HOST_LOCKED" || Date.now() >= deadline) throw error;
      await delay(25, undefined, { signal }); continue;
    }
    try { signal?.throwIfAborted(); return operation(); } finally { gate.release(); }
  }
}

/** Short registry locks protect long-lived PID-bound leases; only confirmed-dead holders are reclaimed. */
export async function acquireResourceLeases(directories: readonly string[], mode: Mode, signal?: AbortSignal): Promise<() => Promise<void>> {
  if (mode !== "read" && mode !== "write") throw fail("Unknown resource lease mode.", "RESOURCE_LEASE_INVALID");
  return acquireResourceLeaseSet(directories.map(directory => ({ directory, mode })), signal);
}

/** Acquire mixed read/write scopes in a stable order; aliases share the strongest mode. */
export async function acquireResourceLeaseSet(requests: readonly ResourceLeaseRequest[], signal?: AbortSignal): Promise<() => Promise<void>> {
  const scopes = new Map<string, Mode>();
  for (const request of requests) {
    if (request.mode !== "read" && request.mode !== "write") throw fail("Unknown resource lease mode.", "RESOURCE_LEASE_INVALID");
    const path = registryPath(request.directory);
    scopes.set(path, request.mode === "write" || scopes.get(path) === "write" ? "write" : "read");
  }
  const paths = [...scopes.keys()].sort(), id = randomUUID(), pid = process.pid;
  const acquired: string[] = [];
  let releasing: Promise<void> | undefined;
  async function release() {
    if (releasing) return releasing;
    releasing = (async () => {
      const failures: unknown[] = [];
      for (const path of [...acquired].reverse()) {
        try {
          await withRegistryGate(path, () => {
            const before = readHolders(path), after = before.filter(item => item.id !== id || item.pid !== pid);
            if (after.length !== before.length) atomicWriteJson(path, { version: 1, holders: after });
          });
          acquired.splice(acquired.indexOf(path), 1);
        } catch (error) { failures.push(error); }
      }
      if (failures.length) throw fail("Could not release resource leases; owner records were preserved.", "RESOURCE_LEASE_RELEASE_FAILED");
    })();
    try { await releasing; } finally { releasing = undefined; }
  }
  try {
    for (const path of paths) {
      await withRegistryGate(path, () => {
        signal?.throwIfAborted();
        const active = readHolders(path).filter(item => hostProcessState(item.pid) !== "dead");
        const mode = scopes.get(path)!;
        if (active.some(item => mode === "write" || item.mode === "write"))
          throw fail("A shared resource is in use by another operation.", "RESOURCES_IN_USE");
        atomicWriteJson(path, { version: 1, holders: [...active, { id, pid, mode }] });
        acquired.push(path);
      }, signal);
    }
    return release;
  } catch (error) { await release(); throw error; }
}
