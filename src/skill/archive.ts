import { createWriteStream, mkdirSync } from "node:fs";
import { join, posix } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { list, extract } from "tar";

export const RECEIPT = ".whyj-skill.json";
export function safeSkillPath(path: string): boolean {
  return path.length > 0 && path.split("/").every(part => part && part !== "." && part !== ".."
    && !/[<>:"\\|?*\u0000-\u001f]/.test(part) && !/[. ]$/.test(part)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    && part.toLowerCase() !== ".git" && part.toLowerCase() !== RECEIPT);
}

/** Validate every entry before writing any repository file; links are never extracted. */
export async function extractSkillArchive(archive: Buffer, staging: string, signal?: AbortSignal): Promise<string> {
  const file = join(staging, "archive.tar"), payload = join(staging, "payload");
  let expanded = 0;
  await pipeline(Readable.from([archive]), createGunzip(), new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      expanded += chunk.length;
      callback(expanded > 128 * 1024 * 1024 ? new Error("Skill archive exceeds the 128 MiB expanded limit.") : null, chunk);
    },
  }), createWriteStream(file, { flags: "wx" }), { signal });
  let failure: Error | undefined, root: string | undefined, count = 0, fileCount = 0;
  const seen = new Set<string>();
  await list({ file, strict: true, onReadEntry(entry) {
    const path = entry.path.replace(/\/$/, ""), parts = path.split("/");
    // GitHub archives can contain example-directory symlinks. Validate their
    // destination but omit them: Windows snapshots never need link privileges.
    const link = entry.type === "SymbolicLink";
    const destination = link ? posix.join(posix.dirname(path), entry.linkpath ?? "") : "";
    const safeLink = link && !!entry.linkpath && !posix.isAbsolute(entry.linkpath)
      && safeSkillPath(destination) && destination.startsWith(parts[0] + "/");
    if (++count > 10_000 || !safeSkillPath(path) || (!["File", "Directory"].includes(entry.type) && !safeLink)
      || (root && parts[0] !== root) || (parts.length === 1 && entry.type !== "Directory") || seen.has(path.toLowerCase())) {
      failure ??= new Error("Unsafe, duplicate, unsupported or oversized skill archive entry.");
    }
    root ??= parts[0];
    seen.add(path.toLowerCase());
    if (entry.type === "File") fileCount++;
  } });
  if (failure) throw failure;
  if (!fileCount) throw new Error("Skill archive contains no repository files.");
  signal?.throwIfAborted();
  mkdirSync(payload);
  await extract({ file, cwd: payload, strip: 1, strict: true, preserveOwner: false, noMtime: true,
    filter: (_path, entry) => {
      if ("type" in entry && entry.type === "SymbolicLink") return false;
      entry.mode = (entry.mode ?? 0o644) & 0o777;
      return true;
    } });
  signal?.throwIfAborted();
  return payload;
}
