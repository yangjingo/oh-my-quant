import { createHash } from "node:crypto";
import { generateArtifact } from "../../artifact/index.ts";
import { verifyReportSession } from "../../artifact/src/report-input.ts";
import { artifactReference, loadArtifactSnapshot, saveArtifact } from "../../storage/index.ts";
import type { QuantAgentDependencies } from "../../agent/src/session-contracts.ts";
import type { JsonlSessionRepoApi } from "../../agent/src/session-runtime/harness/types.ts";
import type { ArtifactRequest, ArtifactSummary, EvidenceItem, SavedResearch, SessionSnapshot } from "../../types/workbench.ts";
import { WorkbenchError } from "../workbench/errors.ts";

const unavailable = () => new WorkbenchError("ARTIFACT_UNAVAILABLE", "固定报告版本无法读取或验证，原文件已保留。", 409);

/** Existing generator/storage keep the private report; only bounded metadata leaves this boundary. */
export async function saveResearchReport(input: {
  sessionId: string; coreSessionId: string; leafId: string; runId: string; cwd: string; title: string;
  expectedArtifactRevision: string | null; artifacts: readonly ArtifactSummary[]; dependencies: QuantAgentDependencies;
}): Promise<ArtifactSummary> {
  const id = `workbench-${input.sessionId}`, prior = input.artifacts.filter(item => item.id === id);
  if ((prior.at(-1)?.sha256 ?? null) !== input.expectedArtifactRevision)
    throw new WorkbenchError("ARTIFACT_CONFLICT", "报告版本已变化，请重新读取后保存。", 409);
  try {
    const repository = input.dependencies.sessions;
    const metadata = (await repository.list({ cwd: input.cwd })).find(item => item.id === input.coreSessionId);
    if (!metadata) throw unavailable();
    const report = generateArtifact({ sessionPath: metadata.path, leafId: input.leafId, title: input.title });
    if (!report || report.sessionId !== input.coreSessionId) throw unavailable();
    const meta = saveArtifact(id, report.html, { title: input.title, messageCount: report.messageCount,
      sourceSessionId: input.coreSessionId, provenance: report.provenance }, input.expectedArtifactRevision);
    return { id, title: meta.title, version: (prior.at(-1)?.version ?? 0) + 1, sha256: meta.revision!, createdAt: meta.createdAt, runId: input.runId };
  } catch (error) {
    if (error instanceof WorkbenchError) throw error;
    if ((error as { code?: string })?.code === "ESTORAGECONFLICT") throw new WorkbenchError("ARTIFACT_CONFLICT", "报告版本已变化，请重新读取后保存。", 409);
    throw unavailable();
  }
}

/** Fixed-version reload never consults current prices or starts a model request. */
export function reloadResearchReport(input: ArtifactRequest, snapshot: SessionSnapshot, clean: (value: string) => string): SavedResearch {
  const artifact = snapshot.output.artifacts.find(item => item.id === input.artifactId && item.sha256 === input.sha256);
  if (!artifact?.runId) throw unavailable();
  const saved = loadArtifactSnapshot(`${artifact.id}@${artifact.sha256}`);
  if (!saved || artifactReference(saved.meta) !== `${artifact.id}@${artifact.sha256}`) throw unavailable();
  const end = snapshot.turns.findIndex(turn => turn.id === artifact.runId + "-assistant");
  if (end < 0) throw unavailable();
  const evidence: EvidenceItem[] = (saved.meta.provenance?.datasets ?? []).map(item => ({
    id: createHash("sha256").update(JSON.stringify(item.ref)).digest("hex"),
    label: clean(`${item.ref.symbol} · ${item.role}`).slice(0, 160),
    source: clean(String(item.ref.source)).slice(0, 160), asOf: item.ref.snapshotAt, available: item.verified,
  }));
  return structuredClone({ identity: { workspaceId: input.workspaceId, sessionId: input.sessionId, runId: artifact.runId },
    artifact, turns: snapshot.turns.slice(0, end + 1), evidence });
}

/** Fork the verified archived branch, never resume or move the source session's leaf. */
export async function forkResearchReport(input: ArtifactRequest, cwd: string, dependencies: QuantAgentDependencies): Promise<string> {
  const saved = loadArtifactSnapshot(`${input.artifactId}@${input.sha256}`);
  const provenance = saved?.meta.provenance;
  if (!saved || !provenance || provenance.scope !== "branch" || !provenance.leafId || !saved.meta.sourceSessionId) throw unavailable();
  // Existing default repositories support fork; a restricted injected port must
  // explicitly provide that capability. The Quant Agent port stays unchanged.
  const repository = dependencies.sessions as QuantAgentDependencies["sessions"] & Partial<Pick<JsonlSessionRepoApi, "fork">>;
  if (!repository.fork) throw new WorkbenchError("REVIEW_UNAVAILABLE", "当前会话存储不支持独立复核。", 409);
  try {
    const metadata = (await repository.list({ cwd })).find(item => item.id === saved.meta.sourceSessionId);
    if (!metadata || !verifyReportSession(metadata.path, provenance)) throw unavailable();
    const fork = await repository.fork(metadata, { cwd, entryId: provenance.leafId, position: "at" });
    if (!verifyReportSession(metadata.path, provenance)) throw unavailable();
    const target = await fork.getMetadata();
    if (target.id === metadata.id) throw unavailable();
    return target.id;
  } catch (error) { if (error instanceof WorkbenchError) throw error; throw unavailable(); }
}
