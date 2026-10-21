import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { withFileLock } from "./atomic-file.ts";
import {
  assertStorageRevision,
  invalidStorageFile,
  readDurableJson,
  writeDurableJson,
} from "./durable-json.ts";
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
  revision?: string;
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
  const { value, revision } = readDurableJson(filePath);
  if (value === null) {
    return {
      revision,
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidStorageFile(filePath);
  }
  const raw = value as Partial<WorkspaceMetadata>;
  if (raw.projects !== undefined && !Array.isArray(raw.projects)) {
    throw invalidStorageFile(filePath);
  }
  if (
    raw.studies !== undefined &&
    (typeof raw.studies !== "object" || raw.studies === null || Array.isArray(raw.studies))
  ) {
    throw invalidStorageFile(filePath);
  }
  return {
    revision,
    projects: Array.isArray(raw.projects) ? raw.projects : [],
    studies:
      typeof raw.studies === "object" && raw.studies !== null && !Array.isArray(raw.studies)
        ? raw.studies
        : {},
  };
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
  return withFileLock(filePath, () => {
    const current = readDurableJson(filePath);
    assertStorageRevision(filePath, meta.revision, current.revision);
    const payload: WorkspaceMetadata = {
      projects: Array.isArray(meta.projects) ? meta.projects : [],
      studies:
        typeof meta.studies === "object" && meta.studies !== null && !Array.isArray(meta.studies)
          ? meta.studies
          : {},
    };
    const revision = writeDurableJson(filePath, payload);
    return { ...payload, revision };
  });
}
