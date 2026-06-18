/**
 * Dashboard result aggregation — reads benchmark JSON results.
 */

import type { BenchmarkScores } from "./benchmark.ts";

export interface ResultRow {
  strategy: string;
  date: string;
  symbol: string;
  benchmarkSymbol: string;
  totalScore: number;
  grade: string;
  returnScore: number;
  riskScore: number;
  robustnessScore: number;
  cagr: number;
  sharpe: number;
  maxDrawdown: number;
  strategyFetcher: string;
  strategyMarket: string;
  benchmarkFetcher: string;
  benchmarkMarket: string;
}

export interface DashboardSummary {
  totalEvals: number;
  avgScore: number;
  medianScore: number;
  bestStrategy: string;
  bestScore: number;
  gradeDistribution: Record<string, number>;
  avgSharpe: number;
  avgMaxDD: number;
  sourceDistribution: Record<string, number>;
}

export function collectResults(results: Record<string, unknown>[]): ResultRow[] {
  const rows: ResultRow[] = [];
  for (const r of results) {
    try {
      const details = (r.details || {}) as Record<string, unknown>;
      const source = (r.source || {}) as Record<string, Record<string, unknown>>;
      const stratSource = source.strategy || {};
      const benchSource = source.benchmark || {};

      rows.push({
        strategy: String(r.strategy || ""),
        date: String(r.date || ""),
        symbol: String(r.symbol || ""),
        benchmarkSymbol: String(r.benchmark_symbol || ""),
        totalScore: Number(r.totalScore ?? r.total_score ?? 0),
        grade: String(r.grade || "N/A"),
        returnScore: Number(r.returnScore ?? r.return_score ?? 0),
        riskScore: Number(r.riskScore ?? r.risk_score ?? 0),
        robustnessScore: Number(r.robustnessScore ?? r.robustness_score ?? 0),
        cagr: Number(details.cagr ?? 0),
        sharpe: Number(details.sharpe ?? 0),
        maxDrawdown: Number(details.maxDrawdown ?? details.max_drawdown ?? 0),
        strategyFetcher: String(stratSource.fetcher || ""),
        strategyMarket: String(stratSource.market || ""),
        benchmarkFetcher: String(benchSource.fetcher || ""),
        benchmarkMarket: String(benchSource.market || ""),
      });
    } catch {
      // skip malformed result
    }
  }
  return rows;
}

export function dashboardSummary(rows: ResultRow[]): DashboardSummary {
  if (rows.length === 0) {
    return {
      totalEvals: 0,
      avgScore: 0,
      medianScore: 0,
      bestStrategy: "",
      bestScore: 0,
      gradeDistribution: {},
      avgSharpe: 0,
      avgMaxDD: 0,
      sourceDistribution: {},
    };
  }

  const scores = rows.map((r) => r.totalScore);
  const sorted = [...scores].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const bestIdx = scores.indexOf(Math.max(...scores));

  const gradeDist: Record<string, number> = {};
  for (const r of rows) {
    gradeDist[r.grade] = (gradeDist[r.grade] || 0) + 1;
  }

  const sourceDist: Record<string, number> = {};
  for (const r of rows) {
    sourceDist[r.strategyFetcher] = (sourceDist[r.strategyFetcher] || 0) + 1;
  }

  return {
    totalEvals: rows.length,
    avgScore: Math.round((scores.reduce((a, b) => a + b, 0) / rows.length) * 100) / 100,
    medianScore: Math.round(median * 100) / 100,
    bestStrategy: rows[bestIdx]?.strategy || "",
    bestScore: scores[bestIdx] || 0,
    gradeDistribution: gradeDist,
    avgSharpe: Math.round((rows.reduce((s, r) => s + r.sharpe, 0) / rows.length) * 100) / 100,
    avgMaxDD: Math.round((rows.reduce((s, r) => s + r.maxDrawdown, 0) / rows.length) * 10000) / 10000,
    sourceDistribution: sourceDist,
  };
}
