/** Domain types for the r2 frame-buffer TUI. */

export interface Holding {
  code: string;
  name: string;
  price: number;
  pct: number;
}

export interface Quote {
  code: string;
  name: string;
  price: number;
  pct: number;
}

export interface ToolState {
  name: string;
  /** Human-readable label with data provider, e.g. "Tushare · Daily OHLCV". */
  label: string;
  args?: string;
  status: "running" | "done" | "error";
  startedAt: number;
  result?: string;
}

export interface UIMessage {
  role: "user" | "assistant" | "thinking" | "tool" | "error";
  text?: string;
  /** When true, thinking text is still streaming (show cursor dots). */
  thinkingLive?: boolean;
  tool?: ToolState;
}

export type PanelSection =
  | { kind: "holdings"; title: string; rows: Holding[] }
  | { kind: "quotes"; title: string; rows: Quote[] }
  | { kind: "keyvalue"; title: string; rows: { label: string; value: string }[] }
  | { kind: "group"; groupId: string; title: string; rows: Holding[]; collapsed: boolean };

export interface ComposerStatus {
  kind: "info" | "error";
  text: string;
}

export interface AppState {
  model: string;
  modelLabel: string;
  version: string;
  user: string;
  activity: "starting" | "thinking" | "running tool" | "ready";
  cost: number;
  cacheHit: number;
  messages: UIMessage[];
  panel: PanelSection[];
  panelLoading: boolean;
  input: string;
  /** Pending NL messages waiting for agent pickup (shown in Composer, not conversation). */
  composerQueue: string[];
  composerStatus: ComposerStatus | null;
  /** Name of the currently active local portfolio (shown in status line). */
  activePortfolio: string;
  /** Active data source labels (shown in status line). */
  aShareSource: string;
  globalSource: string;
  /** Whether the right-side overview panel is visible. */
  insightEnabled: boolean;
}

export interface Layout {
  mainPane: { x: number; y: number; w: number; h: number };
  conversation: { x: number; y: number; w: number; h: number };
  portfolio: { x: number; y: number; w: number; h: number };
  composer: { x: number; y: number; w: number; h: number };
  statusRow: number;
  showPanel: boolean;
}
