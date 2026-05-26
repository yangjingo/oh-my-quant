---
name: quant-reference
description: 量化金融资源索引 — MCP servers、Agent Skills、Python 库、AI Trading 平台、数据源、学习资料
---

# Quant 资源索引 (reference.md)

## MCP Servers

### 市场数据

| Server | 覆盖 | 特点 |
|--------|------|------|
| [LLMQuant Data](https://docs.llmquantdata.com/en/introduction) / [data-mcp](https://github.com/LLMQuant/data-mcp) | 美股/加密/宏观/SEC/13F/量化知识 | 50,000+ Quant Wiki、1,200+ 论文摘要、30+ 年美股 OHLCV、13F Top 1,000 机构，支持 MCP + REST API |
| [Financial Datasets](https://www.financialdatasets.ai/) | 美股 + 加密 | 公司信息、财报、估值、13F、新闻、利率、KPI、筛选器；底层整合 Yahoo Finance、SEC EDGAR 等开放与第三方数据源 |
| [guangxiangdebizi/FinanceMCP](https://github.com/guangxiangdebizi/FinanceMCP) | A 股/加密 | Tushare + Binance |
| [zwldarren/akshare-one-mcp](https://github.com/zwldarren/akshare-one-mcp) | A 股 | AKShare MCP 封装 |
| [Alex2Yang97/yahoo-finance-mcp](https://github.com/Alex2Yang97/yahoo-finance-mcp) | 全球 | Yahoo Finance |
| [massive-com/mcp_massive](https://github.com/massive-com/mcp_massive) | 美股 | Polygon.io 官方 MCP |
| [stefanoamorelli/sec-edgar-mcp](https://github.com/stefanoamorelli/sec-edgar-mcp) | 美股 | SEC 文件阅读 |
| [6551Team/opennews-mcp](https://github.com/6551Team/opennews-mcp) | 全球 | 84+ 新闻源 AI 评分 |

### 券商 / 交易执行

| Server | 覆盖 | 特点 |
|--------|------|------|
| [alpacahq/alpaca-mcp-server](https://github.com/alpacahq/alpaca-mcp-server) | 美股 ETF/期权/加密 | Alpaca 官方 |
| [krakenfx/kraken-cli](https://github.com/krakenfx/kraken-cli) | 加密 | Kraken AI 原生 CLI + MCP |
| [okx/agent-trade-kit](https://github.com/okx/agent-trade-kit) | 加密 现货/永续/期货/期权 | OKX 官方 |
| [rcontesti/IB_MCP](https://github.com/rcontesti/IB_MCP) | 全球 | Interactive Brokers |
| [ariadng/metatrader-mcp-server](https://github.com/ariadng/metatrader-mcp-server) | 外汇/期货 | MT5 MCP |

### 研究 / 分析

| Server | 覆盖 | 特点 |
|--------|------|------|
| [wshobson/maverick-mcp](https://github.com/wshobson/maverick-mcp) | 美股 | 基本面 + 技术面 + 筛选 |
| [atilaahmettaner/tradingview-mcp](https://github.com/atilaahmettaner/tradingview-mcp) | 多市场 | 30+ 工具, 6 回测策略 |
| [guangxiangdebizi/TradingAgents-MCPmode](https://github.com/guangxiangdebizi/TradingAgents-MCPmode) | 多市场 | TradingAgents MCP 化 |
| [QuantMLResearch/AI-Kline](https://github.com/QuantMLResearch/AI-Kline) | 多市场 | 技术分析 + AI 预测 |

### 回测平台

| Server | 覆盖 | 特点 |
|--------|------|------|
| [taylorwilsdon/quantconnect-mcp](https://github.com/taylorwilsdon/quantconnect-mcp) | 全球 | QuantConnect MCP |
| [whchien/ai-trader](https://github.com/whchien/ai-trader) | 多市场 | Backtrader + MCP |

---

### Financial Datasets MCP 速记

- 连接（Claude Code）:
  - `claude mcp add --transport http financial-datasets https://mcp.financialdatasets.ai/`
  - 输入 `/mcp` 并在浏览器完成 OAuth
  - 用 `claude mcp list` 验证连接
- 数据层：整合 open-source data 和第三方 API，包括 Yahoo Finance、SEC EDGAR 等，适合做结构化美股研究
- 核心工具分组：
  - 公司 / 财报 / 指标：`get_company_facts`, `get_earnings`, `get_financial_metrics`, `get_financial_metrics_snapshot`
  - 三大报表 / 分部：`get_income_statement`, `get_balance_sheet`, `get_cash_flow_statement`, `get_segmented_financials`
  - 持仓 / 内部人：`get_institutional_investors`, `get_institutional_holdings`, `get_insider_trades`
  - 市场 / 新闻 / 利率：`get_stock_prices`, `get_stock_price`, `get_news`, `get_interest_rates`
  - 披露 / KPI / 筛选：`get_filings`, `get_filing_items`, `list_filing_item_types`, `get_kpi_*`, `screen_stocks`

---

## Agent Skills

### 股票研究
- [tradermonty/claude-trading-skills](https://github.com/tradermonty/claude-trading-skills) — 美股全覆盖：市场状态、筛选、期权、Alpaca 组合管理
- [himself65/finance-skills](https://github.com/himself65/finance-skills) — 多资产类别：估值、财报、期权、ETF、流动性
- [JoelLewis/finance_skills](https://github.com/JoelLewis/finance_skills) — 84 个 skills：投管/合规/顾问/交易
- [quant-sentiment-ai/claude-equity-research](https://github.com/quant-sentiment-ai/claude-equity-research) — 买入/卖出/持有报告

### 策略编码 / 回测
- [marketcalls/vectorbt-backtesting-skills](https://github.com/marketcalls/vectorbt-backtesting-skills) — vectorbt 配置、优化、对比模板
- [staskh/trading_skills](https://github.com/staskh/trading_skills) — 期权交易 + IBKR/Alpaca MCP 配对

### 加密 / DeFi
- [okx/onchainos-skills](https://github.com/okx/onchainos-skills) — 钱包、代币发现、DEX 互换
- [okx/agent-skills](https://github.com/okx/agent-skills) — 双语 skills + 贡献/安全指南

---

## Python 量化库

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

## AI Trading 平台

### 自主交易 Agent
- [nof1.ai](https://nof1.ai/) — AI 自主交易 agent，实盘驱动，TypeScript 实现。开源复刻：[OpenNof1](https://github.com/OpenNof1)、[alpha-arena-okx](https://github.com/alpha-arena-okx)
- [TradingAgents](https://github.com/TauricResearch/TradingAgents) — 最受欢迎的 LangGraph 多 agent 框架，含 A 股本地化版本
- [ai-hedge-fund](https://github.com/virattt/ai-hedge-fund) — 多人格分析师（Buffett/Munger/Cathie Wood）
- [AI-Trader](https://github.com/HKUDS/AI-Trader) — agent 原生交易平台，通过 SKILL.md 注册。18.7k stars。论文 [2512.10971](https://arxiv.org/abs/2512.10971)：首个全自动实时金融 agent 评测基准，覆盖美股/A 股/加密三大市场。核心发现：通用智能 ≠ 交易能力，风控能力决定跨市场鲁棒性，高流动性市场比政策驱动型市场更容易获得超额收益
- [Vibe-Trading](https://github.com/HKUDS/Vibe-Trading) — 开源量化研究 workspace，自然语言→回测，452 alpha zoo（qlib158/alpha101/gtja191/academic），7 回测引擎，MCP server。CLI: `vibe-trading run -p "..."`, `vibe-trading alpha bench --zoo gtja191`。PyPI: `vibe-trading-ai`
- [INVESTORBENCH](https://github.com/felis33/INVESTOR-BENCH) — ACL 2025 论文 [2412.18174](https://arxiv.org/abs/2412.18174)：首个面向 LLM agent 的金融决策评测基准，覆盖股票(BTC/ETH/美股/ETF)，FinMem agent 架构，Qdrant+RAG 记忆。评测 13 个 LLM，包含 warmup→test→eval 三阶段流程
- [FinRobot](https://github.com/AI4Finance-Foundation/FinRobot) — 学术级开源金融 AI agent 平台

### 量化平台
- [QuantConnect](https://www.quantconnect.com/) — 云端回测 + 实盘，LEAN 引擎
- [BigQuant](https://bigquant.com/) — AI 驱动的国内量化平台
- [聚宽 (JoinQuant)](https://www.joinquant.com/) — 国内最流行的在线量化平台之一
- [米筐 (RiceQuant)](https://www.ricequant.com/) — 专业级量化投研平台

---

## 数据源

### 免费
| 名称 | 覆盖 | API 限制 |
|------|------|----------|
| AKShare | A 股/全球 | 无限制（易被反爬） |
| Yahoo Finance | 全球 | 无官方 API |
| FRED | 美国宏观 | 免费 API key |
| Wind 免费版 | A 股宏观 | 功能受限 |
| TuShare Pro | A 股 | 积分制（注册送积分） |
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

## API Reference

### AKShare (A 股行情)

本项目的统一封装：`from skills.datasource.scripts.akshare import daily, minute, index_cons`

| 函数 | 说明 |
|------|------|
| `daily(symbol, start, end, period, adjust)` | A 股日线 (前复权) |
| `minute(symbol, period)` | A 股分钟线 |
| `index_cons(index_code)` | 指数成分股 |

原始 AKShare API:

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

本项目的统一封装：`from skills.datasource.scripts.yfinance import daily, multi`

| 函数 | 说明 |
|------|------|
| `daily(ticker, start, end)` | 美股日线 |
| `multi(tickers, start, end)` | 批量美股日线 |

原始 yfinance API:

```python
import yfinance as yf

df = yf.download("AAPL", start="2024-01-01", end="2024-12-31")
# 多股票
df = yf.download(["AAPL","MSFT","GOOG"], start="2024-01-01")
# A 股 (Shenzhen=\.SZ, Shanghai=\.SS)
df = yf.download("000001.SZ", start="2024-01-01")
```

### JQData (聚宽 SDK)

本项目的统一封装：`from skills.datasource.scripts.jqdata import daily, valuation, financial, financials_multi, index_weights, alpha101, alpha191, futures_info, query_count, logout`

| 函数 | 说明 |
|------|------|
| `daily(security, start, end)` | A 股日线 (前复权) |
| `valuation(security, start, end)` | 市值/PE/PB |
| `financial(security, stat_date)` | 单季度财务 |
| `financials_multi(security, quarters)` | 多季度财务 |
| `index_weights(index_code, date)` | 指数成分股权重 |
| `alpha101/191(universe)` | 批量因子计算 |
| `futures_info()` | 期货合约信息 |
| `query_count()` / `logout()` | 流量查询/登出 |

原始 JQData SDK:

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

### Financial Datasets MCP

```python
# Claude Code 中直接调用 MCP 工具名，无需 import

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

---

## 学习资源

### 经典书籍
- 《量化交易——如何建立自己的算法交易事业》(Ernest Chan)
- 《算法交易：制胜策略与原理》(Ernest Chan)
- 《金融计量学——从初级到高级》(Ruey Tsay)
- 《统计套利》(Andrew Pole)
- 《主动投资组合管理》(Grinold & Kahn)
- 《因子投资》(Ang)

### 论文
- [Quantpedia 论文精选](https://quantpedia.com/academic-papers/)
- [SSRN 金融](https://papers.ssrn.com/sol3/DisplayAbstractSearch.cfm)

### 在线课程
- [Coursera: Financial Engineering & Risk Management](https://www.coursera.org/learn/financial-engineering)
- [QuantInsti: EPAT 量化交易课程](https://www.quantinsti.com/epat/)
- [WorldQuant University](https://www.wqu.edu/)

### 社区
- 知乎量化话题
- 聚宽社区
- Quantopian 论坛 (已关闭, 归档可查)
- r/quant Reddit
- [Quantocracy](https://quantocracy.com/) — 量化博客聚合

---

> 欢迎 PR 补充更多资源。遇到链接失效请提 Issue。
