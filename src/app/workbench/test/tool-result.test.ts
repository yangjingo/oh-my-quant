import { expect, test } from "bun:test";
import { toolResult } from "../tool-result.ts";

test("tool text is bounded after configured and structured credential redaction", () => {
  const raw = { content: [{ type: "text", text: JSON.stringify({ price: 0, currency: "CNY", api_key: "unknown-key", nested: { token: "unknown-token" }, note: "known-key" }) }] };
  const result = toolResult(raw, ["known-key"]);
  expect(result.text).toContain('"price":0');
  for (const key of ["unknown-key", "unknown-token", "known-key"]) expect(result.text).not.toContain(key);
  expect(result.text).toContain("[REDACTED]"); expect(result.truncated).toBe(false);
  const long = toolResult({ content: [{ type: "text", text: "x".repeat(15_990) + "known-key" + "z".repeat(50) }] }, ["known-key"]);
  expect(long.text).toHaveLength(16_000); expect(long.text).not.toContain("known-key"); expect(long.truncated).toBe(true);
});

test("non-text results are explicit and untrusted tool prose stays text", () => {
  const result = toolResult({ content: [{ type: "image", data: "PRIVATE_BINARY" }, { type: "text", text: "<script>evil()</script>\nAuthorization=secret-value\nBearer hidden-token" }] }, []);
  expect(result.omittedBlocks).toBe(1); expect(result.text).not.toContain("PRIVATE_BINARY");
  expect(result.text).not.toContain("secret-value"); expect(result.text).not.toContain("hidden-token");
  expect(result.text).toContain("<script>evil()</script>");
  expect(toolResult(undefined, []).text).toBe("");
});


test("redaction preserves exact financial number lexemes, layout and zero values", () => {
  const text = '{"price": 12.00, "volume": 9007199254740993, "zero": 0, "token": "hidden"}';
  const result = toolResult({ content: [{ type: "text", text }] }, []);
  expect(result.text).toBe(text.replace('"hidden"', '"[REDACTED]"'));
});
