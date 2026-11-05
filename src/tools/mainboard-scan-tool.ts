import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { scanMainboard, type MainboardScanDeps } from "../runtime/research/mainboard-scan.ts";
import { ok } from "./shared/results.ts";

const schema = Type.Object({
  start: Type.String({ description: "First allowed price date, YYYY-MM-DD." }),
  end: Type.String({ description: "Required common latest price date, YYYY-MM-DD. Choose a completed trading day; older rows are excluded from ranking." }),
  momentum_period: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000, default: 20 })),
  rsi_period: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000, default: 14 })),
  concurrency: Type.Optional(Type.Integer({ minimum: 1, maximum: 8, default: 4 })),
  budget_ms: Type.Optional(Type.Integer({ minimum: 1, maximum: 600000, default: 120000 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000, description: "Explicit bounded probe: first N canonical symbols, never representative or full coverage when N is smaller than the roster." })),
});

export function createMainboardScanTool(deps: MainboardScanDeps = {}): AgentTool<typeof schema> {
  return {
    name: "scan_mainboard", label: "Main-board scan", executionMode: "sequential", parameters: schema,
    description: "Discover and batch-scan the Shanghai/Shenzhen main-board A-share roster in one call. Public AKShare rosters need Python, not a token; prices use the configured source/cache/archive. Computes momentum and RSI once per symbol, reports exact coverage and per-symbol failures. Bounded time/concurrency; partial scans and non-comparable rows are never full-market rankings. Use a fresh discovery session, outside any declared symbol research task. No orders or predictions.",
    async execute(_id, args, signal, onUpdate) {
      const result = await scanMainboard({ start: args.start, end: args.end, momentumPeriod: args.momentum_period,
        rsiPeriod: args.rsi_period, concurrency: args.concurrency, budgetMs: args.budget_ms, limit: args.limit }, deps, signal,
      coverage => onUpdate?.(ok(`Main-board scan: ${coverage.succeeded + coverage.failed}/${coverage.universe} settled; ${coverage.failed} failed.`, { coverage })));
      return ok([
        `Main-board scan: ${result.status} (${result.stopReason})`,
        `Universe ${result.coverage.universe} · attempted ${result.coverage.attempted} · succeeded ${result.coverage.succeeded} · failed ${result.coverage.failed} · unattempted ${result.coverage.unattempted}`,
        ...result.universe.sources.map(source => `${source.exchange} roster ${source.count} · ${source.endpoint} · observed ${source.observedAt}`),
        `Comparable ranked rows ${result.ranked} · excluded ${result.excluded} · price date ${args.end}`,
        `Ranking cohort: ${result.ranking.adjustment ?? "none"} · ${result.ranking.dates.length} common input dates`,
        ...result.ranking.symbols.slice(0, 20).map(symbol => {
          const row = result.rows.find(row => row.symbol === symbol)!;
          return `${row.rank}. ${row.symbol} ${row.name} · momentum ${row.momentum.toFixed(4)} · RSI ${row.rsi.toFixed(2)} · ${row.source}/${row.origin} · dataset ${row.dataset!.revision}`;
        }),
        ...result.failures.slice(0, 10).map(failure => `Failed ${failure.symbol}: ${failure.error}`),
        "Displayed ranking is limited to 20 rows; details contain every result, failure and roster member.",
        result.evidenceBoundary,
      ].join("\n"), result);
    },
  };
}

export const mainboardScanTool = createMainboardScanTool();
