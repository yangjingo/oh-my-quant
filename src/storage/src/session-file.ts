import { createHash } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { basename } from "node:path";
import type { SessionFilePort, SessionFileSnapshot } from "../../types/session-file.ts";
import { atomicWriteTextAsync, withFileLockAsync } from "./atomic-file.ts";
import { emitFileEvent } from "./fs-events.ts";

function readSnapshot(path: string): SessionFileSnapshot | null {
  try {
    const bytes = readFileSync(path);
    // Invalid UTF-8 must not be silently replaced when the next entry is saved.
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return { text, revision: createHash("sha256").update(bytes).digest("hex") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function conflict(path: string): Error {
  return Object.assign(new Error(`Session ${basename(path)} changed on disk. Reopen the session before continuing.`), { code: "ESTORAGECONFLICT" });
}

export class LocalSessionFile implements SessionFilePort {
  async read(path: string): Promise<SessionFileSnapshot> {
    const snapshot = readSnapshot(path);
    if (!snapshot) throw Object.assign(new Error(`Session not found: ${path}`), { code: "ENOENT" });
    return snapshot;
  }

  async commit(path: string, expectedRevision: string | null, text: string, signal?: AbortSignal): Promise<string> {
    const revision = await withFileLockAsync(path, async () => {
      const current = readSnapshot(path);
      // A retry of the exact transaction after a lost acknowledgement is idempotent.
      if (current?.text === text && expectedRevision !== null) return current.revision;
      if ((current?.revision ?? null) !== expectedRevision) throw conflict(path);
      if (current && !text.startsWith(current.text)) throw new Error("Session history is append-only");
      signal?.throwIfAborted();
      await atomicWriteTextAsync(path, text, signal);
      return createHash("sha256").update(text).digest("hex");
    }, signal);
    emitFileEvent({ operation: "WRITE", path, bytes: Buffer.byteLength(text), detail: "session commit" });
    return revision;
  }

  async remove(path: string, expectedRevision: string, signal?: AbortSignal): Promise<void> {
    await withFileLockAsync(path, () => {
      const current = readSnapshot(path);
      if (!current) return;
      if (current.revision !== expectedRevision) throw conflict(path);
      signal?.throwIfAborted();
      unlinkSync(path);
    }, signal);
    emitFileEvent({ operation: "DELETE", path, detail: "session" });
  }
}
