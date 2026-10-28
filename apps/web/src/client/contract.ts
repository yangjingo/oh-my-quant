/**
 * The workbench's view of the Host.
 *
 * This file is the only place the UI learns how work is submitted, cancelled
 * and observed. Based on PR #81's interface slice, extended with scoped events,
 * session snapshots and presentation capabilities. It is a UI port, not a
 * finalized HTTP wire protocol; #46/#75 own the real Host adapter.
 *
 * Two rules are encoded here rather than in prose:
 *
 * 1. Observations are subscriptions. `subscribe` returns a release function
 *    that only detaches the listener; it never cancels the run. Cancelling is
 *    a separate, explicit command.
 * 2. A run is identified by workspace, session and run, not by a component
 *    instance. Switching sessions detaches; it does not end work.
 *    Terminal state/turn events retain the runId of the run they finish;
 *    null means no associated run, never "finish whichever run is active".
 */

export type RunState = "idle" | "running" | "settled" | "failed" | "cancelled";

export interface WorkspaceIdentity {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly runId: string | null;
}

export interface WorkspaceSummary {
  readonly sessionId: string;
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
  readonly group?: "watchlist" | "market";
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
  readonly sessionId: string;
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
  | { readonly type: "turn"; readonly identity: WorkspaceIdentity; readonly turn: Turn }
  | { readonly type: "state"; readonly identity: WorkspaceIdentity; readonly state: RunState }
  | { readonly type: "market"; readonly identity: WorkspaceIdentity; readonly snapshot: MarketSnapshot };

export interface SessionSnapshot {
  readonly identity: WorkspaceIdentity;
  readonly state: RunState;
  readonly turns: readonly Turn[];
  readonly market: MarketSnapshot;
  readonly output: WorkspaceOutput;
}

export interface ReferenceCandidate {
  readonly id: string;
  readonly label: string;
  readonly token: string;
  readonly kind: "file" | "directory" | "session" | "evidence";
  readonly description: string;
}

export interface Preferences {
  readonly availablePortfolios?: readonly string[];
  readonly model: string;
  readonly source: "none" | "demo" | "akshare";
  readonly portfolio: string;
}

export type Release = () => void;

export interface WorkbenchClient {
  readonly mode: "demo" | "host" | "disconnected";
  session(sessionId: string): Promise<SessionSnapshot>;
  createSession(): Promise<WorkspaceSummary>;
  renameSession(sessionId: string, title: string): Promise<void>;
  references(sessionId: string, query: string): Promise<readonly ReferenceCandidate[]>;
  preferences(): Promise<Preferences>;
  updatePreferences(preferences: Preferences): Promise<void>;
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
