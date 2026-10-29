import { cpSync, lstatSync, rmSync, type Stats } from "node:fs";
import { dirname, resolve } from "node:path";

/** Replace only the generated Web bundle; never follow a linked destination. */
export function replaceWebAssets(desktop: string, source: string): void {
  const runtime = resolve(desktop, "runtime"), target = resolve(runtime, "web");
  if (dirname(target) !== runtime || lstatSync(runtime).isSymbolicLink()) throw new Error("Invalid Desktop runtime directory");
  const incoming = lstatSync(source);
  if (!incoming.isDirectory() || incoming.isSymbolicLink()) throw new Error("Invalid Web build directory");
  let existing: Stats | undefined;
  try { existing = lstatSync(target); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error("Invalid Desktop Web runtime directory");
    rmSync(target, { recursive: true, force: true });
  }
  cpSync(source, target, { recursive: true });
}
