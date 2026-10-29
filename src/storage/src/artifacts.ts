/** Atomic report snapshots. HTML files are materialized views of immutable revisions. */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { emitFileEvent } from "./fs-events.ts";
import { ensureDirs, resolveArtifactsDir } from "./dirs.ts";
import { atomicWriteJson, atomicWriteText, withFileLock } from "./atomic-file.ts";
import type { ReportProvenance } from "../../types/research-evidence.ts";

export interface ArtifactMeta {
  /** Report id; the source session may have a different id. */
  sessionId: string;
  sourceSessionId?: string;
  revision?: string;
  previousRevision?: string;
  provenance?: ReportProvenance;
  createdAt: string;
  refreshedAt?: string;
  title: string;
  messageCount: number;
  bytes: number;
}
export interface ArtifactPruneResult { artifacts: ArtifactMeta[]; removedIds: string[] }
export interface ArtifactSnapshot { version: 1; meta: ArtifactMeta; html: string }
type ArtifactSaveMeta = Pick<ArtifactMeta, "title" | "messageCount" | "sourceSessionId" | "provenance">;

function parseRef(ref: string): { id: string; revision?: string } {
  const [id = "", revision, extra] = ref.split("@");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/.test(id) || id.includes("..")
    || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(id)
    || extra !== undefined || (revision !== undefined && !/^[a-f0-9]{64}$/.test(revision))) throw new Error("Invalid report reference.");
  return { id, revision };
}

export function artifactReference(meta: ArtifactMeta): string {
  return meta.revision ? `${meta.sessionId}@${meta.revision}` : meta.sessionId;
}

function headPath(id: string): string { return join(resolveArtifactsDir(), `${id}.report.json`); }
function revisionDir(id: string, revision: string): string { return join(resolveArtifactsDir(), ".revisions", id, revision); }
function fingerprint(meta: ArtifactMeta, html: string): string {
  const { revision: _revision, ...fields } = meta;
  return createHash("sha256").update(JSON.stringify({ version: 1, meta: fields, html })).digest("hex");
}

function readSnapshot(path: string, id: string, revision?: string): ArtifactSnapshot | null {
  try {
    const text = readFileSync(path, "utf8");
    emitFileEvent({ operation: "READ", path, bytes: Buffer.byteLength(text), detail: "report snapshot" });
    const snapshot = JSON.parse(text) as ArtifactSnapshot;
    const meta = snapshot.meta;
    if (snapshot.version !== 1 || typeof snapshot.html !== "string" || !meta || meta.sessionId !== id
      || !meta.revision || (revision && meta.revision !== revision)
      || (meta.previousRevision !== undefined && !/^[a-f0-9]{64}$/.test(meta.previousRevision))
      || typeof meta.title !== "string" || !Number.isFinite(Date.parse(meta.createdAt))
      || !Number.isInteger(meta.messageCount) || meta.messageCount < 0
      || meta.bytes !== Buffer.byteLength(snapshot.html) || fingerprint(meta, snapshot.html) !== meta.revision) return null;
    return snapshot;
  } catch { return null; }
}

function archiveSnapshot(snapshot: ArtifactSnapshot): void {
  const { meta, html } = snapshot;
  const dir = revisionDir(meta.sessionId, meta.revision!);
  mkdirSync(dir, { recursive: true });
  const archive = join(dir, "report.json");
  if (existsSync(archive)) {
    if (!readSnapshot(archive, meta.sessionId, meta.revision)) throw new Error("An existing report revision is damaged.");
  } else {
    const bytes = atomicWriteJson(archive, snapshot);
    emitFileEvent({ operation: "WRITE", path: archive, bytes, detail: "immutable report revision" });
  }
  const view = join(dir, `${meta.sessionId}.html`);
  const bytes = atomicWriteText(view, html);
  emitFileEvent({ operation: "WRITE", path: view, bytes, detail: "report HTML" });
}

/** Legacy reports are read as a pair only when no new-format head exists. */
function readLegacy(id: string): ArtifactSnapshot | null {
  try {
    const dir = resolveArtifactsDir();
    const metadataPath = join(dir, `${id}.meta.json`);
    const htmlPath = join(dir, `${id}.html`);
    const text = readFileSync(metadataPath, "utf8");
    const meta = JSON.parse(text) as ArtifactMeta;
    const html = readFileSync(htmlPath, "utf8");
    emitFileEvent({ operation: "READ", path: metadataPath, bytes: Buffer.byteLength(text), detail: "legacy report metadata" });
    emitFileEvent({ operation: "READ", path: htmlPath, bytes: Buffer.byteLength(html), detail: "legacy report HTML" });
    if (meta.sessionId !== id || !meta.createdAt || typeof meta.title !== "string") return null;
    delete meta.revision;
    return { version: 1, meta, html };
  } catch { return null; }
}

/** A single read supplies HTML and metadata; damaged heads never fall back to legacy copies. */
export function loadArtifactSnapshot(ref: string): ArtifactSnapshot | null {
  const { id, revision } = parseRef(ref);
  if (revision) return readSnapshot(join(revisionDir(id, revision), "report.json"), id, revision);
  const path = headPath(id);
  return existsSync(path) ? readSnapshot(path, id) : readLegacy(id);
}

export function artifactPath(ref: string): string {
  const { id, revision } = parseRef(ref);
  const selected = revision ?? loadArtifactSnapshot(id)?.meta.revision;
  return selected ? join(revisionDir(id, selected), `${id}.html`) : join(resolveArtifactsDir(), `${id}.html`);
}

export function saveArtifact(id: string, html: string, input: Partial<ArtifactSaveMeta> = {}, expectedRevision?: string | null): ArtifactMeta {
  if (parseRef(id).revision) throw new Error("Save a new report version using its report id.");
  ensureDirs();
  const dir = resolveArtifactsDir();
  mkdirSync(dir, { recursive: true });
  return withFileLock(headPath(id), () => {
    const previous = loadArtifactSnapshot(id);
    if (!previous && existsSync(headPath(id))) throw new Error("Report head is damaged. Repair it before saving another version.");
    if (expectedRevision !== undefined && (previous ? previous.meta.revision : null) !== expectedRevision)
      throw Object.assign(new Error("Report changed; reload its current revision before saving."), { code: "ESTORAGECONFLICT" });
    if (previous && !previous.meta.revision) {
      previous.meta.bytes = Buffer.byteLength(previous.html);
      previous.meta.revision = fingerprint(previous.meta, previous.html);
      archiveSnapshot(previous);
    }
    const existing = previous?.meta;
    const now = new Date().toISOString();
    const meta: ArtifactMeta = {
      sessionId: id, sourceSessionId: input.sourceSessionId ?? existing?.sourceSessionId ?? id,
      createdAt: now, refreshedAt: now, title: input.title ?? existing?.title ?? id,
      messageCount: input.messageCount ?? existing?.messageCount ?? 0, bytes: Buffer.byteLength(html),
      ...(input.provenance ? { provenance: input.provenance } : {}),
      ...(existing?.revision ? { previousRevision: existing.revision } : {}),
    };
    parseRef(meta.sourceSessionId!);
    if (!Number.isInteger(meta.messageCount) || meta.messageCount < 0) throw new Error("Invalid report message count.");
    meta.revision = fingerprint(meta, html);
    const snapshot: ArtifactSnapshot = { version: 1, meta, html };
    archiveSnapshot(snapshot);
    const path = headPath(id);
    const bytes = atomicWriteJson(path, snapshot);
    emitFileEvent({ operation: "WRITE", path, bytes, detail: "report head" });
    return meta;
  });
}

/** Repair a missing/changed view using the verified, selected revision, never the latest session. */
export function materializeArtifact(ref: string): string {
  const snapshot = loadArtifactSnapshot(ref);
  if (!snapshot) throw new Error("Report version is unavailable or damaged.");
  const fixedRef = artifactReference(snapshot.meta);
  const path = artifactPath(fixedRef);
  let existing: string | undefined;
  try {
    existing = readFileSync(path, "utf8");
    emitFileEvent({ operation: "READ", path, bytes: Buffer.byteLength(existing), detail: "report HTML view" });
  } catch { /* Rebuild the view from the snapshot. */ }
  if (existing !== snapshot.html) withFileLock(path, () => {
    const bytes = atomicWriteText(path, snapshot.html);
    emitFileEvent({ operation: "WRITE", path, bytes, detail: "restored report HTML" });
  });
  return path;
}

export function loadArtifact(ref: string): string | null { return loadArtifactSnapshot(ref)?.html ?? null; }
export function loadArtifactMeta(ref: string): ArtifactMeta | null { return loadArtifactSnapshot(ref)?.meta ?? null; }

export function listArtifactVersions(id: string): ArtifactMeta[] {
  if (parseRef(id).revision) throw new Error("Use a report id to list versions.");
  const versions: ArtifactMeta[] = [];
  const seen = new Set<string>();
  let meta = loadArtifactMeta(id);
  while (meta?.revision && !seen.has(meta.revision)) {
    versions.push(meta);
    seen.add(meta.revision);
    meta = meta.previousRevision ? loadArtifactMeta(`${id}@${meta.previousRevision}`) : null;
  }
  return versions;
}

export function listArtifacts(): ArtifactMeta[] {
  const dir = resolveArtifactsDir();
  if (!existsSync(dir)) return [];
  const ids = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".report.json")) ids.add(entry.name.slice(0, -".report.json".length));
    else if (entry.name.endsWith(".meta.json")) ids.add(entry.name.slice(0, -".meta.json".length));
  }
  const metas: ArtifactMeta[] = [];
  for (const id of ids) {
    try { const meta = loadArtifactMeta(id); if (meta) metas.push(meta); } catch { /* Not a valid report id. */ }
  }
  emitFileEvent({ operation: "READ", path: dir, detail: "artifact index" });
  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Hide unavailable versions. Keep immutable research evidence for later repair of its source. */
export function pruneUnrestorableArtifacts(validSourceSessionIds: ReadonlySet<string>): ArtifactPruneResult {
  const artifacts = listArtifacts().filter(meta => validSourceSessionIds.has(meta.sourceSessionId ?? meta.sessionId));
  return { artifacts, removedIds: [] };
}

/** Explicitly remove the current listing and legacy files; immutable versions remain addressable. */
export function deleteArtifact(ref: string): boolean {
  const { id, revision } = parseRef(ref);
  if (revision) throw new Error("Immutable report versions are retained as research evidence.");
  const dir = resolveArtifactsDir();
  if (!existsSync(dir)) return false;
  return withFileLock(headPath(id), () => {
    let deleted = false;
    for (const path of [headPath(id), join(dir, `${id}.html`), join(dir, `${id}.meta.json`)]) {
      try { unlinkSync(path); deleted = true; emitFileEvent({ operation: "DELETE", path, detail: "report listing" }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return deleted;
  });
}
