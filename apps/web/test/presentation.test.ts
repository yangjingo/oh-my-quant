import { expect, test } from "bun:test";
import { canSubmitText, researchSummary } from "../src/presentation";
import { createDemoClient } from "../dev/demo-client";

test("running and composing input never submit or acquire cancellation semantics", () => {
  expect(canSubmitText("next question", true, false, false, false)).toBe(false);
  expect(canSubmitText("", true, false, false, false)).toBe(false);
  expect(canSubmitText("问题", false, false, false, true)).toBe(false);
  expect(canSubmitText("问题", false, false, false, false)).toBe(true);
  expect(canSubmitText("   ", false, false, false, false)).toBe(false);
});

test("summary export preserves missing evidence, source dates, versions and its actual scope", async () => {
  const snapshot = await createDemoClient().session("sample");
  const demo = researchSummary("Example", snapshot, true);
  expect(demo).toContain("合成演示记录");
  expect(demo).toContain("公告核验（示例缺失）｜缺失｜来源：未提供｜日期：未提供");
  expect(demo).toContain("v2");
  expect(demo).toContain(snapshot.output.artifacts[1]!.sha256);
  expect(researchSummary("Real", snapshot, false)).toContain("不是不可变报告原文件");
});
