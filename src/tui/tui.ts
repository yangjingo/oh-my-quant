/**
 * QuantTui — full-screen frame-buffer TUI.
 * Pattern: deepseek-tui (ratatui); renderFrame + atomic flush.
 */
import { Buffer } from "./buffer.ts";
import { layout, drawHeader, drawConversation, drawPortfolio, drawComposer, drawStatus } from "./render.ts";
import { S } from "./styles.ts";
import { CANVAS } from "./tokens.ts";
import { ansi } from "./utils.ts";
import type { AppState } from "./types.ts";

export class QuantTui {
  private buf: Buffer;
  private state: AppState;
  private prevLines: string[] = [];
  private running = false;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private submitHandler: ((text: string) => void) | null = null;

  constructor(state: AppState) {
    this.state = state;
    this.buf = new Buffer(process.stdout.columns ?? 120, process.stdout.rows ?? 40);
    process.stdout.on("resize", () => {
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.buf = new Buffer(process.stdout.columns ?? 120, process.stdout.rows ?? 40);
        this.refresh();
      }, 50);
    });
  }

  start(): void {
    this.running = true;
    process.stdout.write(ansi.altScreen + ansi.hideCursor);
    this.paint();
  }

  stop(): void {
    this.running = false;
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    process.stdout.write(ansi.showCursor + ansi.normalScreen);
  }

  update(partial: Partial<AppState>): void {
    Object.assign(this.state, partial);
    this.buf = new Buffer(process.stdout.columns ?? 120, process.stdout.rows ?? 40);
    this.paint();
  }

  refresh(): void {
    if (!this.running) return;
    this.buf = new Buffer(process.stdout.columns ?? 120, process.stdout.rows ?? 40);
    this.paint();
  }

  onSubmit(handler: (text: string) => void): void {
    this.submitHandler = handler;
  }

  getSubmitHandler(): ((text: string) => void) | null {
    return this.submitHandler;
  }

  private paint(): void {
    const C = this.buf.w;
    const R = this.buf.h;
    this.buf.clear();

    // Background
    for (let y = 0; y < R; y++) {
      for (let x = 0; x < C; x++) {
        this.buf.set(x, y, " ", S.canvas);
      }
    }

    const L = layout(C, R);

    drawHeader(this.buf, this.state);
    drawConversation(this.buf, L.conversation, this.state.messages);
    if (L.showPanel) {
      drawPortfolio(this.buf, L.portfolio, this.state.panel);
    }
    drawComposer(this.buf, L.composer, this.state.input);
    drawStatus(this.buf, L.statusRow, C, this.state);

    // Atomic flush
    const rendered = this.buf.render();
    const lines = rendered.split("\n");
    process.stdout.write(ansi.syncOn);
    process.stdout.write(ansi.cursorTo(0, 0) + lines.join("\r\n"));
    process.stdout.write(ansi.syncOff);
    this.prevLines = lines;
  }
}
