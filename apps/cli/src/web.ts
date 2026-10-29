import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { connectWorkspaceHost, type HostConnection } from "../../../src/app/bootstrap.ts";

/** Open only the authenticated loopback endpoint, without invoking a shell. */
export async function openWorkbench(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || parsed.username || parsed.password
    || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error("Invalid local Host URL.");
  const command = process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", parsed.href] : [parsed.href];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true });
    const timer = setTimeout(() => { child.unref(); resolve(); }, 3000);
    child.once("error", () => { clearTimeout(timer); reject(new Error("No browser handler is available.")); });
    child.once("exit", code => {
      clearTimeout(timer);
      if (code === 0) resolve(); else reject(new Error("The browser handler could not open the workbench."));
    });
  });
}

export function cliHostOptions() {
  const source = import.meta.url.endsWith(".ts");
  return {
    executable: process.env.WHYJ_BUN_EXECUTABLE || process.execPath,
    entrypoint: fileURLToPath(new URL(source ? "../../../src/app/host/run.ts" : "./host.js", import.meta.url)),
  };
}

export async function runWebCommand(args: string[], ports: {
  connect?: () => Promise<HostConnection>; open?: (url: string) => Promise<void>;
} = {}) {
  if (args.some(arg => arg !== "--no-open") || args.length > 1) {
    throw Object.assign(new Error("Use whyj [--json] web [--no-open]."), { code: "invalid_arguments" });
  }
  const connection = await (ports.connect ?? (() => connectWorkspaceHost(cliHostOptions())))();
  let warning: string | undefined;
  const requested = !args.includes("--no-open");
  if (requested) {
    try { await (ports.open ?? openWorkbench)(connection.url); }
    catch { warning = "Could not open a browser. Open the displayed local URL manually; the Host is still available."; }
  }
  // Deliberately whitelist output: capabilities never reach argv, JSON or logs.
  return { url: connection.url, workspaceId: connection.workspaceId, instanceId: connection.instanceId,
    started: connection.started, browserOpened: requested && !warning, ...(warning ? { warning } : {}) };
}
