/**
 * QuantTui — full-screen frame-buffer TUI with raw-mode keyboard input.
 * Wraps Screen + Buffer; feeds agent events → paint().
 */
import * as readline from "node:readline";
import { Buffer, Screen } from "./buffer.ts";
import { layout, drawHeader, drawConversation, drawPortfolio, drawComposer, drawStatus } from "./render.ts";
import { CANVAS } from "./tokens.ts";
import type { AppState } from "./types.ts";

export class QuantTui {
  screen: Screen;
  state: AppState;
  private inputBuf = "";
  private history: string[] = [];
  private histIdx = -1;
  private submitHandler: ((text: string) => void) | null = null;
  private running = false;

  constructor(state: AppState) {
    this.state = state;
    this.screen = new Screen(process.stdout);
  }

  start(): void {
    this.running = true;
    this.screen.enter();
    this.setupInput();
    process.stdout.on("resize", () => { this.screen.resize(); this.paint(); });
    this.paint();
  }

  stop(): void {
    this.running = false;
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

  private paint(): void {
    const L = layout(this.screen.cols, this.screen.rows);
    const st = { ...this.state, input: this.inputBuf };
    this.screen.buf.clear();
    // Fill background
    for (let y = 0; y < this.screen.buf.h; y++)
      for (let x = 0; x < this.screen.buf.w; x++)
        this.screen.buf.set(x, y, " ", { fg: CANVAS });
    drawHeader(this.screen.buf, st);
    drawConversation(this.screen.buf, L.conversation, st.messages);
    if (L.showPanel) drawPortfolio(this.screen.buf, L.portfolio, st.panel);
    drawComposer(this.screen.buf, L.composer, st.input);
    drawStatus(this.screen.buf, L.statusRow, this.screen.cols, st);
    this.screen.flush();
  }

  private setupInput(): void {
    if (!process.stdin.isTTY) return;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    readline.emitKeypressEvents(process.stdin);
    process.stdin.on("keypress", (_str: string, key: readline.Key) => {
      if (!this.running) return;
      if (key.name === "return") {
        const text = this.inputBuf.trim();
        if (text) {
          this.history.unshift(text);
          this.histIdx = -1;
          this.inputBuf = "";
          this.submitHandler?.(text);
        }
      } else if (key.name === "backspace") {
        this.inputBuf = this.inputBuf.slice(0, -1);
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
      } else if (key.ctrl && key.name === "c") {
        if (this.inputBuf) { this.inputBuf = ""; }
        else { this.stop(); process.exit(0); }
      } else if (key.ctrl && key.name === "d") {
        this.stop(); process.exit(0);
      } else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        this.inputBuf += key.sequence;
      }
      this.paint();
    });
  }
}
