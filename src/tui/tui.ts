/**
 * QuantTui — full-screen frame-buffer TUI.
 * Wraps Screen + Buffer with app-specific render logic.
 */
import { Buffer, Screen, type Style } from "./buffer.ts";
import { layout, drawHeader, drawConversation, drawPortfolio, drawComposer, drawStatus } from "./render.ts";
import { CANVAS } from "./tokens.ts";
import type { AppState } from "./types.ts";

export class QuantTui {
  screen: Screen;
  state: AppState;
  private submitHandler: ((text: string) => void) | null = null;

  constructor(state: AppState) {
    this.state = state;
    this.screen = new Screen(process.stdout);
    process.stdout.on("resize", () => {
      this.screen.resize();
      this.paint();
    });
  }

  start(): void { this.screen.enter(); this.paint(); }
  stop(): void { this.screen.exit(); }

  update(partial: Partial<AppState>): void {
    Object.assign(this.state, partial);
    this.paint();
  }

  refresh(): void { this.paint(); }

  onSubmit(handler: (text: string) => void): void {
    this.submitHandler = handler;
  }

  getSubmitHandler(): ((text: string) => void) | null {
    return this.submitHandler;
  }

  private paint(): void {
    this.screen.buf.clear();
    const bg: Style = { fg: CANVAS };
    for (let y = 0; y < this.screen.buf.h; y++) {
      for (let x = 0; x < this.screen.buf.w; x++) {
        this.screen.buf.set(x, y, " ", bg);
      }
    }
    const L = layout(this.screen.cols, this.screen.rows);
    drawHeader(this.screen.buf, this.state);
    drawConversation(this.screen.buf, L.conversation, this.state.messages);
    if (L.showPanel) drawPortfolio(this.screen.buf, L.portfolio, this.state.panel);
    drawComposer(this.screen.buf, L.composer, this.state.input);
    drawStatus(this.screen.buf, L.statusRow, this.screen.cols, this.state);
    this.screen.flush();
  }
}
