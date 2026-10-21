import type { Bar } from "./data.ts";

export interface WorkspaceScope {
  symbol: string;
  benchmark: string;
  start: string;
  end: string;
}
export interface WorkspaceEvidence {
  id: string;
  kind: "prices" | "calculation";
  source: string;
  fetchedAt: string;
  contentHash: string;
  symbol?: string;
  adjustment?: string;
  bars?: Bar[];
  sessions?: string[];
  inputs?: string[];
  result?: WorkspaceMetrics;
  limitations: string[];
}
export interface WorkspaceMetrics {
  start: string;
  end: string;
  observations: number;
  close: number;
  returnPct: number;
  drawdownPct: number;
  ma20: number | null;
  ma60: number | null;
  ma120: number | null;
  volumeRatio: number | null;
  closeLocation: number | null;
  relativeReturnPp: number | null;
  structuralLow: { date: string; price: number };
  recentHigh: { date: string; price: number };
  previousBoundary: { date: string; price: number } | null;
  historicalRevisions: string[];
  comparison: {
    previousEnd: string | null;
    newEnd: string;
    advanced: boolean;
    comparable: boolean;
  };
  limitations: string[];
}
export interface WorkspaceAnswer {
  summary: string;
  classification: string;
  signal: "观察" | "失效" | "证据不足";
  claims: Array<{ text: string; evidence: string[] }>;
  next: string[];
  limitations: string[];
}
export interface WorkspaceEvent {
  at: string;
  kind: string;
  text: string;
  toolName?: string;
  toolCallId?: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  isError?: boolean;
}

export interface WorkspaceRun {
  /** Optional for snapshots saved before conversations were introduced. */
  conversationId?: string;
  history?: WorkspaceTurn[];
  version: 1;
  id: string;
  studyId: string;
  parentId: string | null;
  question: string;
  scope: WorkspaceScope;
  createdAt: string;
  updatedAt: string;
  status: "running" | "complete" | "cancelled" | "failed" | "needs_input";
  saved: boolean;
  model: string;
  events: WorkspaceEvent[];
  thinking?: string;
  evidence: WorkspaceEvidence[];
  answer: WorkspaceAnswer | null;
  /** Conversation only; not a newly verified research artifact. */
  reply?: string;
  clarification: string | null;
  error: string | null;
}

export type WorkspaceTurn = Pick<
  WorkspaceRun,
  | "id"
  | "question"
  | "createdAt"
  | "status"
  | "answer"
  | "reply"
  | "clarification"
  | "events"
  | "thinking"
  | "error"
>;
