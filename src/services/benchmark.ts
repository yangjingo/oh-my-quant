/**
 * Benchmark scoring — pure functions, no I/O.
 * Ported from benchmark/scripts/score.py
 */

const TRADING_DAYS = 252;
const RF = 0.02;

export interface BenchmarkScores {
  totalScore: number;
  grade: "S" | "A" | "B" | "C" | "D";
  returnScore: number;
  riskScore: number;
  robustnessScore: number;
  bonus: number;
  details: BenchmarkDetails;
}

export interface BenchmarkDetails {
  cagr: number;
  excessReturn: number;
  sharpe: number;
  maxDrawdown: number;
  calmar: number;
  cvar95: number;
}

interface DailyReturnLike {
  returns: number[];
}

/**
 * Three-dimension scoring: Return (40) + Risk (40) + Robustness (20) = 100 max
 */
export function evaluate(
  strategy: DailyReturnLike,
  benchmark: DailyReturnLike,
  train?: DailyReturnLike,
  test?: DailyReturnLike,
): BenchmarkScores {
  const stratReturns = strategy.returns.filter((r) => !isNaN(r));
  const benchReturns = benchmark.returns.filter((r) => !isNaN(r));

  const cagr = computeCAGR(stratReturns);
  const benchCagr = computeCAGR(benchReturns);
  const excess = cagr - benchCagr;

  const sharpeVal = computeSharpe(stratReturns);
  const maxDD = computeMaxDrawdown(stratReturns);
  const calmarVal = maxDD !== 0 ? cagr / Math.abs(maxDD) : 0;

  const sorted = [...stratReturns].sort((a, b) => a - b);
  const cvar95 = sorted
    .filter((r) => r <= percentile(sorted, 0.05))
    .reduce((a, b) => a + b, 0) / Math.max(1, sorted.filter((r) => r <= percentile(sorted, 0.05)).length);

  // --- Return Score (40) ---
  let returnScore = 0;

  // CAGR (15 max)
  if (cagr > 0.15) returnScore += 15;
  else if (cagr > 0.10) returnScore += 12;
  else if (cagr > 0.05) returnScore += 8;
  else if (cagr > 0) returnScore += 4;

  // Excess return (15 max)
  if (excess > 0.10) returnScore += 15;
  else if (excess > 0.05) returnScore += 12;
  else if (excess > 0.03) returnScore += 9;
  else if (excess > 0) returnScore += 5;

  // Positive month ratio (10 max, scaled)
  const posMonths = positiveMonthRatio(stratReturns);
  returnScore += Math.min(posMonths * 10, 10);

  // --- Risk Score (40) ---
  let riskScore = 0;

  // Sharpe (15 max)
  if (sharpeVal > 2) riskScore += 15;
  else if (sharpeVal > 1.5) riskScore += 12;
  else if (sharpeVal > 1) riskScore += 8;
  else if (sharpeVal > 0.5) riskScore += 4;
  else if (sharpeVal > 0) riskScore += 2;

  // Max drawdown (15 max)
  if (maxDD > -0.05) riskScore += 15;
  else if (maxDD > -0.10) riskScore += 12;
  else if (maxDD > -0.20) riskScore += 8;
  else if (maxDD > -0.35) riskScore += 4;

  // Calmar (5 max)
  if (calmarVal > 2) riskScore += 5;
  else if (calmarVal > 1) riskScore += 3;
  else if (calmarVal > 0.5) riskScore += 1;

  // CVaR (5 max)
  if (cvar95 > -0.03) riskScore += 5;
  else if (cvar95 > -0.05) riskScore += 3;

  // --- Robustness Score (20) ---
  let robustnessScore = 0;

  if (train && test) {
    const trainReturns = train.returns.filter((r) => !isNaN(r));
    const testReturns = test.returns.filter((r) => !isNaN(r));

    const trainCagr = computeCAGR(trainReturns);
    const testCagr = computeCAGR(testReturns);

    if (trainCagr > 0 && testCagr > 0) {
      const ratio = testCagr / trainCagr;
      if (ratio > 0.7) robustnessScore += 10;
      else if (ratio > 0.3) robustnessScore += 5;
    }

    const testSharpe = computeSharpe(testReturns);
    const trainSharpe = computeSharpe(trainReturns);
    const sharpeDecay = trainSharpe > 0 ? 1 - testSharpe / trainSharpe : 1;
    if (sharpeDecay < 0.3) robustnessScore += 10;
    else if (sharpeDecay < 0.5) robustnessScore += 5;
  } else {
    robustnessScore = 10; // baseline when no OOS data
  }

  // --- Bonus (3 max) ---
  let bonus = 0;
  if (maxDD > -0.05) bonus = 3;

  // --- Aggregate ---
  const total = Math.min(returnScore + riskScore + robustnessScore + bonus, 100);

  let grade: BenchmarkScores["grade"];
  if (total >= 80) grade = "S";
  else if (total >= 60) grade = "A";
  else if (total >= 40) grade = "B";
  else if (total >= 20) grade = "C";
  else grade = "D";

  return {
    totalScore: Math.round(total * 10) / 10,
    grade,
    returnScore: Math.round(returnScore),
    riskScore: Math.round(riskScore),
    robustnessScore: Math.round(robustnessScore),
    bonus,
    details: {
      cagr: Math.round(cagr * 10000) / 10000,
      excessReturn: Math.round(excess * 10000) / 10000,
      sharpe: Math.round(sharpeVal * 100) / 100,
      maxDrawdown: Math.round(maxDD * 10000) / 10000,
      calmar: Math.round(calmarVal * 100) / 100,
      cvar95: Math.round(cvar95 * 10000) / 10000,
    },
  };
}

// --- Helpers ---

function computeCAGR(returns: number[]): number {
  if (returns.length === 0) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  return (1 + mean) ** TRADING_DAYS - 1;
}

function computeSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const excess = returns.map((r) => r - RF / TRADING_DAYS);
  const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
  const variance = excess.reduce((s, v) => s + (v - mean) ** 2, 0) / (excess.length - 1);
  const std = Math.sqrt(variance);
  return std > 0 ? (mean / std) * Math.sqrt(TRADING_DAYS) : 0;
}

function computeMaxDrawdown(returns: number[]): number {
  let cum = 1;
  let peak = 1;
  let maxDD = 0;
  for (const r of returns) {
    cum *= 1 + r;
    if (cum > peak) peak = cum;
    const dd = (cum - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[idx];
}

function positiveMonthRatio(returns: number[]): number {
  // Approximate monthly returns from daily (rough split into months)
  if (returns.length < 21) return 0;
  const monthSize = 21;
  let posMonths = 0;
  let totalMonths = 0;
  for (let i = monthSize; i < returns.length; i += monthSize) {
    const slice = returns.slice(i - monthSize, i);
    const monthReturn = slice.reduce((a, b) => a * (1 + b), 1) - 1;
    if (monthReturn > 0) posMonths++;
    totalMonths++;
  }
  return totalMonths > 0 ? posMonths / totalMonths : 0;
}
