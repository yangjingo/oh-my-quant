import { describe, it, expect } from "bun:test";
import { BASE_SYSTEM_PROMPT, buildSystemPrompt, injectSessionContext } from "./context.ts";

describe("BASE_SYSTEM_PROMPT", () => {
  it("contains quant analyst identity", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("quantitative finance analyst");
  });

  it("lists MCP data tools", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("tushare_daily");
    expect(BASE_SYSTEM_PROMPT).toContain("llmquant_price");
    expect(BASE_SYSTEM_PROMPT).toContain("fd_snapshot");
  });

  it("lists computation tools", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("compute_factor");
    expect(BASE_SYSTEM_PROMPT).toContain("run_backtest");
    expect(BASE_SYSTEM_PROMPT).toContain("check_risk");
    expect(BASE_SYSTEM_PROMPT).toContain("score_benchmark");
    expect(BASE_SYSTEM_PROMPT).toContain("show_dashboard");
  });

  it("forbids markdown formatting", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("NO markdown formatting");
    expect(BASE_SYSTEM_PROMPT).toContain("never use **bold**");
  });

  it("forbids emoji", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("NO emoji");
  });

  it("contains financial terminology guidance", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("annualized return");
    expect(BASE_SYSTEM_PROMPT).toContain("momentum premium");
    expect(BASE_SYSTEM_PROMPT).toContain("tail risk");
    expect(BASE_SYSTEM_PROMPT).toContain("tracking error");
  });

  it("contains workflow rules", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("Fetch price data first");
    expect(BASE_SYSTEM_PROMPT).toContain("data → factor → backtest → risk → benchmark");
  });
});

describe("buildSystemPrompt", () => {
  it("returns base prompt with no extra", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("quantitative finance analyst");
  });

  it("appends extra content", () => {
    const p = buildSystemPrompt("Extra instructions here");
    expect(p).toContain("Extra instructions here");
  });
});

describe("injectSessionContext", () => {
  it("wraps input with session context", () => {
    const result = injectSessionContext("analyze AAPL", {
      lastSymbol: "000001.SZ",
      lastMarket: "A",
      lastStartDate: null,
      lastEndDate: null,
    });
    expect(result).toContain("analyze AAPL");
    expect(result).toContain("last_symbol: 000001.SZ");
    expect(result).toContain("last_market: A");
  });

  it("returns input unchanged when context is empty", () => {
    const result = injectSessionContext("hello", {
      lastSymbol: null,
      lastMarket: null,
      lastStartDate: null,
      lastEndDate: null,
    });
    expect(result).toBe("hello");
  });
});
