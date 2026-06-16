import { describe, expect, it } from "bun:test";
import { generateInsights } from "./insight-generator.ts";

describe("generateInsights", () => {
  it("produces entries from notes/quant/notes.md", () => {
    const entries = generateInsights();
    // P-rules should be present
    expect(entries.some((e) => e.source.includes("notes/quant/notes.md"))).toBe(true);
  });

  it("produces entries from notes/quant/funder.md", () => {
    const entries = generateInsights();
    expect(entries.some((e) => e.source.includes("notes/quant/funder.md"))).toBe(true);
  });

  it("deduplicates entries by quote prefix", () => {
    const entries = generateInsights();
    const prefixes = entries.map((e) => e.quote.slice(0, 20));
    const unique = new Set(prefixes);
    expect(unique.size).toBe(entries.length);
  });

  it("every entry has required fields", () => {
    const entries = generateInsights();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.quote).toBeTruthy();
      expect(e.author).toBeTruthy();
      expect(e.title).toBeTruthy();
      expect(e.principle).toBeTruthy();
      expect(e.keywords.length).toBeGreaterThan(0);
    }
  });

  it("includes WhyJ-authored P-rules", () => {
    const entries = generateInsights();
    expect(entries.some((e) => e.author === "WhyJ" && e.title.startsWith("P"))).toBe(true);
  });

  it("includes 大师法则 table entries", () => {
    const entries = generateInsights();
    expect(entries.some((e) => e.source.includes("大师法则"))).toBe(true);
  });

  it("includes well-known funder names", () => {
    const entries = generateInsights();
    const authors = new Set(entries.map((e) => e.author));
    expect(authors.has("Warren Buffett")).toBe(true);
    expect(authors.has("Charlie Munger")).toBe(true);
  });
});
