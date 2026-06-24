/**
 * Real market benchmark monthly returns (Jan-Jun 2026).
 * Used by gen scripts to produce accurate comparison lines.
 * Source: 搜狐行情, Yahoo Finance, 理杏仁, 蛋卷基金.
 */

/** 沪深300 月度收益 (real) */
export const HS300_MONTHLY: Record<string, number> = {
  "2026-01": 1.77, "2026-02": 0.17, "2026-03": -5.53,
  "2026-04": 8.15, "2026-05": 1.94, "2026-06": -2.11,
};

/** 中证机器人指数 H30590 月度收益 (Jan-Mar real from 理杏仁, Apr-Jun estimated from news) */
export const ROBOT_INDEX_MONTHLY: Record<string, number> = {
  "2026-01": 4.66, "2026-02": 1.89, "2026-03": -14.52,
  "2026-04": 11.0, "2026-05": 7.5, "2026-06": 2.5,
};

/** 创业板指 399006 月度收益 (estimated from Danjuan comparison data) */
export const CYB_MONTHLY: Record<string, number> = {
  "2026-01": 2.8, "2026-02": 1.2, "2026-03": -6.5,
  "2026-04": 10.5, "2026-05": 3.2, "2026-06": -1.0,
};

/** 业绩基准 for 红土创新新科技 006265 (中证科技指数 + 债券混合, from fund page) */
export const TECH_BENCHMARK_MONTHLY: Record<string, number> = {
  "2026-01": 0.8, "2026-02": 0.3, "2026-03": -0.5,
  "2026-04": 2.0, "2026-05": 1.0, "2026-06": 0.2,
};

/**
 * Build daily series from monthly returns + product's trading days.
 * Normalized to product's starting NAV for overlay.
 */
export function buildBenchmarkSeries(
  productDates: string[],
  monthlyRet: Record<string, number>,
  productFirstValue: number,
): Record<string, number> {
  const result: Record<string, number> = {};
  let v = productFirstValue; // start at same level as product
  let prevMonth = "";

  for (const dt of productDates) {
    const month = dt.slice(0, 7);
    if (month !== prevMonth) prevMonth = month;
    const mRet = monthlyRet[month] ?? 0;
    // Spread monthly return evenly across trading days (~21 days/month)
    const dailyRet = Math.pow(1 + mRet / 100, 1 / 21) - 1;
    v *= (1 + dailyRet);
    result[dt] = +v.toFixed(4);
  }
  return result;
}
