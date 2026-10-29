import { expect, test } from "bun:test";
import type { Turn } from "../src/client/contract";
import { elapsedLabel, runStatusLabel } from "../src/components/RunStatus";

const turn: Turn = { id: "run", role: "assistant", state: "running", text: "", at: "2026-10-26T09:00:00Z" };
test("waiting is honest without reasoning events, and actual running tools override a text phase", () => {
  expect(runStatusLabel(turn)).toBe("等待模型响应");
  expect(runStatusLabel({ ...turn, phase: "thinking" })).toBe("思考中");
  expect(runStatusLabel({ ...turn, phase: "answering", activity: [{ id: "t", name: "calculator", state: "running" }] })).toBe("正在调用工具");
  expect(runStatusLabel({ ...turn, state: "cancelled", phase: "thinking" })).toBe("已停止");
});
test("elapsed time advances only for running work and freezes at the recorded end", () => {
  const end = Date.parse(turn.at) + 65000;
  expect(elapsedLabel(turn, end)).toBe("1 分 5 秒");
  expect(elapsedLabel({ ...turn, state: "settled", endedAt: new Date(end).toISOString() }, end + 60000)).toBe("1 分 5 秒");
  expect(elapsedLabel({ ...turn, state: "cancelled" }, end)).toBeNull();
});
