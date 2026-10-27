/**
 * The workbench's view of the Host.
 *
 * This file is the only place the UI learns how work is submitted, cancelled
 * and observed. Based on PR #81's interface slice, extended with scoped events,
 * session snapshots and presentation capabilities. It is a UI port, not a
 * finalized public protocol. #101 adds the initial local HTTP/SSE adapter;
 * #46/#75 retain the broader service extraction and Host lifecycle work.
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

export type RunState = "idle" | "running" | "settled" | "failed" | "cancelled" | "interrupted";

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
export type AgentPhase = "waiting" | "thinking" | "preparing" | "tool" | "answering";

export interface Turn {
  readonly id: string;
  readonly role: TurnRole;
  readonly text: string;
  /** Optional provider-returned, non-redacted thinking text; distinct from the answer. */
  readonly thinking?: string;
  readonly state: RunState;
  readonly at: string;
  readonly activity?: readonly ToolActivity[];
  /** Public execution metadata only; never reasoning text. */
  readonly phase?: AgentPhase;
  readonly endedAt?: string;
}

export interface ToolActivity {
  readonly id: string;
  readonly name: string;
  readonly title?: string;
  readonly context?: string;
  readonly state: "preparing" | "running" | "completed" | "failed" | "cancelled" | "not-run" | "unconfirmed";
  readonly elapsedMs?: number;
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
  | { readonly type: "connection"; readonly connected: boolean; readonly error?: string }
  | { readonly type: "session-error"; readonly identity: WorkspaceIdentity; readonly message: string }
  | { readonly type: "snapshot"; readonly identity: WorkspaceIdentity; readonly snapshot: SessionSnapshot }
  | { readonly type: "turn"; readonly identity: WorkspaceIdentity; readonly turn: Turn }
  | { readonly type: "state"; readonly identity: WorkspaceIdentity; readonly state: RunState }
  | { readonly type: "market"; readonly identity: WorkspaceIdentity; readonly snapshot: MarketSnapshot };

export interface SessionSnapshot {
  /** Monotonic within one stored conversation; full snapshots resynchronize missed events. */
  readonly revision?: number;
  readonly identity: WorkspaceIdentity;
  readonly state: RunState;
  readonly turns: readonly Turn[];
  readonly market: MarketSnapshot;
  readonly output: WorkspaceOutput;
  readonly recovery?: { readonly runId: string; readonly unconfirmedTools: number; readonly acknowledgementRequired: boolean };
}

export interface ReferenceCandidate {
  readonly id: string;
  readonly label: string;
  readonly token: string;
  readonly kind: "file" | "directory" | "session" | "evidence";
  readonly description: string;
}

export interface Preferences {
  /** Opaque storage revision for concurrent model-setting edits; never a credential. */
  readonly revision?: string;
  readonly modelProvider?: string;
  readonly modelProtocol?: string;
  readonly thinkingLevel?: string;
  readonly availableThinkingLevels?: readonly string[];
  readonly modelCredentialsConfigured?: boolean;
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
  output(sessionId: string): Promise<WorkspaceOutput>;
  submit(request: SubmitRequest): Promise<SubmitResult>;
  /** Explicit user intent. Releasing a subscription must never do this. */
  cancel(runId: string): Promise<void>;
  /** Acknowledges uncertain prior effects only; never resumes or replays work. */
  acknowledgeInterruption?(runId: string): Promise<void>;
  subscribe(listener: (event: WorkbenchEvent) => void): Release;
}

/** Validate network snapshots before any view state is replaced. No IO or private runtime types. */
export function isWorkbenchSnapshot(value: unknown): value is SessionSnapshot {
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item);
  const string = (item: unknown): item is string => typeof item === "string";
  const nullable = (item: unknown) => item === null || string(item);
  const states = ["idle", "running", "settled", "failed", "cancelled", "interrupted"];
  if (!object(value) || !object(value.identity) || !string(value.identity.workspaceId) || !string(value.identity.sessionId) || !nullable(value.identity.runId)
    || !states.includes(String(value.state)) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0) return false;
  if (!Array.isArray(value.turns) || !value.turns.every(turn => object(turn) && string(turn.id) && ["user", "assistant"].includes(String(turn.role))
    && string(turn.text) && (turn.thinking === undefined || string(turn.thinking)) && string(turn.at) && states.includes(String(turn.state))
    && (turn.phase === undefined || ["waiting", "thinking", "preparing", "tool", "answering"].includes(String(turn.phase)))
    && (turn.endedAt === undefined || string(turn.endedAt) && Number.isFinite(Date.parse(turn.endedAt))) && (turn.activity === undefined || (Array.isArray(turn.activity)
      && turn.activity.every(item => object(item) && string(item.id) && string(item.name)
        && (item.title === undefined || string(item.title) && item.title.length <= 100) && (item.context === undefined || string(item.context) && item.context.length <= 160)
        && ["preparing", "running", "completed", "failed", "cancelled", "not-run", "unconfirmed"].includes(String(item.state))
        && (item.elapsedMs === undefined || typeof item.elapsedMs === "number" && Number.isFinite(item.elapsedMs) && item.elapsedMs >= 0)))))) return false;
  if (value.recovery !== undefined && (!object(value.recovery) || value.state !== "interrupted" || !string(value.recovery.runId) || value.recovery.runId !== value.identity.runId
    || !Number.isSafeInteger(value.recovery.unconfirmedTools) || Number(value.recovery.unconfirmedTools) < 0 || typeof value.recovery.acknowledgementRequired !== "boolean")) return false;
  if (!object(value.market) || !Array.isArray(value.market.quotes) || !string(value.market.refreshedAt) || !object(value.market.source)) return false;
  if (!nullable(value.market.source.provider) || !nullable(value.market.source.updatedAt)
    || ![value.market.source.available, value.market.source.total].every(item => typeof item === "number" && Number.isSafeInteger(item) && item >= 0)) return false;
  if (!value.market.quotes.every(quote => object(quote) && string(quote.code) && string(quote.name)
    && [quote.value, quote.change].every(item => item === null || typeof item === "number" && Number.isFinite(item)))) return false;
  if (!object(value.output) || !object(value.output.conclusion) || !Array.isArray(value.output.evidence) || !Array.isArray(value.output.artifacts)) return false;
  const conclusion = value.output.conclusion;
  return nullable(conclusion.statement) && nullable(conclusion.boundary) && [null, "low", "medium", "high"].includes(conclusion.confidence as null | string) && typeof conclusion.settled === "boolean"
    && value.output.evidence.every(item => object(item) && string(item.id) && string(item.label) && nullable(item.source) && nullable(item.asOf) && typeof item.available === "boolean")
    && value.output.artifacts.every(item => object(item) && string(item.id) && string(item.title) && string(item.sha256) && /^[a-f0-9]{64}$/i.test(item.sha256) && string(item.createdAt) && typeof item.version === "number" && Number.isSafeInteger(item.version) && item.version > 0);
}
