import { createWorkspaceManager, type WorkspacePorts } from "../research-workspace/manager.ts";
import { loadWorkspaceMetadata, saveWorkspaceMetadata, type WorkspaceMetadata } from "../../storage/index.ts";

/** Domain failure; HTTP status selection remains the transport's responsibility. */
export class ResearchWorkspaceError extends Error {
  readonly code?: string;
  constructor(readonly operation: "metadata-read" | "metadata-save" | "delete" | "review", error: unknown, fallback: string) {
    super(error instanceof Error ? error.message : fallback);
    if (error && typeof error === "object" && "code" in error && typeof error.code === "string") this.code = error.code;
  }
}

/** Existing single-stock research and metadata rules, usable without a server or UI.
 * The manager remains the sole owner of its Agent, runs and immutable study store. */
export function createResearchWorkspaceService(options: WorkspacePorts & { metaPath?: string } = {}) {
  const manager = createWorkspaceManager(options);
  const metadata = () => loadWorkspaceMetadata(options.metaPath);
  const updateMetadata = (value: WorkspaceMetadata) => saveWorkspaceMetadata(value, options.metaPath);
  return {
    manager,
    metadata,
    updateMetadata,
    deleteStudy(id: string) {
      let meta: WorkspaceMetadata;
      try { meta = metadata(); }
      catch (error) { throw new ResearchWorkspaceError("metadata-read", error, "工作区元数据读取失败，文件损坏已保留原样。"); }
      let result: { ok: boolean; id: string };
      try { result = manager.delete(id); }
      catch (error) { throw new ResearchWorkspaceError("delete", error, "删除研究失败"); }
      if (meta.studies[id]) {
        delete meta.studies[id];
        try { meta = updateMetadata(meta); }
        catch (error) { throw new ResearchWorkspaceError("metadata-save", error, "工作区元数据保存失败"); }
      }
      // Clients must adopt this complete persisted snapshot, including projects
      // concurrently created before deletion, rather than retaining stale metadata.
      return { ...result, revision: meta.revision, meta };
    },
    review(id: string, end?: string) {
      const old = manager.get(id);
      if (!old.saved) throw new ResearchWorkspaceError("review", undefined, "请先保存本次研究，再发起独立复核。");
      return manager.start(old.history?.[0]?.question ?? old.question,
        { ...old.scope, end: end ?? old.scope.end }, id);
    },
  };
}
