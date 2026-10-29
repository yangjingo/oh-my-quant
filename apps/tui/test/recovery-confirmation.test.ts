import { expect, test } from "bun:test";
import { Buffer } from "../src/buffer.ts";
import { drawRecoveryConfirmation } from "../src/recovery-confirmation.ts";

const text = (buffer: Buffer) => buffer.cells.map(cell => cell.ch).join("");

test("small recovery panel scrolls from affected tools to the no-replay and draft warning", () => {
  const tools = Array.from({ length: 14 }, (_, index) => `tool-${index} · failed`);
  const buffer = new Buffer(40, 18);
  const last = drawRecoveryConfirmation(buffer, 14, tools, 0, false);
  expect(last).toBeGreaterThan(0);
  expect(text(buffer)).toContain("tool-0");
  buffer.clear();
  drawRecoveryConfirmation(buffer, 14, tools, last, false);
  expect(text(buffer)).toContain("tool-13");
  expect(text(buffer)).toContain("不会重跑或验证操作");
  expect(text(buffer)).toContain("草稿会保留");
});
