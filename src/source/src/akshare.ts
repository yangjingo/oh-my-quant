/**
 * AKShare adapter — calls Python akshare via subprocess.
 * Free A-share data, no API key. Preferred default source for A-share pulls.
 */
import { spawn } from "node:child_process";
import type { Bar } from "../../types/data.ts";

// AKShare 股票数据 — AKShare 1.18.64 文档 https://akshare.akfamily.xyz/data/stock/stock.html#

const AKSCRIPT = `
import json, sys
from datetime import datetime
try:
    import akshare as ak
    import pandas as pd

    symbol = sys.argv[1]
    start = sys.argv[2] if len(sys.argv) > 2 else "20200101"
    end = sys.argv[3] if len(sys.argv) > 3 else datetime.today().strftime("%Y%m%d")

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
        if code.isdigit() and len(code) == 6:
            stock_df = None
            try:
                stock_df = ak.stock_zh_a_hist(symbol=code, period="daily",
                                              start_date=start, end_date=end,
                                              adjust="qfq")
            except Exception:
                pass
            if stock_df is not None and not stock_df.empty:
                df = stock_df
            else:
                df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
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

const AK_FUND_HISTORY_SCRIPT = `
import json, sys
from datetime import datetime

try:
    import akshare as ak
    import pandas as pd

    symbol = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else "history"
    attempts = []

    def clean_value(v):
        try:
            if pd.isna(v):
                return None
        except Exception:
            pass
        if hasattr(v, "item"):
            try:
                return clean_value(v.item())
            except Exception:
                pass
        if hasattr(v, "strftime"):
            return v.strftime("%Y-%m-%d")
        return v

    def records(df):
        if df is None or df.empty:
            return []
        df = df.copy()
        for col in df.columns:
            name = str(col)
            if "日期" in name or name.lower() in ("date", "nav_date"):
                try:
                    df[col] = pd.to_datetime(df[col]).dt.strftime("%Y-%m-%d")
                except Exception:
                    pass
        return [{str(k): clean_value(v) for k, v in row.items()} for row in df.to_dict(orient="records")]

    def call(endpoint, fn):
        try:
            rows = fn()
            attempts.append({"endpoint": endpoint, "status": "ok", "rows": len(rows) if isinstance(rows, list) else 1})
            return rows
        except Exception as e:
            attempts.append({"endpoint": endpoint, "status": "error", "error": str(e)})
            return []

    def merge_nav(unit_rows, acc_rows):
        by_date = {}
        for r in unit_rows:
            d = r.get("净值日期")
            if d:
                by_date[d] = {
                    "fund_code": symbol,
                    "nav_date": d,
                    "unit_nav": r.get("单位净值"),
                    "daily_return_pct": r.get("日增长率"),
                    "is_open_day": True,
                    "source": "akshare:fund_open_fund_info_em"
                }
        for r in acc_rows:
            d = r.get("净值日期")
            if d:
                by_date.setdefault(d, {
                    "fund_code": symbol,
                    "nav_date": d,
                    "is_open_day": True,
                    "source": "akshare:fund_open_fund_info_em"
                })["accumulated_nav"] = r.get("累计净值")
        return [by_date[d] for d in sorted(by_date)]

    def fetch_nav(symbol):
        unit_rows = call("fund_open_fund_info_em:单位净值走势",
            lambda: records(ak.fund_open_fund_info_em(symbol=symbol, indicator="单位净值走势")))
        acc_rows = call("fund_open_fund_info_em:累计净值走势",
            lambda: records(ak.fund_open_fund_info_em(symbol=symbol, indicator="累计净值走势")))
        return merge_nav(unit_rows, acc_rows)

    def profile_from_rows(rows):
        profile = {}
        for row in rows:
            k = row.get("字段") or row.get("item")
            if k:
                profile[str(k)] = row.get("值") if "值" in row else row.get("value")
        return profile

    def fetch_profile(symbol):
        rows = call("fund_info_ths", lambda: records(ak.fund_info_ths(symbol=symbol)))
        rows = rows + call("fund_individual_basic_info_xq", lambda: records(ak.fund_individual_basic_info_xq(symbol=symbol)))
        return profile_from_rows(rows)

    def fetch_rank(symbol):
        df = ak.fund_open_fund_rank_em(symbol="全部")
        if df is None or df.empty or "基金代码" not in df.columns:
            return []
        df = df[df["基金代码"].astype(str) == symbol]
        return records(df.head(1))

    def fetch_achievement(symbol):
        return call("fund_individual_achievement_xq", lambda: records(ak.fund_individual_achievement_xq(symbol=symbol)))

    def fetch_analysis(symbol):
        return call("fund_individual_analysis_xq", lambda: records(ak.fund_individual_analysis_xq(symbol=symbol)))

    def fetch_purchase_status(symbol):
        def rows():
            df = ak.fund_purchase_em()
            if df is None or df.empty or "基金代码" not in df.columns:
                return []
            df = df[df["基金代码"].astype(str) == symbol]
            return records(df.head(1))
        result = call("fund_purchase_em", rows)
        return result[0] if result else {}

    payload = {
        "symbol": symbol,
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
    }

    if mode == "nav":
        payload["nav"] = fetch_nav(symbol)
    elif mode == "profile":
        payload["profile"] = fetch_profile(symbol)
    elif mode == "purchase":
        payload["purchase"] = fetch_purchase_status(symbol)
    elif mode == "performance":
        rank = call("fund_open_fund_rank_em", lambda: fetch_rank(symbol))
        payload["rank"] = rank[0] if rank else {}
        payload["achievement"] = fetch_achievement(symbol)
        payload["analysis"] = fetch_analysis(symbol)
    else:
        nav = fetch_nav(symbol)
        profile = fetch_profile(symbol)
        rank = call("fund_open_fund_rank_em", lambda: fetch_rank(symbol))
        achievement = fetch_achievement(symbol)
        analysis = fetch_analysis(symbol)
        purchase = fetch_purchase_status(symbol)
        payload.update({
            "nav": nav,
            "profile": profile,
            "rank": rank[0] if rank else {},
            "purchase": purchase,
            "achievement": achievement,
            "analysis": analysis,
        })

    payload["attempts"] = attempts
    print(json.dumps(payload, default=str))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
`;

const AK_GENERIC_FUND_SCRIPT = `
import json, sys
from datetime import datetime

try:
    import akshare as ak
    import pandas as pd

    endpoint = sys.argv[1]
    params = json.loads(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] else {}
    def fund_fee_em_fallback(symbol, indicator):
        import re
        import requests
        from bs4 import BeautifulSoup
        from io import StringIO

        title_map = {
            "认购费率（前端）": "认购费率",
            "认购费率（后端）": "认购费率",
            "申购费率（前端）": "申购费率",
            "赎回费率（前端）": "赎回费率",
            "赎回费率（后端）": "赎回费率",
        }
        target = title_map.get(indicator, indicator or "申购费率")
        url = f"https://fundf10.eastmoney.com/jjfl_{symbol}.html"
        soup = BeautifulSoup(requests.get(url).text, features="html.parser")
        for title_elem in soup.find_all(name="h4", class_="t"):
            title_text = re.sub(r"\\s+", " ", title_elem.get_text(strip=True)).strip()
            if title_text != target:
                continue
            tables = title_elem.find_all_next("table")
            if target == "申购与赎回金额" and len(tables) >= 2:
                df_1 = pd.read_html(StringIO(str(tables[0])))[0]
                df_2 = pd.read_html(StringIO(str(tables[1])))[0]
                return pd.concat(objs=[df_1, df_2], ignore_index=True)
            if tables:
                return pd.read_html(StringIO(str(tables[0])))[0]
        return pd.DataFrame([])

    def call_endpoint(endpoint, params):
        if endpoint == "fund_fee_em":
            try:
                result = ak.fund_fee_em(**params)
                indicator = params.get("indicator")
                if not isinstance(result, pd.DataFrame) or not result.empty or indicator not in ("认购费率", "认购费率（前端）", "认购费率（后端）", "申购费率", "申购费率（前端）"):
                    return result
            except Exception:
                pass
            return fund_fee_em_fallback(params.get("symbol", ""), params.get("indicator", "申购费率"))
        fn = getattr(ak, endpoint)
        return fn(**params)

    result = call_endpoint(endpoint, params)

    def clean_value(v):
        try:
            if pd.isna(v):
                return None
        except Exception:
            pass
        if hasattr(v, "item"):
            try:
                return clean_value(v.item())
            except Exception:
                pass
        if hasattr(v, "strftime"):
            return v.strftime("%Y-%m-%d")
        return v

    def clean_record(row):
        return {str(k): clean_value(v) for k, v in row.items()}

    def records(value):
        if isinstance(value, pd.DataFrame):
            if value.empty:
                return []
            return [clean_record(row) for row in value.to_dict(orient="records")]
        if isinstance(value, pd.Series):
            return [clean_record(value.to_dict())]
        if isinstance(value, dict):
            return [clean_record(value)]
        if isinstance(value, list):
            rows = []
            for item in value:
                if isinstance(item, dict):
                    rows.append(clean_record(item))
                else:
                    rows.append({"value": clean_value(item)})
            return rows
        if value is None:
            return []
        return [{"value": clean_value(value)}]

    rows = records(result)
    payload = {
        "endpoint": endpoint,
        "params": params,
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
        "row_count": len(rows),
        "rows": rows,
    }
    print(json.dumps(payload, default=str))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
`;

export const AKSHARE_PUBLIC_FUND_ENDPOINTS = [
  "fund_name_em",
  "fund_info_ths",
  "fund_individual_basic_info_xq",
  "fund_info_index_em",
  "fund_purchase_em",
  "fund_etf_spot_em",
  "fund_etf_category_ths",
  "fund_etf_spot_ths",
  "fund_lof_spot_em",
  "fund_etf_category_sina",
  "fund_etf_hist_min_em",
  "fund_lof_hist_min_em",
  "fund_etf_hist_em",
  "fund_lof_hist_em",
  "fund_etf_hist_sina",
  "fund_open_fund_daily_em",
  "fund_open_fund_info_em",
  "fund_money_fund_daily_em",
  "fund_money_fund_info_em",
  "fund_financial_fund_daily_em",
  "fund_financial_fund_info_em",
  "fund_graded_fund_daily_em",
  "fund_graded_fund_info_em",
  "fund_etf_fund_daily_em",
  "fund_etf_fund_info_em",
  "fund_hk_fund_hist_em",
  "fund_etf_dividend_sina",
  "fund_fh_em",
  "fund_cf_em",
  "fund_fh_rank_em",
  "fund_open_fund_rank_em",
  "fund_exchange_rank_em",
  "fund_money_rank_em",
  "fund_lcx_rank_em",
  "fund_hk_rank_em",
  "fund_individual_achievement_xq",
  "fund_value_estimation_em",
  "fund_individual_analysis_xq",
  "fund_individual_profit_probability_xq",
  "fund_individual_detail_hold_xq",
  "fund_overview_em",
  "fund_fee_em",
  "fund_individual_detail_info_xq",
  "fund_portfolio_hold_em",
  "fund_portfolio_bond_hold_em",
  "fund_portfolio_industry_allocation_em",
  "fund_portfolio_change_em",
  "fund_rating_all",
  "fund_rating_sh",
  "fund_rating_zs",
  "fund_rating_ja",
  "fund_manager_em",
  "fund_new_found_em",
  "fund_new_found_ths",
  "fund_scale_open_sina",
  "fund_scale_close_sina",
  "fund_scale_structured_sina",
  "fund_etf_scale_sse",
  "fund_etf_scale_szse",
  "fund_scale_daily_szse",
  "fund_aum_em",
  "fund_aum_trend_em",
  "fund_aum_hist_em",
  "reits_realtime_em",
  "reits_hist_em",
  "fund_report_stock_cninfo",
  "fund_report_industry_allocation_cninfo",
  "fund_report_asset_allocation_cninfo",
  "fund_scale_change_em",
  "fund_hold_structure_em",
  "fund_stock_position_lg",
  "fund_balance_position_lg",
  "fund_linghuo_position_lg",
  "fund_announcement_dividend_em",
  "fund_announcement_report_em",
  "fund_announcement_personnel_em",
] as const;

export type AksharePublicFundEndpoint = typeof AKSHARE_PUBLIC_FUND_ENDPOINTS[number];

const AKSHARE_PUBLIC_FUND_ENDPOINT_SET = new Set<string>(AKSHARE_PUBLIC_FUND_ENDPOINTS);

export interface AkshareAttempt {
  endpoint: string;
  status: "ok" | "error";
  rows?: number;
  error?: string;
}

export interface FundNavDaily {
  fundCode: string;
  navDate: string;
  unitNav: number;
  accumulatedNav: number | null;
  dailyReturnPct: number | null;
  isOpenDay: boolean;
  source: string;
}

export interface FundAchievementRow {
  type: string;
  period: string;
  returnPct: number | null;
  maxDrawdownPct: number | null;
  rank: string | null;
}

export interface FundRiskAnalysisRow {
  period: string;
  riskReturnScore: number | null;
  antiVolatilityScore: number | null;
  annualVolatilityPct: number | null;
  annualSharpe: number | null;
  maxDrawdownPct: number | null;
}

export interface AkshareFundHistory {
  symbol: string;
  fetchedAt: string;
  nav: FundNavDaily[];
  profile: Record<string, unknown>;
  rank: Record<string, unknown>;
  purchase: Record<string, unknown>;
  achievement: FundAchievementRow[];
  analysis: FundRiskAnalysisRow[];
  attempts: AkshareAttempt[];
}

export interface AkshareRowsResult {
  endpoint: AksharePublicFundEndpoint;
  params: Record<string, unknown>;
  fetchedAt: string;
  rowCount: number;
  rows: Record<string, unknown>[];
}

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

export function parseAkshareFundHistoryJson(parsed: unknown): AkshareFundHistory {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AKShare fund history error: invalid payload");
  }
  const record = parsed as Record<string, unknown>;
  if (record.error) throw new Error(`AKShare fund history error: ${String(record.error)}`);

  const nav = Array.isArray(record.nav)
    ? record.nav.map((row) => normalizeFundNav(row as Record<string, unknown>)).filter((row): row is FundNavDaily => Boolean(row))
    : [];

  return {
    symbol: String(record.symbol || ""),
    fetchedAt: String(record.fetched_at || ""),
    nav,
    profile: isRecord(record.profile) ? record.profile : {},
    rank: isRecord(record.rank) ? record.rank : {},
    purchase: isRecord(record.purchase) ? record.purchase : {},
    achievement: Array.isArray(record.achievement)
      ? record.achievement.map((row) => normalizeAchievement(row as Record<string, unknown>))
      : [],
    analysis: Array.isArray(record.analysis)
      ? record.analysis.map((row) => normalizeRiskAnalysis(row as Record<string, unknown>))
      : [],
    attempts: Array.isArray(record.attempts)
      ? record.attempts.map((row) => normalizeAttempt(row as Record<string, unknown>))
      : [],
  };
}

export function parseAkshareRowsJson(parsed: unknown): AkshareRowsResult {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AKShare rows error: invalid payload");
  }
  const record = parsed as Record<string, unknown>;
  if (record.error) throw new Error(`AKShare rows error: ${String(record.error)}`);
  const endpoint = String(record.endpoint || "");
  if (!AKSHARE_PUBLIC_FUND_ENDPOINT_SET.has(endpoint)) {
    throw new Error(`AKShare rows error: unsupported endpoint ${endpoint}`);
  }
  const rows = Array.isArray(record.rows)
    ? record.rows.filter(isRecord).map((row) => ({ ...row }))
    : [];
  return {
    endpoint: endpoint as AksharePublicFundEndpoint,
    params: isRecord(record.params) ? record.params : {},
    fetchedAt: String(record.fetched_at || ""),
    rowCount: numberOrNull(record.row_count) ?? rows.length,
    rows,
  };
}

export async function fetchFromAKShare(
  symbol: string,
  start?: string,
  end?: string,
): Promise<Bar[]> {
  const startDate = start?.replace(/-/g, "") || "20200101";
  const endDate = end?.replace(/-/g, "") || todayYmd();

  const { stdout } = await runPython(AKSCRIPT, symbol, startDate, endDate);
  return parseAkshareJson(JSON.parse(stdout));
}

export async function fetchAkshareFundHistory(symbol: string): Promise<AkshareFundHistory> {
  return fetchAkshareFundMode(symbol, "history");
}

export async function fetchAkshareFundNav(symbol: string): Promise<AkshareFundHistory> {
  return fetchAkshareFundMode(symbol, "nav");
}

export async function fetchAkshareFundProfile(symbol: string): Promise<AkshareFundHistory> {
  return fetchAkshareFundMode(symbol, "profile");
}

export async function fetchAkshareFundPurchase(symbol: string): Promise<AkshareFundHistory> {
  return fetchAkshareFundMode(symbol, "purchase");
}

export async function fetchAkshareFundPerformance(symbol: string): Promise<AkshareFundHistory> {
  return fetchAkshareFundMode(symbol, "performance");
}

export async function fetchAkshareRows(
  endpoint: AksharePublicFundEndpoint,
  params: Record<string, unknown> = {},
): Promise<AkshareRowsResult> {
  if (!AKSHARE_PUBLIC_FUND_ENDPOINT_SET.has(endpoint)) {
    throw new Error(`Unsupported AKShare public fund endpoint: ${endpoint}`);
  }
  const cleanedParams = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value != null && value !== ""),
  );
  const { stdout } = await runPython(AK_GENERIC_FUND_SCRIPT, endpoint, JSON.stringify(cleanedParams));
  return parseAkshareRowsJson(JSON.parse(stdout));
}

async function fetchAkshareFundMode(symbol: string, mode: "history" | "nav" | "profile" | "purchase" | "performance"): Promise<AkshareFundHistory> {
  const { stdout } = await runPython(AK_FUND_HISTORY_SCRIPT, symbol, mode);
  return parseAkshareFundHistoryJson(JSON.parse(stdout));
}

function normalizeFundNav(row: Record<string, unknown>): FundNavDaily | null {
  const navDate = String(row.nav_date || "");
  const unitNav = numberOrNull(row.unit_nav);
  if (!navDate || unitNav == null) return null;
  return {
    fundCode: String(row.fund_code || ""),
    navDate,
    unitNav,
    accumulatedNav: numberOrNull(row.accumulated_nav),
    dailyReturnPct: numberOrNull(row.daily_return_pct),
    isOpenDay: row.is_open_day !== false,
    source: String(row.source || "akshare"),
  };
}

function normalizeAchievement(row: Record<string, unknown>): FundAchievementRow {
  return {
    type: String(row["业绩类型"] || ""),
    period: String(row["周期"] || ""),
    returnPct: numberOrNull(row["本产品区间收益"]),
    maxDrawdownPct: numberOrNull(row["本产品最大回撤"] ?? row["本产品最大回撒"]),
    rank: row["周期收益同类排名"] == null ? null : String(row["周期收益同类排名"]),
  };
}

function normalizeRiskAnalysis(row: Record<string, unknown>): FundRiskAnalysisRow {
  return {
    period: String(row["周期"] || ""),
    riskReturnScore: numberOrNull(row["较同类风险收益比"]),
    antiVolatilityScore: numberOrNull(row["较同类抗风险波动"]),
    annualVolatilityPct: numberOrNull(row["年化波动率"]),
    annualSharpe: numberOrNull(row["年化夏普比率"]),
    maxDrawdownPct: numberOrNull(row["最大回撤"]),
  };
}

function normalizeAttempt(row: Record<string, unknown>): AkshareAttempt {
  const status = row.status === "error" ? "error" : "ok";
  return {
    endpoint: String(row.endpoint || ""),
    status,
    rows: numberOrNull(row.rows) ?? undefined,
    error: row.error == null ? undefined : String(row.error),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function runPython(
  ...args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const timeoutMs = args[0] === AK_FUND_HISTORY_SCRIPT || args[0] === AK_GENERIC_FUND_SCRIPT ? 60_000 : 30_000;
    const proc = spawn("python", ["-c", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const reason = code == null ? `timeout after ${timeoutMs}ms` : `exit ${code}`;
        reject(new Error(`AKShare failed (${reason}): ${stderr || stdout}`));
      }
    });
    proc.on("error", (err) => reject(err));
  });
}
