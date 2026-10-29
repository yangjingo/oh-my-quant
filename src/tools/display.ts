import { shellDisplayName } from "./shell.ts";

export type BuiltinToolDomain = "data" | "quant" | "system";

export type DataProvider =
  | "akshare"
  | "tushare"
  | "llmquant"
  | "financial-datasets"
  | "joinquant";

export interface ToolDisplay {
  label: string;
  /** Human-readable action for the research workbench; label remains the existing terminal key. */
  title?: string;
  provider?: DataProvider;
}

const TOOL_DISPLAYS: Record<string, ToolDisplay> = {
  fetch_bars: { label: "Market Data · Daily Bars", title: "获取日线数据" },
  fetch_bars_archive: { label: "Market Data · Archive Bars", title: "读取历史行情存档" },
  search_symbols: { label: "Tushare · Search", title: "查找研究标的", provider: "tushare" },
  fetch_snapshot: { label: "Direct · Snapshot", title: "获取行情快照" },
  fetch_index_spot: { label: "AKShare · Index Spot", title: "获取指数行情", provider: "akshare" },
  fetch_index_info: { label: "AKShare · Index Info", title: "查询指数信息", provider: "akshare" },
  fetch_index_constituents: { label: "AKShare · Index Constituents", title: "获取指数成分", provider: "akshare" },
  fetch_index_rows: { label: "AKShare · Index Rows", title: "获取指数数据", provider: "akshare" },
  compute_factor: { label: "Quant.Factor", title: "计算研究指标" },
  run_backtest: { label: "Quant.Backtest", title: "运行策略回测" },
  alpha_backtest: { label: "Alpha.Backtest", title: "运行超额收益回测" },
  alpha_runs: { label: "Alpha.Runs", title: "查看回测记录" },
  alpha_engine_status: { label: "Alpha.Engine", title: "检查回测引擎" },
  check_risk: { label: "Quant.Risk", title: "计算风险指标" },
  calculate_weighted_score: { label: "Quant.WeightedScore", title: "计算加权评分" },
  calculate_position_scenarios: { label: "Quant.PositionScenarios", title: "计算持仓情景" },
  analyze_archived_bars: { label: "Quant.ArchiveAnalysis", title: "分析历史行情" },
  fund_dca_backtest: { label: "Tool.quant.fund.dca", title: "回测基金定投" },
  score_benchmark: { label: "Quant.Benchmark", title: "比较基准表现" },
  show_dashboard: { label: "Quant.Dashboard", title: "生成研究看板" },
  list_portfolios: { label: "Quant.Portfolios", title: "查看观察组合" },
  edit_portfolio: { label: "Quant.PortfolioEdit", title: "更新观察组合" },
  compare_portfolios: { label: "Quant.Compare", title: "比较投资组合" },
  portfolio_comparisons: { label: "Quant.Comparisons", title: "查看组合比较记录" },
  research_task: { label: "Quant.Research", title: "管理研究任务" },
  research_news: { label: "Quant.News", title: "收集新闻证据" },
  annual_report: { label: "Quant.AnnualReport", title: "生成年度研究报告" },
  annual_reports: { label: "Quant.AnnualReports", title: "查看年度报告" },
  research_decisions: { label: "Quant.Decisions", title: "记录研究决策" },
};

export function builtinToolDisplay(name: string): ToolDisplay | undefined {
  if (name === "bash") return { label: shellDisplayName() };
  const akshareFund = akshareFundDisplay(name);
  return akshareFund ?? TOOL_DISPLAYS[name];
}

function akshareFundDisplay(name: string): ToolDisplay | undefined {
  const prefix = "akshare_fund_";
  if (!name.startsWith(prefix)) return undefined;
  return { label: `Tool.akshare.fund.${name.slice(prefix.length)}`, title: "获取基金数据", provider: "akshare" };
}
