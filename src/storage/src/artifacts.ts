/**
 * Artifact HTML file storage under .ohquant/artifacts/.
 * Each artifact is a self-contained HTML file derived from a session JSONL.
 * Artifacts are explicit outputs (artifact class) — they can be safely deleted
 * and regenerated from the source session.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emitFileEvent } from "./fs-events.ts";
import { OHQUANT_DIR, ensureDirs } from "./dirs.ts";

export interface ArtifactMeta {
  sessionId: string;
  createdAt: string;
  title: string;
  messageCount: number;
  bytes: number;
}

function artifactsDir(): string {
  return join(process.env.OHQUANT_DIR || OHQUANT_DIR, "artifacts");
}

function ensureArtifactsDir(): void {
  const dir = artifactsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    emitFileEvent({ operation: "MKDIR", path: dir, detail: "artifacts" });
  }
}

export function artifactPath(sessionId: string): string {
  return join(artifactsDir(), `${sessionId}.html`);
}

export function saveArtifact(sessionId: string, html: string, meta?: { title?: string; messageCount?: number }): void {
  ensureDirs();
  ensureArtifactsDir();
  const path = artifactPath(sessionId);

  // Update or create sidecar metadata
  const sidecarPath = join(artifactsDir(), `${sessionId}.meta.json`);
  const now = new Date().toISOString();
  const existingMeta = loadArtifactMetaFile(sidecarPath);
  const merged: ArtifactMeta = {
    sessionId,
    createdAt: existingMeta?.createdAt ?? now,
    title: meta?.title ?? existingMeta?.title ?? sessionId,
    messageCount: meta?.messageCount ?? existingMeta?.messageCount ?? 0,
    bytes: Buffer.byteLength(html, "utf-8"),
  };
  const sidecarJson = JSON.stringify(merged, null, 2);
  writeFileSync(sidecarPath, sidecarJson, "utf-8");
  emitFileEvent({ operation: "WRITE", path: sidecarPath, bytes: Buffer.byteLength(sidecarJson, "utf-8"), detail: "artifact metadata" });

  writeFileSync(path, html, "utf-8");
  emitFileEvent({ operation: "WRITE", path, bytes: merged.bytes, detail: "artifact HTML" });
}

export function loadArtifact(sessionId: string): string | null {
  const path = artifactPath(sessionId);
  if (!existsSync(path)) return null;
  try {
    const html = readFileSync(path, "utf-8");
    emitFileEvent({ operation: "READ", path, bytes: html.length, detail: "artifact HTML" });
    return html;
  } catch {
    return null;
  }
}

export function loadArtifactMeta(sessionId: string): ArtifactMeta | null {
  const sidecarPath = join(artifactsDir(), `${sessionId}.meta.json`);
  return loadArtifactMetaFile(sidecarPath);
}

function loadArtifactMetaFile(path: string): ArtifactMeta | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as ArtifactMeta;
    if (!raw.sessionId || !raw.createdAt) return null;
    return raw;
  } catch {
    return null;
  }
}

export function listArtifacts(): ArtifactMeta[] {
  const dir = artifactsDir();
  if (!existsSync(dir)) return [];
  const metas: ArtifactMeta[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".meta.json")) continue;
    const meta = loadArtifactMetaFile(join(dir, entry.name));
    if (meta) metas.push(meta);
  }
  emitFileEvent({ operation: "READ", path: dir, detail: "artifact index" });
  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteArtifact(sessionId: string): boolean {
  const htmlPath = artifactPath(sessionId);
  const metaPath = join(artifactsDir(), `${sessionId}.meta.json`);
  let deleted = false;
  if (existsSync(htmlPath)) {
    unlinkSync(htmlPath);
    emitFileEvent({ operation: "DELETE", path: htmlPath, detail: "artifact HTML" });
    deleted = true;
  }
  if (existsSync(metaPath)) {
    unlinkSync(metaPath);
    emitFileEvent({ operation: "DELETE", path: metaPath, detail: "artifact metadata" });
    deleted = true;
  }
  return deleted;
}
