import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "./atomic-file.ts";
import { resolveOhquantDir } from "./dirs.ts";
import { emitFileEvent } from "./fs-events.ts";

export interface WorkspaceProject {
  id: string;
  symbol: string;
  name: string;
  benchmark?: string;
  pinned?: boolean;
  pinnedAt?: string;
  folderPath?: string;
  createdAt?: string;
}

export interface WorkspaceStudyMeta {
  customTitle?: string;
  projectId?: string;
  archived?: boolean;
  archivedAt?: string;
}

export interface WorkspaceMetadata {
  projects: WorkspaceProject[];
  studies: Record<string, WorkspaceStudyMeta>;
}

export function resolveWorkspaceMetaPath(): string {
  return join(resolveOhquantDir(), "research", "projects-metadata.json");
}

export function resolveProjectDirPath(symbol: string): string {
  let safeSymbol = symbol.replace(/[^a-zA-Z0-9.-]/g, "_");
  if (!safeSymbol || safeSymbol === "." || safeSymbol === "..") {
    safeSymbol = "default";
  }
  const dir = join(resolveOhquantDir(), "research", "projects", safeSymbol);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    emitFileEvent({
      operation: "MKDIR",
      path: dir,
      detail: `project folder for ${symbol}`,
    });
  }
  return dir;
}

export function loadWorkspaceMetadata(
  filePath = resolveWorkspaceMetaPath(),
): WorkspaceMetadata {
  if (!existsSync(filePath)) {
    return {
      projects: [
        {
          id: "002048.SZ",
          symbol: "002048.SZ",
          name: "002048.SZ 结构跟踪",
          benchmark: "000300.SH",
          pinned: false,
          createdAt: new Date().toISOString(),
        },
      ],
      studies: {},
    };
  }
  try {
    const text = readFileSync(filePath, "utf8");
    const data = JSON.parse(text) as WorkspaceMetadata;
    return {
      projects: Array.isArray(data.projects) ? data.projects : [],
      studies:
        typeof data.studies === "object" && data.studies !== null
          ? data.studies
          : {},
    };
  } catch {
    return { projects: [], studies: {} };
  }
}

export function saveWorkspaceMetadata(
  meta: WorkspaceMetadata,
  filePath = resolveWorkspaceMetaPath(),
): WorkspaceMetadata {
  const dir = join(filePath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    emitFileEvent({
      operation: "MKDIR",
      path: dir,
      detail: "research workspace metadata dir",
    });
  }
  const payload: WorkspaceMetadata = {
    projects: Array.isArray(meta.projects) ? meta.projects : [],
    studies: typeof meta.studies === "object" && meta.studies !== null ? meta.studies : {},
  };
  atomicWriteJson(filePath, payload);
  emitFileEvent({
    operation: "WRITE",
    path: filePath,
    bytes: Buffer.byteLength(JSON.stringify(payload)),
    detail: "workspace metadata",
  });
  return payload;
}
