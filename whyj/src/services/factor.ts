/**
 * Factor computation — pure functions, no I/O.
 * Ported from skills/factor/scripts/compute.py
 */

/** N-period cumulative return */
export function momentum(close: number[], n = 20): (number | null)[] {
  const result: (number | null)[] = new Array(close.length).fill(null);
  for (let i = n; i < close.length; i++) {
    if (close[i - n] !== 0) {
      result[i] = close[i] / close[i - n] - 1;
    }
  }
  return result;
}

/** Negative N-period return (short-term reversal signal) */
export function reversal(close: number[], n = 5): (number | null)[] {
  const mom = momentum(close, n);
  return mom.map((v) => (v !== null ? -v : null));
}

/** N-period rolling standard deviation of daily returns */
export function volatility(close: number[], n = 20): (number | null)[] {
  const returns = close.map((v, i) => (i > 0 ? (v - close[i - 1]) / close[i - 1] : null));
  return rollingStd(returns, n);
}

/** Current volume / N-period mean volume */
export function volumeRatio(volume: number[], n = 20): (number | null)[] {
  const result: (number | null)[] = new Array(volume.length).fill(null);
  for (let i = n - 1; i < volume.length; i++) {
    const slice = volume.slice(i - n + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / n;
    result[i] = mean > 0 ? volume[i] / mean : null;
  }
  return result;
}

/** Relative Strength Index */
export function rsi(close: number[], n = 14): (number | null)[] {
  const result: (number | null)[] = new Array(close.length).fill(null);
  if (close.length < n + 1) return result;

  const deltas: number[] = [];
  for (let i = 1; i < close.length; i++) {
    deltas.push(close[i] - close[i - 1]);
  }

  const gains: number[] = deltas.map((d) => (d > 0 ? d : 0));
  const losses: number[] = deltas.map((d) => (d < 0 ? -d : 0));

  let avgGain = gains.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let avgLoss = losses.slice(0, n).reduce((a, b) => a + b, 0) / n;

  for (let i = n; i < close.length; i++) {
    if (avgLoss === 0) {
      result[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      result[i] = 100 - 100 / (1 + rs);
    }
    // Wilder's smoothing
    avgGain = (avgGain * (n - 1) + gains[i - 1]) / n;
    avgLoss = (avgLoss * (n - 1) + losses[i - 1]) / n;
  }
  return result;
}

/** (SMA_short - SMA_long) / SMA_long — normalized deviation */
export function smaDeviation(close: number[], short = 5, long = 20): (number | null)[] {
  const shortMA = rollingMean(close, short);
  const longMA = rollingMean(close, long);
  const result: (number | null)[] = new Array(close.length).fill(null);
  for (let i = long - 1; i < close.length; i++) {
    if (longMA[i] && longMA[i] !== 0) {
      result[i] = (shortMA[i]! - longMA[i]!) / longMA[i]!;
    }
  }
  return result;
}

// --- Preprocessing ---

/** Clip outliers beyond n_mad * 1.4826 * MAD from the median */
export function winsorize(series: (number | null)[], nMAD = 5): (number | null)[] {
  const valid = series.filter((v): v is number => v !== null);
  if (valid.length === 0) return [...series];

  const sorted = [...valid].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const absDev = valid.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = absDev[Math.floor(absDev.length / 2)];
  const threshold = nMAD * 1.4826 * mad;

  const upper = median + threshold;
  const lower = median - threshold;

  return series.map((v) => (v !== null ? Math.max(lower, Math.min(upper, v)) : null));
}

/** Z-score normalization (sample std) */
export function standardize(series: (number | null)[]): (number | null)[] {
  const valid = series.filter((v): v is number => v !== null);
  if (valid.length < 2) return [...series];

  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const variance = valid.reduce((s, v) => s + (v - mean) ** 2, 0) / (valid.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return series.map(() => 0);

  return series.map((v) => (v !== null ? (v - mean) / std : null));
}

// --- Utilities ---

function rollingMean(values: (number | null)[], n: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    let sum = 0;
    let ok = true;
    for (let j = i - n + 1; j <= i; j++) {
      if (values[j] === null) { ok = false; break; }
      sum += values[j]!;
    }
    if (ok) result[i] = sum / n;
  }
  return result;
}

function rollingStd(values: (number | null)[], n: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    const window: number[] = [];
    let ok = true;
    for (let j = i - n + 1; j <= i; j++) {
      if (values[j] === null) { ok = false; break; }
      window.push(values[j]!);
    }
    if (!ok || window.length < 2) continue;
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / (window.length - 1);
    result[i] = Math.sqrt(variance);
  }
  return result;
}

/** Available factor names */
export const FACTOR_NAMES = [
  "momentum",
  "reversal",
  "volatility",
  "volume_ratio",
  "rsi",
  "sma_deviation",
] as const;

export type FactorName = (typeof FACTOR_NAMES)[number];

/** Compute a factor by name */
export function computeFactor(
  name: FactorName,
  close: number[],
  volume?: number[],
  period = 20,
): (number | null)[] {
  switch (name) {
    case "momentum": return momentum(close, period);
    case "reversal": return reversal(close, period);
    case "volatility": return volatility(close, period);
    case "volume_ratio": {
      if (!volume) throw new Error("volume_ratio requires volume data");
      return volumeRatio(volume, period);
    }
    case "rsi": return rsi(close, period);
    case "sma_deviation": return smaDeviation(close, 5, period);
  }
}
