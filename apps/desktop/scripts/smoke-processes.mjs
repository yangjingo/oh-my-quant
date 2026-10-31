import { execFileSync } from "node:child_process";
import { join } from "node:path";

// A name-only query is intentional: installation acceptance runs on a disposable
// Windows account and must reject every surviving CLI, including an earlier launch.
export function inspectProcesses(name, run = execFileSync) {
  const query = { method: "System.Diagnostics.Process.GetProcessesByName", name,
    startedAt: new Date().toISOString(), timeoutMs: 20000 };
  const start = performance.now();
  let output;
  try {
    output = run(join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference = 'Stop'; [Console]::Error.WriteLine('WHYJ_QUERY_STAGE=start'); $ids = @([System.Diagnostics.Process]::GetProcessesByName($env:WHYJ_SMOKE_PROCESS_NAME) | ForEach-Object { $_.Id }); [Console]::Error.WriteLine('WHYJ_QUERY_STAGE=enumerated'); ConvertTo-Json -Compress -InputObject $ids"],
      { windowsHide: true, encoding: "utf8", timeout: query.timeoutMs,
        env: { ...process.env, WHYJ_SMOKE_PROCESS_NAME: name } });
    const pids = JSON.parse(output);
    if (!Array.isArray(pids) || !pids.every(pid => Number.isSafeInteger(pid) && pid > 0)) {
      throw new Error("Process query returned an invalid PID array");
    }
    return { ...query, durationMs: Math.round(performance.now() - start), pids };
  } catch (error) {
    error.processQuery = { ...query, durationMs: Math.round(performance.now() - start),
      code: error.code, status: error.status, signal: error.signal,
      stdout: error.stdout?.toString() ?? output, stderr: error.stderr?.toString() };
    throw error;
  }
}
