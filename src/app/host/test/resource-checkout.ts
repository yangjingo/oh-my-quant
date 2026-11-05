import { existsSync, lstatSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

/** Drain a bounded fixture process before teardown; report the operation that failed. */
export async function runCheckoutCommand(cwd: string, command: string[], timeoutMs = 20_000): Promise<string> {
  const started = performance.now();
  const child = Bun.spawn(command, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: timeoutMs, killSignal: "SIGKILL" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code !== 0 || child.signalCode) throw new Error(
    `Checkout command ${JSON.stringify(command)} failed: exit=${code}, signal=${child.signalCode ?? "none"}, elapsedMs=${Math.round(performance.now() - started)}, budgetMs=${timeoutMs}\n${stderr || stdout}`);
  return stdout.trim();
}

/** This regression needs src/ and root manifests, not a second copy of app/site/docs assets. */
export async function withResourceCheckout(repo: string, run: (fixture: { checkout: string; scratch: string }) => Promise<void>,
  overrides: { git?: (cwd: string, args: string[]) => Promise<string>; remove?: (scratch: string) => void } = {}): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), "whyj-resource-test-"));
  const scratchReal = realpathSync(scratch), tempReal = realpathSync(tmpdir());
  const validateRoot = () => {
    if (realpathSync(scratch) !== scratchReal || dirname(scratchReal) !== tempReal || !basename(scratchReal).startsWith("whyj-resource-test-"))
      throw new Error("Resource fixture directory changed before cleanup");
  };
  validateRoot();
  const checkout = join(scratch, "checkout"), modules = join(checkout, "node_modules");
  const git = overrides.git ?? ((cwd, args) => runCheckoutCommand(cwd, ["git", ...args]));
  let failed = false, primary: unknown;
  try {
    const revision = await git(repo, ["rev-parse", "HEAD"]);
    // Independent Git metadata avoids registering a partial worktree or changing
    // the caller's sparse-checkout configuration. Objects remain read-only/shared.
    await git(repo, ["clone", "--shared", "--no-checkout", "--single-branch", "--no-tags", "--", repo, checkout]);
    await git(checkout, ["sparse-checkout", "set", "--cone", "src"]);
    await git(checkout, ["checkout", "--detach", revision]);
    if (await git(checkout, ["rev-parse", "HEAD"]) !== revision || await git(checkout, ["status", "--porcelain", "--untracked-files=no"]))
      throw new Error("Resource fixture is not a clean pinned checkout");
    symlinkSync(realpathSync(join(repo, "node_modules")), modules, process.platform === "win32" ? "junction" : "dir");
    await run({ checkout, scratch });
  } catch (error) { failed = true; primary = error; }
  try {
    validateRoot();
    if (existsSync(checkout) && (lstatSync(checkout).isSymbolicLink() || dirname(realpathSync(checkout)) !== scratchReal))
      throw new Error("Resource checkout escaped its owned directory");
    // Detach the only external directory before any recursive removal.
    const moduleStat = lstatSync(modules, { throwIfNoEntry: false });
    if (moduleStat) {
      if (!moduleStat.isSymbolicLink()) throw new Error("Unexpected non-link fixture dependencies");
      unlinkSync(modules);
    }
    if (overrides.remove) overrides.remove(scratchReal);
    else rmSync(scratchReal, { recursive: true });
  } catch (cleanup) {
    throw new AggregateError(failed ? [primary, cleanup] : [cleanup],
      `Resource fixture cleanup failed; retained ${scratchReal}`, { cause: failed ? primary : cleanup });
  }
  if (failed) throw primary;
}
