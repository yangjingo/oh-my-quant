/**
 * AKShare adapter — calls Python akshare via subprocess.
 * Free A-share data, no API key. Preferred default source for A-share pulls.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Bar } from "../../types/data.ts";

type PythonCandidate = { command: string; args: string[] };

function getPythonCandidates(): PythonCandidate[] {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const venvCandidates = process.platform === "win32"
    ? [
      resolve(root, ".venv/Scripts/python.exe"),
      resolve(root, ".venv/Scripts/python"),
      resolve(root, ".venv/python.exe"),
      resolve(root, ".venv/python"),
    ]
    : [
      resolve(root, ".venv/bin/python"),
      resolve(root, ".venv/bin/python3"),
      resolve(root, ".venv/bin/python.exe"),
    ];

  const candidates: PythonCandidate[] = [];
  for (const command of venvCandidates) {
    if (existsSync(command)) {
      candidates.push({ command, args: [] });
    }
  }

  candidates.push(
    { command: "py", args: ["-3"] },
    { command: "python3", args: [] },
    { command: "python", args: [] },
  );

  return candidates;
}
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
    df = None

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

    def normalize_date_filter(input_df):
        if input_df is None or input_df.empty:
            return input_df
        local_df = input_df.copy()
        if "日期" in local_df.columns and "date" not in local_df.columns:
            local_df = local_df.rename(columns={"日期": "date"})
        if "date" in local_df.columns:
            local_df["date"] = pd.to_datetime(local_df["date"]).dt.strftime("%Y-%m-%d")
            if start:
                local_df = local_df[local_df["date"] >= pd.to_datetime(start).strftime("%Y-%m-%d")]
            if end:
                local_df = local_df[local_df["date"] <= pd.to_datetime(end).strftime("%Y-%m-%d")]
        return local_df

    def fetch_index_hist(code, market_symbol=None):
        endpoint_calls = [
            ("index_zh_a_hist", lambda: ak.index_zh_a_hist(symbol=code, period="daily", start_date=start, end_date=end)),
            ("stock_zh_index_daily_em", lambda: ak.stock_zh_index_daily_em(symbol=market_symbol or code, start_date=start, end_date=end)),
            ("stock_zh_index_hist_csindex", lambda: ak.stock_zh_index_hist_csindex(symbol=code, start_date=start, end_date=end)),
            ("index_hist_cni", lambda: ak.index_hist_cni(symbol=code, start_date=start, end_date=end)),
            ("index_hist_sw", lambda: ak.index_hist_sw(symbol=code, period="day")),
            ("stock_zh_index_daily", lambda: ak.stock_zh_index_daily(symbol=market_symbol or code)),
        ]
        for _name, fn in endpoint_calls:
            try:
                hist = normalize_date_filter(fn())
                if hist is not None and not hist.empty:
                    return hist
            except Exception:
                pass
        return None

    if symbol in index_map:
        code = symbol.split(".")[0]
        df = fetch_index_hist(code, index_map[symbol])
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
                try:
                    df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
                except Exception:
                    df = None
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
            if df is None or df.empty:
                market_prefix = "sh" if symbol.upper().endswith(".SH") else "sz" if symbol.upper().endswith(".SZ") else ""
                df = fetch_index_hist(code, f"{market_prefix}{code}" if market_prefix else code)
        else:
            df = ak.stock_zh_a_hist(symbol=code, period="daily",
                                    start_date=start, end_date=end,
                                    adjust="qfq")
    elif symbol.isdigit() and len(symbol) == 6:
        try:
            df = ak.fund_open_fund_info_em(symbol=symbol, indicator="单位净值走势")
        except Exception:
            df = None
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
        if df is None or df.empty:
            df = fetch_index_hist(symbol)
    else:
        df = ak.stock_zh_a_hist(symbol=symbol, period="daily",
                                start_date=start, end_date=end,
                                adjust="qfq")

    if df is None or df.empty:
        print(json.dumps({"error": f"No data for {symbol}"}))
        sys.exit(1)

    # Normalize column names
    col_map = {"日期":"date","开盘":"open","开盘价":"open","今开":"open","最高":"high","最高价":"high","最低":"low","最低价":"low",
               "收盘":"close","收盘价":"close","最新价":"close","latest":"close","成交量":"volume","成交额":"amount","成交金额":"amount"}
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

const AK_GENERIC_INDEX_SCRIPT = `
import json, sys
from datetime import datetime

try:
    import akshare as ak
    import pandas as pd

    endpoint = sys.argv[1]
    params = json.loads(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] else {}
    result = getattr(ak, endpoint)(**params)

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
    print(json.dumps({
        "endpoint": endpoint,
        "params": params,
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
        "row_count": len(rows),
        "rows": rows,
    }, default=str))
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

export const AKSHARE_PUBLIC_INDEX_ENDPOINTS = [
  "stock_zh_index_spot_em",
  "stock_zh_index_spot_sina",
  "stock_zh_index_daily",
  "stock_zh_index_daily_tx",
  "stock_zh_index_daily_em",
  "index_zh_a_hist",
  "index_zh_a_hist_min_em",
  "stock_hk_index_spot_sina",
  "stock_hk_index_spot_em",
  "stock_hk_index_daily_sina",
  "stock_hk_index_daily_em",
  "index_us_stock_sina",
  "index_global_spot_em",
  "index_global_hist_em",
  "index_global_hist_sina",
  "index_global_name_table",
  "index_stock_info",
  "index_stock_cons",
  "index_stock_cons_sina",
  "index_stock_cons_csindex",
  "index_stock_cons_weight_csindex",
  "index_csindex_all",
  "stock_zh_index_hist_csindex",
  "stock_zh_index_value_csindex",
  "index_all_cni",
  "index_hist_cni",
  "index_detail_cni",
  "index_detail_hist_cni",
  "index_detail_hist_adjust_cni",
  "sw_index_first_info",
  "sw_index_second_info",
  "sw_index_third_info",
  "sw_index_third_cons",
  "index_realtime_sw",
  "index_hist_sw",
  "index_min_sw",
  "index_component_sw",
  "index_analysis_daily_sw",
  "index_analysis_weekly_sw",
  "index_analysis_monthly_sw",
  "index_analysis_week_month_sw",
  "index_realtime_fund_sw",
  "index_hist_fund_sw",
  "index_option_50etf_qvix",
  "index_option_50etf_min_qvix",
  "index_option_300etf_qvix",
  "index_option_300etf_min_qvix",
  "index_option_500etf_qvix",
  "index_option_500etf_min_qvix",
  "index_option_cyb_qvix",
  "index_option_cyb_min_qvix",
  "index_option_kcb_qvix",
  "index_option_kcb_min_qvix",
  "index_option_100etf_qvix",
  "index_option_100etf_min_qvix",
  "index_option_300index_qvix",
  "index_option_300index_min_qvix",
  "index_option_1000index_qvix",
  "index_option_1000index_min_qvix",
  "index_option_50index_qvix",
  "index_option_50index_min_qvix",
  "spot_goods",
  "index_yw",
  "index_kq_fz",
  "index_kq_fashion",
  "index_sugar_msweet",
  "index_inner_quote_sugar_msweet",
  "index_outer_quote_sugar_msweet",
  "index_eri",
  "drewry_wci_index",
  "index_price_cflp",
  "index_volume_cflp",
  "index_news_sentiment_scope",
  "index_pmi_com_cx",
  "index_pmi_man_cx",
  "index_pmi_ser_cx",
  "index_dei_cx",
  "index_ii_cx",
  "index_si_cx",
  "index_fi_cx",
  "index_bi_cx",
  "index_nei_cx",
  "index_li_cx",
  "index_ci_cx",
  "index_ti_cx",
  "index_neaw_cx",
  "index_awpr_cx",
  "index_cci_cx",
  "index_qli_cx",
  "index_ai_cx",
  "index_bei_cx",
  "index_neei_cx",
] as const;

export type AksharePublicIndexEndpoint = typeof AKSHARE_PUBLIC_INDEX_ENDPOINTS[number];

const AKSHARE_PUBLIC_INDEX_ENDPOINT_SET = new Set<string>(AKSHARE_PUBLIC_INDEX_ENDPOINTS);

export interface AkshareIndexRowsResult {
  endpoint: AksharePublicIndexEndpoint;
  params: Record<string, unknown>;
  fetchedAt: string;
  rowCount: number;
  rows: Record<string, unknown>[];
}

export type AkshareIndexConstituentEndpoint =
  | "index_stock_cons_csindex"
  | "index_stock_cons_sina"
  | "index_stock_cons";

export interface AkshareIndexInfoRow {
  indexCode: string;
  displayName: string;
  publishDate: string | null;
}

export interface AkshareIndexInfoResult {
  fetchedAt: string;
  rowCount: number;
  rows: AkshareIndexInfoRow[];
}

export interface AkshareIndexQuote {
  code: string;
  name: string;
  price: number;
  change: number | null;
  changePct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  volume: number | null;
  amount: number | null;
  category?: string;
  source: "akshare";
}

export interface AkshareIndexConstituent {
  stockCode: string;
  stockName: string;
  inclusionDate: string | null;
  indexCode: string;
  indexName: string | null;
  exchange: string | null;
  weight: number | null;
  source: AkshareIndexConstituentEndpoint;
}

export interface AkshareIndexConstituentsResult {
  symbol: string;
  indexName: string | null;
  fetchedAt: string;
  source: AkshareIndexConstituentEndpoint | null;
  constituents: AkshareIndexConstituent[];
  attempts: AkshareAttempt[];
}

export interface AkshareArtifactReferenceLine {
  label: string;
  symbol: string;
  dates: string[];
  closes: number[];
  source: "akshare";
}
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

export function parseAkshareIndexRowsJson(parsed: unknown): AkshareIndexRowsResult {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AKShare index rows error: invalid payload");
  }
  const record = parsed as Record<string, unknown>;
  if (record.error) throw new Error(`AKShare index rows error: ${String(record.error)}`);
  const endpoint = String(record.endpoint || "");
  if (!AKSHARE_PUBLIC_INDEX_ENDPOINT_SET.has(endpoint)) {
    throw new Error(`AKShare index rows error: unsupported endpoint ${endpoint}`);
  }
  const rows = Array.isArray(record.rows)
    ? record.rows.filter(isRecord).map((row) => ({ ...row }))
    : [];
  return {
    endpoint: endpoint as AksharePublicIndexEndpoint,
    params: isRecord(record.params) ? record.params : {},
    fetchedAt: String(record.fetched_at || ""),
    rowCount: numberOrNull(record.row_count) ?? rows.length,
    rows,
  };
}

export function normalizeAkshareIndexQuote(row: Record<string, unknown>): AkshareIndexQuote | null {
  const rawCode = textOrEmpty(row["代码"] ?? row.code ?? row["指数代码"]);
  const code = rawCode.replace(/^(sh|sz|bj)/iu, "").trim();
  const name = textOrEmpty(row["名称"] ?? row.name ?? row["指数名称"] ?? row["指数中文简称"] ?? row["指数简称"]);
  const price = numberOrNull(row["最新价"] ?? row.latest ?? row["收盘点位"] ?? row["收盘指数"] ?? row["收盘"]);
  if (!code || !name || price == null) return null;
  return {
    code,
    name,
    price,
    change: numberOrNull(row["涨跌额"] ?? row["涨跌"] ?? row["变化值"]),
    changePct: numberOrNull(row["涨跌幅"] ?? row["日涨跌幅"] ?? row["变化幅度"]),
    open: numberOrNull(row["今开"] ?? row["今开盘"] ?? row["开盘价"] ?? row["开盘"]),
    high: numberOrNull(row["最高"] ?? row["最高价"]),
    low: numberOrNull(row["最低"] ?? row["最低价"]),
    prevClose: numberOrNull(row["昨收"] ?? row["昨收盘"] ?? row["昨收价"]),
    volume: numberOrNull(row["成交量"]),
    amount: numberOrNull(row["成交额"] ?? row["成交金额"]),
    category: textOrEmpty(row._category) || undefined,
    source: "akshare",
  };
}

export function normalizeAkshareIndexQuotes(rows: Record<string, unknown>[]): AkshareIndexQuote[] {
  return rows.map(normalizeAkshareIndexQuote).filter((row): row is AkshareIndexQuote => Boolean(row));
}

export function normalizeAkshareIndexInfoRow(row: Record<string, unknown>): AkshareIndexInfoRow | null {
  const indexCode = normalizeSecurityCode(firstValue(row, ["index_code", "指数代码", "代码"]));
  const displayName = textOrEmpty(firstValue(row, ["display_name", "指数名称", "指数中文简称", "名称", "指数简称"]));
  if (!indexCode || !displayName) return null;
  return {
    indexCode,
    displayName,
    publishDate: textOrEmpty(firstValue(row, ["publish_date", "发布日期", "发布日"])) || null,
  };
}

export function normalizeAkshareIndexInfoRows(
  rows: Record<string, unknown>[],
  options: { keyword?: string; limit?: number } = {},
): AkshareIndexInfoRow[] {
  const byCode = new Map<string, AkshareIndexInfoRow>();
  for (const row of rows) {
    const normalized = normalizeAkshareIndexInfoRow(row);
    if (!normalized) continue;
    byCode.set(`${normalized.indexCode}:${normalized.displayName}`, normalized);
  }
  const keyword = textOrEmpty(options.keyword).toLowerCase();
  const filtered = [...byCode.values()].filter((row) => {
    if (!keyword) return true;
    return [row.indexCode, row.displayName, row.publishDate].some((value) => textOrEmpty(value).toLowerCase().includes(keyword));
  });
  const limit = positiveLimit(options.limit);
  return limit == null ? filtered : filtered.slice(0, limit);
}

export function normalizeAkshareIndexConstituentRow(
  row: Record<string, unknown>,
  options: { symbol: string; indexName?: string | null; source: AkshareIndexConstituentEndpoint },
): AkshareIndexConstituent | null {
  const stockCode = normalizeSecurityCode(firstValue(row, ["品种代码", "成分券代码", "证券代码", "股票代码", "样本代码", "stock_code", "code"]));
  const stockName = textOrEmpty(firstValue(row, ["品种名称", "成分券名称", "证券名称", "股票简称", "股票名称", "样本简称", "stock_name", "name"]));
  if (!stockCode || !stockName) return null;
  const indexCode = normalizeSecurityCode(firstValue(row, ["指数代码"])) || normalizeSecurityCode(options.symbol);
  const indexName = textOrEmpty(firstValue(row, ["指数名称", "指数中文简称", "指数中文全称"])) || options.indexName || null;
  return {
    stockCode,
    stockName,
    inclusionDate: textOrEmpty(firstValue(row, ["纳入日期", "计入日期"])) || null,
    indexCode,
    indexName,
    exchange: textOrEmpty(firstValue(row, ["交易所", "交易所英文名称", "market", "exchange"])) || null,
    weight: numberOrNull(firstValue(row, ["权重", "最新权重"])),
    source: options.source,
  };
}

export function normalizeAkshareIndexConstituentRows(
  rows: Record<string, unknown>[],
  options: { symbol: string; indexName?: string | null; source: AkshareIndexConstituentEndpoint },
): AkshareIndexConstituent[] {
  const byStock = new Map<string, AkshareIndexConstituent>();
  for (const row of rows) {
    const normalized = normalizeAkshareIndexConstituentRow(row, options);
    if (!normalized) continue;
    byStock.set(normalized.stockCode, normalized);
  }
  return [...byStock.values()];
}

export async function fetchAkshareIndexInfo(keyword?: string, limit?: number): Promise<AkshareIndexInfoResult> {
  const data = await fetchAkshareIndexRows("index_stock_info");
  const rows = normalizeAkshareIndexInfoRows(data.rows, { keyword, limit });
  return {
    fetchedAt: data.fetchedAt,
    rowCount: data.rowCount,
    rows,
  };
}

export async function fetchAkshareIndexConstituents(
  symbol: string,
  sourcePriority?: string | string[],
): Promise<AkshareIndexConstituentsResult> {
  const normalizedSymbol = normalizeSecurityCode(symbol);
  if (!normalizedSymbol) throw new Error("AKShare index constituents error: symbol is required");

  let indexName: string | null = null;
  try {
    const info = await fetchAkshareIndexInfo(normalizedSymbol);
    indexName = info.rows.find((row) => row.indexCode === normalizedSymbol)?.displayName
      || info.rows[0]?.displayName
      || null;
  } catch {
    indexName = null;
  }

  const attempts: AkshareAttempt[] = [];
  for (const endpoint of normalizeConstituentSourcePriority(sourcePriority)) {
    for (const candidateSymbol of constituentSymbolCandidates(normalizedSymbol, endpoint)) {
      try {
        const data = await fetchAkshareIndexRows(endpoint, { symbol: candidateSymbol });
        const rows = normalizeAkshareIndexConstituentRows(data.rows, { symbol: normalizedSymbol, indexName, source: endpoint });
        attempts.push({ endpoint: `${endpoint}:${candidateSymbol}`, status: "ok", rows: data.rowCount });
        if (rows.length > 0) {
          return {
            symbol: normalizedSymbol,
            indexName: rows[0]?.indexName || indexName,
            fetchedAt: data.fetchedAt,
            source: endpoint,
            constituents: rows,
            attempts,
          };
        }
      } catch (error) {
        attempts.push({ endpoint: `${endpoint}:${candidateSymbol}`, status: "error", error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  return {
    symbol: normalizedSymbol,
    indexName,
    fetchedAt: new Date().toISOString(),
    source: null,
    constituents: [],
    attempts,
  };
}

export async function fetchAkshareIndexRows(
  endpoint: AksharePublicIndexEndpoint,
  params: Record<string, unknown> = {},
): Promise<AkshareIndexRowsResult> {
  if (!AKSHARE_PUBLIC_INDEX_ENDPOINT_SET.has(endpoint)) {
    throw new Error(`Unsupported AKShare index endpoint: ${endpoint}`);
  }
  const cleanedParams = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value != null && value !== ""),
  );
  const { stdout } = await runPython(AK_GENERIC_INDEX_SCRIPT, endpoint, JSON.stringify(cleanedParams));
  return parseAkshareIndexRowsJson(JSON.parse(stdout));
}

export async function fetchAkshareAIndexSpot(
  symbol: string | string[] = "沪深重要指数",
): Promise<AkshareIndexQuote[]> {
  const categories = Array.isArray(symbol) ? symbol : [symbol];
  const fallbackQuotes = await fetchSinaAIndexSpotQuotes(categories);
  if (fallbackQuotes.length > 0) return fallbackQuotes;

  const byKey = new Map<string, AkshareIndexQuote>();
  for (const category of categories) {
    const result = await fetchAkshareIndexRows("stock_zh_index_spot_em", { symbol: category });
    for (const quote of normalizeAkshareIndexQuotes(result.rows.map((row) => ({ ...row, _category: category })))) {
      byKey.set(`${quote.code}:${quote.name}`, quote);
    }
  }
  return [...byKey.values()];
}
export async function buildAkshareArtifactReferenceLine(
  symbol: string,
  label: string,
  start?: string,
  end?: string,
): Promise<AkshareArtifactReferenceLine> {
  const bars = await fetchFromAKShare(symbol, start, end);
  return {
    label,
    symbol,
    dates: bars.map((bar) => bar.date),
    closes: bars.map((bar) => bar.close),
    source: "akshare",
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

function firstValue(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value != null && textOrEmpty(value) !== "") return value;
  }
  return undefined;
}

function normalizeSecurityCode(value: unknown): string {
  const raw = textOrEmpty(value)
    .replace(/^(sh|sz|bj)/iu, "")
    .replace(/\.(SH|SZ|BJ|SI)$/iu, "")
    .trim();
  const match = raw.match(/\d{6}/u);
  return match?.[0] || raw;
}

function positiveLimit(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function normalizeConstituentSourcePriority(sourcePriority?: string | string[]): AkshareIndexConstituentEndpoint[] {
  const defaults: AkshareIndexConstituentEndpoint[] = ["index_stock_cons_csindex", "index_stock_cons_sina", "index_stock_cons"];
  const aliases: Record<string, AkshareIndexConstituentEndpoint> = {
    csindex: "index_stock_cons_csindex",
    csi: "index_stock_cons_csindex",
    "中证": "index_stock_cons_csindex",
    index_stock_cons_csindex: "index_stock_cons_csindex",
    sina: "index_stock_cons_sina",
    "新浪": "index_stock_cons_sina",
    index_stock_cons_sina: "index_stock_cons_sina",
    legacy: "index_stock_cons",
    sina_legacy: "index_stock_cons",
    "通用": "index_stock_cons",
    index_stock_cons: "index_stock_cons",
  };
  const parts = Array.isArray(sourcePriority)
    ? sourcePriority
    : textOrEmpty(sourcePriority).split(/[\s,>]+/u);
  const picked: AkshareIndexConstituentEndpoint[] = [];
  for (const part of parts) {
    const endpoint = aliases[part.trim().toLowerCase()];
    if (endpoint && !picked.includes(endpoint)) picked.push(endpoint);
  }
  return [...picked, ...defaults.filter((endpoint) => !picked.includes(endpoint))];
}

function constituentSymbolCandidates(symbol: string, endpoint: AkshareIndexConstituentEndpoint): string[] {
  const candidates = [symbol];
  if ((endpoint === "index_stock_cons_csindex" || endpoint === "index_stock_cons_sina") && /^399\d{3}$/u.test(symbol)) {
    candidates.push(`000${symbol.slice(3)}`);
  }
  if (endpoint === "index_stock_cons_sina" && /^000\d{3}$/u.test(symbol)) {
    candidates.push(`399${symbol.slice(3)}`);
  }
  return [...new Set(candidates)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textOrEmpty(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const normalized = typeof value === "string" ? value.replace(/,/gu, "").replace(/%$/u, "").trim() : value;
  if (normalized === "" || normalized === "--") return null;
  const n = Number(normalized);
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
    const timeoutMs = args[0] === AK_FUND_HISTORY_SCRIPT || args[0] === AK_GENERIC_FUND_SCRIPT || args[0] === AK_GENERIC_INDEX_SCRIPT ? 60_000 : 30_000;
    const candidates = getPythonCandidates();
    let index = 0;

    const attempt = () => {
      const candidate = candidates[index++];
      if (!candidate) {
        reject(new Error(`AKShare failed (python unavailable): ${pythonAvailabilityMessage()}`));
        return;
      }

      let stdout = "";
      let stderr = "";
      const proc = spawn(candidate.command, [...candidate.args, "-c", ...args], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs,
      });

      proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

      proc.on("close", (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        const reason = code == null ? `timeout after ${timeoutMs}ms` : `exit ${code}`;
        reject(new Error(`AKShare failed (${reason}): ${stderr || stdout}`));
      });

      proc.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT" && index < candidates.length) {
          attempt();
          return;
        }
        reject(err);
      });
    };

    attempt();
  });
}

function pythonAvailabilityMessage(): string {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  return [
    resolve(root, ".venv/Scripts/python.exe"),
    resolve(root, ".venv/Scripts/python"),
    resolve(root, ".venv/bin/python"),
    resolve(root, ".venv/bin/python3"),
    "py -3",
    "python3",
    "python",
  ].join(", ");
}

const SINA_INDEX_QUOTE_GROUPS: Record<string, string[]> = {
  "沪深重要指数": ["000001", "399001", "000300", "000905", "399006", "000016", "000852", "000688"],
  "上证系列指数": ["000001", "000016", "000300", "000905", "000852", "000688"],
  "深证系列指数": ["399001", "399005", "399006", "399300", "399905"],
  "中证系列指数": ["000300", "000905", "000852", "000903", "000904", "000906", "000907", "000908", "000909", "000910"],
};

function resolveSinaIndexSymbols(categories: string[]): string[] {
  const codes = new Set<string>();
  for (const category of categories) {
    const mapped = SINA_INDEX_QUOTE_GROUPS[category];
    if (mapped) {
      for (const code of mapped) codes.add(code);
      continue;
    }
    const direct = normalizeSecurityCode(category);
    if (direct) codes.add(direct);
  }
  if (codes.size === 0) {
    for (const code of SINA_INDEX_QUOTE_GROUPS["沪深重要指数"]) codes.add(code);
  }
  return [...codes];
}

function sinaIndexQuoteSymbol(code: string): string {
  return code.startsWith("399") ? `sz${code}` : `sh${code}`;
}

async function fetchSinaAIndexSpotQuotes(categories: string[]): Promise<AkshareIndexQuote[]> {
  const codes = resolveSinaIndexSymbols(categories);
  if (codes.length === 0) return [];

  const response = await fetch(`https://hq.sinajs.cn/list=${codes.map(sinaIndexQuoteSymbol).join(",")}`, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Referer": "https://finance.sina.com.cn/",
    },
  });
  if (!response.ok) return [];

  const text = new TextDecoder("gb18030" as never).decode(await response.arrayBuffer());
  const rows = parseSinaIndexQuotes(text);
  const byCode = new Map(rows.map((row) => [row.code, row]));
  return codes.map((code) => byCode.get(code)).filter((row): row is AkshareIndexQuote => Boolean(row));
}

function parseSinaIndexQuotes(text: string): AkshareIndexQuote[] {
  const rows: AkshareIndexQuote[] = [];
  const pattern = /var\s+hq_str_(\w+)="([^"]*)";/g;
  for (const match of text.matchAll(pattern)) {
    const rawSymbol = match[1] || "";
    const code = rawSymbol.replace(/^(sh|sz|bj)/iu, "");
    const values = (match[2] || "").split(",");
    const name = values[0]?.trim() || "";
    const open = numberOrNull(values[1]);
    const prevClose = numberOrNull(values[2]);
    const price = numberOrNull(values[3] ?? values[1] ?? values[2]);
    if (!code || !name || price == null) continue;
    const high = numberOrNull(values[4]);
    const low = numberOrNull(values[5]);
    const volume = numberOrNull(values[8]);
    const amount = numberOrNull(values[9]);
    const change = prevClose == null ? null : price - prevClose;
    const changePct = prevClose == null ? null : ((price - prevClose) / prevClose) * 100;
    rows.push({
      code,
      name,
      price,
      change,
      changePct,
      open,
      high,
      low,
      prevClose,
      volume,
      amount,
      source: "akshare",
    });
  }
  return rows;
}



