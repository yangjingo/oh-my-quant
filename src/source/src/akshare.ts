/**
 * AKShare adapter — calls Python akshare via subprocess.
 * Free A-share data, no API key. Preferred default source for A-share pulls.
 */
import { spawn } from "node:child_process";
import type { Bar } from "../../types/data.ts";

const AKSCRIPT = `
import json, sys
try:
    import akshare as ak
    import pandas as pd

    symbol = sys.argv[1]
    start = sys.argv[2] if len(sys.argv) > 2 else "20200101"
    end = sys.argv[3] if len(sys.argv) > 3 else "20251231"

    index_map = {
        "000001.SH": "sh000001",
        "399001.SZ": "sz399001",
        "000300.SH": "sh000300",
        "000905.SH": "sh000905",
        "399006.SZ": "sz399006",
        "000016.SH": "sh000016",
        "000688.SH": "sh000688",
        "000852.SH": "sh000852",
    }

    if symbol in index_map:
        df = ak.stock_zh_index_daily(symbol=index_map[symbol])
        if df is not None and not df.empty and "date" not in df.columns:
            df = df.rename(columns={"日期": "date", "收盘": "close", "开盘": "open",
                                    "最高": "high", "最低": "low", "成交量": "volume"})
        if df is not None and not df.empty:
            df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
            if start:
                df = df[df["date"] >= pd.to_datetime(start).strftime("%Y-%m-%d")]
            if end:
                df = df[df["date"] <= pd.to_datetime(end).strftime("%Y-%m-%d")]
    elif "." in symbol:
        code = symbol.split(".")[0]
        df = ak.stock_zh_a_hist(symbol=code, period="daily",
                                start_date=start, end_date=end,
                                adjust="qfq")
    elif symbol.isdigit() and len(symbol) == 6:
        df = ak.fund_open_fund_info_em(symbol=symbol, indicator="单位净值走势")
        if df is not None and not df.empty:
            df = df.rename(columns={"净值日期": "date", "单位净值": "close"})
            df["open"] = df["close"]
            df["high"] = df["close"]
            df["low"] = df["close"]
            df["volume"] = 0
            df["amount"] = 0
            df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
            if start:
                df = df[df["date"] >= pd.to_datetime(start).strftime("%Y-%m-%d")]
            if end:
                df = df[df["date"] <= pd.to_datetime(end).strftime("%Y-%m-%d")]
    else:
        df = ak.stock_zh_a_hist(symbol=symbol, period="daily",
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

export function parseAkshareJson(parsed: unknown): Bar[] {
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

export async function fetchFromAKShare(
  symbol: string,
  start?: string,
  end?: string,
): Promise<Bar[]> {
  const startDate = start?.replace(/-/g, "") || "20200101";
  const endDate = end?.replace(/-/g, "") || "20251231";

  const { stdout } = await runPython(AKSCRIPT, symbol, startDate, endDate);
  return parseAkshareJson(JSON.parse(stdout));
}

function runPython(
  ...args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python", ["-c", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`AKShare failed (exit ${code}): ${stderr || stdout}`));
    });
    proc.on("error", (err) => reject(err));
  });
}
