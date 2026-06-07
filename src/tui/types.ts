/** Domain types for the r2 frame-buffer TUI. */

export interface Holding {
  code: string;
  name: string;
  price: number;
  pct: number;
}

export interface Quote {
  symbol: string;
  price: number;
  pct: number;
}

export interface ToolState {
  name: string;
  args?: string;
  status: "running" | "done" | "error";
  startedAt: number;
  result?: string;
}

export interface UIMessage {
  role: "user" | "assistant" | "thinking" | "tool" | "error";
  text?: string;
  tool?: ToolState;
}

export type PanelSection =
  | { kind: "holdings"; title: string; rows: Holding[] }
  | { kind: "quotes"; title: string; rows: Quote[] }
  | { kind: "keyvalue"; title: string; rows: { label: string; value: string }[] };

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
  composerStatus: ComposerStatus | null;
}

export interface Layout {
  mainPane: { x: number; y: number; w: number; h: number };
  conversation: { x: number; y: number; w: number; h: number };
  portfolio: { x: number; y: number; w: number; h: number };
  composer: { x: number; y: number; w: number; h: number };
  statusRow: number;
  showPanel: boolean;
}
