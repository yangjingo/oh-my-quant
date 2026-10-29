import { expect, test } from "bun:test";
import { displayMessageTime } from "../src/components/Research";

test("message dates display local readable time and reject invalid dates", () => {
  const value = "2026-10-27T07:45:32.421Z";
  const expected = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
  expect(displayMessageTime(value)).toBe(expected);
  expect(displayMessageTime(value)).not.toContain("T07:");
  expect(displayMessageTime("invalid")).toBe("时间未知");
});
