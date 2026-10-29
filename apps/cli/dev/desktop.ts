import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Ask only our development child to quit through Electron's normal lifecycle. */
export async function superviseDesktop(executable: string, args: string[], cwd: string, signal?: AbortSignal): Promise<number> {
  if (signal?.aborted) return 0;
  const child = spawn(executable, args, { cwd, detached: true, stdio: ["inherit", "inherit", "inherit", "ipc"],
    env: { ...process.env, WHYJ_DESKTOP_DEV_CONTROL: "1" } });
  let stopping = false, deadline: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    if (child.connected) child.send({ type: "whyj-development-quit" }, error => { if (error) child.kill(); });
    else child.kill();
    deadline = setTimeout(() => { if (child.exitCode === null) { console.error("Desktop did not exit; stopping the development process."); child.kill(); } }, 15_000);
    deadline.unref?.();
  };
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  try { const code = await childExit(child); return stopping ? 0 : code; }
  finally { signal?.removeEventListener("abort", stop); if (deadline) clearTimeout(deadline); }
}

function childExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => resolve(code ?? 1)); });
}

/** Build the shared Web/Host assets and run the existing Desktop entry. */
export async function runDesktopDevelopment(signal?: AbortSignal): Promise<number> {
  if (signal?.aborted) return 0;
  const desktop = fileURLToPath(new URL("../../desktop/", import.meta.url));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const vite = join(root, "apps/web/node_modules/vite/bin/vite.js");
  if (!existsSync(vite)) throw new Error("Web dependencies are missing. Run bun install --cwd apps/web --frozen-lockfile.");
  let executable: string;
  try { executable = createRequire(join(desktop, "package.json"))("electron") as string; }
  catch { throw new Error("Desktop dependencies are missing. Run bun install --cwd apps/desktop --frozen-lockfile."); }
  console.log("Building the shared workbench and Desktop development entry.");
  const build = spawn(process.execPath, ["run", join(desktop, "scripts/build.ts")], { cwd: root, stdio: "inherit" });
  const stopBuild = () => build.kill();
  signal?.addEventListener("abort", stopBuild, { once: true });
  if (signal?.aborted) stopBuild();
  let code: number;
  try { code = await childExit(build); }
  finally { signal?.removeEventListener("abort", stopBuild); }
  if (signal?.aborted) return 0;
  if (code !== 0) return code;
  console.log("Starting Desktop. Closing its window hides it to the tray; quit from the tray or press Ctrl+C here.");
  return superviseDesktop(executable, [desktop], desktop, signal);
}

if (import.meta.main) {
  const controller = new AbortController(), stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  runDesktopDevelopment(controller.signal).then(code => { process.exitCode = code; }, error => {
    console.error(`Desktop development failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1;
  }).finally(() => { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); });
}
