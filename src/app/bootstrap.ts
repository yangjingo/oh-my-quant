import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createHostRuntimeStore, hostProcessState, type HostRegistration } from "../storage/index.ts";
import { researchWorkspaceId } from "./services/workspace.ts";
import { assertCompatibleHost, HOST_READY_TIMEOUT_MS, publicHostIdentity } from "./host/protocol.ts";
import { launchHostProcess } from "./host/process.ts";

const failure = (code: string, message: string) => Object.assign(new Error(message), { code });
export interface HostConnection extends ReturnType<typeof publicHostIdentity> {
  /** Capability for local callers; never log this object or pass it in a URL. */
  token: string;
  controlToken: string;
  started: boolean;
}

async function probe(entry: HostRegistration, workspaceId: string, timeoutMs: number) {
  assertCompatibleHost(entry, workspaceId);
  let response: Response;
  try { response = await fetch(entry.url + "/api/host/ready", { headers: { "x-workbench-token": entry.token }, redirect: "error", signal: AbortSignal.timeout(timeoutMs) }); }
  catch { throw failure("HOST_UNREACHABLE", "The registered Host is alive or its liveness is unknown, but readiness could not be authenticated. No replacement was started."); }
  if (!response.ok) throw failure("HOST_NOT_READY", "The registered Host refused authenticated readiness. No replacement was started.");
  const value = await response.json() as ReturnType<typeof publicHostIdentity>;
  if (value.instanceId !== entry.instanceId || value.url !== entry.url) throw failure("HOST_IDENTITY_CONFLICT", "The endpoint is not the registered Host instance.");
  assertCompatibleHost(value, workspaceId);
  return { ...publicHostIdentity(entry), token: entry.token, controlToken: entry.controlToken };
}

/** Discover an already registered owner without starting a replacement. */
export async function connectExistingWorkspaceHost(): Promise<HostConnection> {
  const registry = createHostRuntimeStore(), entry = registry.read(), owner = registry.readOwner("owner");
  if (!entry || !owner || owner.instanceId !== entry.instanceId || owner.pid !== entry.pid || hostProcessState(entry.pid) === "dead")
    throw failure("HOST_OWNER_NOT_READY", "The workspace owner is unavailable or not ready; no replacement was started.");
  return { ...await probe(entry, researchWorkspaceId(registry.root), 2000), started: false };
}

/** Launch/connect only. Entry adapters own presentation, not the detached process. */
export async function connectWorkspaceHost(options: {
  workspaceRoot?: string; timeoutMs?: number; bunExecutable?: string; executable?: string;
  /** Alternate bundled entry for packaging/tests; never supplied over HTTP. */
  entrypoint?: string;
} = {}): Promise<HostConnection> {
  const timeout = options.timeoutMs ?? HOST_READY_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 50 || timeout > 120_000) throw failure("HOST_ARGUMENT_INVALID", "Host readiness timeout must be 50..120000 ms.");
  const registry = createHostRuntimeStore(options.workspaceRoot), workspaceId = researchWorkspaceId(registry.root);
  const deadline = Date.now() + timeout;
  let startup: ReturnType<typeof registry.acquire> | undefined;
  while (!startup) {
    try { startup = registry.acquire("startup"); }
    catch (error) {
      if ((error as { code?: string }).code !== "HOST_LOCKED") throw error;
      if (Date.now() >= deadline) throw failure("HOST_STARTUP_BUSY", "Another launcher still owns workspace discovery. No second Host was started.");
      await delay(25);
    }
  }
  let child: Awaited<ReturnType<typeof launchHostProcess>> | undefined;
  try {
    const existing = registry.read();
    if (existing && hostProcessState(existing.pid) !== "dead") {
      const owner = registry.readOwner("owner");
      if (owner?.instanceId !== existing.instanceId || owner.pid !== existing.pid) throw failure("HOST_IDENTITY_CONFLICT", "Host registration and execution ownership disagree; both were preserved.");
      return { ...await probe(existing, workspaceId, Math.max(1, Math.min(2000, deadline - Date.now()))), started: false };
    }
    const owner = registry.readOwner("owner");
    if (owner && hostProcessState(owner.pid) !== "dead") throw failure("HOST_OWNER_NOT_READY", "A live or unverified execution owner has not published readiness. No duplicate was started.");
    const executable = options.executable ?? options.bunExecutable ?? (process.versions.bun ? process.execPath : undefined);
    if (!executable) throw failure("HOST_RUNTIME_REQUIRED", "Provide a runtime executable for this Host entry; Node/Electron callers must select a compatible child runtime explicitly.");
    child = await launchHostProcess(executable, options.entrypoint ?? fileURLToPath(new URL("./host/run.ts", import.meta.url)), registry.root);
    for (;;) {
      if (child.terminal()) throw failure("HOST_START_FAILED", child.failed() ? "The Host process could not be launched." : "The Host exited before authenticated readiness; check assets and local configuration.");
      const published = registry.read();
      if (published && published.pid === child.pid && registry.readOwner("owner")?.instanceId === published.instanceId) {
        const connection = await probe(published, workspaceId, Math.max(1, Math.min(2000, deadline - Date.now())));
        child.unref();
        return { ...connection, started: true };
      }
      if (Date.now() >= deadline) throw failure("HOST_READY_TIMEOUT", "The new Host did not become ready within the startup budget.");
      await delay(25);
    }
  } catch (error) {
    if (child && !child.terminal()) {
      // Only the retained child of this launch is eligible. Once readiness was
      // published it may already serve another caller, so do not kill it here.
      let published = true;
      try { published = registry.read()?.pid === child.pid; } catch { /* Uncertain ownership is not cleanup authority. */ }
      if (!published) {
        child.kill();
        const until = Date.now() + 2000;
        while (!child.terminal() && Date.now() < until) await delay(10);
      }
      child.unref();
    }
    if (child?.terminal()) child.unref();
    throw error;
  } finally { startup.release(); }
}

export async function stopWorkspaceHost(connection: HostConnection, mode: "explicit" | "if-idle" = "explicit") {
  if (mode === "if-idle" && !connection.started) throw failure("HOST_NOT_STARTED_HERE", "Detaching an entry that reused the Host does not authorize stopping it.");
  const response = await fetch(connection.url + "/api/host/shutdown", { method: "POST", redirect: "error", signal: AbortSignal.timeout(2000),
    headers: { "content-type": "application/json", "x-workbench-token": connection.token, "x-host-control-token": connection.controlToken },
    body: JSON.stringify({ instanceId: connection.instanceId, mode }),
  });
  if (!response.ok) throw failure("HOST_STOP_REFUSED", "The Host did not accept shutdown; it remains owned by the existing instance.");
}

/** Entry presence is explicit; releasing it never cancels work or stops the Host. */
export async function attachWorkspaceHost(connection: HostConnection, kind: "web" | "tui" | "desktop") {
  async function send(action: string, clientId?: string) {
    const response = await fetch(connection.url + "/api/host/clients", { method: "POST", redirect: "error", signal: AbortSignal.timeout(2000),
      headers: { "content-type": "application/json", "x-workbench-token": connection.token },
      body: JSON.stringify({ instanceId: connection.instanceId, action, ...(clientId ? { clientId } : { kind }) }),
    });
    if (!response.ok) throw failure("HOST_CLIENT_FAILED", "Client registration changed or the Host disconnected; reconnect explicitly.");
    return await response.json() as { clientId: string; expiresAt: number };
  }
  const registration = await send("attach");
  return { clientId: registration.clientId, renew: () => send("renew", registration.clientId), detach: () => send("detach", registration.clientId) };
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || args.length === 1 && args[0] !== "--stop") throw failure("HOST_ARGUMENT_INVALID", "Use this launcher with no arguments or --stop; select the workspace with OHQUANT_DIR.");
    if (args[0] === "--stop") {
      const registry = createHostRuntimeStore(), existing = registry.read();
      if (!existing || hostProcessState(existing.pid) === "dead") console.log("No running workspace Host.");
      else {
        const connection = await probe(existing, researchWorkspaceId(registry.root), 2000);
        await stopWorkspaceHost({ ...connection, started: false });
        console.log("Workspace Host shutdown accepted; active requests are being stopped.");
      }
    } else {
      const connection = await connectWorkspaceHost();
      console.log("WhyJ Agent workbench: " + connection.url + (connection.started ? " (started)" : " (reused)"));
    }
  } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
