/**
 * AKShare bridge — calls Python akshare via subprocess.
 * AKShare is free, no API key needed. Preferred over MCP for A-share data.
 */
import type { Bar } from "../types/data.ts";

const AKSCRIPT = `
import json, sys
try:
    import akshare as ak
    import pandas as pd

    symbol = sys.argv[1]
    start = sys.argv[2] if len(sys.argv) > 2 else "20200101"
    end = sys.argv[3] if len(sys.argv) > 3 else "20251231"

    # Convert symbol: "000001.SZ" → "000001"
    code = symbol.split(".")[0] if "." in symbol else symbol

    df = ak.stock_zh_a_hist(symbol=code, period="daily",
                            start_date=start, end_date=end,
                            adjust="qfq")

    if df is None or df.empty:
        print(json.dumps({"error": f"No data for {symbol}"}))
        sys.exit(1)

    # Normalize column names
    col_map = {"日期":"date","开盘":"open","最高":"high","最低":"low",
               "收盘":"close","成交量":"volume","成交额":"amount"}
    df = df.rename(columns=col_map)
    cols = ["date","open","high","low","close","volume","amount"]
    df = df[[c for c in cols if c in df.columns]]
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")

    records = df.to_dict(orient="records")
    for r in records:
        for k in ("open","high","low","close"):
            if k in r and r[k] is not None:
                r[k] = round(float(r[k]), 4)
        for k in ("volume","amount"):
            if k in r and r[k] is not None:
                r[k] = int(float(r[k]))
    print(json.dumps(records))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
`;

export async function fetchFromAKShare(
  symbol: string,
  start?: string,
  end?: string,
): Promise<Bar[]> {
  const startDate = start?.replace(/-/g, "") || "20200101";
  const endDate = end?.replace(/-/g, "") || "20251231";

  const proc = Bun.spawn(["python", "-c", AKSCRIPT, symbol, startDate, endDate], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  if (proc.exitCode !== 0) {
    throw new Error(`AKShare failed (exit ${proc.exitCode}): ${stderr || output}`);
  }

  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed)) {
    throw new Error(`AKShare error: ${(parsed as { error: string }).error}`);
  }

  if (parsed.length === 0) return [];

  return parsed.map((r: Record<string, unknown>) => ({
    date: String(r.date || ""),
    open: Number(r.open || 0),
    high: Number(r.high || 0),
    low: Number(r.low || 0),
    close: Number(r.close || 0),
    volume: Number(r.volume || 0),
    amount: Number(r.amount || 0),
  }));
}
