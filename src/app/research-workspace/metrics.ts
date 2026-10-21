import { maxDrawdown, mean } from "../../quant/index.ts";
import type {
  WorkspaceEvidence,
  WorkspaceMetrics,
  WorkspaceRun,
} from "../../types/workspace.ts";

export const BOUNDARIES = [
  "尚未接入板块证据，不能确认买点。",
  "历史接口与交易日历交叉检查，排除当天日线；不是交易所终态认证。",
  "前复权历史可能修订；本次是当前可取得的数据，不是历史时点回放。",
];
export function calculateMetrics(
  stock: WorkspaceEvidence,
  benchmark: WorkspaceEvidence,
  previous?: WorkspaceRun,
): WorkspaceMetrics {
  const bars = stock.bars!,
    base = benchmark.bars!;
  if (bars.length < 21 || base.length < 21)
    throw new Error("至少需要 21 条股票与基准日线。");
  const last = bars.at(-1)!;
  const average = (n: number) =>
    bars.length >= n ? mean(bars.slice(-n).map((b) => b.close)) : null;
  const preceding = bars
    .slice(-21, -1)
    .map((b) => b.volume)
    .sort((a, b) => a - b);
  const median = (preceding[9]! + preceding[10]!) / 2;
  const recent = bars.slice(-20);
  const low = recent.reduce((a, b) => (b.low < a.low ? b : a));
  const high = recent.reduce((a, b) => (b.high > a.high ? b : a));
  const common = bars.filter((b) => base.some((x) => x.date === b.date));
  const firstCommon = common[0],
    lastCommon = common.at(-1);
  const old =
    previous?.evidence.find((e) => e.symbol === stock.symbol)?.bars ?? [];
  const revisions = old
    .filter((b) => {
      const current = bars.find((x) => x.date === b.date);
      return (
        current &&
        ["open", "high", "low", "close", "volume"].some(
          (k) => current[k as keyof typeof current] !== b[k as keyof typeof b],
        )
      );
    })
    .map((b) => b.date);
  const previousBoundary =
    previous?.evidence.find((e) => e.result)?.result?.structuralLow ?? null;
  const missing = (stock.sessions ?? []).filter(
    (d) => !bars.some((b) => b.date === d),
  );
  return {
    start: bars[0]!.date,
    end: last.date,
    observations: bars.length,
    close: last.close,
    returnPct: (last.close / bars[0]!.close - 1) * 100,
    drawdownPct:
      maxDrawdown(bars.slice(1).map((b, i) => b.close / bars[i]!.close - 1)) *
      100,
    ma20: average(20),
    ma60: average(60),
    ma120: average(120),
    volumeRatio: median > 0 ? last.volume / median : null,
    closeLocation:
      last.high > last.low
        ? (last.close - last.low) / (last.high - last.low)
        : null,
    relativeReturnPp:
      firstCommon && lastCommon && firstCommon.date !== lastCommon.date
        ? (lastCommon.close / firstCommon.close -
            1 -
            (base.find((b) => b.date === lastCommon.date)!.close /
              base.find((b) => b.date === firstCommon.date)!.close -
              1)) *
          100
        : null,
    structuralLow: { date: low.date, price: low.low },
    recentHigh: { date: high.date, price: high.high },
    previousBoundary,
    historicalRevisions: revisions,
    comparison: {
      previousEnd: old.at(-1)?.date ?? null,
      newEnd: last.date,
      advanced: old.length > 0 && last.date > old.at(-1)!.date,
      comparable:
        old.length > 0 &&
        missing.length === 0 &&
        old.every((b) => bars.some((x) => x.date === b.date)) &&
        stock.adjustment ===
          previous?.evidence.find((e) => e.symbol === stock.symbol)?.adjustment,
    },
    limitations: [
      ...BOUNDARIES,
      ...(missing.length
        ? [
            `股票缺少 ${missing.length} 个日历交易日；可能停牌或来源缺失，不补造行情。`,
          ]
        : []),
      ...(old.length === 0
        ? ["首次研究，无前一版本可比较；修订列表为空不表示已验证历史未修订。"]
        : []),
      ...(old.length > 0 && last.date === old.at(-1)!.date
        ? ["新旧证据截止日相同，覆盖日期尚未推进。"]
        : []),
      ...(old.length > 0 && last.date < old.at(-1)!.date
        ? ["本次证据截止日倒退，覆盖不完整；不能把缺失历史解释为正常无变化。"]
        : []),
      ...(revisions.length
        ? ["历史价格或成交量发生修订，旧价格边界不能直接判定失效。"]
        : []),
    ],
  };
}
