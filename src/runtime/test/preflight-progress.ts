type PipedChild = {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
};

/** Observe only timing and stream completion for the synthetic CLI test child. */
export function monitorPreflight(child: PipedChild, started: number) {
  const spawnedMs = Math.round(performance.now() - started);
  let stdoutMs: number | null = null, stderrMs: number | null = null, exitMs: number | null = null;
  const elapsed = () => Math.round(performance.now() - started);
  const stdout = new Response(child.stdout).text().then(value => { stdoutMs = elapsed(); return value; });
  const stderr = new Response(child.stderr).text().then(value => { stderrMs = elapsed(); return value; });
  const exit = child.exited.then(value => { exitMs = elapsed(); return value; });
  return {
    stdout, stderr, exit,
    report(reason: "watchdog" | "teardown", log = console.error) {
      // Logging must never prevent the child from being killed or drained.
      try { log("WHYJ_PREFLIGHT_PROGRESS " + JSON.stringify({ reason, elapsedMs: elapsed(), spawnedMs, stdoutMs, stderrMs, exitMs })); }
      catch { /* Preserve the original timeout and fixture ownership. */ }
    },
  };
}
