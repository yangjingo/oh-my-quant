import { createHash } from "node:crypto";
import { mkdirSync, realpathSync, statSync } from "node:fs";
import { ensureDirs, resolveOhquantDir } from "../../storage/index.ts";

/** Resolve links and filesystem casing before hashing; paths never enter public state. */
export function researchWorkspaceId(root?: string): string {
  if (root === undefined) ensureDirs(); else mkdirSync(root, { recursive: true });
  let canonical = realpathSync.native(root ?? resolveOhquantDir());
  if (process.platform === "win32") {
    // Preserve the existing identity on ordinary Windows roots, but do not
    // collapse distinct directories when case-sensitive names are enabled.
    const alternate = canonical.replace(/[a-z]/gi, char => char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase());
    const original = statSync(canonical), other = statSync(alternate, { throwIfNoEntry: false });
    if (other && original.dev === other.dev && original.ino === other.ino) canonical = canonical.toLowerCase();
  }
  return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
}
