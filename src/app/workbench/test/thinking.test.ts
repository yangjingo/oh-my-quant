import { expect, test } from "bun:test";
import { redactModelText, thinkingText } from "../thinking.ts";

test("only non-redacted textual thinking is projected, excluding signatures and other payloads", () => {
  expect(thinkingText({ content: [
    { type: "thinking", thinking: "核对数据日期", thinkingSignature: "OPAQUE_SIGNATURE" },
    { type: "thinking", thinking: "FILTERED_CONTENT", redacted: true, thinkingSignature: "ENCRYPTED" },
    { type: "text", text: "最终回答" }, { type: "thinking", thinking: 123 },
    { type: "thinking", thinking: "计算风险收益", redacted: false },
  ] })).toBe("核对数据日期\n\n计算风险收益");
  expect(thinkingText({ content: [{ type: "thinking", thinking: "INVALID_FLAG", redacted: "false" }] })).toBe("");
  expect(thinkingText(null)).toBe("");
});
test("full credentials and their trailing split prefixes never enter streaming projections", () => {
  const secret = "sk-fixture-secret";
  for (let i = 1; i < secret.length; i++) expect(redactModelText("分析中 " + secret.slice(0, i), [secret], true)).toBe("分析中 ");
  expect(redactModelText("分析中 " + secret, [secret], true)).toBe("分析中 [REDACTED]");
  expect(redactModelText("分析中 sk-fixX", [secret], true)).toBe("分析中 sk-fixX");
  expect(redactModelText("普通末尾 s", [secret], false)).toBe("普通末尾 s");
});
