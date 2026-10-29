import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { atomicWriteTextAsync, withFileLockAsync } from "./atomic-file.ts";
import { resolveWorkbenchSessionsDir } from "./dirs.ts";
import { emitFileEvent } from "./fs-events.ts";
import { isWorkbenchSnapshot } from "../../types/workbench.ts";
import type { WorkbenchSessionHeader, WorkbenchSessionListing, WorkbenchSessionRecord } from "../../types/workbench-session.ts";

const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
const formatError = () => Object.assign(new Error("Workbench conversation is damaged or unsupported; original file preserved."), { code: "ESTORAGEFORMAT" });
const conflict = () => Object.assign(new Error("Workbench conversation changed on disk; reload before continuing."), { code: "ESTORAGECONFLICT" });
const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
type Envelope = WorkbenchSessionHeader & { digest: string };
function envelope(text: string, workspaceId: string, sessionId: string): Envelope {
  let value: Envelope;
  try { value = JSON.parse(text); } catch { throw formatError(); }
  if (!value || value.version !== 1 || value.workspaceId !== workspaceId || value.sessionId !== sessionId || !idPattern.test(sessionId)
    || typeof value.name !== "string" || value.name.length > 100 || typeof value.cwd !== "string" || !isAbsolute(value.cwd)
    || !(value.coreSessionId === null || typeof value.coreSessionId === "string" && value.coreSessionId.length > 0 && value.coreSessionId.length <= 160)
    || !Number.isSafeInteger(value.runCount) || value.runCount < 0 || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !(value.runId === null || typeof value.runId === "string" && idPattern.test(value.runId))
    || !["idle", "running", "settled", "failed", "cancelled", "interrupted"].includes(value.state)
    || (["running", "interrupted"].includes(value.state) && value.runId === null)
    || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)) || !/^[a-f0-9]{64}$/.test(value.digest)) throw formatError();
  return value;
}

/** Atomic, revision-checked checkpoint storage. List reads only a bounded first line, not histories. */
export function createWorkbenchSessionStore(root = resolveWorkbenchSessionsDir()) {
  const path = (id: string) => { if (!idPattern.test(id)) throw formatError(); return join(root, `${id}.json`); };
  const checkFile = (file: string) => { if (lstatSync(file).isSymbolicLink()) throw formatError(); };
  const load = (workspaceId: string, id: string) => {
    const file = path(id); checkFile(file);
    let text: string;
    try { text = decode(readFileSync(file)); } catch { throw formatError(); }
    const newline = text.indexOf("\n");
    if (newline < 0 || newline > 65536) throw formatError();
    const { digest: storedDigest, ...header } = envelope(text.slice(0, newline), workspaceId, id);
    const payload = text.slice(newline + 1);
    if (digest(JSON.stringify(header) + "\n" + payload) !== storedDigest) throw formatError();
    let snapshot: unknown;
    try { snapshot = JSON.parse(payload); } catch { throw formatError(); }
    if (!isWorkbenchSnapshot(snapshot) || snapshot.identity.workspaceId !== workspaceId || snapshot.identity.sessionId !== id
      || snapshot.identity.runId !== header.runId || snapshot.revision !== header.revision || snapshot.state !== header.state) throw formatError();
    const { state: _, runId: __, revision: ___, ...metadata } = header;
    return { record: { ...metadata, snapshot } as WorkbenchSessionRecord, revision: digest(text) };
  };
  return {
    load,
    list(workspaceId: string): WorkbenchSessionListing[] {
      if (!existsSync(root)) return [];
      return readdirSync(root).filter(name => idPattern.test(name.slice(0, -5)) && name.endsWith(".json")).map(name => {
        const sessionId = name.slice(0, -5), file = path(sessionId);
        let fd: number | undefined;
        try {
          checkFile(file); fd = openSync(file, "r");
          let bytes = Buffer.alloc(0), newline = -1;
          while (newline < 0 && bytes.length <= 65536) {
            const block = Buffer.alloc(Math.min(1024, 65537 - bytes.length));
            const count = readSync(fd, block, 0, block.length, bytes.length);
            if (!count) break;
            bytes = Buffer.concat([bytes, block.subarray(0, count)]); newline = bytes.indexOf(10);
          }
          if (newline < 0 || newline > 65536) throw formatError();
          const { digest: _, ...header } = envelope(decode(bytes.subarray(0, newline)), workspaceId, sessionId);
          return { header, sessionId };
        } catch { return { header: null, sessionId, problem: "会话记录无法读取或版本不受支持，原文件已保留。" }; }
        finally { if (fd !== undefined) closeSync(fd); }
      });
    },
    async save(record: WorkbenchSessionRecord, expectedRevision: string | null) {
      const file = path(record.sessionId);
      const { snapshot, ...metadata } = record;
      const header: WorkbenchSessionHeader = { ...metadata, state: snapshot.state, runId: snapshot.identity.runId, revision: snapshot.revision! };
      const payload = JSON.stringify(snapshot), hash = digest(JSON.stringify(header) + "\n" + payload);
      const text = JSON.stringify({ ...header, digest: hash }) + "\n" + payload;
      envelope(JSON.stringify({ ...header, digest: hash }), record.workspaceId, record.sessionId);
      if (!isWorkbenchSnapshot(snapshot) || snapshot.identity.workspaceId !== record.workspaceId || snapshot.identity.sessionId !== record.sessionId) throw formatError();
      mkdirSync(root, { recursive: true });
      return withFileLockAsync(file, async () => {
        if (existsSync(file)) {
          checkFile(file);
          const current = decode(readFileSync(file));
          if (current === text && expectedRevision !== null) return digest(current);
          if (expectedRevision === null || digest(current) !== expectedRevision) throw conflict();
          // Never replace a corrupt/unsupported generation merely because its byte revision is known.
          load(record.workspaceId, record.sessionId);
        } else if (expectedRevision !== null) throw conflict();
        await atomicWriteTextAsync(file, text);
        emitFileEvent({ operation: "WRITE", path: file, bytes: Buffer.byteLength(text), detail: "workbench checkpoint" });
        return digest(text);
      });
    },
  };
}
