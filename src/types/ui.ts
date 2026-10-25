/** Domain types for the r2 frame-buffer TUI. */
import type { QuoteObservation } from "./market-observation.ts";
import type { MarketColorScheme } from "./theme-colors.ts";
import type { HudMode } from "./config.ts";

export interface Holding {
  code: string;
  name: string;
  price: number;
  pct: number;
  observation?: QuoteObservation;
  refreshState?: "refreshing" | "stale";
}

export interface Quote {
  code: string;
  name: string;
  price: number;
  pct: number;
  observation?: QuoteObservation;
  refreshState?: "refreshing" | "stale";
}

import type { SkillState } from "./skills.ts";
import type { HudMetrics } from "./hud.ts";

export type { SkillState };
export type { HudMetrics };

export interface ToolState {
  /** Stable agent call id used to match parallel tool updates/results. */
  toolCallId?: string;
  name: string;
  /** Human-readable label with data provider, e.g. "Tushare · Daily OHLCV". */
  label: string;
  args?: string;
  status: "running" | "done" | "error";
  startedAt: number;
  result?: string;
}

export interface UIMessage {
  role: "user" | "assistant" | "thinking" | "tool" | "skill" | "error";
  text?: string;
  /** When true, thinking text is still streaming (show cursor dots). */
  thinkingLive?: boolean;
  /** Timestamp used to show elapsed thinking time while the turn is active. */
  startedAt?: number;
  tool?: ToolState;
  skill?: SkillState;
}

export interface OverviewRefreshView {
  /** Local refresh attempt, never a shared trading/NAV date. Null before the first attempt. */
  at: string | null;
  status: "idle" | "fetching" | "success" | "partial" | "unavailable" | "timeout" | "error";
  retryKey?: string;
}

export type PanelSection = (
  | { kind: "holdings"; title: string; rows: Holding[] }
  | { kind: "quotes"; title: string; rows: Quote[] }
  | { kind: "keyvalue"; title: string; rows: { label: string; value: string }[] }
  | { kind: "group"; groupId: string; title: string; rows: Holding[]; collapsed: boolean }
) & { /** Overview-wide presentation metadata, carried by the first section. */ refresh?: OverviewRefreshView };

export interface ComposerStatus {
  kind: "info" | "error";
  text: string;
}

export interface AppState {
  model: string;
  modelLabel: string;
  version: string;
  user: string;
  activity: "starting" | "thinking" | "running tool" | "compacting" | "ready";
  cost: number;
  cacheHit: number;
  messages: UIMessage[];
  panel: PanelSection[];
  panelLoading: boolean;
  input: string;
  /** Pending NL messages waiting for agent pickup (shown in Composer, not conversation). */
  composerQueue: string[];
  composerStatus: ComposerStatus | null;
  researchInterruptKey?: string;
  researchStartedAt?: number;
  failedQuotesRetryKey?: string;
  /** Name of the currently active local portfolio (shown in status line). */
  activePortfolio: string;
  /** Active data source label (shown in status line). */
  source: string;
  /** Whether the right-side overview panel is visible. */
  showPortfolioPanel: boolean;
  marketColorScheme?: MarketColorScheme;
  hudMode?: HudMode;
  /** Bottom HUD metrics for the current session and latest assistant turn. */
  hud?: HudMetrics;
}

export interface Layout {
  mainPane: { x: number; y: number; w: number; h: number };
  conversation: { x: number; y: number; w: number; h: number };
  portfolio: { x: number; y: number; w: number; h: number };
  composer: { x: number; y: number; w: number; h: number };
  statusRow: number;
  showPanel: boolean;
}



