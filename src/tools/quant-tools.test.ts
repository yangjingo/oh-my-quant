import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Bar } from "../types/data.ts";
import {
  COMPUTE_TOOLS,
  checkRiskTool,
  computeFactorTool,
  runBacktestTool,
  scoreBenchmarkTool,
  showDashboardTool,
} from "./quant-tools.ts";

const OHQ = join(process.cwd(), ".ohquant-test-quant-tools");

function resetOhq(): void {
  process.env.OHQUANT_DIR = OHQ;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
  mkdirSync(OHQ, { recursive: true });
}

function cleanupOhq(): void {
  delete process.env.OHQUANT_DIR;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
}

function resultText(result: AgentToolResult<unknown>): string {
  return result.content
    .map((part) => part.type === "text" ? part.text : "")
    .join("\n");
}

function makeBars(count: number, startClose = 100, step = 0.35): Bar[] {
  const start = new Date(Date.UTC(2026, 0, 1));
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const close = startClose + i * step + Math.sin(i / 5) * 0.8;
    return {
      date: d.toISOString().slice(0, 10),
      open: close - 0.2,
      high: close + 0.5,
      low: close - 0.6,
      close,
      volume: 1_000_000 + i * 1000,
      amount: close * (1_000_000 + i * 1000),
    };
  });
}

function writeCachedBars(symbol: string, source: string, bars: Bar[]): void {
  const dir = join(OHQ, "data", source, symbol);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "daily.json"), JSON.stringify(bars), "utf-8");
  writeFileSync(join(dir, "meta.json"), JSON.stringify({
    symbol,
    name: symbol,
    market: "A",
    source,
    firstDate: bars[0]?.date ?? "",
    lastDate: bars[bars.length - 1]?.date ?? "",
    rowCount: bars.length,
    fetchedAt: new Date().toISOString(),
  }), "utf-8");
}

beforeEach(() => resetOhq());
afterAll(() => cleanupOhq());

describe("built-in quant tool catalog", () => {
  it("registers the built-in quant tools as sequential agent tools", () => {
    expect(COMPUTE_TOOLS.map((tool) => tool.name)).toEqual([
      "compute_factor",
      "run_backtest",
      "check_risk",
      "fund_dca_backtest",
      "score_benchmark",
      "show_dashboard",
    ]);
    expect(COMPUTE_TOOLS.every((tool) => tool.executionMode === "sequential")).toBe(true);
  });
});

describe("compute_factor", () => {
  it("returns DATA_NO_CACHE when bars are missing", async () => {
    const result = await computeFactorTool.execute("t1", {
      symbol: "000001.SZ",
      factor: "momentum",
      period: 20,
    });
    expect(resultText(result)).toContain("No cached data for this symbol");
    expect(resultText(result)).toContain("Call fetch_bars first");
  });

  it("computes factor metrics from cached bars", async () => {
    writeCachedBars("000001.SZ", "akshare", makeBars(80));

    const result = await computeFactorTool.execute("t1", {
      symbol: "000001.SZ",
      factor: "momentum",
      period: 20,
    });

    const text = resultText(result);
    expect(text).toContain("Factor  000001.SZ  momentum_20");
    expect(text).toContain("Source      akshare");
    expect(text).toContain("Percentile");
    expect((result.details as { symbol?: string }).symbol).toBe("000001.SZ");
    expect((result.details as { factor?: string }).factor).toBe("momentum");
  });
});

describe("run_backtest", () => {
  it("rejects cached data that is too short for the slow window", async () => {
    writeCachedBars("000002.SZ", "akshare", makeBars(12));

    const result = await runBacktestTool.execute("t1", {
      symbol: "000002.SZ",
      fast: 5,
      slow: 20,
      cash: 100_000,
    });

    expect(resultText(result)).toContain("Not enough bars for the requested analysis");
    expect(resultText(result)).toContain("SMA(5,20)");
  });

  it("runs an SMA backtest from cached bars", async () => {
    writeCachedBars("000002.SZ", "tushare", makeBars(90, 50, 0.2));

    const result = await runBacktestTool.execute("t1", {
      symbol: "000002.SZ",
      fast: 5,
      slow: 20,
      cash: 100_000,
    });

    const text = resultText(result);
    expect(text).toContain("Backtest  000002.SZ  SMA(5,20)");
    expect(text).toContain("Source        tushare");
    expect(text).toContain("Total return");
    expect(text).toContain("Sharpe");
    expect((result.details as { symbol?: string }).symbol).toBe("000002.SZ");
  });
});

describe("check_risk", () => {
  it("computes risk metrics from cached bars", async () => {
    writeCachedBars("000003.SZ", "llmquant-data", makeBars(90, 20, 0.12));

    const result = await checkRiskTool.execute("t1", { symbol: "000003.SZ" });

    const text = resultText(result);
    expect(text).toContain("Risk  000003.SZ");
    expect(text).toContain("Source        llmquant-data");
    expect(text).toContain("Annual vol");
    expect(text).toContain("VaR 95");
    expect((result.details as { symbol?: string }).symbol).toBe("000003.SZ");
    expect(typeof (result.details as { annualVol?: number }).annualVol).toBe("number");
  });
});

describe("score_benchmark and show_dashboard", () => {
  it("scores from cached bars, writes an artifact, and dashboard reads it back", async () => {
    writeCachedBars("000004.SZ", "akshare", makeBars(120, 30, 0.16));
    writeCachedBars("000300.SH", "akshare", makeBars(120, 100, 0.08));

    const score = await scoreBenchmarkTool.execute("t1", {
      symbol: "000004.SZ",
      benchmark_symbol: "000300.SH",
      fast: 5,
      slow: 20,
      cash: 100_000,
      label: "unit_sma",
    });

    const scoreText = resultText(score);
    expect(scoreText).toContain("Benchmark  unit_sma");
    expect(scoreText).toContain("Score");
    expect(scoreText).toContain("Saved         .ohquant/benchmark/results/unit_sma_");

    const filename = (score.details as { filename?: string }).filename;
    expect(filename).toMatch(/^unit_sma_\d{4}-\d{2}-\d{2}\.json$/);
    const artifactPath = join(OHQ, "benchmark", "results", filename!);
    expect(existsSync(artifactPath)).toBe(true);

    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
    expect(artifact.strategy).toBe("unit_sma");
    expect(artifact.symbol).toBe("000004.SZ");
    expect(artifact.benchmark_symbol).toBe("000300.SH");
    expect(typeof artifact.totalScore).toBe("number");

    const dashboard = await showDashboardTool.execute("t2", {});
    const dashboardText = resultText(dashboard);
    expect(dashboardText).toContain("Dashboard  1 evaluations");
    expect(dashboardText).toContain("Best unit_sma");
    expect(dashboardText).toContain("unit_sma");
    expect((dashboard.details as { summary?: { totalEvals?: number } }).summary?.totalEvals).toBe(1);
  });

  it("returns a helpful dashboard hint when no artifacts exist", async () => {
    const result = await showDashboardTool.execute("t1", {});
    expect(resultText(result)).toContain("No benchmark results yet");
  });
});
