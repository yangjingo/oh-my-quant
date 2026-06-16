/**
 * QuantTui — full-screen frame-buffer TUI with raw-mode keyboard input.
 * Wraps Screen + Buffer; feeds agent events → paint().
 */
import type * as readline from "node:readline";
import { Buffer, Screen } from "./buffer.ts";
import { layout, drawHeader, drawConversation, drawPortfolio, drawComposer, drawStatus, conversationMaxScrollUp, overviewMaxScrollTop, buildConversationView, buildOverviewView } from "./render.ts";
import { CANVAS } from "./styles.ts";
import type { AppState } from "./types.ts";
import { loadWatchlistEntries, type CodeEntry } from "./watchlist.ts";
import { PanelController, type CurrentSessionMeta } from "./panel.ts";
import { buildSuggestions, hitTestScrollRegion, nextInputAction, type InputAction, type MouseEvent, type ScrollRegion } from "./input.ts";
import { copyToClipboard } from "./clipboard.ts";
import {
  conversationPointFromScreen,
  conversationPointFromScreenClamped,
  extractConversationSelection,
  lastAssistantPlainText,
  type ConversationSelection,
  type ConversationView,
} from "./selection.ts";

export class QuantTui {
  screen: Screen;
  state: AppState;
  private inputBuf = "";
  private history: string[] = [];
  private histIdx = -1;
  private submitHandler: ((text: string) => void) | null = null;
  private panelRefreshHandler: (() => void) | null = null;
  private running = false;
  private animTimer: ReturnType<typeof setInterval> | null = null;
  private suggestionIdx = 0;
  private watchlist: CodeEntry[] = [];
  private panel = new PanelController();
  /** Conversation: lines scrolled up from bottom (0 = latest). */
  private convScrollUp = 0;
  /** Overview panel: lines scrolled from top. */
  private overviewScrollTop = 0;
  /** Last non-composer region touched by mouse; arrow keys scroll it. */
  private scrollRegion: ScrollRegion = "composer";
  private pendingInput = "";
  private dragTarget: "conversation" | "overview" | null = null;
  private dragRow = 0;
  private textSelection: ConversationSelection | null = null;
  private selectDrag = false;
  /** Panel that owns the active text selection (for highlight + copy scope). */
  private selectionRegion: ScrollRegion | null = null;
  private copyStatusTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(state: AppState) {
    this.state = state;
    this.screen = new Screen(process.stdout);
  }

  start(): void {
    this.running = true;
    this.screen.enter();
    this.setupInput();
    void loadWatchlistEntries().then((entries) => {
      this.watchlist = entries;
      this.paint();
    });
    process.stdout.on("resize", () => { this.screen.resize(); this.paint(); });
    this.animTimer = setInterval(() => {
      if (this.state.activity !== "ready") this.paint();
    }, 80);
    this.paint();
  }

  stop(): void {
    this.running = false;
    if (this.animTimer) { clearInterval(this.animTimer); this.animTimer = null; }
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.removeAllListeners("data");
    process.stdin.removeAllListeners("keypress");
    this.screen.exit();
  }

  update(partial: Partial<AppState>): void {
    Object.assign(this.state, partial);
    if (!this.running) return;
    this.screen.resize();
    this.paint();
  }

  onSubmit(handler: (text: string) => void): void { this.submitHandler = handler; }
  onPanelRefresh(handler: () => void): void { this.panelRefreshHandler = handler; }
  openConfig(): void { this.panel.open("config"); this.paint(); }
  openResume(meta?: CurrentSessionMeta): void { if (meta) this.panel.setCurrentSessionMeta(meta); this.panel.open("resume"); this.paint(); }
  openPortfolio(): void { this.panel.open("portfolio"); this.paint(); }
  openHelp(): void { this.panel.open("help"); this.paint(); }

  private paint(): void {
    const L = layout(this.screen.cols, this.screen.rows);
    this.clampScroll(L);
    const st = { ...this.state, input: this.inputBuf };
    this.screen.buf.clear();
    for (let y = 0; y < this.screen.buf.h; y++)
      for (let x = 0; x < this.screen.buf.w; x++)
        this.screen.buf.set(x, y, " ", { fg: CANVAS });
    drawHeader(this.screen.buf, st);
    drawConversation(
      this.screen.buf,
      L.conversation,
      st.messages,
      st.activity,
      L.mainPane,
      this.convScrollUp,
      this.selectionRegion === "conversation" ? this.textSelection : null,
    );
    if (L.showPanel) {
      drawPortfolio(
        this.screen.buf,
        L.portfolio,
        st.panel,
        st.panelLoading,
        this.overviewScrollTop,
        this.selectionRegion === "overview" ? this.textSelection : null,
      );
    }
    const suggestions = buildSuggestions(this.inputBuf, this.watchlist);
    const selectedIdx = suggestions.length === 0 ? -1 : Math.min(this.suggestionIdx, suggestions.length - 1);
    drawComposer(this.screen.buf, L.composer, st, st.input, suggestions, selectedIdx, L.conversation);
    drawStatus(this.screen.buf, L.statusRow, this.screen.cols, st);
    this.panel.render(this.screen.buf);
    this.screen.flush();
  }

  private clampScroll(L: ReturnType<typeof layout>): void {
    const convInnerH = L.mainPane.h - 2;
    const convInnerW = L.mainPane.w - 4;
    this.convScrollUp = Math.min(
      this.convScrollUp,
      conversationMaxScrollUp(this.state.messages, convInnerW, convInnerH),
    );
    if (L.showPanel) {
      const ovInnerH = L.portfolio.h - 2;
      this.overviewScrollTop = Math.min(
        this.overviewScrollTop,
        overviewMaxScrollTop(this.state.panel, ovInnerH),
      );
    } else {
      this.overviewScrollTop = 0;
    }
  }

  private scroll(region: ScrollRegion, delta: number): void {
    const L = layout(this.screen.cols, this.screen.rows);
    if (region === "conversation") {
      const max = conversationMaxScrollUp(this.state.messages, L.mainPane.w - 4, L.mainPane.h - 2);
      this.convScrollUp = Math.min(max, Math.max(0, this.convScrollUp + delta));
    } else if (region === "overview" && L.showPanel) {
      const max = overviewMaxScrollTop(this.state.panel, L.portfolio.h - 2);
      this.overviewScrollTop = Math.min(max, Math.max(0, this.overviewScrollTop + delta));
    }
  }

  private wheelStep(L: ReturnType<typeof layout>, region: ScrollRegion): number {
    const h = region === "overview" ? L.portfolio.h : L.mainPane.h;
    return Math.max(1, Math.floor((h - 3) / 4));
  }

  private scrollRegionPanel(up: boolean, page: boolean): void {
    const L = layout(this.screen.cols, this.screen.rows);
    const step = page
      ? Math.max(1, (this.scrollRegion === "overview" ? L.portfolio.h : L.mainPane.h) - 3)
      : 1;
    if (this.scrollRegion === "conversation") {
      this.scroll("conversation", up ? step : -step);
    } else if (this.scrollRegion === "overview") {
      this.scroll("overview", up ? -step : step);
    }
  }

  private handlePanelSelect(
    panel: "conversation" | "overview",
    view: ConversationView,
    evt: MouseEvent,
  ): boolean {
    const pointAt = (c: number, r: number) =>
      this.selectDrag ? conversationPointFromScreenClamped(c, r, view) : conversationPointFromScreen(c, r, view);
    const point = pointAt(evt.col, evt.row);

    if (evt.shift && evt.wheel === 0 && evt.kind === "press" && evt.button === 0 && point) {
      this.textSelection = { anchor: point, cursor: point };
      this.selectDrag = true;
      this.selectionRegion = panel;
      // #region agent log
      fetch("http://127.0.0.1:7287/ingest/afac60de-da57-47d2-beed-4b5639b3d1cd", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "33aff1" }, body: JSON.stringify({ sessionId: "33aff1", hypothesisId: "A", location: "tui.ts:selectStart", message: "shift+press selection start", data: { panel, point, inner: view.inner }, timestamp: Date.now() }) }).catch(() => {});
      // #endregion
      return true;
    }

    if (this.selectDrag && this.selectionRegion === panel) {
      const dragPoint = pointAt(evt.col, evt.row);
      if (dragPoint && (evt.dragging || evt.kind === "motion")) {
        if (this.textSelection) this.textSelection = { anchor: this.textSelection.anchor, cursor: dragPoint };
        return true;
      }
      if (evt.kind === "release") {
        this.selectDrag = false;
        // #region agent log
        fetch("http://127.0.0.1:7287/ingest/afac60de-da57-47d2-beed-4b5639b3d1cd", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "33aff1" }, body: JSON.stringify({ sessionId: "33aff1", hypothesisId: "E", location: "tui.ts:selectRelease", message: "selection release copy", data: { panel, hasSelection: !!this.textSelection }, timestamp: Date.now() }) }).catch(() => {});
        // #endregion
        void this.copyPanelSelection(panel, view);
        return true;
      }
    }

    if (evt.kind === "press" && evt.button === 0 && !evt.shift) {
      this.clearSelection();
    }
    return false;
  }

  private clearSelection(): void {
    this.textSelection = null;
    this.selectDrag = false;
    this.selectionRegion = null;
  }

  private handleMouseEvent(evt: MouseEvent): boolean {
    const L = layout(this.screen.cols, this.screen.rows);
    const region = hitTestScrollRegion(evt.col, evt.row, L);
    this.scrollRegion = region;

    if (region === "conversation") {
      const view = buildConversationView(this.state.messages, L.conversation, this.convScrollUp, L.mainPane);
      if (this.handlePanelSelect("conversation", view, evt)) return true;
    } else if (region === "overview" && L.showPanel) {
      const view = buildOverviewView(this.state.panel, L.portfolio, this.overviewScrollTop);
      if (this.handlePanelSelect("overview", view, evt)) return true;
    } else if (this.selectDrag && evt.kind === "press" && evt.button === 0) {
      this.clearSelection();
    }

    if (this.selectDrag) return true;

    if (evt.wheel !== 0) {
      const step = this.wheelStep(L, region);
      if (region === "conversation") {
        this.scroll("conversation", evt.wheel < 0 ? step : -step);
      } else if (region === "overview") {
        this.scroll("overview", evt.wheel < 0 ? -step : step);
      }
      return region === "conversation" || region === "overview";
    }

    if (evt.kind === "press" && evt.button === 0) {
      if (region === "conversation") {
        this.dragTarget = region;
        this.dragRow = evt.row;
      } else {
        this.dragTarget = null;
      }
      return false;
    }

    if (evt.kind === "release" && evt.button === 0) {
      this.dragTarget = null;
      return false;
    }

    if (evt.dragging && this.dragTarget) {
      const delta = evt.row - this.dragRow;
      if (delta !== 0) {
        this.scroll(this.dragTarget, this.dragTarget === "conversation" ? delta : -delta);
        this.dragRow = evt.row;
        return true;
      }
    }

    return false;
  }

  private async copyPanelSelection(
    panel: "conversation" | "overview",
    view: ConversationView,
  ): Promise<void> {
    const fallback = panel === "conversation"
      ? lastAssistantPlainText(this.state.messages)
      : "";
    const text = this.textSelection
      ? extractConversationSelection(view, this.textSelection)
      : fallback;
    // #region agent log
    fetch("http://127.0.0.1:7287/ingest/afac60de-da57-47d2-beed-4b5639b3d1cd", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "33aff1" }, body: JSON.stringify({ sessionId: "33aff1", hypothesisId: "C", location: "tui.ts:copyPanelSelection", message: "extracted copy text", data: { panel, len: text.length, trimmed: text.trim().length, hasSelection: !!this.textSelection }, timestamp: Date.now() }) }).catch(() => {});
    // #endregion
    if (!text.trim()) {
      this.flashCopyStatus("Nothing to copy", true);
      return;
    }
    const ok = await copyToClipboard(text);
    // #region agent log
    fetch("http://127.0.0.1:7287/ingest/afac60de-da57-47d2-beed-4b5639b3d1cd", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "33aff1" }, body: JSON.stringify({ sessionId: "33aff1", hypothesisId: "D", location: "tui.ts:copyPanelSelection", message: "clipboard result", data: { panel, ok, len: text.length, platform: process.platform }, timestamp: Date.now() }) }).catch(() => {});
    // #endregion
    this.flashCopyStatus(ok ? `Copied ${text.length} chars` : "Copy failed", !ok);
  }

  private async copyConversationSelection(): Promise<void> {
    const L = layout(this.screen.cols, this.screen.rows);
    const view = buildConversationView(this.state.messages, L.conversation, this.convScrollUp, L.mainPane);
    await this.copyPanelSelection("conversation", view);
  }

  private flashCopyStatus(text: string, error = false): void {
    if (this.copyStatusTimer) clearTimeout(this.copyStatusTimer);
    this.state.composerStatus = { kind: error ? "error" : "info", text };
    this.paint();
    this.copyStatusTimer = setTimeout(() => {
      this.state.composerStatus = null;
      this.paint();
      this.copyStatusTimer = null;
    }, 2000);
  }

  private drainInput(): void {
    while (this.running) {
      const { action, rest } = nextInputAction(this.pendingInput);
      this.pendingInput = rest;
      if (!action) break;
      if (action.type === "mouse") {
        let paint = false;
        for (const evt of action.events) {
          if (this.handleMouseEvent(evt)) paint = true;
        }
        if (paint) this.paint();
        continue;
      }
      if (action.type === "discard") continue;
      this.handleKeyAction(action);
      this.paint();
    }
  }

  private handleKeyAction(action: Extract<InputAction, { type: "key" }>): void {
    const key: readline.Key = {
      name: action.name || undefined,
      shift: action.shift,
      ctrl: action.ctrl,
      meta: action.meta,
      sequence: action.char ?? (action.name || ""),
    };
    const ch = action.char ?? "";

    if (this.panel.isOpen()) {
      const result = this.panel.handleKey(ch, key);
      if (result?.command) this.submitHandler?.(result.command);
      if (result?.refreshPanel) this.panelRefreshHandler?.();
      if (result?.close) {
        this.panel.close();
        this.state.activePortfolio = this.panel.activePortfolioName();
      }
      return;
    }

    const suggestions = this.currentSuggestions();
    const hasSuggestions = suggestions.length > 0;

    if (hasSuggestions && action.char && /^[1-9]$/.test(action.char)) {
      const idx = Number(action.char) - 1;
      if (idx < suggestions.length) this.applySuggestion(suggestions[idx].fill);
      return;
    }

    if (key.name === "return") {
      const input = this.inputBuf;
      if (hasSuggestions) {
        const idx = Math.min(this.suggestionIdx, suggestions.length - 1);
        const fill = suggestions[idx].fill;
        // Auto-complete only when fill is a different command (e.g. /r → /resume).
        // When fill is a subcommand/arg of current input (e.g. /factor → /factor analyze),
        // submit the current input and let the user pick subcommands via Tab.
        const trimInput = input.trim();
        if (fill !== input && !fill.startsWith(trimInput + " ")) {
          this.applySuggestion(fill);
          return;
        }
      }
      const text = input.trim();
      if (text && text !== "/") {
        this.history.unshift(text);
        this.histIdx = -1;
        this.inputBuf = "";
        this.suggestionIdx = 0;
        this.convScrollUp = 0;
        this.scrollRegion = "composer";
        this.submitHandler?.(text);
      }
    } else if (key.name === "pageup") {
      const L = layout(this.screen.cols, this.screen.rows);
      const page = Math.max(1, L.mainPane.h - 3);
      if (key.shift && L.showPanel) this.scroll("overview", -page);
      else this.scroll("conversation", page);
    } else if (key.name === "pagedown") {
      const L = layout(this.screen.cols, this.screen.rows);
      const page = Math.max(1, L.mainPane.h - 3);
      if (key.shift && L.showPanel) this.scroll("overview", page);
      else this.scroll("conversation", -page);
    } else if (key.name === "backspace") {
      this.inputBuf = this.inputBuf.slice(0, -1);
      this.suggestionIdx = 0;
    } else if (key.name === "up" || key.name === "down") {
      if (this.scrollRegion === "conversation" || this.scrollRegion === "overview") {
        this.scrollRegionPanel(key.name === "up", false);
      } else if (hasSuggestions) {
        if (key.name === "up") {
          this.suggestionIdx = this.suggestionIdx <= 0 ? suggestions.length - 1 : this.suggestionIdx - 1;
        } else {
          this.suggestionIdx = this.suggestionIdx >= suggestions.length - 1 ? 0 : this.suggestionIdx + 1;
        }
      } else if (key.name === "up") {
        if (this.history.length > 0 && this.histIdx < this.history.length - 1) {
          this.histIdx++;
          this.inputBuf = this.history[this.histIdx];
        }
      } else if (key.name === "down") {
        if (this.histIdx > 0) {
          this.histIdx--;
          this.inputBuf = this.history[this.histIdx];
        } else { this.histIdx = -1; this.inputBuf = ""; }
      }
    } else if (key.ctrl && key.shift && key.name === "c") {
      void this.copyConversationSelection();
    } else if (key.ctrl && key.name === "c") {
      if (this.inputBuf) { this.inputBuf = ""; this.suggestionIdx = 0; }
      else { this.stop(); process.exit(0); }
    } else if (key.ctrl && key.name === "d") {
      this.stop(); process.exit(0);
    } else if (key.ctrl && key.name === "p") {
      this.openConfig();
    } else if (key.name === "tab") {
      if (hasSuggestions) {
        const idx = Math.min(this.suggestionIdx, suggestions.length - 1);
        this.applySuggestion(suggestions[idx].fill);
      }
    } else if (key.name === "escape") {
      if (this.inputBuf) { this.inputBuf = ""; this.suggestionIdx = 0; }
      else { this.stop(); process.exit(0); }
    } else if (action.char && !key.ctrl && !key.meta) {
      this.scrollRegion = "composer";
      this.suggestionIdx = 0;
      this.inputBuf += action.char;
    }
  }

  private currentSuggestions() {
    return buildSuggestions(this.inputBuf, this.watchlist);
  }

  private applySuggestion(fill: string): void {
    this.inputBuf = fill;
    this.suggestionIdx = 0;
  }

  private setupInput(): void {
    if (!process.stdin.isTTY) return;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      if (!this.running) return;
      this.pendingInput += chunk;
      this.drainInput();
    });
  }
}
