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

test("authorization header redaction consumes complete schemes and folded values without changing finance lines", () => {
  const cases = [
    ["Authorization: Basic dXNlcjpwYXNz", "Authorization: [REDACTED]"],
    ["Proxy-Authorization: Digest username=synthetic, response=synthetic", "Proxy-Authorization: [REDACTED]"],
    ["aUtHoRiZaTiOn\t=\tBearer synthetic-token", "aUtHoRiZaTiOn\t=\t[REDACTED]"],
    ["Authorization: Basic abc\r\n\tcontinued-secret\r\n", "Authorization: [REDACTED]\r\n\t[REDACTED]\r\n"],
  ];
  for (const [header, safe] of cases) {
    const tail = '\nprice: 12.00\nvolume: 9007199254740993\nzero: 0\n';
    expect(toolResult({ content: [{ type: "text", text: header + tail }] }, []).text).toBe(safe + tail);
  }
});

test("authorization forms hide configured transformed credentials and structured scalar fields before bounding", () => {
  const secret = "synthetic-user:synthetic-password";
  const basic = Buffer.from(secret).toString("base64");
  const digest = 'username="synthetic-user", response="synthetic-digest"';
  const text = `Authorization: Basic ${basic}\nProxy-Authorization: Digest ${digest}\nAuthorization: Bearer ${secret}\n`;
  const json = '{"Authorization": "Basic other-base64", "Proxy-Authorization": "Digest username=other, response=hash", "api_key": "other-key", "price":12.00,"zero":0,"volume":9007199254740993}';
  const value = toolResult({ content: [{ type: "text", text: text + json + '\n' + 'x'.repeat(16_100) }] }, [secret]);
  for (const hidden of [secret, basic, "synthetic-digest", "other-base64", "username=other", "other-key"]) expect(value.text).not.toContain(hidden);
  expect(value.text).toContain('"price":12.00,"zero":0,"volume":9007199254740993');
  expect(value.text).toHaveLength(16_000); expect(value.truncated).toBe(true);
});

test("authorization inside JSON prose cannot consume adjacent exact financial fields", () => {
  const text = '{"message":"Authorization: Basic synthetic-base64\\r\\nprice: 0", "volume":9007199254740993,"price":12.00,"zero":0}';
  const value = toolResult({ content: [{ type: "text", text }] }, []);
  expect(value.text).toBe(text.replace("Basic synthetic-base64", "[REDACTED]"));
});
