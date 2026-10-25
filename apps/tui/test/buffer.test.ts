import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { Buffer, Screen, ansi, strWidth } from "../src/buffer.ts";
import { CANVAS, S } from "../src/styles.ts";

describe("buffer render", () => {
  it("exports mixed-width plain rows at their cell width without adding extra padding", () => {
    const buffer = new Buffer(12, 2);
    buffer.text(0, 0, "A中文B");
    expect(buffer.toPlain()[0]).toBe("A中文B      ");
    expect(buffer.toPlain().map(strWidth)).toEqual([12, 12]);
  });
  it("resets dim before non-dim cells on the same row", () => {
    const buf = new Buffer(24, 1);
    buf.text(0, 0, "dim", { ...S.thinking, dim: true });
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
    buf.text(2, 0, "think", { ...S.thinking, dim: true });
    const rendered = buf.render();
    const tail = rendered.slice(rendered.indexOf("think") + 5);
    const nextStyle = tail.match(/\x1b\[[0-9;]*m/);
    expect(nextStyle?.[0]).toBe("\x1b[0m");
  });
});

class SlowOutput extends EventEmitter {
  columns = 24;
  rows = 3;
  writable = false;
  writes: string[] = [];
  write(value: string): boolean { this.writes.push(value); return this.writable; }
}

describe("screen output backpressure", () => {
  it("coalesces blocked paints into the latest synchronized frame", () => {
    const out = new SlowOutput();
    const screen = new Screen(out as unknown as NodeJS.WriteStream);
    screen.buf.text(0, 0, "first"); screen.flush();
    screen.buf.clear(); screen.buf.text(0, 0, "intermediate"); screen.flush();
    screen.buf.clear(); screen.buf.text(0, 0, "latest"); screen.flush();
    expect(out.writes).toHaveLength(1);
    out.writable = true; out.emit("drain");
    expect(out.writes).toHaveLength(2);
    expect(out.writes[1]).toContain("latest");
    expect(out.writes[1]).not.toContain("intermediate");
    expect(out.writes[1]).toStartWith(ansi.syncOn);
    expect(out.writes[1]).toEndWith(ansi.syncOff);
  });

  it("drops a pending frame on exit and queues terminal restoration", () => {
    const out = new SlowOutput();
    const screen = new Screen(out as unknown as NodeJS.WriteStream);
    screen.buf.text(0, 0, "first"); screen.flush();
    screen.buf.clear(); screen.buf.text(0, 0, "pending"); screen.flush();
    screen.exit(); out.writable = true; out.emit("drain");
    expect(out.writes).toHaveLength(2);
    expect(out.writes[1]).toContain(ansi.altOff);
    expect(out.writes.join("")).not.toContain("pending");
  });

  it("waits for an initial blocked terminal setup and resumes after repeated stalls", () => {
    const out = new SlowOutput();
    const screen = new Screen(out as unknown as NodeJS.WriteStream);
    screen.enter();
    screen.buf.text(0, 0, "ready"); screen.flush();
    expect(out.writes).toHaveLength(1);
    out.writable = true; out.emit("drain");
    expect(out.writes[1]).toContain("ready");
    out.writable = false;
    screen.buf.clear(); screen.buf.text(0, 0, "again"); screen.flush();
    screen.buf.clear(); screen.buf.text(0, 0, "final"); screen.flush();
    expect(out.writes).toHaveLength(3);
    out.writable = true; out.emit("drain");
    expect(out.writes[3]).toContain("final");
    expect(out.writes[3]).not.toContain("again");
    screen.exit();
  });

  it("delivers the newest frame after real Writable backpressure clears", async () => {
    const writes: string[] = [];
    const sink = Object.assign(new Writable({ highWaterMark: 1, write(chunk, _encoding, done) {
      writes.push(String(chunk)); setTimeout(done, 20);
    } }), { columns: 24, rows: 3 });
    const screen = new Screen(sink as unknown as NodeJS.WriteStream);
    screen.buf.text(0, 0, "first"); screen.flush();
    screen.buf.clear(); screen.buf.text(0, 0, "skipped"); screen.flush();
    screen.buf.clear(); screen.buf.text(0, 0, "current"); screen.flush();
    await new Promise<void>(resolve => sink.once("drain", resolve));
    expect(writes).toHaveLength(2);
    expect(writes[1]).toContain("current");
    expect(writes.join("")).not.toContain("skipped");
    screen.exit(); sink.end();
    await new Promise<void>(resolve => sink.once("finish", resolve));
    expect(writes.at(-1)).toContain(ansi.altOff);
  });
});
