import { describe, expect, it } from "bun:test";
import { Buffer } from "../src/buffer.ts";
import { CANVAS, S } from "../src/styles.ts";

describe("buffer render", () => {
  it("resets dim before non-dim cells on the same row", () => {
    const buf = new Buffer(24, 1);
    buf.text(0, 0, "dim", S.thinking);
    buf.text(8, 0, "ok", S.cream, Infinity, 24);
    const rendered = buf.render();
    const okIdx = rendered.indexOf("ok");
    const resetBeforeOk = rendered.lastIndexOf("\x1b[0m", okIdx);
    expect(resetBeforeOk).toBeGreaterThan(-1);
    expect(rendered.slice(resetBeforeOk, okIdx)).not.toContain("\x1b[2m");
  });

  it("does not leave dim active after canvas padding cells", () => {
    const buf = new Buffer(20, 1);
    buf.fillRect({ x: 0, y: 0, w: 20, h: 1 }, { fg: CANVAS });
    buf.text(2, 0, "think", S.thinking);
    const rendered = buf.render();
    const tail = rendered.slice(rendered.indexOf("think") + 5);
    const nextStyle = tail.match(/\x1b\[[0-9;]*m/);
    expect(nextStyle?.[0]).toBe("\x1b[0m");
  });
});
