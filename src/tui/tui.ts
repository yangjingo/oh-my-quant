/**
 * QuantTui — full-screen frame-buffer TUI with raw-mode keyboard input.
 * Wraps Screen + Buffer; feeds agent events → paint().
 */
import * as readline from "node:readline";
import { Buffer, Screen } from "./buffer.ts";
import { layout, drawHeader, drawConversation, drawPortfolio, drawComposer, drawStatus } from "./render.ts";
import { CANVAS } from "./tokens.ts";
import type { AppState } from "./types.ts";
import { buildSuggestions } from "./input-suggestions.ts";
import { loadWatchlistEntries, type CodeEntry } from "./local-snapshot.ts";
import { ConfigPanelController } from "./config-panel.ts";

export class QuantTui {
  screen: Screen;
  state: AppState;
  private inputBuf = "";
  private history: string[] = [];
  private histIdx = -1;
  private submitHandler: ((text: string) => void) | null = null;
  private running = false;
  private animTimer: ReturnType<typeof setInterval> | null = null;
  private suggestionIdx = 0;
  private watchlist: CodeEntry[] = [];
  private configPanel = new ConfigPanelController();

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
    this.screen.exit();
  }

  update(partial: Partial<AppState>): void {
    Object.assign(this.state, partial);
    if (!this.running) return;
    this.screen.resize();
    this.paint();
  }

  refresh(): void { if (this.running) this.paint(); }

  onSubmit(handler: (text: string) => void): void { this.submitHandler = handler; }
  openConfig(): void { this.configPanel.open(); this.paint(); }

  private paint(): void {
    const L = layout(this.screen.cols, this.screen.rows);
    const st = { ...this.state, input: this.inputBuf };
    this.screen.buf.clear();
    for (let y = 0; y < this.screen.buf.h; y++)
      for (let x = 0; x < this.screen.buf.w; x++)
        this.screen.buf.set(x, y, " ", { fg: CANVAS });
    drawConversation(this.screen.buf, L.conversation, st.messages, st.activity, L.mainPane);
    drawHeader(this.screen.buf, st);
    if (L.showPanel) drawPortfolio(this.screen.buf, L.portfolio, st.panel, st.panelLoading);
    const suggestions = buildSuggestions(this.inputBuf, this.watchlist);
    const selectedIdx = suggestions.length === 0 ? -1 : Math.min(this.suggestionIdx, suggestions.length - 1);
    drawComposer(this.screen.buf, L.composer, st, st.input, suggestions, selectedIdx);
    drawStatus(this.screen.buf, L.statusRow, this.screen.cols, st);
    this.configPanel.render(this.screen.buf);
    this.screen.flush();
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
    readline.emitKeypressEvents(process.stdin);
    process.stdin.on("keypress", (_str: string, key: readline.Key) => {
      if (!this.running) return;

      if (this.configPanel.isOpen()) {
        const result = this.configPanel.handleKey(_str, key);
        if (result?.command) this.submitHandler?.(result.command);
        if (result?.close) this.configPanel.close();
        this.paint();
        return;
      }

      const suggestions = this.currentSuggestions();
      const hasSuggestions = suggestions.length > 0;

      if (hasSuggestions && key.sequence && /^[1-9]$/.test(key.sequence)) {
        const idx = Number(key.sequence) - 1;
        if (idx < suggestions.length) {
          this.applySuggestion(suggestions[idx].fill);
          this.paint();
        }
        return;
      }

      if (key.name === "return") {
        if (hasSuggestions) {
          const idx = Math.min(this.suggestionIdx, suggestions.length - 1);
          this.applySuggestion(suggestions[idx].fill);
          this.paint();
          return;
        }
        const text = this.inputBuf.trim();
        if (text) {
          this.history.unshift(text);
          this.histIdx = -1;
          this.inputBuf = "";
          this.suggestionIdx = 0;
          this.submitHandler?.(text);
        }
      } else if (key.name === "backspace") {
        this.inputBuf = this.inputBuf.slice(0, -1);
        this.suggestionIdx = 0;
      } else if (key.name === "up" || key.name === "down") {
        if (hasSuggestions) {
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
      } else if (key.ctrl && key.name === "c") {
        if (this.inputBuf) { this.inputBuf = ""; this.suggestionIdx = 0; }
        else { this.stop(); process.exit(0); }
      } else if (key.ctrl && key.name === "d") {
        this.stop(); process.exit(0);
      } else if (key.ctrl && key.name === "p") {
        this.openConfig();
        return;
      } else if (key.name === "tab") {
        if (hasSuggestions) {
          const idx = Math.min(this.suggestionIdx, suggestions.length - 1);
          this.applySuggestion(suggestions[idx].fill);
          this.paint();
          return;
        }
      } else if (key.name === "escape") {
        this.suggestionIdx = 0;
      } else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        this.suggestionIdx = 0;
        this.inputBuf += key.sequence;
      }
      this.paint();
    });
  }
}
