import type { SessionSnapshot } from "./workbench.ts";

/** Versioned private presentation checkpoint; the Quant journal owns model context. */
export interface WorkbenchSessionRecord {
  version: 1;
  workspaceId: string;
  sessionId: string;
  name: string;
  cwd: string;
  coreSessionId: string | null;
  runCount: number;
  updatedAt: string;
  snapshot: SessionSnapshot;
}
export type WorkbenchSessionHeader = Omit<WorkbenchSessionRecord, "snapshot"> & {
  state: SessionSnapshot["state"];
  runId: string | null;
  revision: number;
};
export interface WorkbenchSessionListing {
  header: WorkbenchSessionHeader | null;
  sessionId: string;
  problem?: string;
}
