---
name: quant-reference
description: 量化金融资源索引 — MCP servers、Agent Skills、Python 库、AI Trading 平台、数据源、学习资料
---

# Quant 资源索引 (reference.MD)

## MCP Servers

### 市场数据

| Server | 覆盖 | 特点 |
|--------|------|------|
| [LLMQuant Data](https://docs.llmquantdata.com/en/introduction) / [data-mcp](https://github.com/LLMQuant/data-mcp) | 美股/加密/宏观/SEC/13F/量化知识 | 50,000+ Quant Wiki、1,200+ 论文摘要、30+ 年美股 OHLCV、13F Top 1,000 机构，支持 MCP + REST API |
| [financial-datasets/mcp-server](https://github.com/financial-datasets/mcp-server) | 美股 + 加密 | 基本面 + 新闻 |
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

### 付费
| 名称 | 覆盖 | 特点 |
|------|------|------|
| Wind 万得 | A 股/全球 | 行业标准，终端最全 |
| Choice 东方财富 | A 股/全球 | Wind 替代品 |
| Bloomberg | 全球 | 华尔街标准 |
| Quandl/Nasdaq Data Link | 全球 | 多源聚合 |
| Polygon.io | 美股 | 实时 + 历史 |
| Tushare Pro | A 股 | 积分越高数据越多 |

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
