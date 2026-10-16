import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson, withFileLock } from "./atomic-file.ts";
import { resolveOhquantDir } from "./dirs.ts";
import { emitFileEvent } from "./fs-events.ts";
import type { WorkspaceRun } from "../../types/workspace.ts";

export function workspaceHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
/** A clarification alone is not a completed research basis for archiving explanations. */
export function canArchiveWorkspaceReply(run: WorkspaceRun): boolean {
  const answer = run.history?.findLast(
    (turn) => turn.status === "complete" && turn.answer,
  )?.answer;
  return (
    !!run.reply &&
    !(run.reply.match(/\bE\d+\b/g) ?? []).some(
      (id) => !run.evidence.some((e) => e.id === id),
    ) &&
    !!answer &&
    answer.claims.length > 0 &&
    answer.claims.every(
      (claim) =>
        claim.evidence.length > 0 &&
        claim.evidence.every((id) => run.evidence.some((e) => e.id === id)),
    ) &&
    run.evidence.some((e) => e.kind === "calculation" && !!e.result)
  );
}
export function createWorkspaceStore(
  root = join(resolveOhquantDir(), "research", "workspace"),
) {
  function path(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid research ID.");
    return join(root, `${id}.json`);
  }
  function load(id: string): WorkspaceRun {
    const file = path(id),
      text = readFileSync(file, "utf8");
    emitFileEvent({
      operation: "READ",
      path: file,
      bytes: Buffer.byteLength(text),
      detail: "workspace research",
    });
    const envelope = JSON.parse(text) as {
      run: WorkspaceRun;
      hash: string;
    };
    if (
      envelope.run?.version !== 1 ||
      envelope.run.id !== id ||
      envelope.run.status !== "complete" ||
      !envelope.run.saved ||
      !(
        envelope.run.answer ||
        (envelope.run.reply && canArchiveWorkspaceReply(envelope.run))
      ) ||
      workspaceHash(envelope.run) !== envelope.hash
    ) {
      throw new Error("Research integrity check failed; original preserved.");
    }
    return envelope.run;
  }
  return {
    load,
    save(run: WorkspaceRun): WorkspaceRun {
      if (
        run.status !== "complete" ||
        !(run.answer || (run.reply && canArchiveWorkspaceReply(run)))
      )
        throw new Error("Only completed research can be saved.");
      if (!existsSync(root)) {
        mkdirSync(root, { recursive: true });
        emitFileEvent({
          operation: "MKDIR",
          path: root,
          detail: "workspace research",
        });
      }
      const file = path(run.id);
      const snapshot = structuredClone({ ...run, saved: true });
      return withFileLock(file, () => {
        if (existsSync(file)) {
          const existing = load(run.id);
          if (workspaceHash(existing) !== workspaceHash(snapshot))
            throw new Error("Research version is immutable.");
          return existing;
        }
        const bytes = atomicWriteJson(file, {
          run: snapshot,
          hash: workspaceHash(snapshot),
        });
        emitFileEvent({
          operation: "WRITE",
          path: file,
          bytes,
          detail: "workspace research",
        });
        return snapshot;
      });
    },
    list(): WorkspaceRun[] {
      if (!existsSync(root)) return [];
      // A corrupt saved version is surfaced, never silently overwritten or hidden.
      const names = readdirSync(root);
      emitFileEvent({
        operation: "READ",
        path: root,
        detail: "workspace research index",
      });
      return names
        .filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
        .map((name) => load(name.slice(0, -5)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    delete(id: string): boolean {
      if (!existsSync(root)) return false;
      const file = path(id);
      if (!existsSync(file)) return false;
      unlinkSync(file);
      emitFileEvent({
        operation: "DELETE",
        path: file,
        detail: "workspace research",
      });
      return true;
    },
    filePath(id: string): string {
      return path(id);
    },
    root,
  };
}
