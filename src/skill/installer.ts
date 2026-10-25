import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { extractSkillArchive, RECEIPT, safeSkillPath } from "./archive.ts";
import { isRevision, skillGithub, type SkillFetch } from "./github.ts";
import { assertSkillFiles, readSkillReceipt, skillFiles, type SkillReceipt } from "./receipt.ts";

export type { SkillFetch } from "./github.ts";
export interface SkillInstallResult { success: boolean; message: string; revision?: string; source?: string }
export interface SkillRevisionPin { revision: string; requiredFiles: readonly string[] }
const activeInstalls = new Set<string>();

export async function installSkillRepository(root: string, repo: string, request: SkillFetch = fetch, signal?: AbortSignal, pin?: SkillRevisionPin): Promise<SkillInstallResult> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repo)) {
    return { success: false, message: "Use a GitHub repo in owner/repo format, for example: /skill install LLMQuant/skills" };
  }
  if (pin && (!isRevision(pin.revision) || pin.requiredFiles.some(path => !safeSkillPath(path)))) {
    return { success: false, message: "Invalid pinned revision or required file path." };
  }
  const target = resolve(root, repo.replace("/", "-")), source = `https://github.com/${repo}.git`;
  const lock = process.platform === "win32" ? target.toLowerCase() : target;
  if (activeInstalls.has(lock)) return { success: false, message: `Installation already running for ${repo}. Wait and retry.` };
  activeInstalls.add(lock);
  let staging: string | undefined, preserveStaging = false;
  try {
    signal?.throwIfAborted();
    const updating = existsSync(target);
    let receipt: SkillReceipt | undefined, receiptText: string | undefined;
    if (updating) {
      if (lstatSync(target).isSymbolicLink() || !lstatSync(target).isDirectory()) throw new Error("Install location must be a directory, not a link or file.");
      receipt = readSkillReceipt(target, repo);
      receiptText = readFileSync(join(target, RECEIPT), "utf8");
      assertSkillFiles(target, receipt);
    }
    const github = skillGithub(request, signal);
    const revision = pin?.revision ?? await github.revision(repo);
    if (receipt?.revision === revision) {
      for (const file of pin?.requiredFiles ?? []) if (!existsSync(join(target, file)) || !statSync(join(target, file)).isFile()) throw new Error(`Pinned skill entry is missing: ${file}`);
      return { success: true, source, revision, message: `Already installed ${repo}\nLocation  ${target}\nRevision  ${revision}` };
    }
    if (receipt) await github.forward(repo, receipt.revision, revision);
    mkdirSync(root, { recursive: true });
    staging = mkdtempSync(join(resolve(root), ".install-"));
    const payload = await extractSkillArchive(await github.archive(repo, revision), staging, signal);
    for (const file of pin?.requiredFiles ?? []) if (!existsSync(join(payload, file)) || !statSync(join(payload, file)).isFile()) throw new Error(`Pinned skill entry is missing: ${file}`);
    const next: SkillReceipt = { version: 1, repo, revision, files: skillFiles(payload) };
    const serialized = JSON.stringify(next, null, 2) + "\n";
    if (Buffer.byteLength(serialized) > 2 * 1024 * 1024) throw new Error("Skill receipt exceeds the 2 MiB limit.");
    writeFileSync(join(payload, RECEIPT), serialized, { flag: "wx" });
    signal?.throwIfAborted();
    // Recheck after network/extraction. No await between the final check and publication.
    if (receipt) {
      if (lstatSync(target).isSymbolicLink() || readFileSync(join(target, RECEIPT), "utf8") !== receiptText) throw new Error("Installation changed during download; retry without overwriting local files.");
      assertSkillFiles(target, receipt);
      const previous = join(staging, "previous");
      renameSync(target, previous);
      try { renameSync(payload, target); }
      catch (error) {
        try { renameSync(previous, target); }
        catch { preserveStaging = true; throw new Error(`Could not restore the previous installation. Its files are preserved at ${previous}.`); }
        throw error;
      }
    } else {
      if (existsSync(target)) throw new Error("Another installation created the destination. Retry to inspect it.");
      renameSync(payload, target);
    }
    return { success: true, source, revision,
      message: `${updating ? "Updated" : "Installed"} ${repo}\nLocation  ${target}\nRevision  ${revision}\nNext      Run /skill after the current response finishes to discover installed skills. Follow the upstream skill instructions for credentials and dependencies.` };
  } catch (error) {
    return { success: false, message: `Could not install or update ${repo}.\nLocation: ${target}\nCause: ${error instanceof Error ? error.message : String(error)}\nCheck local changes and GitHub access, then retry /skill install ${repo}.` };
  } finally {
    activeInstalls.delete(lock);
    if (staging && !preserveStaging && existsSync(staging)) {
      const within = relative(realpathSync(root), realpathSync(staging));
      if (!within.startsWith(".install-") || within.includes(sep) || resolve(root) === resolve(staging)) throw new Error("Refusing to clean staging outside the installation root.");
      rmSync(staging, { recursive: true, force: true });
    }
  }
}
