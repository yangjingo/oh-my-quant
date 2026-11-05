import { parseArgs } from "node:util";
import { createBuiltinTools } from "../../tools/registry.ts";
import { fetchBars } from "../data/source-runtime.ts";

/** Opt-in, public-only bounded probe. An explicit isolated cache is required. */
const { values } = parseArgs({ args: process.argv.slice(2), options: {
  start: { type: "string" }, end: { type: "string" }, limit: { type: "string", default: "4" },
  "budget-ms": { type: "string", default: "90000" },
}, strict: true });
const limit = Number(values.limit), budget = Number(values["budget-ms"]);
if (!process.env.OHQUANT_DIR || !values.start || !values.end || !Number.isInteger(limit) || limit < 1 || limit > 10
  || !Number.isInteger(budget) || budget < 1 || budget > 120_000)
  throw new Error("Set OHQUANT_DIR to an isolated probe cache and pass --start YYYY-MM-DD --end YYYY-MM-DD [--limit 1..10] [--budget-ms 1..120000].");
const tools = createBuiltinTools({ mainboardScan: { bars: (symbol, _minimum, start, end, signal) =>
  fetchBars(symbol, "A", start, end, "akshare", { providers: { signal, fallbackOrder: { A: ["akshare"] } } }) } });
const controller = new AbortController();
const cancel = () => controller.abort();
process.on("SIGINT", cancel);
process.on("SIGTERM", cancel);
const started = performance.now();
try {
  const result = await tools.find(tool => tool.name === "scan_mainboard")!.execute("mainboard-live-probe",
    { start: values.start, end: values.end, limit, budget_ms: budget, concurrency: 2 }, controller.signal);
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), kind: "bounded-live-probe", ...result.details as object }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ kind: "bounded-live-probe", status: "universe-unavailable", universe: null,
    attempted: 0, elapsedMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  process.off("SIGINT", cancel); process.off("SIGTERM", cancel);
}
