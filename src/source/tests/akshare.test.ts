import { describe, expect, it } from "bun:test";
import { parseAkshareJson } from "../src/akshare.ts";

describe("parseAkshareJson", () => {
  it("maps AKShare records to Bar rows", () => {
    const rows = parseAkshareJson([
      {
        date: "2026-06-08",
        open: 1.1,
        high: 1.2,
        low: 1.0,
        close: 1.15,
        volume: 1000,
        amount: 2000,
      },
    ]);
    expect(rows).toEqual([
      {
        date: "2026-06-08",
        open: 1.1,
        high: 1.2,
        low: 1,
        close: 1.15,
        volume: 1000,
        amount: 2000,
      },
    ]);
  });

  it("returns empty array for empty payload", () => {
    expect(parseAkshareJson([])).toEqual([]);
  });

  it("throws on error payload", () => {
    expect(() => parseAkshareJson({ error: "No data for 000001.SH" })).toThrow(
      "AKShare error: No data for 000001.SH",
    );
  });
});
