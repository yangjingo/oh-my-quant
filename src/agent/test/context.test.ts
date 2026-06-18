import { describe, it, expect } from "bun:test";
import { BASE_SYSTEM_PROMPT, buildSystemPrompt, injectSessionContext, injectSkillContext, injectTurnContext } from "../src/context.ts";

describe("BASE_SYSTEM_PROMPT", () => {
  it("contains quant analyst identity", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("quantitative finance analyst");
  });

  it("lists local data tools", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("fetch_bars");
    expect(BASE_SYSTEM_PROMPT).toContain("AKShare");
    expect(BASE_SYSTEM_PROMPT).toContain("search_symbols");
    expect(BASE_SYSTEM_PROMPT).toContain("fetch_snapshot");
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

  it("contains structured tool-result preservation guidance", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("Structured Tool Result Handling");
    expect(BASE_SYSTEM_PROMPT).toContain("run_backtest");
    expect(BASE_SYSTEM_PROMPT).toContain("Total return, CAGR, Sharpe, Max DD, Win rate, P/L ratio");
    expect(BASE_SYSTEM_PROMPT).toContain("check_risk");
    expect(BASE_SYSTEM_PROMPT).toContain("VaR, CVaR, Max DD, Skew/Kurt");
    expect(BASE_SYSTEM_PROMPT).toContain("show_dashboard");
    expect(BASE_SYSTEM_PROMPT).toContain("do not replace the leaderboard with a one-line summary");
  });

  it("lists shell tool", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("bash:");
  });

  it("constrains Windows shell calls to PowerShell syntax", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("PowerShell.*");
    expect(BASE_SYSTEM_PROMPT).toContain("ls -la");
    expect(BASE_SYSTEM_PROMPT).toContain("Get-ChildItem -Force");
    expect(BASE_SYSTEM_PROMPT).toContain("cmd1 && cmd2");
    expect(BASE_SYSTEM_PROMPT).toContain("cmd1; cmd2");
    expect(BASE_SYSTEM_PROMPT).toContain("Get-Content path -Tail N");
    expect(BASE_SYSTEM_PROMPT).toContain("Get-Content path -Encoding utf8");
    expect(BASE_SYSTEM_PROMPT).toContain("foreach ($x in @(...))");
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

  it("appends available skills in pi XML format", () => {
    const p = buildSystemPrompt(undefined, [{
      name: "whyj-quant",
      description: "Use for benchmark interpretation.",
      content: "# WhyJ Quant",
      filePath: "C:/tmp/whyj-quant/SKILL.md",
    }]);
    expect(p).toContain("<available_skills>");
    expect(p).toContain("<name>whyj-quant</name>");
  });
});

describe("injectSessionContext", () => {
  it("wraps input with session context", () => {
    const result = injectSessionContext("analyze AAPL", {
      lastSymbol: "000001.SZ",
      lastMarket: "A",
      lastStartDate: null,
      lastEndDate: null,
      lastToolName: null,
      lastResultShape: null,
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
      lastToolName: null,
      lastResultShape: null,
    });
    expect(result).toBe("hello");
  });
});

describe("injectTurnContext", () => {
  it("adds lightweight render guidance for comparison-heavy requests", () => {
    const result = injectTurnContext("compare top 5 holdings and show a table", {
      lastSymbol: "510300.SH",
      lastMarket: "A",
      lastStartDate: null,
      lastEndDate: null,
      lastToolName: null,
      lastResultShape: null,
    });
    expect(result).toContain("<!-- render guidance -->");
    expect(result).toContain("compact aligned plain-text table");
    expect(result).toContain("last_symbol: 510300.SH");
  });

  it("adds tool-family-specific guidance for backtest and risk style requests", () => {
    const result = injectTurnContext("run backtest and compare risk with a chart", {
      lastSymbol: null,
      lastMarket: null,
      lastStartDate: null,
      lastEndDate: null,
      lastToolName: null,
      lastResultShape: null,
    });
    expect(result).toContain("total return, CAGR, Sharpe, max drawdown, win rate, P/L ratio");
    expect(result).toContain("preserve VaR/CVaR and drawdown lines explicitly");
  });

  it("uses last tool name to shape a generic follow-up", () => {
    const result = injectTurnContext("继续，展开讲一下", {
      lastSymbol: "000300.SH",
      lastMarket: "A",
      lastStartDate: null,
      lastEndDate: null,
      lastToolName: "check_risk",
      lastResultShape: null,
    });
    expect(result).toContain("last_tool: check_risk");
    expect(result).toContain("<!-- render guidance -->");
    expect(result).toContain("preserve VaR/CVaR and drawdown lines explicitly");
  });

  it("uses last result shape to shape a generic follow-up", () => {
    const result = injectTurnContext("继续", {
      lastSymbol: "000300.SH",
      lastMarket: "A",
      lastStartDate: null,
      lastEndDate: null,
      lastToolName: null,
      lastResultShape: "dashboard_ranking",
    });
    expect(result).toContain("last_result_shape: dashboard_ranking");
    expect(result).toContain("<!-- render guidance -->");
    expect(result).toContain("preserve ranking rows and scores instead of summarizing only the top name");
  });

  it("stays lightweight for ordinary chat requests", () => {
    const result = injectTurnContext("hello", {
      lastSymbol: null,
      lastMarket: null,
      lastStartDate: null,
      lastEndDate: null,
      lastToolName: null,
      lastResultShape: null,
    });
    expect(result).toBe("hello");
  });
});

describe("injectSkillContext", () => {
  it("adds compact structured-output guidance to skill instructions", () => {
    const result = injectSkillContext("whyj-quant", "focus on benchmark drift");
    expect(result).toContain("focus on benchmark drift");
    expect(result).toContain("structured rows visible");
    expect(result).toContain("3 short lines");
    expect(result).toContain("Preserve score rows, ranking rows, risk rows, and backtest metric rows");
  });
});
