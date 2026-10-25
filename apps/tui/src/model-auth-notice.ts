import type { AuthEvent } from "../../../src/runtime/models/model-oauth.ts";
import { Buffer, wrap, truncate } from "./buffer.ts";
import type { PanelFrame } from "./panel-chrome.ts";
import { S } from "./styles.ts";

/** Ephemeral authorization text; never part of a transcript or settings payload. */
export class ModelAuthNotice {
  url = "";
  private instructions = "Waiting for provider...";
  private progress = "";
  private offset = 0;
  private maxOffset = 0;

  notify(event: AuthEvent): void {
    if (event.type === "auth_url") {
      this.url = event.url; this.instructions = event.instructions ?? "Open this link to authorize your account."; this.offset = 0;
    } else if (event.type === "device_code") {
      this.url = event.verificationUri;
      this.instructions = `Device code: ${event.userCode}${event.expiresInSeconds ? ` · expires in ${event.expiresInSeconds}s` : ""}`;
      this.offset = 0;
    } else if (event.type === "info") {
      this.instructions = event.message;
      if (event.links?.length) { this.url = event.links[0]!.url; this.offset = 0; }
    } else this.progress = event.message;
  }

  scroll(direction: number): void { this.offset = Math.max(0, Math.min(this.maxOffset, this.offset + direction * 3)); }

  render(buf: Buffer, frame: PanelFrame): void {
    const text = [this.instructions, this.url, this.progress].filter(Boolean).join("\n").replace(/[\x00-\x09\x0b-\x1f\x7f]/g, " ");
    const lines = text.split("\n").flatMap(line => wrap(line, frame.inner.w));
    this.maxOffset = Math.max(0, lines.length - frame.contentH);
    this.offset = Math.min(this.offset, this.maxOffset);
    for (const [index, line] of lines.slice(this.offset, this.offset + frame.contentH).entries()) {
      buf.text(frame.inner.x, frame.contentY + index, truncate(line, frame.inner.w), S.cream);
    }
  }
}
