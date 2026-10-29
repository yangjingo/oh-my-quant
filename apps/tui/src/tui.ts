/**
 * QuantTui — full-screen frame-buffer TUI with raw-mode keyboard input.
 * Wraps Screen + Buffer; feeds agent events → paint().
 */
import type * as readline from "node:readline";
import { Screen } from "./buffer.ts";
import { layout, drawHeader, drawConversation, drawPortfolio, drawComposer, drawStatus, buildConversationView, buildOverviewView, activeConversationStatusRows } from "./render.ts";
import { CANVAS, marketForegrounds } from "./styles.ts";
import { drawRecoveryConfirmation } from "./recovery-confirmation.ts";
import type { RunRevisionRequest, SessionSnapshot } from "../../../src/types/workbench.ts";
import type { AppState, CurrentSessionMeta } from "../../../src/types/ui.ts";
import type { ComposerReferenceSuggestion } from "../../../src/types/composer-reference.ts";
import { activeReferenceQuery } from "../../../src/runtime/workspace/reference-syntax.ts";
import type { ResearchTaskSnapshot } from "../../../src/types/research-task.ts";
import type { PrivateAnnualExportRequest } from "../../../src/types/private-annual-export.ts";
import { loadWatchlistEntries, type CodeEntry } from "./watchlist.ts";
import { PanelController } from "./panel.ts";
import { buildSuggestions, hitTestScrollRegion, nextInputAction, type InputAction, type MouseEvent, type ScrollRegion, type SkillEntry } from "./input.ts";
import { loadRuntimeSkillSuggestions } from "../../../src/runtime/skills/skill-suggestions.ts";
import { copyToClipboard } from "./clipboard.ts";
import { resolveCopyText } from "./tui-copy.ts";
import { DEFAULT_APP_KEYBINDINGS } from "./model-settings-panel.ts";
import {
  applyScrollDelta as applyScrollDeltaToState,
  clampScrollState as clampScrollStateForLayout,
  scrollRegionDelta as scrollRegionDeltaForLayout,
  wheelStep as wheelStepForLayout,
} from "./tui-scroll.ts";
import {
  conversationPointFromScreen,
  conversationPointFromScreenClamped,
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
  private recoveryTarget: (RunRevisionRequest & { unconfirmedTools: number; activities: string[] }) | null = null;
  private recoveryPrompt: (RunRevisionRequest & { unconfirmedTools: number; activities: string[] }) | null = null;
  private recoveryConfirming = false;
  private recoveryOffset = 0;
  private recoveryMaxOffset = 0;
  private recoveryHandler: ((target: RunRevisionRequest) => Promise<boolean>) | null = null;
  private artifactRestoreHandler: ((reportId: string) => void) | null = null;
  private privateAnnualExportHandler: ((request: PrivateAnnualExportRequest) => void) | null = null;
  private panelRefreshHandler: (() => void) | null = null;
  private configurationChangeHandler: (() => void) | null = null;
  private doctorCloseHandler: (() => void) | null = null;
  private researchInterruptHandler: (() => void) | null = null;
  private failedQuotesRetryHandler: (() => void) | null = null;
  private readonly operationBindings: Record<"interruptResearch" | "retryFailedQuotes", readonly string[]>;
  private running = false;
  private animTimer: ReturnType<typeof setInterval> | null = null;
  private suggestionIdx = 0;
  private watchlist: CodeEntry[] = [];
  private skills: SkillEntry[] = [];
  private skillLoadVersion = 0;
  private referenceProvider?: (input: string) => Promise<ComposerReferenceSuggestion[]>;
  private referenceInput: string | null = null;
  private referenceSuggestions: ComposerReferenceSuggestion[] = [];
  private referencePending = false;
  private referenceVersion = 0;
  private referenceError: string | null = null;
  private referenceTimer: ReturnType<typeof setTimeout> | null = null;
  private panel = new PanelController(undefined, {
    onChange: () => { if (this.running) this.paint(); },
    onDoctorClose: () => this.doctorCloseHandler?.(),
    onConfigurationChange: () => this.configurationChangeHandler?.(),
  });
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
  private portfolioStatusTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(state: AppState, bindings: Partial<Record<"interruptResearch" | "retryFailedQuotes", readonly string[]>> = {}) {
    this.state = state;
    this.operationBindings = { ...DEFAULT_APP_KEYBINDINGS, ...bindings };
    this.state.researchInterruptKey = this.operationBindings.interruptResearch[0];
    this.state.failedQuotesRetryKey = this.operationBindings.retryFailedQuotes[0];
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
    void this.refreshSkills();
    process.stdout.on("resize", () => { this.screen.resize(); this.paint(); });
    this.animTimer = setInterval(() => {
      if (this.state.activity !== "ready") this.paint();
    }, 80);
    this.paint();
  }

  stop(): void {
    this.running = false;
    this.referenceVersion++;
    this.referenceInput = null;
    if (this.referenceTimer) clearTimeout(this.referenceTimer);
    this.skillLoadVersion++;
    this.panel.close();
    if (this.animTimer) { clearInterval(this.animTimer); this.animTimer = null; }
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.removeAllListeners("data");
    process.stdin.removeAllListeners("keypress");
    this.screen.exit();
  }

  update(partial: Partial<AppState>): void {
    if (partial.activity === "thinking" || partial.activity === "running tool") {
      this.state.researchStartedAt ??= Date.now();
    } else if (partial.activity === "ready") this.state.researchStartedAt = undefined;
    Object.assign(this.state, partial);
    if (!this.running) return;
    this.screen.resize();
    this.paint();
  }

  onSubmit(handler: (text: string) => void): void { this.submitHandler = handler; }
  onRecoveryConfirm(handler: (target: RunRevisionRequest) => Promise<boolean>): void { this.recoveryHandler = handler; }
  setRecoverySnapshot(snapshot: SessionSnapshot): void {
    const recovery = snapshot.recovery, identity = snapshot.identity;
    const next = recovery?.acknowledgementRequired && identity.runId && recovery.runId === identity.runId
      && Number.isSafeInteger(snapshot.revision) && snapshot.revision! >= 0
      ? { workspaceId: identity.workspaceId, sessionId: identity.sessionId, runId: identity.runId,
        expectedRevision: snapshot.revision!, unconfirmedTools: recovery.unconfirmedTools,
        activities: (snapshot.turns?.find(turn => turn.id === `${identity.runId}-assistant`)?.activity ?? [])
          .filter(item => ["unconfirmed", "failed", "cancelled", "not-run"].includes(item.state))
          .map(item => `${item.name} · ${item.state}`) } : null;
    if (this.recoveryPrompt && (!next || next.workspaceId !== this.recoveryPrompt.workspaceId
      || next.sessionId !== this.recoveryPrompt.sessionId || next.runId !== this.recoveryPrompt.runId
      || next.expectedRevision !== this.recoveryPrompt.expectedRevision)) {
      this.recoveryPrompt = null; this.recoveryConfirming = false;
    }
    this.recoveryTarget = next;
    if (this.running) this.paint();
  }
  setReferenceProvider(provider: (input: string) => Promise<ComposerReferenceSuggestion[]>): void {
    this.referenceProvider = provider;
    this.referenceInput = null;
  }
  onArtifactRestore(handler: (reportId: string) => void): void { this.artifactRestoreHandler = handler; }
  onPrivateAnnualExport(handler: (request: PrivateAnnualExportRequest) => void): void { this.privateAnnualExportHandler = handler; }
  onPanelRefresh(handler: () => void): void { this.panelRefreshHandler = handler; }
  onConfigurationChange(handler: () => void): void { this.configurationChangeHandler = handler; }
  onDoctorClose(handler: () => void): void { this.doctorCloseHandler = handler; }
  onResearchInterrupt(handler: () => void): void { this.researchInterruptHandler = handler; }
  onFailedQuotesRetry(handler: () => void): void { this.failedQuotesRetryHandler = handler; }
  openConfig(): void { this.panel.open("config"); this.paint(); }
  openDoctor(doctor?: unknown): void {
    if (!this.panel.isDoctorMode()) this.panel.open("doctor");
    this.panel.setDoctor(doctor as any);
    this.paint();
  }
  openResume(meta?: CurrentSessionMeta): void { this.panel.setCurrentSessionMeta(meta ?? null); this.panel.open("resume"); this.paint(); }
  openResearch(snapshot: ResearchTaskSnapshot): void { this.panel.open("research"); this.panel.setResearchSnapshot(snapshot); this.paint(); }
  syncCurrentSessionMeta(meta?: CurrentSessionMeta): void { this.panel.setCurrentSessionMeta(meta ?? null); this.paint(); }
  openPortfolio(): void { this.panel.open("portfolio"); this.paint(); }
  openArtifact(): void { this.panel.open("artifact"); this.paint(); }
  setArtifactCwd(cwd: string | null): void { this.panel.setArtifactCwd(cwd); this.paint(); }
  openHelp(): void { this.panel.open("help"); this.paint(); }

  private currentLayout() {
    return layout(this.screen.cols, this.screen.rows, this.state.showPortfolioPanel,
      this.inputBuf.startsWith("/") || Boolean(activeReferenceQuery(this.inputBuf)) || this.inputBuf.includes("\n") || this.state.composerQueue.length > 0);
  }

  private paint(): void {
    this.refreshReferenceSuggestions();
    const L = this.currentLayout();
    this.clampScroll(L);
    const status = this.referenceError ? { kind: "error" as const, text: this.referenceError } : this.state.composerStatus;
    const st = { ...this.state, input: this.inputBuf, composerStatus: this.recoveryTarget && status?.kind !== "error"
      ? { kind: "info" as const, text: "工具结果待核对 · Enter 查看确认，草稿保留" } : status };
    this.screen.buf.clear();
    this.screen.buf.foregrounds = marketForegrounds(this.state.marketColorScheme);
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
    const suggestions = this.currentSuggestions();
    const selectedIdx = suggestions.length === 0 ? -1 : Math.min(this.suggestionIdx, suggestions.length - 1);
    drawComposer(this.screen.buf, L.composer, st, st.input, suggestions, selectedIdx, L.conversation);
    drawStatus(this.screen.buf, L.statusRow, this.screen.cols, st);
    this.panel.render(this.screen.buf);
    if (this.recoveryPrompt) this.recoveryMaxOffset = drawRecoveryConfirmation(this.screen.buf, this.recoveryPrompt.unconfirmedTools, this.recoveryPrompt.activities, this.recoveryOffset, this.recoveryConfirming);
    this.screen.flush();
  }

  private clampScroll(L: ReturnType<typeof layout>): void {
    const next = clampScrollStateForLayout(L, this.state.messages, this.state.panel, this.state.activity, {
      convScrollUp: this.convScrollUp,
      overviewScrollTop: this.overviewScrollTop,
    });
    this.convScrollUp = next.convScrollUp;
    this.overviewScrollTop = next.overviewScrollTop;
  }

  private scroll(region: ScrollRegion, delta: number): void {
    const L = this.currentLayout();
    const next = applyScrollDeltaToState(L, region, delta, this.state.messages, this.state.panel, this.state.activity, {
      convScrollUp: this.convScrollUp,
      overviewScrollTop: this.overviewScrollTop,
    });
    this.convScrollUp = next.convScrollUp;
    this.overviewScrollTop = next.overviewScrollTop;
  }

  private wheelStep(L: ReturnType<typeof layout>, region: ScrollRegion): number {
    return wheelStepForLayout(L, region);
  }

  private scrollRegionPanel(up: boolean, page: boolean): void {
    const L = this.currentLayout();
    const delta = scrollRegionDeltaForLayout(L, this.scrollRegion, up, page);
    if (delta !== 0) this.scroll(this.scrollRegion, delta);
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
    const L = this.currentLayout();
    const region = hitTestScrollRegion(evt.col, evt.row, L);
    this.scrollRegion = region;

    if (region === "conversation") {
      const view = buildConversationView(
        this.state.messages,
        L.conversation,
        this.convScrollUp,
        L.mainPane,
        this.conversationReservedRows(L.mainPane.h - 2),
      );
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
    const text = resolveCopyText(panel, view, this.textSelection, this.state.messages);
    if (!text.trim()) {
      this.flashCopyStatus("Nothing to copy", true);
      return;
    }
    const ok = await copyToClipboard(text);
    this.flashCopyStatus(ok ? `Copied ${text.length} chars` : "Copy failed", !ok);
  }

  private async copyConversationSelection(): Promise<void> {
    const L = this.currentLayout();
    const view = buildConversationView(
      this.state.messages,
      L.conversation,
      this.convScrollUp,
      L.mainPane,
      this.conversationReservedRows(L.mainPane.h - 2),
    );
    await this.copyPanelSelection("conversation", view);
  }

  private conversationReservedRows(innerH: number): number {
    return activeConversationStatusRows(this.state.activity, this.state.messages, innerH);
  }

  private flashPortfolioStatus(text: string): void {
    if (this.portfolioStatusTimer) clearTimeout(this.portfolioStatusTimer);
    this.state.composerStatus = { kind: "info", text };
    this.portfolioStatusTimer = setTimeout(() => {
      this.state.composerStatus = null;
      this.paint();
      this.portfolioStatusTimer = null;
    }, 3000);
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
      if (action.type === "paste") {
        if (this.panel.isOpen()) {
          for (const char of action.text.replace(/[\n\t]/g, " ")) {
            this.handleKeyAction({ type: "key", name: "", char, ctrl: false, shift: false, meta: false });
          }
        } else {
          this.inputBuf += action.text;
          this.scrollRegion = "composer";
          this.suggestionIdx = 0;
        }
        this.paint();
        continue;
      }
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
    const chord = `${key.ctrl ? "ctrl+" : ""}${key.meta ? "meta+" : ""}${key.shift ? "shift+" : ""}${key.name ?? ch}`;
    if (this.operationBindings.interruptResearch.includes(chord)
      && (this.state.activity === "thinking" || this.state.activity === "running tool")) {
      this.researchInterruptHandler?.();
      return;
    }
    if (this.operationBindings.retryFailedQuotes.includes(chord)) {
      this.failedQuotesRetryHandler?.();
      return;
    }

    if (this.recoveryPrompt) {
      if (this.recoveryConfirming) return;
      if (key.name === "escape") { this.recoveryPrompt = null; return; }
      if (key.name === "up") { this.recoveryOffset = Math.max(0, this.recoveryOffset - 1); return; }
      if (key.name === "down") { this.recoveryOffset = Math.min(this.recoveryMaxOffset, this.recoveryOffset + 1); return; }
      if (key.name === "return" && this.recoveryHandler) {
        const prompt = this.recoveryPrompt, { unconfirmedTools: _, activities: _activities, ...target } = prompt;
        this.recoveryConfirming = true;
        void this.recoveryHandler(target).then(() => {
          if (this.recoveryPrompt !== prompt) return;
          this.recoveryPrompt = null; this.recoveryConfirming = false;
          if (this.running) this.paint();
        }, () => {
          if (this.recoveryPrompt !== prompt) return;
          this.recoveryPrompt = null; this.recoveryConfirming = false;
          this.state.composerStatus = { kind: "error", text: "确认结果未知，请重新连接并核对会话。" };
          if (this.running) this.paint();
        });
      }
      return;
    }

    if (this.panel.isOpen()) {
      const result = this.panel.handleKey(ch, key);
      if (result?.refreshPanel) this.panelRefreshHandler?.();
      this.state.source = this.panel.activeDataSource();
      this.state.marketColorScheme = this.panel.marketColorScheme();
      if (result?.close) {
        const name = this.panel.activePortfolioName();
        const showPanel = this.panel.showPortfolioPanel();
        this.panel.close();
        this.state.activePortfolio = name;
        this.state.showPortfolioPanel = showPanel;
        if (result.refreshPanel) {
          this.flashPortfolioStatus("设置已保存，正在更新行情");
        }
      } else {
        this.state.activePortfolio = this.panel.selectedPortfolioName();
      }
      if (result?.command) this.submitHandler?.(result.command);
      if (result?.restoreArtifact) this.artifactRestoreHandler?.(result.restoreArtifact);
      if (result?.privateAnnualExport) this.privateAnnualExportHandler?.(result.privateAnnualExport);
      return;
    }

    const suggestions = this.currentSuggestions();
    const hasSuggestions = suggestions.length > 0;

    if (this.inputBuf.startsWith("/") && hasSuggestions && action.char && /^[1-9]$/.test(action.char)) {
      const idx = Number(action.char) - 1;
      if (idx < suggestions.length) this.applySuggestion(suggestions[idx].fill);
      return;
    }

    if (key.name === "return") {
      if (this.recoveryTarget && !this.inputBuf.trimStart().startsWith("/")) {
        this.recoveryOffset = 0; this.recoveryPrompt = { ...this.recoveryTarget }; return;
      }
      if (activeReferenceQuery(this.inputBuf) && this.referencePending) return;
      const input = this.inputBuf;
      if (hasSuggestions) {
        const idx = Math.min(this.suggestionIdx, suggestions.length - 1);
        const fill = suggestions[idx].fill;
        // Auto-complete only when fill is a different command (e.g. /r -> /resume).
        // Keep an exact command runnable; Tab can choose a contextual suggestion such as a skill.
        const trimInput = input.trim();
        if (fill !== input && !fill.startsWith(trimInput + " ")) {
          this.applySuggestion(fill);
          return;
        }
      }
      const text = input.trim();
      if (text && text !== "/") {
        const normalized = normalizeSlashInput(text);
        this.history.unshift(normalized);
        this.histIdx = -1;
        this.inputBuf = "";
        this.suggestionIdx = 0;
        this.convScrollUp = 0;
        this.scrollRegion = "composer";
        this.submitHandler?.(normalized);
      }
    } else if (key.name === "pageup") {
      const L = this.currentLayout();
      const page = Math.max(1, L.mainPane.h - 3);
      if (key.shift && L.showPanel) this.scroll("overview", -page);
      else this.scroll("conversation", page);
    } else if (key.name === "pagedown") {
      const L = this.currentLayout();
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
      else this.requestExit();
    } else if (key.ctrl && key.name === "d") {
      this.requestExit();
    } else if (key.ctrl && key.name === "p") {
      this.openConfig();
    } else if (key.name === "tab") {
      if (hasSuggestions) {
        const idx = Math.min(this.suggestionIdx, suggestions.length - 1);
        this.applySuggestion(suggestions[idx].fill);
      }
    } else if (key.name === "escape") {
      if (this.inputBuf) { this.inputBuf = ""; this.suggestionIdx = 0; }
      else this.requestExit();
    } else if (action.char && !key.ctrl && !key.meta) {
      this.scrollRegion = "composer";
      this.suggestionIdx = 0;
      this.inputBuf += action.char;
    }
  }

  async refreshSkills(load: () => Promise<SkillEntry[]> = loadRuntimeSkillSuggestions): Promise<void> {
    const version = ++this.skillLoadVersion;
    try {
      const skills = await load();
      if (version !== this.skillLoadVersion) return;
      this.skills = skills;
      this.suggestionIdx = 0;
      if (this.running) this.paint();
    } catch { /* skills are optional */ }
  }

  private requestExit(): void {
    if (this.submitHandler) this.submitHandler("/exit");
    else { this.stop(); process.exit(0); }
  }

  private currentSuggestions() {
    if (activeReferenceQuery(this.inputBuf)) return this.referenceInput === this.inputBuf ? this.referenceSuggestions : [];
    return buildSuggestions(this.inputBuf, this.watchlist, this.skills);
  }

  private refreshReferenceSuggestions(): void {
    if (this.referenceInput === this.inputBuf) return;
    if (this.referenceTimer) clearTimeout(this.referenceTimer);
    const input = this.inputBuf;
    const version = ++this.referenceVersion;
    this.referenceInput = input;
    this.referenceSuggestions = [];
    this.referenceError = null;
    this.referencePending = Boolean(this.referenceProvider && activeReferenceQuery(input));
    if (!this.referencePending) return;
    this.referenceTimer = setTimeout(() => {
      this.referenceTimer = null;
      void this.referenceProvider!(input).then(items => {
        if (!this.running || version !== this.referenceVersion || this.inputBuf !== input) return;
        this.referenceSuggestions = items;
      }).catch(error => {
        if (version === this.referenceVersion && this.inputBuf === input) this.referenceError = error instanceof Error ? error.message : String(error);
      }).finally(() => {
        if (!this.running || version !== this.referenceVersion || this.inputBuf !== input) return;
        this.referencePending = false;
        this.paint();
      });
    }, 80);
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

function normalizeSlashInput(input: string): string {
  return input.replace(/^\/session(?=\s|$)/, "/resume");
}


