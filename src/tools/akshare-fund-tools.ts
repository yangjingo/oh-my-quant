import { Type } from "typebox";
import type { Static } from "typebox";
import type { TSchema } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  fetchAkshareRows,
  fetchAkshareFundNav,
  type AkshareFundHistory,
  type AksharePublicFundEndpoint,
  type AkshareRowsResult,
  type FundAchievementRow,
  type FundNavDaily,
  type FundRiskAnalysisRow,
} from "../source/index.ts";

const FundSymbolWithPriority = Type.Object({
  symbol: Type.String({ description: "Fund code, e.g. 270042" }),
  source_priority: Type.Optional(Type.String({ description: "Comma-separated preferred providers or endpoints, e.g. 东方财富,雪球,同花顺 or fund_overview_em,fund_info_ths" })),
});

const FundFeeRequest = Type.Object({
  symbol: Type.String({ description: "Fund code, e.g. 270042" }),
  indicator: Type.Optional(Type.String({ description: "Fee/rule indicator, e.g. 申购费率（前端）, 赎回费率, 交易状态" })),
  source_priority: Type.Optional(Type.String({ description: "Comma-separated preferred providers or endpoints, e.g. 东方财富,雪球 or fund_fee_em,fund_individual_detail_info_xq" })),
});

type FundSymbolWithPriorityArgs = Static<typeof FundSymbolWithPriority>;
type FundFeeRequestArgs = Static<typeof FundFeeRequest>;
type EndpointParameterSchemas = Record<string, TSchema>;

interface AkshareFundEndpointSpec {
  endpoint: AksharePublicFundEndpoint;
  description: string;
  params: EndpointParameterSchemas;
}

export interface AkshareFundToolRegistration {
  name: string;
  label: string;
}

interface SourceCandidate<T> {
  id: string;
  provider: string;
  endpoint: string;
  fetch: (symbol: string) => Promise<T>;
  isHit: (value: T) => boolean;
}

interface SourceAttempt {
  id: string;
  provider: string;
  endpoint: string;
  status: "ok" | "empty" | "error";
  rows?: number;
  error?: string;
}

interface SourceResult<T> {
  candidate: SourceCandidate<T> | null;
  value: T | null;
  attempts: SourceAttempt[];
}

const COMMON_ENDPOINT_OPTIONS: EndpointParameterSchemas = {
  fund_code: Type.Optional(Type.String({ description: "Local output filter for fund code, e.g. 270042. Not passed to AKShare." })),
  keyword: Type.Optional(Type.String({ description: "Local output filter across returned values. Not passed to AKShare." })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Maximum rows to include in tool output/details. Default 12." })),
};

const AKSHARE_FUND_ENDPOINT_SPECS: AkshareFundEndpointSpec[] = [
  { endpoint: "fund_name_em", description: "东方财富-天天基金-所有基金基本信息", params: {} },
  { endpoint: "fund_info_ths", description: "同花顺-基金基本信息", params: { symbol: codeParam("基金代码, e.g. 270042") } },
  { endpoint: "fund_individual_basic_info_xq", description: "雪球-单只基金基本信息", params: { symbol: codeParam("基金代码, e.g. 270042"), timeout: optNumberParam("Optional request timeout") } },
  { endpoint: "fund_info_index_em", description: "东方财富-天天基金-指数型基金基本信息", params: { symbol: optStringParam("全部/沪深指数/行业主题/大盘指数/中盘指数/小盘指数/股票指数/债券指数"), indicator: optStringParam("全部/被动指数型/增强指数型") } },
  { endpoint: "fund_purchase_em", description: "东方财富-天天基金-基金申购/赎回状态", params: {} },

  { endpoint: "fund_open_fund_daily_em", description: "东方财富-天天基金-开放式基金实时净值", params: {} },
  { endpoint: "fund_open_fund_info_em", description: "东方财富-天天基金-开放式基金历史净值/收益/分红/拆分", params: { symbol: codeParam("基金代码, e.g. 270042"), indicator: optStringParam("单位净值走势/累计净值走势/累计收益率走势/同类排名走势/同类排名百分比/分红送配详情/拆分详情"), period: optStringParam("累计收益率走势周期: 1月/3月/6月/1年/3年/5年/今年来/成立来") } },
  { endpoint: "fund_money_fund_daily_em", description: "东方财富-天天基金-货币型基金实时收益", params: {} },
  { endpoint: "fund_money_fund_info_em", description: "东方财富-天天基金-货币型基金历史收益", params: { symbol: codeParam("基金代码, e.g. 000009") } },
  { endpoint: "fund_financial_fund_daily_em", description: "东方财富-天天基金-理财型基金实时数据", params: {} },
  { endpoint: "fund_financial_fund_info_em", description: "东方财富-天天基金-理财型基金历史净值", params: { symbol: codeParam("基金代码, e.g. 000134") } },
  { endpoint: "fund_graded_fund_daily_em", description: "东方财富-天天基金-分级基金实时数据", params: {} },
  { endpoint: "fund_graded_fund_info_em", description: "东方财富-天天基金-分级基金历史净值", params: { symbol: codeParam("基金代码, e.g. 150232") } },
  { endpoint: "fund_etf_fund_daily_em", description: "东方财富-天天基金-场内交易基金实时净值", params: {} },
  { endpoint: "fund_etf_fund_info_em", description: "东方财富-天天基金-场内交易基金历史净值", params: { fund: codeParam("基金代码, e.g. 511280"), start_date: optDateParam("Start date YYYYMMDD"), end_date: optDateParam("End date YYYYMMDD") } },
  { endpoint: "fund_hk_fund_hist_em", description: "东方财富-天天基金-香港基金历史净值/分红", params: { code: codeParam("香港基金代码, e.g. 1002200683"), symbol: optStringParam("历史净值明细/分红送配详情") } },

  { endpoint: "fund_open_fund_rank_em", description: "东方财富-开放式基金排行", params: { symbol: optStringParam("全部/股票型/混合型/债券型/指数型/QDII/FOF") } },
  { endpoint: "fund_exchange_rank_em", description: "东方财富-场内交易基金排行", params: {} },
  { endpoint: "fund_money_rank_em", description: "东方财富-货币型基金排行", params: {} },
  { endpoint: "fund_lcx_rank_em", description: "东方财富-理财基金排行", params: {} },
  { endpoint: "fund_hk_rank_em", description: "东方财富-香港基金排行", params: {} },
  { endpoint: "fund_individual_achievement_xq", description: "雪球-单只基金业绩详情", params: { symbol: codeParam("基金代码, e.g. 270042"), timeout: optNumberParam("Optional request timeout") } },
  { endpoint: "fund_individual_analysis_xq", description: "雪球-单只基金风险收益分析", params: { symbol: codeParam("基金代码, e.g. 270042"), timeout: optNumberParam("Optional request timeout") } },
  { endpoint: "fund_individual_profit_probability_xq", description: "雪球-单只基金盈利概率", params: { symbol: codeParam("基金代码, e.g. 270042"), timeout: optNumberParam("Optional request timeout") } },
  { endpoint: "fund_value_estimation_em", description: "东方财富-基金净值估算", params: { symbol: optStringParam("全部/股票型/混合型/债券型/指数型/QDII/ETF联接/LOF/场内交易基金") } },

  { endpoint: "fund_overview_em", description: "天天基金-基金档案-基本概况", params: { symbol: codeParam("基金代码, e.g. 270042") } },
  { endpoint: "fund_fee_em", description: "天天基金-基金档案-购买信息/费率", params: { symbol: codeParam("基金代码, e.g. 270042"), indicator: optStringParam("交易状态/申购与赎回金额/交易确认日/运作费用/认购费率（前端）/认购费率（后端）/申购费率（前端）/赎回费率") } },
  { endpoint: "fund_individual_detail_info_xq", description: "雪球-单只基金交易规则", params: { symbol: codeParam("基金代码, e.g. 270042"), timeout: optNumberParam("Optional request timeout") } },
  { endpoint: "fund_individual_detail_hold_xq", description: "雪球-单只基金指定季度大类资产持仓", params: { symbol: codeParam("基金代码, e.g. 270042"), date: dateParam("Quarter date YYYYMMDD, e.g. 20231231"), timeout: optNumberParam("Optional request timeout") } },
  { endpoint: "fund_portfolio_hold_em", description: "天天基金-基金股票持仓", params: { symbol: codeParam("基金代码, e.g. 270042"), date: yearParam("Year, e.g. 2025") } },
  { endpoint: "fund_portfolio_bond_hold_em", description: "天天基金-基金债券持仓", params: { symbol: codeParam("基金代码, e.g. 270042"), date: yearParam("Year, e.g. 2025") } },
  { endpoint: "fund_portfolio_industry_allocation_em", description: "天天基金-基金行业配置", params: { symbol: codeParam("基金代码, e.g. 270042"), date: yearParam("Year, e.g. 2025") } },
  { endpoint: "fund_portfolio_change_em", description: "天天基金-基金重大买入/卖出变动", params: { symbol: codeParam("基金代码, e.g. 270042"), indicator: stringParam("累计买入/累计卖出"), date: yearParam("Year, e.g. 2025") } },

  { endpoint: "fund_fh_em", description: "天天基金-基金分红", params: { year: yearParam("Year, e.g. 2026"), typ: optStringParam("Fund type filter"), rank: optStringParam("BZDM/ABBNAME/DJR/FSRQ/FHFCZ/FFR"), sort: optStringParam("asc/desc"), page: optIntegerParam("Page; -1 means all pages") } },
  { endpoint: "fund_cf_em", description: "天天基金-基金拆分", params: { year: yearParam("Year, e.g. 2026"), typ: optStringParam("Fund type filter"), rank: optStringParam("BZDM/ABBNAME/FSRQ/FHFCZ"), sort: optStringParam("asc/desc"), page: optIntegerParam("Page; -1 means all pages") } },
  { endpoint: "fund_fh_rank_em", description: "天天基金-基金累计分红排行", params: {} },
  { endpoint: "fund_etf_dividend_sina", description: "新浪财经-ETF基金累计分红", params: { symbol: stringParam("Sina fund symbol, e.g. sh510050") } },

  { endpoint: "fund_etf_spot_em", description: "东方财富-ETF实时行情", params: {} },
  { endpoint: "fund_etf_category_ths", description: "同花顺-基金每日净值实时行情", params: { symbol: optStringParam("股票型/债券型/混合型/ETF/LOF/QDII/保本型/指数型/empty for all"), date: optDateParam("Query date YYYYMMDD") } },
  { endpoint: "fund_etf_spot_ths", description: "同花顺-ETF基金实时行情", params: { date: optDateParam("Query date YYYYMMDD") } },
  { endpoint: "fund_lof_spot_em", description: "东方财富-LOF实时行情", params: {} },
  { endpoint: "fund_etf_category_sina", description: "新浪财经-基金列表及行情", params: { symbol: stringParam("封闭式基金/ETF基金/LOF基金") } },
  { endpoint: "fund_etf_hist_min_em", description: "东方财富-ETF分时行情", params: { symbol: codeParam("ETF代码, e.g. 513500"), start_date: optStringParam("Start datetime YYYY-MM-DD HH:mm:ss"), end_date: optStringParam("End datetime YYYY-MM-DD HH:mm:ss"), period: optStringParam("1/5/15/30/60"), adjust: optStringParam("empty/qfq/hfq") } },
  { endpoint: "fund_lof_hist_min_em", description: "东方财富-LOF分时行情", params: { symbol: codeParam("LOF代码, e.g. 166009"), start_date: optStringParam("Start datetime YYYY-MM-DD HH:mm:ss"), end_date: optStringParam("End datetime YYYY-MM-DD HH:mm:ss"), period: optStringParam("1/5/15/30/60"), adjust: optStringParam("empty/qfq/hfq") } },
  { endpoint: "fund_etf_hist_em", description: "东方财富-ETF历史行情", params: { symbol: codeParam("ETF代码, e.g. 513500"), period: optStringParam("daily/weekly/monthly"), start_date: optDateParam("Start date YYYYMMDD"), end_date: optDateParam("End date YYYYMMDD"), adjust: optStringParam("empty/qfq/hfq") } },
  { endpoint: "fund_lof_hist_em", description: "东方财富-LOF历史行情", params: { symbol: codeParam("LOF代码, e.g. 166009"), period: optStringParam("daily/weekly/monthly"), start_date: optDateParam("Start date YYYYMMDD"), end_date: optDateParam("End date YYYYMMDD"), adjust: optStringParam("empty/qfq/hfq") } },
  { endpoint: "fund_etf_hist_sina", description: "新浪财经-基金日频历史行情", params: { symbol: stringParam("Sina fund symbol, e.g. sh510050") } },
  { endpoint: "reits_realtime_em", description: "东方财富-沪深REITs实时行情", params: {} },
  { endpoint: "reits_hist_em", description: "东方财富-REITs历史行情", params: { symbol: codeParam("REITs code, e.g. 508097") } },

  { endpoint: "fund_rating_all", description: "天天基金-基金评级总汇", params: {} },
  { endpoint: "fund_rating_sh", description: "天天基金-上海证券评级", params: { date: dateParam("Rating date YYYYMMDD") } },
  { endpoint: "fund_rating_zs", description: "天天基金-招商证券评级", params: { date: dateParam("Rating date YYYYMMDD") } },
  { endpoint: "fund_rating_ja", description: "天天基金-济安金信评级", params: { date: dateParam("Rating date YYYYMMDD") } },
  { endpoint: "fund_manager_em", description: "天天基金-基金经理大全", params: {} },
  { endpoint: "fund_new_found_em", description: "天天基金-新成立基金", params: {} },
  { endpoint: "fund_new_found_ths", description: "同花顺-新发基金", params: { symbol: optStringParam("全部/发行中/将发行") } },

  { endpoint: "fund_scale_open_sina", description: "新浪财经-开放式基金规模", params: { symbol: stringParam("股票型基金/混合型基金/债券型基金/货币型基金/QDII基金") } },
  { endpoint: "fund_scale_close_sina", description: "新浪财经-封闭式基金规模", params: {} },
  { endpoint: "fund_scale_structured_sina", description: "新浪财经-分级子基金规模", params: {} },
  { endpoint: "fund_etf_scale_sse", description: "上交所-ETF基金份额", params: { date: dateParam("Date YYYYMMDD") } },
  { endpoint: "fund_etf_scale_szse", description: "深交所-ETF基金份额", params: {} },
  { endpoint: "fund_scale_daily_szse", description: "深交所-基金规模日频", params: { start_date: dateParam("Start date YYYYMMDD"), end_date: dateParam("End date YYYYMMDD"), symbol: stringParam("ETF/LOF/REITS") } },
  { endpoint: "fund_aum_em", description: "天天基金-基金公司规模详情", params: {} },
  { endpoint: "fund_aum_trend_em", description: "天天基金-市场全部基金规模走势", params: {} },
  { endpoint: "fund_aum_hist_em", description: "天天基金-基金公司历年管理规模", params: { year: yearParam("Year, e.g. 2025") } },
  { endpoint: "fund_scale_change_em", description: "天天基金-规模份额-规模变动", params: {} },
  { endpoint: "fund_hold_structure_em", description: "天天基金-规模份额-持有人结构", params: {} },

  { endpoint: "fund_report_stock_cninfo", description: "巨潮资讯-基金重仓股", params: { date: dateParam("Report date YYYYMMDD, quarter end") } },
  { endpoint: "fund_report_industry_allocation_cninfo", description: "巨潮资讯-基金行业配置", params: { date: dateParam("Report date YYYYMMDD, quarter end") } },
  { endpoint: "fund_report_asset_allocation_cninfo", description: "巨潮资讯-基金资产配置", params: {} },
  { endpoint: "fund_stock_position_lg", description: "乐咕乐股-股票型基金仓位", params: {} },
  { endpoint: "fund_balance_position_lg", description: "乐咕乐股-平衡混合型基金仓位", params: {} },
  { endpoint: "fund_linghuo_position_lg", description: "乐咕乐股-灵活配置型基金仓位", params: {} },

  { endpoint: "fund_announcement_dividend_em", description: "东方财富-天天基金-分红配送公告", params: { symbol: codeParam("基金代码, e.g. 270042") } },
  { endpoint: "fund_announcement_report_em", description: "东方财富-天天基金-定期报告公告", params: { symbol: codeParam("基金代码, e.g. 270042") } },
  { endpoint: "fund_announcement_personnel_em", description: "东方财富-天天基金-人事调整公告", params: { symbol: codeParam("基金代码, e.g. 270042") } },
];

const AKSHARE_FUND_ENDPOINT_TOOLS = AKSHARE_FUND_ENDPOINT_SPECS.map(makeAkshareEndpointTool);

function ok(text: string, details?: unknown): AgentToolResult<unknown> {
  return { content: [{ type: "text" as const, text }], details: details ?? {} };
}

async function runFirstSource<T>(
  symbol: string,
  sourcePriority: string | undefined,
  candidates: SourceCandidate<T>[],
): Promise<SourceResult<T>> {
  const attempts: SourceAttempt[] = [];
  for (const candidate of orderCandidates(candidates, sourcePriority)) {
    try {
      const value = await candidate.fetch(symbol);
      const hit = candidate.isHit(value);
      attempts.push({
        id: candidate.id,
        provider: candidate.provider,
        endpoint: candidate.endpoint,
        status: hit ? "ok" : "empty",
        rows: valueCount(value),
      });
      if (hit) return { candidate, value, attempts };
    } catch (error) {
      attempts.push({
        id: candidate.id,
        provider: candidate.provider,
        endpoint: candidate.endpoint,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { candidate: null, value: null, attempts };
}

async function runAllSources<T>(
  symbol: string,
  sourcePriority: string | undefined,
  candidates: SourceCandidate<T>[],
): Promise<{ values: Array<{ candidate: SourceCandidate<T>; value: T }>; attempts: SourceAttempt[] }> {
  const values: Array<{ candidate: SourceCandidate<T>; value: T }> = [];
  const attempts: SourceAttempt[] = [];
  for (const candidate of orderCandidates(candidates, sourcePriority)) {
    try {
      const value = await candidate.fetch(symbol);
      const hit = candidate.isHit(value);
      attempts.push({
        id: candidate.id,
        provider: candidate.provider,
        endpoint: candidate.endpoint,
        status: hit ? "ok" : "empty",
        rows: valueCount(value),
      });
      if (hit) values.push({ candidate, value });
    } catch (error) {
      attempts.push({
        id: candidate.id,
        provider: candidate.provider,
        endpoint: candidate.endpoint,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { values, attempts };
}

function orderCandidates<T>(candidates: SourceCandidate<T>[], sourcePriority?: string): SourceCandidate<T>[] {
  const tokens = parseSourcePriority(sourcePriority);
  if (tokens.length === 0) return [...candidates];
  const picked: SourceCandidate<T>[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    for (const candidate of candidates) {
      if (seen.has(candidate.id)) continue;
      if (candidateMatches(candidate, token)) {
        picked.push(candidate);
        seen.add(candidate.id);
      }
    }
  }
  for (const candidate of candidates) {
    if (!seen.has(candidate.id)) picked.push(candidate);
  }
  return picked;
}

function parseSourcePriority(value?: string): string[] {
  return String(value || "")
    .split(/[,，>、\s]+/u)
    .map((item) => normalizeSourceToken(item))
    .filter(Boolean);
}

function normalizeSourceToken(value: string): string {
  const raw = value.trim().toLowerCase();
  const aliases: Record<string, string> = {
    东方财富: "eastmoney",
    天天基金: "eastmoney",
    东财: "eastmoney",
    雪球: "xq",
    蛋卷: "xq",
    同花顺: "ths",
    新浪: "sina",
  };
  return aliases[value.trim()] || raw;
}

function candidateMatches<T>(candidate: SourceCandidate<T>, token: string): boolean {
  return candidate.id.toLowerCase() === token
    || candidate.provider.toLowerCase() === token
    || candidate.endpoint.toLowerCase() === token;
}

function valueCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (isRecord(value)) return Object.keys(value).length > 0 ? 1 : 0;
  return value == null ? 0 : 1;
}

function profileSourceCandidates(): SourceCandidate<Record<string, unknown>>[] {
  return [
    {
      id: "eastmoney",
      provider: "eastmoney",
      endpoint: "fund_overview_em",
      fetch: async (symbol) => {
        const data = await fetchAkshareRows("fund_overview_em", { symbol });
        return data.rows[0] ? { ...data.rows[0] } : {};
      },
      isHit: (value) => Object.keys(value).length > 0,
    },
    {
      id: "ths",
      provider: "ths",
      endpoint: "fund_info_ths",
      fetch: async (symbol) => keyValueRows(await fetchAkshareRows("fund_info_ths", { symbol }), "字段", "值"),
      isHit: (value) => Object.keys(value).length > 0,
    },
    {
      id: "xq",
      provider: "xq",
      endpoint: "fund_individual_basic_info_xq",
      fetch: async (symbol) => keyValueRows(await fetchAkshareRows("fund_individual_basic_info_xq", { symbol }), "item", "value"),
      isHit: (value) => Object.keys(value).length > 0,
    },
  ];
}

function navSourceCandidates(): SourceCandidate<FundNavDaily[]>[] {
  return [
    {
      id: "open_fund_em",
      provider: "eastmoney",
      endpoint: "fund_open_fund_info_em",
      fetch: async (symbol) => (await fetchAkshareFundNav(symbol)).nav,
      isHit: (value) => value.length > 0,
    },
    {
      id: "exchange_fund_em",
      provider: "eastmoney",
      endpoint: "fund_etf_fund_info_em",
      fetch: async (symbol) => normalizeNavRows(
        symbol,
        (await fetchAkshareRows("fund_etf_fund_info_em", { fund: symbol, start_date: "20000101", end_date: "20500101" })).rows,
        "akshare:fund_etf_fund_info_em",
      ),
      isHit: (value) => value.length > 0,
    },
    {
      id: "graded_fund_em",
      provider: "eastmoney",
      endpoint: "fund_graded_fund_info_em",
      fetch: async (symbol) => normalizeNavRows(
        symbol,
        (await fetchAkshareRows("fund_graded_fund_info_em", { symbol })).rows,
        "akshare:fund_graded_fund_info_em",
      ),
      isHit: (value) => value.length > 0,
    },
    {
      id: "financial_fund_em",
      provider: "eastmoney",
      endpoint: "fund_financial_fund_info_em",
      fetch: async (symbol) => normalizeNavRows(
        symbol,
        (await fetchAkshareRows("fund_financial_fund_info_em", { symbol })).rows,
        "akshare:fund_financial_fund_info_em",
      ),
      isHit: (value) => value.length > 0,
    },
  ];
}

function purchaseSourceCandidates(): SourceCandidate<Record<string, unknown>>[] {
  return [
    {
      id: "eastmoney_purchase",
      provider: "eastmoney",
      endpoint: "fund_purchase_em",
      fetch: async (symbol) => filterRows((await fetchAkshareRows("fund_purchase_em")).rows, { fund_code: symbol })[0] ?? {},
      isHit: (value) => Object.keys(value).length > 0,
    },
    {
      id: "eastmoney_open_daily",
      provider: "eastmoney",
      endpoint: "fund_open_fund_daily_em",
      fetch: async (symbol) => filterRows((await fetchAkshareRows("fund_open_fund_daily_em")).rows, { fund_code: symbol })[0] ?? {},
      isHit: (value) => Object.keys(value).length > 0,
    },
    {
      id: "ths_qdii_daily",
      provider: "ths",
      endpoint: "fund_etf_category_ths",
      fetch: async (symbol) => filterRows((await fetchAkshareRows("fund_etf_category_ths", { symbol: "QDII" })).rows, { fund_code: symbol })[0] ?? {},
      isHit: (value) => Object.keys(value).length > 0,
    },
  ];
}

function feeSourceCandidates(indicator: string): SourceCandidate<Record<string, unknown>[]>[] {
  return [
    {
      id: "eastmoney_fee",
      provider: "eastmoney",
      endpoint: "fund_fee_em",
      fetch: async (symbol) => (await fetchAkshareRows("fund_fee_em", { symbol, indicator })).rows,
      isHit: (value) => value.length > 0,
    },
    {
      id: "xq_trade_rule",
      provider: "xq",
      endpoint: "fund_individual_detail_info_xq",
      fetch: async (symbol) => filterFeeRows((await fetchAkshareRows("fund_individual_detail_info_xq", { symbol })).rows, indicator),
      isHit: (value) => value.length > 0,
    },
  ];
}

function performanceSourceCandidates(): SourceCandidate<FundAchievementRow[]>[] {
  return [
    {
      id: "xq_achievement",
      provider: "xq",
      endpoint: "fund_individual_achievement_xq",
      fetch: async (symbol) => (await fetchAkshareRows("fund_individual_achievement_xq", { symbol })).rows.map(rowToAchievement),
      isHit: (value) => value.length > 0,
    },
    {
      id: "eastmoney_rank",
      provider: "eastmoney",
      endpoint: "fund_open_fund_rank_em",
      fetch: async (symbol) => {
        const row = filterRows((await fetchAkshareRows("fund_open_fund_rank_em", { symbol: "全部" })).rows, { fund_code: symbol })[0];
        return row ? rankRowToAchievements(row) : [];
      },
      isHit: (value) => value.length > 0,
    },
  ];
}

function keyValueRows(data: AkshareRowsResult, keyField: string, valueField: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of data.rows) {
    const key = textValue(row[keyField]);
    if (key) out[key] = row[valueField];
  }
  return out;
}

function mergeRecordsByPriority(records: Array<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (out[key] == null || out[key] === "") out[key] = value;
    }
  }
  return out;
}

function normalizeNavRows(symbol: string, rows: Record<string, unknown>[], source: string): FundNavDaily[] {
  return rows.map((row) => {
    const navDate = textValue(row["净值日期"] ?? row["日期"]);
    const unitNav = numberOrNull(row["单位净值"] ?? row["当前-单位净值"] ?? row["最新-单位净值"]);
    if (!navDate || unitNav == null) return null;
    return {
      fundCode: symbol,
      navDate,
      unitNav,
      accumulatedNav: numberOrNull(row["累计净值"] ?? row["当前-累计净值"] ?? row["最新-累计净值"]),
      dailyReturnPct: numberOrNull(row["日增长率"] ?? row["增长率"]),
      isOpenDay: true,
      source,
    };
  }).filter((row): row is FundNavDaily => Boolean(row));
}

function filterFeeRows(rows: Record<string, unknown>[], indicator: string): Record<string, unknown>[] {
  if (indicator.includes("赎回") || indicator.includes("卖出")) {
    return rows.filter((row) => textValue(row["费用类型"]).includes("卖出"));
  }
  if (indicator.includes("申购") || indicator.includes("认购") || indicator.includes("买入")) {
    return rows.filter((row) => textValue(row["费用类型"]).includes("买入"));
  }
  if (indicator.includes("运作") || indicator.includes("管理") || indicator.includes("托管")) {
    return rows.filter((row) => textValue(row["费用类型"]).includes("其他"));
  }
  return rows;
}

function rowToAchievement(row: Record<string, unknown>): FundAchievementRow {
  return {
    type: textValue(row["业绩类型"]),
    period: textValue(row["周期"]),
    returnPct: numberOrNull(row["本产品区间收益"]),
    maxDrawdownPct: numberOrNull(row["本产品最大回撤"] ?? row["本产品最大回撒"]),
    rank: row["周期收益同类排名"] == null ? null : textValue(row["周期收益同类排名"]),
  };
}

function rankRowToAchievements(row: Record<string, unknown>): FundAchievementRow[] {
  const periods = ["近1周", "近1月", "近3月", "近6月", "近1年", "近2年", "近3年", "今年来", "成立来"];
  return periods
    .filter((period) => row[period] != null && row[period] !== "")
    .map((period) => ({
      type: "阶段业绩",
      period,
      returnPct: numberOrNull(row[period]),
      maxDrawdownPct: null,
      rank: null,
    }));
}

function formatSourceAttempts(attempts: SourceAttempt[]): string {
  const text = attempts.map((attempt) => `${attempt.endpoint}:${attempt.status}`).join("  ");
  return text || "--";
}

function formatRowsPreview(title: string, toolLabel: string, source: string, rows: Record<string, unknown>[]): string {
  const lines = [title, `Tool       ${toolLabel}`, `Source     ${source}`, `Rows       ${rows.length}`];
  if (rows.length === 0) return [...lines, "Preview    --"].join("\n");
  const fields = previewFields(rows);
  lines.push(`Columns    ${fields.join(", ")}`);
  rows.slice(0, 8).forEach((row, index) => {
    const values = fields.map((field) => `${field}=${formatCell(row[field])}`).join("  ");
    lines.push(`${String(index + 1).padStart(2, "0")}         ${values}`);
  });
  return lines.join("\n");
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export const akshareFundNavTool: AgentTool<typeof FundSymbolWithPriority> = {
  name: "akshare_fund_nav",
  description: "Live AKShare fund NAV curve with source priority and fallback. No cache.",
  label: "AKShare Fund NAV",
  parameters: FundSymbolWithPriority,
  executionMode: "sequential",
  async execute(_id: string, args: FundSymbolWithPriorityArgs): Promise<AgentToolResult<unknown>> {
    const result = await runFirstSource(args.symbol, args.source_priority, navSourceCandidates());
    const nav = result.value ?? [];
    const latest = nav[nav.length - 1];
    if (!latest) {
      return ok(
        [`Fund NAV   ${args.symbol}`, "Tool       Tool.akshare.fund.nav", "Rows       0", `Sources    ${formatSourceAttempts(result.attempts)}`].join("\n"),
        { tool: "Tool.akshare.fund.nav", symbol: args.symbol, navCurve: [], sourceAttempts: result.attempts },
      );
    }
    return ok(
      [
        `Fund NAV   ${args.symbol}`,
        "Tool       Tool.akshare.fund.nav",
        `Source     ${result.candidate?.endpoint || latest.source}`,
        `Latest     ${latest.navDate}  NAV=${latest.unitNav.toFixed(4)}  Acc=${num(latest.accumulatedNav, 4)}  Day=${pct(latest.dailyReturnPct)}`,
        `Rows       ${nav.length}`,
        `Range      ${nav[0]?.navDate} -> ${latest.navDate}`,
        `Sources    ${formatSourceAttempts(result.attempts)}`,
      ].join("\n"),
      {
        tool: "Tool.akshare.fund.nav",
        provider: "akshare",
        endpoint: result.candidate?.endpoint,
        symbol: args.symbol,
        latestNav: latest,
        navCurve: nav,
        sourcePriority: args.source_priority,
        sourceAttempts: result.attempts,
      },
    );
  },
};

export const akshareFundProfileTool: AgentTool<typeof FundSymbolWithPriority> = {
  name: "akshare_fund_profile",
  description: "Live AKShare fund basic profile with source priority, multi-source merge, and fallback. No cache.",
  label: "AKShare Fund Profile",
  parameters: FundSymbolWithPriority,
  executionMode: "sequential",
  async execute(_id: string, args: FundSymbolWithPriorityArgs): Promise<AgentToolResult<unknown>> {
    const result = await runAllSources(args.symbol, args.source_priority, profileSourceCandidates());
    const profile = mergeRecordsByPriority(result.values.map((entry) => entry.value));
    const fund = normalizeFundCard({
      symbol: args.symbol,
      fetchedAt: "",
      nav: [],
      profile,
      rank: {},
      purchase: {},
      achievement: [],
      analysis: [],
      attempts: [],
    });
    return ok(
      [
        `Fund       ${String(fund.name || args.symbol)} (${args.symbol})`,
        "Tool       Tool.akshare.fund.profile",
        `Sources    ${formatSourceAttempts(result.attempts)}`,
        `Profile    ${compact([fund.fundType, fund.investmentType, fund.manager ? `Manager ${fund.manager}` : null, fund.scale ? `Scale ${fund.scale}` : null])}`,
        `Company    ${compact([fund.managementCompany, fund.custodian ? `Custodian ${fund.custodian}` : null])}`,
        `Benchmark  ${String(fund.benchmark || "--")}`,
      ].join("\n"),
      {
        tool: "Tool.akshare.fund.profile",
        provider: "akshare",
        endpoints: result.values.map((entry) => entry.candidate.endpoint),
        sourcePriority: args.source_priority,
        sourceAttempts: result.attempts,
        fund,
        profile,
      },
    );
  },
};

export const akshareFundPurchaseTool: AgentTool<typeof FundSymbolWithPriority> = {
  name: "akshare_fund_purchase",
  description: "Live AKShare fund purchase/redemption status with source priority and fallback. No cache.",
  label: "AKShare Fund Purchase",
  parameters: FundSymbolWithPriority,
  executionMode: "sequential",
  async execute(_id: string, args: FundSymbolWithPriorityArgs): Promise<AgentToolResult<unknown>> {
    const result = await runFirstSource(args.symbol, args.source_priority, purchaseSourceCandidates());
    const p = result.value ?? {};
    return ok(
      [
        `Fund Trade ${String(p["基金简称"] || args.symbol)} (${args.symbol})`,
        "Tool       Tool.akshare.fund.purchase",
        `Source     ${result.candidate?.endpoint || "--"}`,
        `Buy        ${String(p["申购状态"] || "--")}  Min ${String(p["购买起点"] ?? "--")}  Limit ${String(p["日累计限定金额"] ?? "--")}`,
        `Redeem     ${String(p["赎回状态"] || "--")}`,
        `Fee        ${formatPercentLike(p["手续费"])}`,
        `Sources    ${formatSourceAttempts(result.attempts)}`,
      ].join("\n"),
      {
        tool: "Tool.akshare.fund.purchase",
        provider: "akshare",
        endpoint: result.candidate?.endpoint,
        symbol: args.symbol,
        sourcePriority: args.source_priority,
        sourceAttempts: result.attempts,
        purchase: p,
      },
    );
  },
};

export const akshareFundFeeTool: AgentTool<typeof FundFeeRequest> = {
  name: "akshare_fund_fee",
  description: "Live AKShare fund fee and trade-rule rows with source priority and fallback. No cache.",
  label: "AKShare Fund Fee",
  parameters: FundFeeRequest,
  executionMode: "sequential",
  async execute(_id: string, args: FundFeeRequestArgs): Promise<AgentToolResult<unknown>> {
    const indicator = args.indicator || "申购费率（前端）";
    const result = await runFirstSource(args.symbol, args.source_priority, feeSourceCandidates(indicator));
    const rows = result.value ?? [];
    return ok(
      [
        formatRowsPreview(`Fund Fee   ${args.symbol}`, "Tool.akshare.fund.fee", result.candidate?.endpoint || "--", rows),
        `Indicator  ${indicator}`,
        `Sources    ${formatSourceAttempts(result.attempts)}`,
      ].join("\n"),
      {
        tool: "Tool.akshare.fund.fee",
        provider: "akshare",
        endpoint: result.candidate?.endpoint,
        symbol: args.symbol,
        indicator,
        sourcePriority: args.source_priority,
        sourceAttempts: result.attempts,
        rows,
      },
    );
  },
};

export const akshareFundPerformanceTool: AgentTool<typeof FundSymbolWithPriority> = {
  name: "akshare_fund_performance",
  description: "Live AKShare fund stage performance, drawdown/rank, and risk rows with source priority and fallback. No cache.",
  label: "AKShare Fund Performance",
  parameters: FundSymbolWithPriority,
  executionMode: "sequential",
  async execute(_id: string, args: FundSymbolWithPriorityArgs): Promise<AgentToolResult<unknown>> {
    const result = await runFirstSource(args.symbol, args.source_priority, performanceSourceCandidates());
    const riskResult = await runFirstSource<FundRiskAnalysisRow[]>(args.symbol, args.source_priority, [
      {
        id: "xq_analysis",
        provider: "xq",
        endpoint: "fund_individual_analysis_xq",
        fetch: async (symbol) => (await fetchAkshareRows("fund_individual_analysis_xq", { symbol })).rows.map((row) => ({
          period: textValue(row["周期"]),
          riskReturnScore: numberOrNull(row["较同类风险收益比"]),
          antiVolatilityScore: numberOrNull(row["较同类抗风险波动"]),
          annualVolatilityPct: numberOrNull(row["年化波动率"]),
          annualSharpe: numberOrNull(row["年化夏普比率"]),
          maxDrawdownPct: numberOrNull(row["最大回撤"]),
        })),
        isHit: (value) => value.length > 0,
      },
    ]);
    const periods = pickStagePeriods(result.value ?? []);
    const sourceAttempts = [...result.attempts, ...riskResult.attempts];
    return ok(
      [
        formatFundPerformanceText(args.symbol, periods, riskResult.value ?? []),
        `Source     ${result.candidate?.endpoint || "--"}`,
        `Sources    ${formatSourceAttempts(sourceAttempts)}`,
      ].join("\n"),
      {
        tool: "Tool.akshare.fund.performance",
        provider: "akshare",
        endpoint: result.candidate?.endpoint,
        symbol: args.symbol,
        sourcePriority: args.source_priority,
        sourceAttempts,
        periodPerformance: periods,
        riskAnalysis: riskResult.value ?? [],
      },
    );
  },
};

export const AKSHARE_FUND_TOOLS: AgentTool[] = [
  akshareFundNavTool,
  akshareFundProfileTool,
  akshareFundPurchaseTool,
  akshareFundFeeTool,
  akshareFundPerformanceTool,
  ...AKSHARE_FUND_ENDPOINT_TOOLS,
];

export const AKSHARE_FUND_TOOL_REGISTRATIONS: AkshareFundToolRegistration[] = [
  { name: "akshare_fund_nav", label: "Tool.akshare.fund.nav" },
  { name: "akshare_fund_profile", label: "Tool.akshare.fund.profile" },
  { name: "akshare_fund_purchase", label: "Tool.akshare.fund.purchase" },
  { name: "akshare_fund_fee", label: "Tool.akshare.fund.fee" },
  { name: "akshare_fund_performance", label: "Tool.akshare.fund.performance" },
  ...AKSHARE_FUND_ENDPOINT_SPECS.map((spec) => ({ name: endpointToolName(spec.endpoint), label: endpointToolLabel(spec.endpoint) })),
];

function makeAkshareEndpointTool(spec: AkshareFundEndpointSpec): AgentTool {
  const parameters = Type.Object({ ...spec.params, ...COMMON_ENDPOINT_OPTIONS });
  return {
    name: endpointToolName(spec.endpoint),
    description: `Live AKShare public fund endpoint ${spec.endpoint}: ${spec.description}. No cache.`,
    label: endpointToolLabel(spec.endpoint),
    parameters,
    executionMode: "sequential",
    async execute(_id: string, rawArgs: unknown): Promise<AgentToolResult<unknown>> {
      const args = isRecord(rawArgs) ? rawArgs : {};
      const endpointParams = endpointArgs(spec, args);
      const data = await fetchAkshareRows(spec.endpoint, endpointParams);
      const filteredRows = filterRows(data.rows, args);
      const limit = outputLimit(args.limit);
      const rows = filteredRows.slice(0, limit);
      return ok(
        formatEndpointText(spec, data.rowCount, filteredRows.length, rows, endpointParams, args),
        {
          tool: endpointToolLabel(spec.endpoint),
          provider: "akshare",
          endpoint: spec.endpoint,
          params: endpointParams,
          fetchedAt: data.fetchedAt,
          rowCount: data.rowCount,
          filteredRowCount: filteredRows.length,
          rows,
        },
      );
    },
  };
}

function stringParam(description: string): TSchema {
  return Type.String({ description });
}

function optStringParam(description: string): TSchema {
  return Type.Optional(Type.String({ description }));
}

function codeParam(description: string): TSchema {
  return Type.String({ description });
}

function dateParam(description: string): TSchema {
  return Type.String({ description });
}

function optDateParam(description: string): TSchema {
  return Type.Optional(Type.String({ description }));
}

function yearParam(description: string): TSchema {
  return Type.String({ description });
}

function optIntegerParam(description: string): TSchema {
  return Type.Optional(Type.Integer({ description }));
}

function optNumberParam(description: string): TSchema {
  return Type.Optional(Type.Number({ description }));
}

function endpointToolName(endpoint: AksharePublicFundEndpoint): string {
  return `akshare_fund_${endpoint}`;
}

function endpointToolLabel(endpoint: AksharePublicFundEndpoint): string {
  return `Tool.akshare.fund.${endpoint}`;
}

function endpointArgs(spec: AkshareFundEndpointSpec, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(spec.params)) {
    const value = args[key];
    if (value != null && value !== "") out[key] = value;
  }
  return out;
}

function filterRows(rows: Record<string, unknown>[], args: Record<string, unknown>): Record<string, unknown>[] {
  const fundCode = textValue(args.fund_code);
  const keyword = textValue(args.keyword);
  return rows.filter((row) => {
    if (fundCode && !matchesFundCode(row, fundCode)) return false;
    if (keyword && !matchesKeyword(row, keyword)) return false;
    return true;
  });
}

function outputLimit(value: unknown): number {
  const n = Number(value ?? 12);
  if (!Number.isFinite(n)) return 12;
  return Math.max(1, Math.min(100, Math.trunc(n)));
}

function formatEndpointText(
  spec: AkshareFundEndpointSpec,
  rowCount: number,
  filteredRowCount: number,
  rows: Record<string, unknown>[],
  endpointParams: Record<string, unknown>,
  args: Record<string, unknown>,
): string {
  const lines = [
    `AKShare    ${spec.endpoint}`,
    `Tool       ${endpointToolLabel(spec.endpoint)}`,
    `Rows       ${filteredRowCount === rowCount ? rowCount : `${filteredRowCount} / ${rowCount}`}`,
  ];
  const paramLine = formatParams(endpointParams, args);
  if (paramLine) lines.push(`Params     ${paramLine}`);
  if (rows.length === 0) {
    lines.push("Preview    --");
    return lines.join("\n");
  }

  const fields = previewFields(rows);
  lines.push(`Columns    ${fields.join(", ")}`);
  rows.forEach((row, index) => {
    const values = fields.map((field) => `${field}=${formatCell(row[field])}`).join("  ");
    lines.push(`${String(index + 1).padStart(2, "0")}         ${values}`);
  });
  return lines.join("\n");
}

function formatParams(endpointParams: Record<string, unknown>, args: Record<string, unknown>): string {
  const entries = Object.entries({
    ...endpointParams,
    fund_code: args.fund_code,
    keyword: args.keyword,
    limit: args.limit,
  }).filter(([, value]) => value != null && value !== "");
  return entries.map(([key, value]) => `${key}=${String(value)}`).join("  ");
}

const PREVIEW_FIELD_PRIORITY = [
  "基金代码",
  "代码",
  "基金简称",
  "简称",
  "基金名称",
  "名称",
  "字段",
  "item",
  "值",
  "value",
  "日期",
  "净值日期",
  "报告日期",
  "单位净值",
  "累计净值",
  "最新净值/万份收益",
  "日增长率",
  "增长率",
  "近1月",
  "近3月",
  "近6月",
  "近1年",
  "今年来",
  "申购状态",
  "赎回状态",
  "手续费",
  "基金类型",
  "类型",
  "基金经理",
  "基金公司",
  "周期",
  "本产品区间收益",
  "本产品最大回撒",
  "周期收益同类排名",
  "最新价",
  "涨跌幅",
  "成交额",
];

function previewFields(rows: Record<string, unknown>[]): string[] {
  const available = new Set(rows.flatMap((row) => Object.keys(row)));
  const fields = PREVIEW_FIELD_PRIORITY.filter((field) => available.has(field));
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!fields.includes(key)) fields.push(key);
      if (fields.length >= 7) return fields;
    }
  }
  return fields.slice(0, 7);
}

function matchesFundCode(row: Record<string, unknown>, fundCode: string): boolean {
  const target = normalizeCode(fundCode);
  for (const [key, value] of Object.entries(row)) {
    if (!/(基金代码|代码|证券代码|股票代码|债券代码|code|symbol)/i.test(key)) continue;
    const candidate = textValue(value);
    if (!candidate) continue;
    if (candidate === fundCode || normalizeCode(candidate) === target) return true;
  }
  return false;
}

function matchesKeyword(row: Record<string, unknown>, keyword: string): boolean {
  const lower = keyword.toLowerCase();
  return Object.values(row).some((value) => textValue(value).toLowerCase().includes(lower));
}

function normalizeCode(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits || value.trim().toLowerCase();
}

function textValue(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function formatCell(value: unknown): string {
  const text = typeof value === "number" && Number.isFinite(value)
    ? Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "")
    : textValue(value);
  if (!text) return "--";
  return text.length > 28 ? `${text.slice(0, 25)}...` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeFundCard(data: AkshareFundHistory): Record<string, unknown> {
  const p = data.profile;
  return {
    code: data.symbol,
    name: pick(p["基金简称"], p["基金名称"]),
    fullName: pick(p["基金全称"], p["基金名称"]),
    fundType: pick(p["基金类型"]),
    investmentType: pick(p["投资类型"]),
    manager: pick(p["基金经理"], p["基金经理人"]),
    inceptionDate: pick(p["成立日期"], p["成立时间"]),
    scale: pick(p["最新规模"], p["净资产规模"], p["资产规模"], p["份额规模"]),
    managementCompany: pick(p["基金管理人"], p["基金公司"]),
    custodian: pick(p["基金托管人"], p["托管银行"]),
    benchmark: pick(p["业绩比较基准"]),
  };
}

function pick(...values: unknown[]): unknown {
  return values.find((value) => value != null && value !== "") ?? null;
}

function pickStagePeriods(rows: FundAchievementRow[]): FundAchievementRow[] {
  const wanted = ["近1月", "近3月", "近6月", "近1年", "近3年", "近5年"];
  const wantedSet = new Set(wanted);
  const stage = rows.filter((row) => wantedSet.has(row.period));
  return [...stage].sort((a, b) => wanted.indexOf(a.period) - wanted.indexOf(b.period));
}

function formatFundPerformanceText(symbol: string, periods: FundAchievementRow[], riskRows: FundRiskAnalysisRow[]): string {
  const rows = [
    `Fund Perf  ${symbol}`,
    "Tool       Tool.akshare.fund.performance",
    "Mode       source-priority fallback",
  ];
  if (periods.length > 0) {
    rows.push("Periods    Return   MaxDD    Rank");
    for (const row of periods) {
      rows.push(`${row.period.padEnd(9)} ${pct(row.returnPct).padStart(7)} ${pct(row.maxDrawdownPct).padStart(7)} ${String(row.rank || "--").padStart(8)}`);
    }
  }
  if (riskRows.length > 0) {
    const risk = riskRows[0]!;
    rows.push(`Risk       ${risk.period || "--"}  Vol ${pct(risk.annualVolatilityPct)}  Sharpe ${num(risk.annualSharpe, 2)}  MaxDD ${pct(risk.maxDrawdownPct)}`);
  }
  return rows.join("\n");
}

function formatPercentLike(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return `${value.toFixed(2)}%`;
  if (typeof value === "string" && value.trim()) return value.includes("%") ? value : `${value}%`;
  return "--";
}

function compact(values: unknown[]): string {
  const text = values.filter(Boolean).map(String).join("  ");
  return text || "--";
}

function pct(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "--" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function num(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? "--" : value.toFixed(digits);
}
