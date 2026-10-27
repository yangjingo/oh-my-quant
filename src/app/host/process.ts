import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hostProcessState } from "../../storage/index.ts";

export interface HostProcess {
  pid: number | undefined;
  terminal(): boolean;
  failed(): boolean;
  kill(): void;
  unref(): void;
}

/** Retain the owned child until readiness; Windows Bun needs a shell launch broker
 * to avoid passing the outer `bun run` shell's pipe handles to the detached Host. */
export async function launchHostProcess(executable: string, entrypoint: string, workspaceRoot: string): Promise<HostProcess> {
  const env = { ...process.env, OHQUANT_DIR: workspaceRoot };
  let terminal = false, failed = false;
  if (process.platform === "win32" && process.versions.bun) {
    const powershell = Bun.which("pwsh") ?? Bun.which("powershell");
    if (!powershell) throw Object.assign(new Error("PowerShell is required for detached Windows Host launch."), { code: "HOST_SHELL_REQUIRED" });
    const broker = spawn(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", fileURLToPath(new URL("./windows-launch.ps1", import.meta.url)), "-BunExecutable", executable, "-EntryPoint", entrypoint], {
      cwd: process.cwd(), env, windowsHide: true, stdio: ["pipe", "pipe", "ignore"],
    });
    let detached = false, output = "";
    broker.stdin!.on("error", () => { if (!detached) terminal = true; });
    broker.once("error", () => { failed = true; terminal = true; });
    broker.once("exit", () => { if (!detached) terminal = true; });
    const pid = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => { broker.stdin?.end("kill\n"); reject(new Error("Windows Host launch broker did not respond.")); }, 2000);
      const fail = () => { clearTimeout(timer); reject(new Error("Windows Host launch broker failed.")); };
      broker.once("error", fail); broker.once("exit", fail);
      broker.stdout!.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
        if (output.length > 100) { broker.stdin?.end("kill\n"); fail(); return; }
        if (!output.includes("\n")) return;
        const value = Number(output.trim());
        if (!Number.isSafeInteger(value) || value < 1) { broker.stdin?.end("kill\n"); fail(); return; }
        clearTimeout(timer); broker.removeListener("error", fail); broker.removeListener("exit", fail); resolve(value);
      });
    });
    return { pid, terminal: () => terminal || hostProcessState(pid) === "dead", failed: () => failed,
      kill() { broker.stdin!.end("kill\n"); },
      unref() { if (!detached) { detached = true; if (!broker.stdin!.writableEnded) broker.stdin!.end("detach\n"); broker.unref(); } },
    };
  }
  const child = spawn(executable, [entrypoint], { cwd: process.cwd(), env, detached: true, windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
  child.once("error", () => { failed = true; terminal = true; });
  child.once("exit", () => { terminal = true; });
  return { pid: child.pid, terminal: () => terminal, failed: () => failed, kill: () => { child.kill("SIGKILL"); }, unref: () => child.unref() };
}
