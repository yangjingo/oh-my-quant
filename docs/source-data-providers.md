# WhyJ Quant 数据源 Provider

本文档描述 WhyJ Quant 使用的行情数据源：其官方 API/文档入口、本地 adapter 实际调用的内容、运行时优先级顺序，以及这些 adapter 如何注入 agent loop。

这些 provider 的配置位于 `.ohquant/settings.json`。运行时会先从 settings 中规范化到统一的 `WHYJ_QUANT_*` 键名，再注入进 source adapter；不要把项目根目录 `.env` 当成主配置源。

## 1. Provider 矩阵

| Provider | 官方网站/文档 | WhyJ Quant adapter 文件 | 市场 | 配置键 |
|------|------|------|------|------|
| AKShare | https://akshare.akfamily.xyz/ | `src/source/src/akshare.ts` | A 股、指数、基金 | 无 |
| Tushare | https://tushare.pro/document/2 | `src/source/src/tushare.ts` | A 股、基金(ETF/LOF) | `WHYJ_QUANT_TUSHARE_TOKEN` |
| Financial Datasets | https://docs.financialdatasets.ai/introduction | `src/source/src/financial-datasets.ts` | 美股 | `WHYJ_QUANT_FINANCIAL_DATASETS_KEY` |
| LLMQuant Data | `LLMQUANT_BASE_URL` / `https://api.llmquantdata.com` | `src/source/src/llmquant.ts` | 美股、港股 | `WHYJ_QUANT_LLMQUANT_API_KEY` |

注意：LLMQuant Data 在本仓库中以直接 HTTP adapter 方式接入。撰写时，仓库依赖配置的 API base URL，而非入库的公开文档链接。

## 2. 官方接口与本地使用

### AKShare

- 官方文档：
  - 主页：https://akshare.akfamily.xyz/
- WhyJ Quant 调用：
  - `ak.stock_zh_index_daily(...)`
  - `ak.fund_open_fund_info_em(..., indicator="单位净值走势")`
  - `ak.stock_zh_a_hist(..., period="daily", adjust="qfq")`
- 本地角色：
  - A 股/指数/基金日线的主要数据源
  - 中国市场数据的零密钥本地回退
- 本地 wrapper 形态：
  - Node 通过 `child_process.spawn` 启动 Python 子进程执行 AKShare 代码片段
  - adapter 将结果标准化为内部 `Bar[]`
- Python 发现顺序（`getPythonCandidates()`）：
  1. 项目 `.venv/` 下的 python（按源文件位置解析，不依赖 cwd）
  2. `py -3`（Windows Python Launcher）
  3. `python3`
  4. `python`

### Tushare

- 官方文档：
  - 入口：https://tushare.pro/document/2
- WhyJ Quant 调用：
  - `daily` — 股票日线
  - `fund_daily` — 基金/ETF 日线（`daily` 返回空时自动回退）
  - `stock_basic` — symbol 搜索
  - `daily_basic` — 快照（PE/PB/市值）
- 本地角色：
  - 当 `settings.preferences.source` 设为 `tushare` 时的 A 股首选 provider
  - 其他 source 配置下，AKShare 返回空或出错时的 A 股回退
  - `/search` 风格查找的 symbol 搜索
  - A 股 symbol 的紧凑交易快照
- 本地 wrapper 形态：
  - POST `https://api.tushare.pro`
  - body 包含 `api_name`、`token`、`params`、`fields`

### Financial Datasets

- 官方文档：
  - 介绍：https://docs.financialdatasets.ai/introduction
  - API 族包括 Stock Prices、Company 和 Financial Metrics
- WhyJ Quant 调用：
  - `GET /prices/`
  - `GET /prices/snapshot`
- 本地角色：
  - 美股 bars 的回退/显式数据源
  - 比本地 A 股 adapter 更丰富的美股快照数据
- 本地 wrapper 形态：
  - HTTP GET，带 `X-API-KEY`
  - 默认请求最近 60 天窗口；未显式传日期范围时只向上层返回最近 30 条
  - 接受数组 payload 或包装的 `{ prices: [...] }` / `{ data: [...] }`

### LLMQuant Data

- 运行时端点：
  - 默认 base URL：`https://api.llmquantdata.com`
- WhyJ Quant 调用：
  - `GET /api/equity/historical`
- 本地角色：
  - 配置后作为美股/港股 bars 的首选直接 adapter
  - 将 `adj_close` 保留为内部 `adjClose`
- 本地 wrapper 形态：
  - HTTP GET，带 `Authorization: Bearer <WHYJ_QUANT_LLMQUANT_API_KEY>`
  - 无显式日期范围时追加 `limit=30`
  - 接受包装的 `{ data: [...] }` 或 `{ data: { prices: [...] } }`
- 配置位置：
  - 在 `.ohquant/settings.json` 中设置 `WHYJ_QUANT_LLMQUANT_API_KEY` 和可选的 `WHYJ_QUANT_BASE_URL`

## 3. 数据优先级规则

优先级不是静态全局列表，取决于市场和调用路径。

### 3.1 `fetchBars()` 优先级

文件：`src/source/src/sources.ts`

1. 从 `settings.preferences.source` 解析选定的数据源，除非调用方传入显式 source。
2. 仅在 auto 模式下：
   - 如果选定 source 的缓存新鲜，读取本地 `.ohquant/data/{source}/{symbol}/daily.json`
3. 如果缓存缺失/过期：
   - 调用 `pullBarsFromProviders(...)`
4. 如果实时拉取仍然返回空：
   - 按以下顺序扫描任何现有缓存：
     - `akshare`
     - `tushare`
     - `llmquant-data`
     - `financial-datasets`

### 3.2 `pullBarsFromProviders()` 优先级

这是权威的实时 provider 回退链。

市场 `A`：

1. 根据 `selected` 参数决定优先 provider：
   - `selected === "tushare"` → Tushare 优先，失败回退 AKShare
   - 其他（auto / akshare 等）→ AKShare 优先，失败回退 Tushare
2. Tushare adapter 内部：`daily` API 对基金代码可能返回空，此时自动尝试 `fund_daily`

市场 `US` / `HK`：

1. 显式选择 `llmquant-data` 时优先走 LLMQuant Data
2. 显式选择 `financial-datasets` 时优先走 Financial Datasets
3. auto 模式下：
   - `US` / `HK` 先尝试 `llmquant-data`
   - `US` 再尝试 `financial-datasets`

重要细节：

- 显式 `source` 参数必须优先生效，不能被默认 source 覆盖。
- A 股始终尝试两个 provider（首选 + 回退），顺序由 `selected` 参数决定。
- US/HK 不尝试 AKShare/Tushare。
- `Financial Datasets` 对 `US` 自动，但对 `HK` 不自动。

### 3.3 `fetchLiveBars()` 优先级

此路径由 Overview 面板使用，有意避免缓存读写。

1. 调用 `pullBarsFromProviders(...)`
2. 过滤到请求的日期窗口
3. 如果请求窗口为空但 provider 返回了更早的数据：
   - 不受日期限制地重新拉取
   - 返回最新可用数据和 `asOfDate`

最后一步是 Overview 不再因本地时钟领先于 provider 最新交易日而显示错误的"暂无数据"的原因。

## 4. Agent loop 注入路径

有两个注入层：工具注册和 prompt/context 注入。

### 4.1 工具注册

文件：

- `src/tools/data-tools.ts`
- `src/source/index.ts`
- `src/source/src/*.ts`

流程：

1. `DATA_TOOLS` 注册：
   - `fetch_bars`
   - `search_symbols`
   - `fetch_snapshot`
2. 这些工具 handler 调用 source 模块导出：
   - `fetchBars(...)` — 支持 `source: "akshare" | "tushare"`
   - `searchSymbols(...)`
   - `fetchTushareSnapshot(...)`
   - `fetchFinancialDatasetsSnapshot(...)`
3. source orchestrator 调度到具体的 provider

### 4.2 Prompt 注入

文件：`src/agent/src/context.ts`

`BASE_SYSTEM_PROMPT` 告知模型：

- `fetch_bars` 是本地行情数据工具
- `search_symbols` 是 symbol 查找工具
- `fetch_snapshot` 是紧凑 symbol 快照工具

`buildSystemPrompt(...)` 同时注入缓存的 symbol 清单，使模型在决定是否重新获取之前看到本地已有数据。

### 4.3 运行时事件路径

主要运行时流程：

1. 用户在 TUI 中输入自然语言
2. `src/app-runtime.ts` 调用 `dispatchUserMessage(...)`
3. agent loop 在 harness facade 内运行
4. 模型选择工具调用，如 `fetch_bars`
5. `src/tools/data-tools.ts` 执行
6. `src/source/index.ts` 路由到 `sources.ts`
7. provider adapter 返回标准化的 `Bar[]`
8. 工具结果发送回 harness event stream
9. TUI 渲染工具行、结果文本和 Overview source attribution

### 4.4 Overview 注入

右侧 Overview 面板不来自 agent 工具文本。它直接使用 source 模块：

1. `AppRuntime.refreshMarketPanel()`
2. `fetchQuoteBars(...)`
3. `fetchLiveBars(...)`
4. `buildSourceSection(...)`

这就是为什么即使 agent 本身没有显式叙述 provider，仍可以显示如 `AKShare · 东方财富 + Tushare` 这样的数据源归属。

## 5. 测试覆盖

模块测试现已覆盖每个配置的 source adapter：

- `src/source/tests/akshare.test.ts`
- `src/source/tests/tushare.test.ts`
- `src/source/tests/financial-datasets.test.ts`
- `src/source/tests/llmquant.test.ts`
- `src/source/tests/sources.test.ts`

覆盖意图：

- adapter payload 标准化
- snapshot 映射
- provider fallback order
- 实时获取空窗口回退
- source attribution 格式化

## 6. 维护规则

1. 在 `src/source/src/` 下添加新 provider。
2. 仅通过 `src/source/index.ts` 导出。
3. 当端点形态或优先级变化时更新本文档。
4. 添加一个 adapter 测试文件和至少一个编排回归测试。

---

## 7. Financial Datasets API 速记

数据层整合 open-source data 和第三方 API，包括 Yahoo Finance、SEC EDGAR 等，适合做结构化美股研究。

核心工具分组：

- 公司 / 财报 / 指标：`get_company_facts`, `get_earnings`, `get_financial_metrics`, `get_financial_metrics_snapshot`
- 三大报表 / 分部：`get_income_statement`, `get_balance_sheet`, `get_cash_flow_statement`, `get_segmented_financials`
- 持仓 / 内部人：`get_institutional_investors`, `get_institutional_holdings`, `get_insider_trades`
- 市场 / 新闻 / 利率：`get_stock_prices`, `get_stock_price`, `get_news`, `get_interest_rates`
- 披露 / KPI / 筛选：`get_filings`, `get_filing_items`, `list_filing_item_types`, `get_kpi_*`, `screen_stocks`

---

## 8. 外部数据源参考

以下为 WhyJ Quant 当前未接入，但在量化生态中常用的数据源，供未来扩展参考。

### 免费

| 名称 | 覆盖 | API 限制 |
|------|------|----------|
| AKShare | A 股/全球 | 无限制（易被反爬） |
| Yahoo Finance | 全球 | 无官方 API |
| FRED | 美国宏观 | 免费 API key |
| Wind 免费版 | A 股宏观 | 功能受限 |
| Tushare Pro | A 股 | 积分制（注册送积分） |
| JQData | A 股/期货/基金/指数/期权/因子/风险模型 | 聚宽 SDK，3 个月试用（申请即开通），覆盖前 15 月~近 3 月历史数据，日流量 100 万条 |

### 付费

| 名称 | 覆盖 | 特点 |
|------|------|------|
| JQData Pro | A 股/期货/基金/宏观 | 聚宽全量数据，年付/月付 |
| Wind 万得 | A 股/全球 | 行业标准，终端最全 |
| Choice 东方财富 | A 股/全球 | Wind 替代品 |
| Bloomberg | 全球 | 华尔街标准 |
| Quandl/Nasdaq Data Link | 全球 | 多源聚合 |
| Polygon.io | 美股 | 实时 + 历史 |
| Tushare Pro | A 股 | 积分越高数据越多 |

### JQData 试用模块清单

`pip install jqdatasdk` → 申请试用 → 3 个月有效期 · 日流量 100 万条 · 覆盖前 15 月~近 3 月

| 类别 | 数据模块 |
|------|---------|
| 沪深 A 股 | 股票列表、交易统计、融资融券、行业概念成分股、市场通(沪/深/港)、集合竞价、多频率分时 |
| 基金 | 交易标的列表、主体信息、投资组合、财务指标、分红、净值及业绩、融资融券、多频率分时 |
| A 股财务 | 单季度/年度财务、报告期财务、上市公司概况(上市信息/员工)、股东股本 |
| 指数 | 交易标的列表、多频率分时、成分股及权重 |
| 期货(商品+金融) | 所有期货信息、主力合约、连续指数、外盘日行情、龙虎榜、仓单、结算价、持仓量、合约信息、多频率分时 |
| 期权(商品+金融) | 所有期权信息、交易和持仓排名、风险指标、行权交收、合约调整、合约资料、每日盘前静态文件、日/周/月历史 |
| 特色因子 | 聚宽因子库、Alpha191、Alpha101、资金流因子 |
| 风险模型 | CNE5、CNE6、重点宽基指数风格暴露、因子分位数收益率 |

---

## 9. Python 量化库

### 数据获取

| 库 | 用途 | 市场 |
|----|------|------|
| [AKShare](https://github.com/akfamily/akshare) | 行情/财务/宏观/另类 | A 股/全球 |
| [Tushare](https://tushare.pro/) | 行情/财务/参考/指数 | A 股 |
| [yfinance](https://github.com/ranaroussi/yfinance) | Yahoo Finance 数据 | 全球 |
| [baostock](http://baostock.com/) | 证券宝 | A 股 |
| [efinance](https://github.com/Micro-sheep/efinance) | 东方财富 | A 股/基金 |
| [JQData](https://www.joinquant.com/help/api/doc?name=JQDatadoc) | 聚宽数据 SDK，行情/财务/指数/期货/基金/宏观/行业 | A 股/期货/基金 |

### 回测框架

| 库 | 特点 | 适用场景 |
|----|------|----------|
| [backtrader](https://github.com/mementum/backtrader) | 事件驱动、功能全面 | 复杂策略、多资产 |
| [vectorbt](https://github.com/polakowo/vectorbt) | 向量化、速度快 | 因子回测、参数优化 |
| [zipline-reloaded](https://github.com/stefan-jansen/zipline-reloaded) | Quantopian 继任者 | Pipeline 风格研究 |
| [vnpy](https://github.com/vnpy/vnpy) | 全栈量化平台 | A 股/期货实盘 |
| [Backtesting.py](https://github.com/kernc/backtesting.py) | 轻量交互 | 快速原型 |

### 因子分析

| 库 | 用途 |
|----|------|
| [alphalens](https://github.com/stefan-jansen/alphalens-reloaded) | 因子 IC/分层/换手分析 |
| [empyrical](https://github.com/stefan-jansen/empyrical-reloaded) | 风险/绩效指标计算 |
| [pyfolio](https://github.com/quantopian/pyfolio-reloaded) | 组合绩效 + 风险 tear sheet |

### 组合优化

| 库 | 用途 |
|----|------|
| [PyPortfolioOpt](https://github.com/robertmartin8/PyPortfolioOpt) | 均值-方差 / 风险平价 / 最大夏普 |
| [riskfolio-lib](https://github.com/dcajasn/Riskfolio-Lib) | 多层次组合优化 |
| [cvxpy](https://github.com/cvxpy/cvxpy) | 凸优化通用库 |

### 机器学习

| 库 | 用途 |
|----|------|
| [qlib](https://github.com/microsoft/qlib) | 微软量化 AI 平台 |
| [FinRL](https://github.com/AI4Finance-Foundation/FinRL) | 深度强化学习交易 |
| [FinGPT](https://github.com/AI4Finance-Foundation/FinGPT) | 金融 LLM |

---

## 10. API Reference（外部库）

### AKShare (A 股行情)

```python
import akshare as ak

# 日线
df = ak.stock_zh_a_hist(symbol="000001", period="daily", start_date="20240101", end_date="20241231", adjust="qfq")
# 分钟线 (1/5/15/30/60)
df = ak.stock_zh_a_hist_min_em(symbol="000001", period="60", adjust="qfq")
# 指数成分
df = ak.index_stock_cons(symbol="000300")
# 行业分类
df = ak.stock_board_industry_name_em()
# 财务报表
df = ak.stock_financial_report_sina(stock="000001", symbol="资产负债表")
# 估值指标
df = ak.stock_a_lg_indicator(symbol="000001")
```

### yfinance (美股/全球)

```python
import yfinance as yf

df = yf.download("AAPL", start="2024-01-01", end="2024-12-31")
# 多股票
df = yf.download(["AAPL","MSFT","GOOG"], start="2024-01-01")
# A 股 (Shenzhen=\.SZ, Shanghai=\.SS)
df = yf.download("000001.SZ", start="2024-01-01")
```

### JQData (聚宽 SDK)

当前项目已不再内置 JQData 封装；以下内容仅作为外部参考。

```python
from jqdatasdk import auth, get_price, get_query_count, logout, get_all_securities, get_index_weights, get_valuation, get_fundamentals, query, valuation, income, balance, get_all_alpha_101, get_all_alpha_191

auth('手机号', '密码')
# 日线/分钟线
df = get_price('000001.XSHE', start_date='2024-01-01', end_date='2024-12-31', frequency='daily', fields=['open','close','high','low','volume'], fq='pre')
# 指数权重
df = get_index_weights('000300.XSHG', date='2024-12-31')
# 估值
df = get_valuation('000001.XSHE', start_date='2024-01-01', end_date='2024-12-31')
# 财务 (单季度)
q = query(valuation, income, balance).filter(valuation.code=='000001.XSHE', balance.stat_date=='2024q4', income.stat_date=='2024q4')
df = get_fundamentals(q, stat_date='2024q4')
# Alpha 因子
df = get_all_alpha_101(stocks)  # 101 Formulaic Alphas
df = get_all_alpha_191(stocks)  # GTJA 191
# 流量查询
get_query_count()  # {'total': 1000000, 'spare': 996927}
logout()
```

### Tushare

```python
import tushare as ts
ts.set_token('YOUR_TOKEN')
pro = ts.pro_api()

df = pro.daily(ts_code='000001.SZ', start_date='20240101', end_date='20241231')
df = pro.daily_basic(ts_code='000001.SZ', start_date='20240101')  # 每日指标(PE/PB)
df = pro.income(ts_code='000001.SZ', period='20241231')           # 利润表
df = pro.balancesheet(ts_code='000001.SZ', period='20241231')     # 资产负债表
df = pro.index_weight(index_code='000300.SH', start_date='20240101')
```

### Financial Datasets

```python
# Claude Code 中直接调用数据工具名，无需 import

# 公司信息
get_company_facts(ticker="AAPL")                          # → company_name, sector, CIK, exchange
# 股价
get_stock_prices(ticker="AAPL", start_date="2024-01-01", end_date="2024-12-31")
get_stock_price(ticker="AAPL")                            # 最新快照
# 财报
get_income_statement(ticker="AAPL", period="annual", limit=4)
get_balance_sheet(ticker="AAPL", period="quarterly", limit=4)
get_cash_flow_statement(ticker="AAPL", period="ttm")
# 估值
get_financial_metrics_snapshot(ticker="AAPL")             # PE/PB/PS/ROE/市值
get_financial_metrics(ticker="AAPL", period="annual", limit=4)
# 机构持仓 (13F)
get_institutional_holdings(ticker="AAPL", limit=10)
get_institutional_investors(name="Berkshire")
# 内部交易
get_insider_trades(ticker="AAPL", limit=20)
# SEC 文件
get_filings(ticker="AAPL", filing_type="10-K", limit=5)
get_filing_items(ticker="AAPL", filing_type="10-K", year=2024, item=["Item-1","Item-7"])
# 利率
get_interest_rates()
# 新闻
get_news(ticker="AAPL")
# 选股筛选
list_stock_screener_filters()
screen_stocks(filters=[{"field":"pe_ratio","operator":"lt","value":20},{"field":"sector","operator":"eq","value":"Technology"}])
```
