/**
 * Risk metrics — pure functions, no I/O.
 * Ported from skills/risk/scripts/risk_metrics.py
 */

const TRADING_DAYS = 252;
const RF_ANNUAL = 0.02;

export interface RiskMetrics {
  annualVol: number;
  downsideVol: number;
  var95: number;
  var99: number;
  var95Parametric: number;
  cvar95: number;
  cvar99: number;
  maxDrawdown: number;
  maxDdDays: number;
  skewness: number;
  kurtosis: number;
}

export function metrics(returns: number[], rf = RF_ANNUAL): RiskMetrics {
  const valid = returns.filter((r) => !isNaN(r));
  const n = valid.length;
  if (n < 2) throw new Error("Need at least 2 valid returns");

  const mean = valid.reduce((a, b) => a + b, 0) / n;
  const variance = valid.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  const std = Math.sqrt(variance);

  const annualVol = std * Math.sqrt(TRADING_DAYS);

  // Downside vol
  const downside = valid.filter((r) => r < 0);
  let downsideVol = 0;
  if (downside.length >= 2) {
    const dMean = downside.reduce((a, b) => a + b, 0) / downside.length;
    const dVar = downside.reduce((s, v) => s + (v - dMean) ** 2, 0) / (downside.length - 1);
    downsideVol = Math.sqrt(dVar) * Math.sqrt(TRADING_DAYS);
  }

  // Historical VaR
  const sorted = [...valid].sort((a, b) => a - b);
  const var95 = percentile(sorted, 0.05);
  const var99 = percentile(sorted, 0.01);
  const var95Parametric = mean - 1.645 * std; // normal assumption

  // CVaR (expected shortfall)
  const cvar95 = sorted.filter((r) => r <= var95).reduce((a, b) => a + b, 0) /
    Math.max(1, sorted.filter((r) => r <= var95).length);
  const cvar99 = sorted.filter((r) => r <= var99).reduce((a, b) => a + b, 0) /
    Math.max(1, sorted.filter((r) => r <= var99).length);

  // Drawdown
  const maxDD = computeMaxDrawdown(valid);
  const maxDDDays = computeMaxDdDays(valid);

  // Higher moments
  const m3 = valid.reduce((s, v) => s + (v - mean) ** 3, 0) / n;
  const m4 = valid.reduce((s, v) => s + (v - mean) ** 4, 0) / n;
  const skewness = std > 0 ? m3 / std ** 3 : 0;
  const kurtosis = std > 0 ? m4 / std ** 4 - 3 : 0; // excess kurtosis

  return {
    annualVol,
    downsideVol,
    var95,
    var99,
    var95Parametric,
    cvar95,
    cvar99,
    maxDrawdown: maxDD,
    maxDdDays: maxDDDays,
    skewness,
    kurtosis,
  };
}

// --- Internal helpers ---

function percentile(sorted: number[], p: number): number {
  const idx = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[idx];
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

function computeMaxDdDays(returns: number[]): number {
  let cum = 1;
  let peak = 1;
  let currentDays = 0;
  let maxDays = 0;
  let underwater = false;

  for (const r of returns) {
    cum *= 1 + r;
    if (cum >= peak) {
      peak = cum;
      if (underwater) {
        if (currentDays > maxDays) maxDays = currentDays;
        currentDays = 0;
        underwater = false;
      }
    } else {
      underwater = true;
      currentDays++;
    }
  }
  if (currentDays > maxDays) maxDays = currentDays;
  return maxDays;
}
