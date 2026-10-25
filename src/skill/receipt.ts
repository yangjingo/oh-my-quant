import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { RECEIPT, safeSkillPath } from "./archive.ts";
import { isRevision } from "./github.ts";

export interface SkillReceipt { version: 1; repo: string; revision: string; files: Record<string, string> }

export function skillFiles(directory: string, prefix = "", result: Record<string, string> = Object.create(null)): Record<string, string> {
  for (const name of readdirSync(join(directory, prefix)).sort()) {
    if (!prefix && name === RECEIPT) continue;
    const path = prefix + name, full = join(directory, path), stat = lstatSync(full);
    if (!safeSkillPath(path) || stat.isSymbolicLink()) throw new Error("Local changes or unsupported files exist; installation preserved.");
    if (stat.isDirectory()) skillFiles(directory, path + "/", result);
    else if (stat.isFile()) {
      if (stat.size > 128 * 1024 * 1024) throw new Error("Local file exceeds the archive limit; installation preserved.");
      result[path] = createHash("sha256").update(readFileSync(full)).digest("hex");
    }
    else throw new Error("Local special files exist; installation preserved.");
  }
  return result;
}

export function readSkillReceipt(directory: string, repo: string): SkillReceipt {
  let data: unknown;
  try {
    const path = join(directory, RECEIPT);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error();
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch { throw new Error("This folder has no valid archive-install receipt. Existing Git/manual skills remain usable and untouched. Move the folder outside the managed skills directory, then reinstall; keep your old folder and edits."); }
  const value = data as SkillReceipt;
  if (!value || value.version !== 1 || typeof value.repo !== "string" || value.repo.toLowerCase() !== repo.toLowerCase()
    || !isRevision(value.revision) || !value.files || typeof value.files !== "object" || Array.isArray(value.files)
    || !Object.keys(value.files).length || Object.entries(value.files).some(([path, hash]) => !safeSkillPath(path) || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))) {
    throw new Error("Invalid skill receipt or different repository; existing installation preserved.");
  }
  return value;
}

export function assertSkillFiles(directory: string, receipt: SkillReceipt): void {
  const actual = skillFiles(directory);
  if (Object.keys(actual).length !== Object.keys(receipt.files).length || Object.entries(actual).some(([path, hash]) => receipt.files[path] !== hash)) {
    throw new Error("Local changes or untracked files exist. Save them before updating; existing installation preserved.");
  }
}
