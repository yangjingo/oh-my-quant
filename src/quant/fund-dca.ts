import type { FundNavDaily } from "../source/index.ts";

export type DcaFrequency = "weekly" | "biweekly" | "monthly" | "quarterly";

export interface DcaBacktestOptions {
  startDate?: string;
  endDate?: string;
  frequency?: DcaFrequency;
  investAmount?: number;
  investDay?: number;
  purchaseFeeRate?: number;
}

export interface DcaTradeRecord {
  scheduledDate: string;
  tradeDate: string;
  nav: number;
  grossAmount: number;
  purchaseFee: number;
  netAmount: number;
  shares: number;
  cumulativeShares: number;
  cumulativePrincipal: number;
}

export interface DcaAccountPoint {
  date: string;
  unitNav: number;
  cumulativePrincipal: number;
  cumulativeShares: number;
  marketValue: number;
  floatingProfit: number;
  returnRate: number;
  drawdown: number;
  maxDrawdownToDate: number;
}

export interface DcaBacktestResult {
  plan: {
    startDate: string;
    endDate: string;
    frequency: DcaFrequency;
    investAmount: number;
    investDay: number;
    purchaseFeeRate: number;
  };
  summary: {
    tradeCount: number;
    totalPrincipal: number;
    totalPurchaseFee: number;
    totalNetAmount: number;
    totalShares: number;
    finalMarketValue: number;
    profit: number;
    returnRate: number;
    xirr: number | null;
    averageCost: number;
    breakevenNav: number;
    maxDrawdown: number;
  };
  trades: DcaTradeRecord[];
  accountCurve: DcaAccountPoint[];
}

const DAY_MS = 86_400_000;

export function runDcaBacktest(navRows: FundNavDaily[], options: DcaBacktestOptions = {}): DcaBacktestResult {
  const rows = navRows
    .filter((row) => row.navDate && Number.isFinite(row.unitNav) && row.unitNav > 0)
    .sort((a, b) => a.navDate.localeCompare(b.navDate));
  if (rows.length === 0) throw new Error("No NAV rows available for DCA backtest.");

  const latest = rows[rows.length - 1]!;
  const rawStartDate = options.startDate || shiftYears(latest.navDate, -5);
  const startDate = normalizeStartDate(rawStartDate, rows[0]!.navDate, latest.navDate);
  const endDate = clampDate(options.endDate || latest.navDate, startDate, latest.navDate);
  const frequency = options.frequency || "monthly";
  const investAmount = positive(options.investAmount, 1000);
  const investDay = Math.max(1, Math.floor(options.investDay || defaultInvestDay(frequency)));
  const purchaseFeeRate = normalizeRate(options.purchaseFeeRate ?? 0);

  const schedules = buildDcaSchedule(startDate, endDate, frequency, investDay);
  const navByDate = new Map(rows.map((row) => [row.navDate, row]));
  let cumulativePrincipal = 0;
  let cumulativeShares = 0;
  let totalPurchaseFee = 0;
  let totalNetAmount = 0;
  const trades: DcaTradeRecord[] = [];

  for (const scheduledDate of schedules) {
    const tradeDate = findNextNavDate(rows, scheduledDate, endDate);
    if (!tradeDate) continue;
    const nav = navByDate.get(tradeDate)!.unitNav;
    const netAmount = investAmount / (1 + purchaseFeeRate);
    const purchaseFee = investAmount - netAmount;
    const shares = netAmount / nav;
    cumulativePrincipal += investAmount;
    cumulativeShares += shares;
    totalPurchaseFee += purchaseFee;
    totalNetAmount += netAmount;
    trades.push({
      scheduledDate,
      tradeDate,
      nav,
      grossAmount: investAmount,
      purchaseFee,
      netAmount,
      shares,
      cumulativeShares,
      cumulativePrincipal,
    });
  }

  const accountCurve = buildAccountCurve(rows, trades, startDate, endDate);
  const finalPoint = accountCurve[accountCurve.length - 1];
  const finalMarketValue = finalPoint?.marketValue ?? 0;
  const profit = finalMarketValue - cumulativePrincipal;
  const cashflows = trades.map((trade) => ({ date: trade.tradeDate, amount: -trade.grossAmount }));
  if (finalPoint) cashflows.push({ date: finalPoint.date, amount: finalMarketValue });

  return {
    plan: { startDate, endDate, frequency, investAmount, investDay, purchaseFeeRate },
    summary: {
      tradeCount: trades.length,
      totalPrincipal: cumulativePrincipal,
      totalPurchaseFee,
      totalNetAmount,
      totalShares: cumulativeShares,
      finalMarketValue,
      profit,
      returnRate: cumulativePrincipal > 0 ? profit / cumulativePrincipal : 0,
      xirr: calculateXirr(cashflows),
      averageCost: cumulativeShares > 0 ? totalNetAmount / cumulativeShares : 0,
      breakevenNav: cumulativeShares > 0 ? cumulativePrincipal / cumulativeShares : 0,
      maxDrawdown: accountCurve.reduce((min, point) => Math.min(min, point.drawdown), 0),
    },
    trades,
    accountCurve,
  };
}

export function buildDcaSchedule(startDate: string, endDate: string, frequency: DcaFrequency, investDay: number): string[] {
  const start = parseYmd(startDate);
  const end = parseYmd(endDate);
  let cursor = initialScheduleDate(start, frequency, investDay);
  const dates: string[] = [];
  while (cursor <= end) {
    dates.push(formatYmd(cursor));
    cursor = addFrequency(cursor, frequency, investDay);
  }
  return dates;
}

export function calculateXirr(cashflows: Array<{ date: string; amount: number }>): number | null {
  if (cashflows.length < 2 || !cashflows.some((c) => c.amount < 0) || !cashflows.some((c) => c.amount > 0)) return null;
  const start = parseYmd(cashflows[0]!.date).getTime();
  const npv = (rate: number) => cashflows.reduce((sum, flow) => {
    const years = (parseYmd(flow.date).getTime() - start) / DAY_MS / 365;
    return sum + flow.amount / Math.pow(1 + rate, years);
  }, 0);

  let lo = -0.9999;
  let hi = 10;
  let loVal = npv(lo);
  let hiVal = npv(hi);
  if (Math.sign(loVal) === Math.sign(hiVal)) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const midVal = npv(mid);
    if (Math.abs(midVal) < 1e-7) return mid;
    if (Math.sign(midVal) === Math.sign(loVal)) {
      lo = mid;
      loVal = midVal;
    } else {
      hi = mid;
      hiVal = midVal;
    }
  }
  return (lo + hi) / 2;
}

function buildAccountCurve(rows: FundNavDaily[], trades: DcaTradeRecord[], startDate: string, endDate: string): DcaAccountPoint[] {
  let tradeIndex = 0;
  let cumulativePrincipal = 0;
  let cumulativeShares = 0;
  let peakValue = 0;
  let maxDrawdownToDate = 0;
  const curve: DcaAccountPoint[] = [];

  for (const row of rows) {
    if (row.navDate < startDate || row.navDate > endDate) continue;
    while (tradeIndex < trades.length && trades[tradeIndex]!.tradeDate <= row.navDate) {
      const trade = trades[tradeIndex++]!;
      cumulativePrincipal = trade.cumulativePrincipal;
      cumulativeShares = trade.cumulativeShares;
    }
    if (cumulativePrincipal <= 0) continue;
    const marketValue = cumulativeShares * row.unitNav;
    peakValue = Math.max(peakValue, marketValue);
    const drawdown = peakValue > 0 ? marketValue / peakValue - 1 : 0;
    maxDrawdownToDate = Math.min(maxDrawdownToDate, drawdown);
    curve.push({
      date: row.navDate,
      unitNav: row.unitNav,
      cumulativePrincipal,
      cumulativeShares,
      marketValue,
      floatingProfit: marketValue - cumulativePrincipal,
      returnRate: marketValue / cumulativePrincipal - 1,
      drawdown,
      maxDrawdownToDate,
    });
  }
  return curve;
}

function findNextNavDate(rows: FundNavDaily[], target: string, endDate: string): string | null {
  let lo = 0;
  let hi = rows.length - 1;
  let found: string | null = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const date = rows[mid]!.navDate;
    if (date >= target) {
      found = date;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return found && found <= endDate ? found : null;
}

function initialScheduleDate(start: Date, frequency: DcaFrequency, investDay: number): Date {
  if (frequency === "weekly" || frequency === "biweekly") {
    const target = investDay % 7;
    const delta = (target - start.getUTCDay() + 7) % 7;
    return new Date(start.getTime() + delta * DAY_MS);
  }
  const day = Math.min(investDay, lastDayOfMonth(start.getUTCFullYear(), start.getUTCMonth()));
  let date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), day));
  if (date < start) date = addFrequency(date, frequency, investDay);
  return date;
}

function addFrequency(date: Date, frequency: DcaFrequency, investDay: number): Date {
  if (frequency === "weekly") return new Date(date.getTime() + 7 * DAY_MS);
  if (frequency === "biweekly") return new Date(date.getTime() + 14 * DAY_MS);
  const step = frequency === "quarterly" ? 3 : 1;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + step;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = month % 12;
  const day = Math.min(investDay, lastDayOfMonth(targetYear, targetMonth));
  return new Date(Date.UTC(targetYear, targetMonth, day));
}

function defaultInvestDay(frequency: DcaFrequency): number {
  return frequency === "weekly" || frequency === "biweekly" ? 1 : 1;
}

function normalizeRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return rate > 0.05 ? rate / 100 : rate;
}

function positive(value: number | undefined, fallback: number): number {
  return value && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampDate(date: string, min: string, max: string): string {
  if (date < min) return min;
  if (date > max) return max;
  return date;
}

function normalizeStartDate(date: string, firstNavDate: string, latestNavDate: string): string {
  if (date > latestNavDate) return latestNavDate;
  if (date >= firstNavDate) return date;
  return daysBetween(date, firstNavDate) <= 31 ? date : firstNavDate;
}

function daysBetween(a: string, b: string): number {
  return Math.abs((parseYmd(b).getTime() - parseYmd(a).getTime()) / DAY_MS);
}

function shiftYears(date: string, years: number): string {
  const d = parseYmd(date);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return formatYmd(d);
}

function parseYmd(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
}

function formatYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
