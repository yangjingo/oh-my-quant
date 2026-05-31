/**
 * Backtest engine — pure functions, no I/O.
 * Ported from skills/backtest/scripts/metrics.py
 */

const TRADING_DAYS = 252;
const RF_ANNUAL = 0.02;

export interface BacktestResult {
  equity: number[];
  returns: number[];
  position: number[];
  trade: number[];
  cost: number[];
}

export interface BacktestReport {
  totalReturn: number;
  cagr: number;
  annualVol: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  maxDrawdown: number;
  maxDdDays: number;
  winRate: number;
  pnlRatio: number;
  excessReturn?: number;
  trackingError?: number;
}

/** Vectorized SMA cross-over backtest */
export function vectorizedBacktest(
  signals: number[],    // 0..1 target position per bar
  prices: number[],     // close prices
  initialCash = 100_000,
  commission = 0.0003,   // 0.03%
  stampDuty = 0.0005,    // 0.05% (sell only, A-share)
): BacktestResult {
  const n = prices.length;
  if (n < 2) throw new Error("Need at least 2 bars");

  // Lag signals by 1 bar to avoid look-ahead bias
  const target: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    target[i] = signals[i - 1] ?? 0;
  }

  // Position in shares
  const position: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const prevPos = i > 0 ? position[i - 1] : 0;
    position[i] = (target[i] * initialCash / prices[i]) || 0;
    // Forward-fill: keep previous position if target is NaN
    if (isNaN(position[i])) position[i] = prevPos;
  }

  // Trade and cost
  const trade: number[] = new Array(n).fill(0);
  const cost: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    trade[i] = position[i] - position[i - 1];
    cost[i] = Math.abs(trade[i]) * prices[i] * commission;
    if (trade[i] < 0) {
      cost[i] += Math.abs(trade[i]) * prices[i] * stampDuty;
    }
  }

  // Equity curve
  const equity: number[] = new Array(n).fill(initialCash);
  for (let i = 1; i < n; i++) {
    const prevEq = equity[i - 1];
    const prevPos = position[i - 1];
    const pxChg = prices[i] / prices[i - 1] - 1;
    equity[i] = prevEq + prevPos * pxChg * prices[i] - cost[i];
  }

  // Daily returns
  const returns: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    returns[i] = equity[i] / equity[i - 1] - 1;
  }

  return { equity, returns, position, trade, cost };
}

/** SMA signal generation: 1 when fast > slow, 0 otherwise */
export function smaSignals(close: number[], fast: number, slow: number): number[] {
  const signals: number[] = new Array(close.length).fill(0);
  const fastMA = rollingMean(close, fast);
  const slowMA = rollingMean(close, slow);
  for (let i = slow - 1; i < close.length; i++) {
    if (fastMA[i] !== null && slowMA[i] !== null) {
      signals[i] = fastMA[i]! > slowMA[i]! ? 1 : 0;
    }
  }
  return signals;
}

// --- Performance Metrics ---

export function maxDrawdown(returns: number[]): number {
  let cum = 1;
  let peak = 1;
  let maxDD = 0;
  for (const r of returns) {
    cum *= 1 + r;
    if (cum > peak) peak = cum;
    const dd = (cum - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD; // negative or zero
}

export function maxDdDuration(returns: number[]): number {
  let cum = 1;
  let peak = 1;
  let currentDuration = 0;
  let maxDuration = 0;
  let underwater = false;

  for (const r of returns) {
    cum *= 1 + r;
    if (cum > peak) {
      peak = cum;
      if (underwater) {
        if (currentDuration > maxDuration) maxDuration = currentDuration;
        currentDuration = 0;
        underwater = false;
      }
    } else if (cum < peak) {
      underwater = true;
      currentDuration++;
    }
  }
  if (currentDuration > maxDuration) maxDuration = currentDuration;
  return maxDuration;
}

export function sharpe(returns: number[], rf = RF_ANNUAL): number {
  const valid = returns.filter((r) => !isNaN(r));
  if (valid.length < 2) return 0;
  const excess = valid.map((r) => r - rf / TRADING_DAYS);
  const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
  const variance = excess.reduce((s, v) => s + (v - mean) ** 2, 0) / (excess.length - 1);
  const std = Math.sqrt(variance);
  return std > 0 ? (mean / std) * Math.sqrt(TRADING_DAYS) : 0;
}

export function sortino(returns: number[], rf = RF_ANNUAL): number {
  const valid = returns.filter((r) => !isNaN(r));
  if (valid.length < 2) return 0;
  const excess = valid.map((r) => r - rf / TRADING_DAYS);
  const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
  const downside = excess.filter((e) => e < 0);
  if (downside.length < 2) return 0;
  const dMean = downside.reduce((a, b) => a + b, 0) / downside.length;
  const dVar = downside.reduce((s, v) => s + (v - dMean) ** 2, 0) / (downside.length - 1);
  const dStd = Math.sqrt(dVar);
  return dStd > 0 ? (mean / dStd) * Math.sqrt(TRADING_DAYS) : 0;
}

export function calmar(returns: number[]): number {
  const dd = Math.abs(maxDrawdown(returns));
  if (dd === 0) return 0;
  const mean = returns.filter((r) => !isNaN(r)).reduce((a, b) => a + b, 0) / (returns.length || 1);
  const cagr = (1 + mean) ** TRADING_DAYS - 1;
  return cagr / dd;
}

export function winRate(returns: number[]): number {
  const valid = returns.filter((r) => !isNaN(r) && r !== 0);
  if (valid.length === 0) return 0;
  return valid.filter((r) => r > 0).length / valid.length;
}

export function profitLossRatio(returns: number[]): number {
  const wins = returns.filter((r) => !isNaN(r) && r > 0);
  const losses = returns.filter((r) => !isNaN(r) && r < 0);
  if (losses.length === 0) return 0;
  const avgWin = wins.reduce((a, b) => a + b, 0) / wins.length;
  const avgLoss = Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length);
  return avgLoss > 0 ? avgWin / avgLoss : 0;
}

/** Generate full backtest report */
export function report(
  returns: number[],
  benchmarkReturns?: number[],
): BacktestReport {
  const valid = returns.filter((r) => !isNaN(r));
  const mean = valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
  const variance = valid.length > 1
    ? valid.reduce((s, v) => s + (v - mean) ** 2, 0) / (valid.length - 1)
    : 0;
  const std = Math.sqrt(variance);

  const result: BacktestReport = {
    totalReturn: valid.reduce((a, b) => a * (1 + b), 1) - 1,
    cagr: (1 + mean) ** TRADING_DAYS - 1,
    annualVol: std * Math.sqrt(TRADING_DAYS),
    sharpe: sharpe(returns),
    sortino: sortino(returns),
    calmar: calmar(returns),
    maxDrawdown: maxDrawdown(returns),
    maxDdDays: maxDdDuration(returns),
    winRate: winRate(returns),
    pnlRatio: profitLossRatio(returns),
  };

  if (benchmarkReturns && benchmarkReturns.length > 0) {
    const bValid = benchmarkReturns.filter((r) => !isNaN(r));
    const bMean = bValid.length > 0 ? bValid.reduce((a, b) => a + b, 0) / bValid.length : 0;
    const bCagr = (1 + bMean) ** TRADING_DAYS - 1;
    result.excessReturn = result.cagr - bCagr;

    // Tracking error: align lengths
    const minLen = Math.min(returns.length, benchmarkReturns.length);
    const diff: number[] = [];
    for (let i = 0; i < minLen; i++) {
      diff.push(returns[i] - benchmarkReturns[i]);
    }
    const dValid = diff.filter((r) => !isNaN(r));
    const dMean = dValid.reduce((a, b) => a + b, 0) / dValid.length;
    const dVar = dValid.reduce((s, v) => s + (v - dMean) ** 2, 0) / (dValid.length - 1);
    result.trackingError = Math.sqrt(dVar) * Math.sqrt(TRADING_DAYS);
  }

  return result;
}

// --- Utilities ---

function rollingMean(values: number[], n: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < n) return result;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i]!;
  result[n - 1] = sum / n;
  for (let i = n; i < values.length; i++) {
    sum += values[i]! - values[i - n]!;
    result[i] = sum / n;
  }
  return result;
}
