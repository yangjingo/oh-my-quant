import { runPython } from "./akshare-python.ts";

export interface MainboardMember { symbol: string; name: string; exchange: "SH" | "SZ" }
export interface MainboardUniverse {
  members: MainboardMember[];
  sources: { exchange: "SH" | "SZ"; endpoint: string; observedAt: string; count: number }[];
}

const SCRIPT = `
import sys
import akshare as ak
if sys.argv[1] == "SH":
    df = ak.stock_info_sh_name_code(symbol="主板A股")
    df = df[["证券代码", "证券简称"]]
else:
    df = ak.stock_info_sz_name_code(symbol="A股列表")
    df = df[["板块", "A股代码", "A股简称"]]
# Keep pipe chunks ASCII-safe; the shared bridge decodes each chunk separately.
print(df.to_json(orient="records", force_ascii=True))
`;

/** Fail closed on schema drift: neither an index sample nor one exchange is the universe. */
export function normalizeMainboardMembers(value: unknown, exchange: "SH" | "SZ"): MainboardMember[] {
  if (!Array.isArray(value) || !value.length) throw new Error(`${exchange} roster is empty or invalid.`);
  const members = new Map<string, MainboardMember>();
  for (const row of value) {
    if (!row || typeof row !== "object") throw new Error(`${exchange} roster row is invalid.`);
    if (exchange === "SZ") {
      if (!["主板", "创业板"].includes(row["板块"])) throw new Error("SZ roster has an unknown board.");
      if (row["板块"] !== "主板") continue;
    }
    const code = row[exchange === "SH" ? "证券代码" : "A股代码"];
    const name = row[exchange === "SH" ? "证券简称" : "A股简称"];
    if (typeof code !== "string" || !(exchange === "SH" ? /^60\d{4}$/ : /^00\d{4}$/).test(code)
      || typeof name !== "string" || !name.trim()) throw new Error(`${exchange} main-board identity is invalid.`);
    const symbol = `${code}.${exchange}`, member = { symbol, name: name.trim(), exchange };
    if (members.has(symbol) && members.get(symbol)!.name !== member.name) throw new Error(`Conflicting roster identity: ${symbol}.`);
    members.set(symbol, member);
  }
  if (!members.size) throw new Error(`${exchange} main-board roster is empty.`);
  return [...members.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export async function fetchMainboardUniverse(options: {
  signal?: AbortSignal; timeoutMs?: number; execute?: typeof runPython;
} = {}): Promise<MainboardUniverse> {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  try {
    const results = await Promise.all((["SH", "SZ"] as const).map(async exchange => {
      const { stdout } = await (options.execute ?? runPython)(SCRIPT, [exchange], { signal, timeoutMs: options.timeoutMs ?? 30_000 });
      signal.throwIfAborted();
      const members = normalizeMainboardMembers(JSON.parse(stdout), exchange);
      return { members, source: { exchange, endpoint: `stock_info_${exchange.toLowerCase()}_name_code`,
        observedAt: new Date().toISOString(), count: members.length } };
    }));
    return { members: results.flatMap(result => result.members).sort((a, b) => a.symbol.localeCompare(b.symbol)),
      sources: results.map(result => result.source) };
  } finally { controller.abort(); }
}
