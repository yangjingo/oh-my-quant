import { expect, test } from "bun:test";
import { formatSystemPrompt } from "../src/system-prompt.ts";
import { injectTurnContext, injectSkillContext, type SessionCtx } from "../src/context.ts";

const context: SessionCtx = { lastSymbol: null, lastMarket: null, lastStartDate: null, lastEndDate: null, recentToolState: { toolName: null, resultShape: null } };
test("Markdown presentation replaces terminal instructions while preserving research constraints", () => {
  const web = formatSystemPrompt({ tools: [], presentation: "markdown" });
  expect(web).toContain("Use Markdown"); expect(web).toContain("GFM tables");
  expect(web).not.toContain("NO markdown"); expect(web).not.toContain("align columns with spaces");
  expect(web).toContain("Do not rename reported metrics"); expect(web).toContain("never label that difference alpha");
  const terminal = formatSystemPrompt({ tools: [] });
  expect(terminal).toContain("NO markdown"); expect(terminal).toContain("align columns with spaces");
});
test("per-turn and skill guidance use the same selected presentation", () => {
  const web = injectTurnContext("比较两个指标并列一个表格", context, "markdown");
  expect(web).toContain("GFM table"); expect(web).not.toContain("three-line plain-text"); expect(web).not.toContain("do not use vertical bars");
  expect(injectSkillContext("quant", "", "markdown")).toContain("GFM tables");
  expect(injectTurnContext("比较两个指标并列一个表格", context)).toContain("three-line plain-text");
});
