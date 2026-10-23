/**
 * The workbench's view of the Host.
 *
 * This file is the only place the UI learns how work is submitted, cancelled
 * and observed. It exists so #50's interface slice can be built and tested
 * before the Host from #46/#75 lands: swapping `FixtureClient` for the real
 * client must not change a single component.
 *
 * Two rules are encoded here rather than in prose:
 *
 * 1. Observations are subscriptions. `subscribe` returns a release function
 *    that only detaches the listener; it never cancels the run. Cancelling is
 *    a separate, explicit command.
 * 2. A run is identified by workspace, session and run, not by a component
 *    instance. Switching sessions detaches; it does not end work.
 */

export type RunState = "idle" | "running" | "settled" | "failed" | "cancelled";

export interface WorkspaceIdentity {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly runId: string | null;
}

export interface WorkspaceSummary {
  readonly workspaceId: string;
  readonly code: string;
  readonly name: string;
  readonly runCount: number;
  readonly state: RunState;
}

export type TurnRole = "user" | "assistant";

export interface Turn {
  readonly id: string;
  readonly role: TurnRole;
  readonly text: string;
  readonly state: RunState;
  readonly at: string;
}

export interface MarketQuote {
  readonly code: string;
  readonly name: string;
  readonly value: number | null;
  readonly change: number | null;
}

export interface SourceStatus {
  readonly provider: string | null;
  readonly updatedAt: string | null;
  readonly available: number;
  readonly total: number;
}

export interface MarketSnapshot {
  readonly refreshedAt: string;
  readonly quotes: readonly MarketQuote[];
  readonly source: SourceStatus;
}

/** A conclusion is only settled when a run finished; drafts stay drafts. */
export interface Conclusion {
  readonly statement: string | null;
  readonly confidence: "low" | "medium" | "high" | null;
  /** What would break the reading. Empty means the author did not state it. */
  readonly boundary: string | null;
  readonly settled: boolean;
}

/** Evidence is a pointer to a source, not a restatement of its numbers. */
export interface EvidenceItem {
  readonly id: string;
  readonly label: string;
  readonly source: string | null;
  readonly asOf: string | null;
  readonly available: boolean;
}

/** Artifacts are immutable saved reports, referenced by hash. */
export interface ArtifactSummary {
  readonly id: string;
  readonly title: string;
  readonly version: number;
  readonly sha256: string;
  readonly createdAt: string;
}

export interface WorkspaceOutput {
  readonly conclusion: Conclusion;
  readonly evidence: readonly EvidenceItem[];
  readonly artifacts: readonly ArtifactSummary[];
}

export interface SubmitRequest {
  readonly workspaceId: string;
  readonly text: string;
}

export interface SubmitResult {
  readonly sessionId: string;
  readonly runId: string;
}

/**
 * Events are coarse on purpose: the Host decides how much detail to stream,
 * and the UI must not assume it receives provider-level deltas.
 */
export type WorkbenchEvent =
  | { readonly type: "turn"; readonly turn: Turn }
  | { readonly type: "state"; readonly identity: WorkspaceIdentity; readonly state: RunState }
  | { readonly type: "market"; readonly snapshot: MarketSnapshot };

export type Release = () => void;

export interface WorkbenchClient {
  identity(): Promise<WorkspaceIdentity>;
  workspaces(): Promise<readonly WorkspaceSummary[]>;
  transcript(sessionId: string): Promise<readonly Turn[]>;
  market(): Promise<MarketSnapshot>;
  output(workspaceId: string): Promise<WorkspaceOutput>;
  submit(request: SubmitRequest): Promise<SubmitResult>;
  /** Explicit user intent. Releasing a subscription must never do this. */
  cancel(runId: string): Promise<void>;
  subscribe(listener: (event: WorkbenchEvent) => void): Release;
}
