import { describe, expect, it } from "bun:test";
import {
  deriveConversationInsights,
  formatConversationInsights,
  getInsightRules,
  loadInsightSourceRules,
  resetInsightSourceRuleCache,
} from "./insight.ts";

describe("deriveConversationInsights", () => {
  it("loads insight rules from notes/quant/notes.md and notes/quant/funder.md", () => {
    resetInsightSourceRuleCache();
    const rules = loadInsightSourceRules(process.cwd());
    expect(rules.some((rule) => rule.source.includes("notes/quant/notes.md"))).toBe(true);
    expect(rules.some((rule) => rule.source.includes("notes/quant/funder.md"))).toBe(true);
  });

  it("getInsightRules includes built-in conversation triggers", () => {
    resetInsightSourceRuleCache();
    const rules = getInsightRules();
    expect(rules.some((rule) => rule.title === "Risk first")).toBe(true);
  });

  it("surfaces risk management wisdom from drawdown and sizing language", () => {
    const insights = deriveConversationInsights([
      { role: "user", text: "I want to size positions and control drawdown." },
      { role: "assistant", text: "Use smaller position sizes and respect risk limits." },
    ]);
    expect(insights.length).toBeGreaterThan(0);
    expect(insights[0]?.title).toBe("Risk first");
    expect(formatConversationInsights(insights)).toContain("Risk first");
  });

  it("can link insight output to docs-based principles", () => {
    const insights = deriveConversationInsights([
      { role: "user", text: "我想做一个全天候组合，降低回撤，保留现金。"},
      { role: "assistant", text: "重点是组合韧性，而不是单一方向押注。"},
    ], 3);
    expect(insights.some((insight) => insight.source.includes("notes/quant/notes.md"))).toBe(true);
  });

  it("returns an empty set when there is no conversation content", () => {
    expect(deriveConversationInsights([])).toEqual([]);
  });
});
