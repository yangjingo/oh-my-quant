/**
 * Group comparison — equal-weight portfolio NAV synthesis + per-group risk metrics.
 * Pure functions, no I/O.
 */

import { metrics, type RiskMetrics } from "./risk.ts";

export interface NavPoint {
  date: string;
  nav: number;
}

export interface GroupNav {
  groupId: string;
  groupName: string;
  navSeries: NavPoint[];
}

export interface GroupComparisonResult {
  groupId: string;
  groupName: string;
  symbolCount: number;
  risk: RiskMetrics;
  totalReturn: number;
  navSeries: NavPoint[];
}

/**
 * Synthesize an equal-weight portfolio NAV from per-symbol daily returns.
 * Each symbol's returns are aligned by date; missing dates are skipped.
 * NAV starts at 1.0 on the first common date.
 */
export function synthesizeEqualWeightNav(
  symbolReturns: Map<string, Map<string, number>>,
): NavPoint[] {
  if (symbolReturns.size === 0) return [];

  const allDates = collectCommonDates(symbolReturns);
  if (allDates.length === 0) return [];

  let nav = 1.0;
  const series: NavPoint[] = [{ date: allDates[0], nav }];

  for (let i = 1; i < allDates.length; i++) {
    const date = allDates[i];
    let dayReturn = 0;
    let count = 0;
    for (const returns of symbolReturns.values()) {
      const r = returns.get(date);
      if (r !== undefined && !isNaN(r)) {
        dayReturn += r;
        count++;
      }
    }
    if (count > 0) {
      nav *= 1 + dayReturn / count;
    }
    series.push({ date, nav });
  }

  return series;
}

/**
 * Compute risk metrics for a group from its synthesized NAV series.
 */
export function groupRiskFromNav(navSeries: NavPoint[]): RiskMetrics | null {
  if (navSeries.length < 3) return null;
  const returns: number[] = [];
  for (let i = 1; i < navSeries.length; i++) {
    const prev = navSeries[i - 1].nav;
    if (prev > 0) {
      returns.push((navSeries[i].nav - prev) / prev);
    }
  }
  if (returns.length < 2) return null;
  try {
    return metrics(returns);
  } catch {
    return null;
  }
}

export function totalReturn(navSeries: NavPoint[]): number {
  if (navSeries.length < 2) return 0;
  const first = navSeries[0].nav;
  const last = navSeries[navSeries.length - 1].nav;
  return first > 0 ? (last - first) / first : 0;
}

function collectCommonDates(symbolReturns: Map<string, Map<string, number>>): string[] {
  const dateSets = [...symbolReturns.values()].map(m => new Set(m.keys()));
  if (dateSets.length === 0) return [];
  const first = dateSets[0];
  const common = [...first].filter(d => dateSets.every(s => s.has(d)));
  return common.sort();
}
