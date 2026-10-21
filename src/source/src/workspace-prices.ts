import { normalizeSymbol } from "../../market/symbols.ts";
import {
  isDailyDate,
  normalizeBarSeries,
  validateDateRange,
} from "../../market/bars.ts";
import { AKSHARE_KNOWN_A_INDEX_SYMBOLS } from "./akshare-endpoints.ts";
import { runPython } from "./akshare-python.ts";
import type { WorkspaceScope } from "../../types/workspace.ts";
import type { Bar } from "../../types/data.ts";

// Fixed program and bounded arguments; model text is never executed as Python.
const SCRIPT = `import json,sys,akshare as ak
symbol,start,end,today=sys.argv[1:]
calendar=ak.tool_trade_date_hist_sina()
sessions=sorted(str(x)[:10] for x in calendar.iloc[:,0] if start<=str(x)[:10]<=end and str(x)[:10]<today)
df=ak.stock_zh_a_hist_tx(symbol=symbol,start_date=start.replace('-',''),end_date=end.replace('-',''),adjust='qfq',timeout=12)
rows=[]
for _,r in df.iterrows():
 d=str(r['date'])[:10]
 if d not in sessions: continue
 rows.append(dict(date=d,open=float(r['open']),high=float(r['high']),low=float(r['low']),close=float(r['close']),volume=float(r['amount']),amount=None))
print(json.dumps(dict(bars=rows,sessions=sessions),allow_nan=False))`;

export interface WorkspacePrices {
  bars: Bar[];
  sessions: string[];
  source: string;
  fetchedAt: string;
  adjustment: string;
}
export function validateWorkspaceScope(
  scope: WorkspaceScope,
  today: string,
): WorkspaceScope {
  const symbol = normalizeSymbol(scope.symbol, "A");
  if (!/^(?:00\d{4}\.SZ|60\d{4}\.SH)$/.test(symbol))
    throw new Error("首轮仅支持沪深主板股票的明确代码。");
  if (!AKSHARE_KNOWN_A_INDEX_SYMBOLS[scope.benchmark])
    throw new Error("请选择支持的大盘基准代码。");
  validateDateRange(scope.start, scope.end);
  if (
    !scope.start ||
    !scope.end ||
    scope.end > today ||
    Date.parse(scope.end) - Date.parse(scope.start) > 732 * 86400000
  ) {
    throw new Error("研究区间必须有效、不晚于今天，且不超过两年。");
  }
  return { ...scope, symbol };
}
export async function fetchWorkspacePrices(
  symbol: string,
  scope: WorkspaceScope,
  signal: AbortSignal,
): Promise<WorkspacePrices> {
  const normalized = normalizeSymbol(symbol, "A");
  if (normalized !== scope.symbol && normalized !== scope.benchmark)
    throw new Error("标的不在本次研究范围。");
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
  }).format(new Date());
  const code = normalized.slice(-2).toLowerCase() + normalized.slice(0, 6);
  let stdout: string;
  try {
    ({ stdout } = await runPython(
      SCRIPT,
      [code, scope.start, scope.end, today],
      { timeoutMs: 45000, signal },
    ));
  } catch {
    signal.throwIfAborted();
    throw new Error("日线来源请求失败：请检查 AKShare、Python 与网络连接。");
  }
  signal.throwIfAborted();
  const response = JSON.parse(stdout) as { bars: Bar[]; sessions: string[] };
  const bars = normalizeBarSeries(response.bars, scope.start, scope.end);
  const sessions = response.sessions;
  if (
    !Array.isArray(sessions) ||
    sessions.some(
      (date, i) =>
        typeof date !== "string" ||
        !isDailyDate(date) ||
        date >= today ||
        date < scope.start ||
        date > scope.end ||
        (i > 0 && date <= sessions[i - 1]!),
    ) ||
    !bars.length ||
    bars.length !== response.bars.length ||
    bars.some((bar) => !sessions.includes(bar.date))
  ) {
    throw new Error("来源未返回有效的历史日线和交易日历。");
  }
  return {
    bars,
    sessions,
    source: "AKShare/Tencent stock_zh_a_hist_tx；Sina 交易日历",
    fetchedAt: new Date().toISOString(),
    adjustment: AKSHARE_KNOWN_A_INDEX_SYMBOLS[normalized]
      ? "index-level"
      : "forward-adjusted",
  };
}
