---
name: data
description: |
  数据获取与清洗。触发场景：获取数据、下载行情、股票数据、数据清洗、OHLCV、历史行情。
  从 A 股与美股价格源获取行情数据，标准化清洗，作为 CLI 的基础输入。
---

# data

获取金融数据，清洗后缓存。

## 数据源总览 (9 个)

### Python SDK (本机直连)

| 数据源 | 市场 | 认证 | 安装 | 参考文档 |
|--------|------|------|------|---------|
| **AKShare** | A 股 / 港股 / 期货 / 宏观 | 无需 | `pip install akshare` | [akshare-reference.md](reference/akshare-reference.md) |
| **BaoStock** | A 股深度 (1990+) | 无需 | `pip install baostock` | [baostock-reference.md](reference/baostock-reference.md) |
| **JoinQuant** | A 股全品类 / 因子库 / 回测 | 注册账号 (免费) | `pip install jqdatasdk` | [jqdata-reference.md](reference/jqdata-reference.md) |
| **OpenBB** | 全球 / 30+ 提供商统一协议层 | 按 provider | `pip install openbb` | [openbb-reference.md](reference/openbb-reference.md) |
| **yfinance** | 美股 / 全球 | 无需 | `pip install yfinance` | [yfinance docs](https://ranaroussi.github.io/yfinance/) |

### MCP (通过 Claude Code 调用)

| 数据源 | 市场 | 认证 | 配置 | 参考文档 |
|--------|------|------|------|---------|
| **Tushare** | A 股全品类 | token + 积分 | `claude mcp add ...` | [tushare-mcp.md](reference/tushare-mcp.md) |
| **Financial Datasets** | 美股基本面 / SEC | OAuth | `claude mcp add ...` | [financialdatasets-mcp.md](reference/financialdatasets-mcp.md) |
| **LLMQuant Data** | 美股 Quant Wiki / 13F / 宏观 | API Key | `claude mcp add ...` | [llmquant-mcp.md](reference/llmquant-mcp.md) |
| **Alpha Vantage** | 全球 / 技术指标 / 外汇 / 加密 | API Key (免费) | `claude mcp add -t http alphavantage https://mcp.alphavantage.co/mcp?apikey=KEY` | [alphavantage-mcp.md](reference/alphavantage-mcp.md) |

### 覆盖矩阵

| 数据维度 | AKShare | BaoStock | JoinQuant | OpenBB | yfinance | Alpha Vantage | Tushare MCP | Financial Datasets MCP | LLMQuant MCP |
|----------|:-------:|:--------:|:---------:|:------:|:--------:|:-------------:|:-----------:|:----------------------:|:------------:|
| A 股日/周/月线 | ✅ | ✅ (35年) | ✅ | — | — | — | ✅ | — | — |
| A 股分钟线 | ✅ | ✅ | ✅ | — | — | — | ✅ | — | — |
| 美股日线 | — | — | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 美股日内分时 | — | — | — | ✅ | ✅ | ✅ (1/5/15/30/60min) | — | — | — |
| 指数日线 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| 指数成分 | ✅ | ✅ (HS300/50/500) | ✅ | ✅ | — | — | ✅ | — | — |
| ETF/LOF | ✅ | — | ✅ | ✅ | ✅ | — | ✅ | — | ✅ |
| 公募基金 | ✅ | — | ✅ | — | — | — | ✅ | — | — |
| 可转债 | ✅ | — | ✅ | — | — | — | ✅ | — | — |
| 实时行情 | ✅ | — | ✅ | ✅ | ✅ | ✅ (快照) | — | ✅ (快照) | ✅ (快照) |
| 技术指标 (30+) | — | — | — | ✅ | — | ✅ | — | — | — |
| 财务三大表 | ✅ | ✅ (季频) | ✅ | ✅ | ✅ | ✅ (5年) | ✅ | ✅ | — |
| 杜邦/成长/营运 | — | ✅ | ✅ | — | — | — | ✅ | — | — |
| 分红数据 | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| 业绩预告/快报 | — | ✅ | ✅ | — | — | — | ✅ | — | — |
| 资金流向 | ✅ | — | ✅ | — | — | — | ✅ | — | — |
| 融资融券 | — | — | ✅ | — | — | — | ✅ | — | — |
| 龙虎榜 | — | — | ✅ | — | — | — | ✅ | — | — |
| 股东增减持 | — | — | ✅ | — | — | — | ✅ | — | — |
| 因子库 (200+) | — | — | ✅ | — | — | — | — | — | — |
| 回测引擎 | — | — | ✅ | — | — | — | — | — | — |
| 外汇 (50+ 货币对) | — | — | — | ✅ | — | ✅ | — | — | — |
| 行业板块表现 | — | — | — | ✅ | — | ✅ | — | — | — |
| 股票筛选器 | — | — | — | ✅ | — | — | — | ✅ | — |
| 13F 机构持仓 | — | — | — | — | — | — | — | ✅ | ✅ |
| 内部交易 | — | — | — | ✅ | — | — | — | ✅ | — |
| 分析师评级/目标价 | — | — | ✅ | ✅ | ✅ | — | — | — | — |
| ESG | — | — | — | ✅ | ✅ | — | — | — | — |
| CPI/PMI/GDP/利率 | ✅ | ✅ (利率) | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ |
| 货币供应量 | ✅ | ✅ | ✅ | ✅ | — | — | ✅ | — | ✅ |
| 新闻 | ✅ | — | — | — | ✅ | — | — | ✅ | — |
| SEC Filing | — | — | — | ✅ | — | — | — | ✅ | ✅ |
| Quant Wiki/论文 | — | — | — | — | — | — | — | — | ✅ |
| 加密货币 | — | — | — | ✅ | — | ✅ | — | — | ✅ |

### 按场景推荐

**重要**: 在满足功能的前提下，优先走 OpenBB 统一协议层（`from openbb import obb`），切换 provider 只需改参数，无需重写代码。

#### 通过 OpenBB 调用（推荐）

| 场景 | obb 路径 | 推荐 provider |
|------|---------|--------------|
| 美股行情 | `obb.equity.price.historical()` | yfinance / alpha_vantage |
| 美股基本面 | `obb.equity.fundamental.income()` | fmp |
| 技术分析 | `obb.technical.ma()` / `.rsi()` / `.macd()` | 内置计算 |
| 外汇 | `obb.forex.price.historical()` | alpha_vantage |
| 宏观经济 | `obb.economy.cpi()` / `.gdp()` | fred |
| ETF | `obb.etf.holdings()` / `.search()` | fmp |
| 筛选器 | `obb.equity.screener()` | fmp |
| SEC 文件 | `obb.regulators.sec()` | sec |

#### 直接调用 (OpenBB 不覆盖)

| 场景 | 首选 | 说明 |
|------|------|------|
| A 股日线回测 | AKShare | 最方便，自动回退 |
| 长期历史回测 (1990+) | **BaoStock** | 唯一有完整早期数据 |
| 实盘盯盘 | AKShare | 唯一支持实时快照 |
| 分钟级策略 | AKShare / BaoStock | 均支持 5/15/30/60 min |
| 深度财务分析 | **BaoStock** | 杜邦/成长/营运指标 |
| 分红/业绩预告 | **BaoStock** | AKShare 不覆盖 |
| 多因子研究 | **JoinQuant** | 聚宽因子库 200+，内置回测 |
| 单因子/IC/IR 分析 | **JoinQuant** | get_factor_values + 回测 |
| 美股日线 | yfinance | 成熟稳定 |
| 美股技术指标 | **Alpha Vantage** | SMA/EMA/MACD/RSI/BBands 30+，无需本地计算 |
| 美股基本面 | Financial Datasets MCP | 专业 SEC 数据 |
| 美股因子研究 | LLMQuant MCP | Quant Wiki + 论文 + 13F |
| 日内分时 (美股) | Alpha Vantage / yfinance | 1/5/15/30/60min |
| 外汇 | **Alpha Vantage** | 50+ 货币对 |
| 行业板块 | **Alpha Vantage** | SECTOR() 美国 11 大板块 |
| 融资融券/龙虎榜 | JoinQuant / Tushare MCP | JQ 免费，Tushare 需 token |
| 港股 | AKShare / Tushare MCP / JoinQuant | — |
| 期货 | AKShare | — |
| 可转债 | AKShare | — |

---

## 工具脚本

### `scripts/akshare.py` — A 股行情 (核心)

| 函数 | 说明 |
|------|------|
| `daily(symbol, start, end, period, adjust)` | A 股历史日线。内置三级回退：yfinance 映射 → AKShare → 本地 CSV |
| `minute(symbol, period)` | A 股分钟线 (1/5/15/30/60)。`period="60"` |
| `index_cons(index_code)` | 指数成分股。`index_code="000300"` 沪深 300 |

### `scripts/akshare_extended.py` — A 股扩展数据

#### 基础信息

| 函数 | 说明 |
|------|------|
| `stock_basic()` | 沪深京 A 股列表 |
| `stock_spot()` | 全市场实时行情快照 (东财) |
| `trade_cal(start, end)` | 交易日历，`start`/`end` 格式 `YYYYMMDD` |

#### 指数

| 函数 | 说明 |
|------|------|
| `index_daily(ts_code, start, end)` | 指数日线。`ts_code="000300"` |
| `index_cons(index_code)` | 指数成分股，同核心脚本 |

#### ETF

| 函数 | 说明 |
|------|------|
| `etf_basic()` | 沪深两市 ETF/LOF 基本信息 |
| `etf_daily(ts_code, start, end)` | ETF 日线。`ts_code="510050"` |

#### 公募基金

| 函数 | 说明 |
|------|------|
| `fund_basic()` | 公募基金列表 (天天基金) |
| `fund_nav(ts_code)` | 基金历史单位净值。`ts_code="000001"` |

#### 可转债

| 函数 | 说明 |
|------|------|
| `cb_basic()` | 可转债列表 (集思录) |
| `cb_daily(ts_code, start, end)` | 可转债日线行情 |

#### 资金流向

| 函数 | 说明 |
|------|------|
| `moneyflow(ts_code)` | 个股资金流向 (东财，近 100 日) |
| `moneyflow_market()` | 大盘资金流向 (东财) |

#### 财务报表

| 函数 | 说明 |
|------|------|
| `fina_indicator(ts_code)` | 财务指标摘要 |
| `fina_balance_sheet(ts_code)` | 资产负债表 (按报告期) |
| `fina_income(ts_code)` | 利润表 (按报告期) |
| `fina_cashflow(ts_code)` | 现金流量表 (按报告期) |

> 财务函数自动为 `ts_code` 添加交易所前缀 (`SZ` 深交所 / `SH` 上交所)。

#### 宏观数据

| 函数 | 说明 |
|------|------|
| `macro_cpi()` | CPI |
| `macro_pmi()` | PMI |
| `macro_money_supply()` | 货币供应量 (M0/M1/M2) |
| `macro_shibor(indicator)` | Shibor。`indicator`: 隔夜/1周/2周/1月/3月/6月/9月/1年 |
| `macro_gdp()` | GDP |

#### 新闻 / 期货

| 函数 | 说明 |
|------|------|
| `news_cctv(date)` | 新闻联播文字稿。`date="20250101"` |
| `futures_daily(ts_code, start, end)` | 期货主力连续日线。`ts_code="AU0"` |

### `scripts/baostock.py` — A 股长期历史 & 深度财务

> 免费、无需 token。日线从 1990 年开始，近 35 年历史。每次调用自动处理 `login()`/`logout()`。

#### K 线

| 函数 | 说明 |
|------|------|
| `daily(symbol, start, end, adjust)` | 日 K 线。adjust: "2"=前复权 |
| `weekly(symbol, start, end, adjust)` | 周 K 线 |
| `monthly(symbol, start, end, adjust)` | 月 K 线 |
| `minute(symbol, freq, start, end)` | 分钟 K 线。freq: "5"/"15"/"30"/"60" |

#### 指数 + 成分股

| 函数 | 说明 |
|------|------|
| `index_daily(index_code, start, end)` | 指数日线。如 `"sh.000300"` |
| `hs300_stocks(date)` | 沪深 300 成分股 |
| `sz50_stocks(date)` | 上证 50 成分股 |
| `zz500_stocks(date)` | 中证 500 成分股 |

#### 基础信息

| 函数 | 说明 |
|------|------|
| `stock_basic(code, code_name)` | 证券基本资料，支持模糊查询 |
| `stock_industry(code, date)` | 行业分类 |
| `trade_dates(start, end)` | 交易日历 |

#### 季频财务 (BaoStock 特色：杜邦分析 + 成长/营运能力)

| 函数 | 说明 |
|------|------|
| `balance_data(code, year, quarter)` | 偿债能力 |
| `profit_data(code, year, quarter)` | 盈利能力 |
| `cash_flow_data(code, year, quarter)` | 现金流量 |
| `dupont_data(code, year, quarter)` | 杜邦指标 |
| `growth_data(code, year, quarter)` | 成长能力 |
| `operation_data(code, year, quarter)` | 营运能力 |

#### 分红 / 业绩预告 / 宏观

| 函数 | 说明 |
|------|------|
| `dividend_data(code, year, year_type)` | 股息分红 |
| `adjust_factor(code, start, end)` | 复权因子 |
| `forecast_report(code, start, end)` | 业绩预告 (2003 年起) |
| `performance_express(code, start, end)` | 业绩快报 (2006 年起) |
| `money_supply(start, end)` | 货币供应量 |
| `deposit_rate(start, end)` | 存款利率 |
| `loan_rate(start, end)` | 贷款利率 |
| `reserve_ratio(start, end, year_type)` | 存款准备金率 |

### `scripts/jqdata.py` — 聚宽因子 & 回测

> 免费注册账号即可使用。聚宽因子库 200+ 因子，支持 get_factor_values 批量提取。
> 每次调用前需 `jqdatasdk.auth("username", "password")`。

#### 行情

| 函数 | 说明 |
|------|------|
| `get_price(security, start, end, frequency)` | A 股日/分钟线。frequency: "daily"/"1m"/"5m"/"30m" |
| `get_bars(security, count, unit)` | 最近 N 根 K 线 |
| `get_index_stocks(index, date)` | 指数成分股 |

#### 因子 (核心差异化能力)

| 函数 | 说明 |
|------|------|
| `get_factor_values(securities, factors, start, end)` | 批量提取因子值。factors: list of factor codes |
| `get_all_factors()` | 获取全部可用因子列表及分类 |
| `get_factor_kanban_values(universe, bt_cycle)` | 因子看板聚合数据 |

> 聚宽常用因子: `market_cap`, `pe_ratio`, `pb_ratio`, `roe`, `roa`, `revenue_growth`, `volume_1m`, `momentum_1m`, `turnover_1m`, `beta`, `volatility_1m`

#### 财务

| 函数 | 说明 |
|------|------|
| `get_fundamentals(query, date)` | 财务数据查询，类 SQL 语法 |
| `get_fundamentals_continuously(query, end, count)` | 多期连续财务 |
| `balance`, `income`, `cashflow` | 三大表对象 |

#### 龙虎榜 / 资金

| 函数 | 说明 |
|------|------|
| `get_billboard_list(start, end)` | 龙虎榜上榜股票列表 |
| `get_money_flow(security, start, end)` | 个股资金流向 |
| `get_mtss(security, start, end)` | 融资融券数据 |

#### 回测

| 函数 | 说明 |
|------|------|
| `create_backtest(config)` | 创建回测实例 |
| `run_backtest(backtest)` | 运行回测并返回结果 |

### `scripts/yfinance.py` — 美股行情

| 函数 | 说明 |
|------|------|
| `daily(ticker, start, end)` | 美股日线。`ticker="AAPL"` |
| `multi(tickers, start, end)` | 批量美股日线。`tickers=["AAPL", "MSFT"]` |

## 数据源优先级

**总体原则**: 凡是 OpenBB 覆盖的场景，优先通过 `from openbb import obb` 统一调用；OpenBB 不覆盖的 A 股/因子/龙虎榜场景，直连具体数据源。

**A 股日线**: AKShare → BaoStock → JoinQuant → 本地 CSV (OpenBB 不覆盖)
**美股行情/基本面**: OpenBB (`obb.equity.price` / `obb.equity.fundamental`) → yfinance 直连
**技术分析**: OpenBB `obb.technical` → Alpha Vantage MCP 直连
**外汇/宏观经济**: OpenBB → Alpha Vantage / FRED
**指数成分**: AKShare `index_stock_cons(symbol="000300")` → BaoStock `hs300_stocks()`
**长期历史回测**: 优先 BaoStock (日线从 1990 年起)
**深度财务**: 优先 BaoStock (杜邦分析、成长/营运能力)
**因子研究**: 优先 JoinQuant (200+ 因子库 + 内置回测引擎)
**龙虎榜/两融**: JoinQuant → Tushare MCP
**ETF**: OpenBB `obb.etf` → AKShare

### 基金数据抓取 (网页源优先)

当 SDK/MCP 不可用或基金净值/阶段收益需要实时值时，按以下优先级：

| 优先级 | 数据源 | URL | 用途 |
|--------|--------|-----|------|
| **1 (主)** | 同花顺 | `fund.10jqka.com.cn/pc/{code}/` | 净值、阶段收益（近1周/1月/3月/6月/今年来/近1年） |
| **2 (补)** | 天天基金 | `fundf10.eastmoney.com/jjjz_{code}.html` | 基金规模、持仓明细、公告 |
| **3 (补)** | 蛋卷基金 | `danjuanfunds.com/funding/{code}` | 收益排行、估值、同类比较 |

**原则**: 同花顺优先获取阶段收益 → 天天基金补规模持仓 → 蛋卷补排行 → 交叉验证后取合理值。

## 数据标准化

所有输出的 DataFrame 必须满足：
- 列名小写: `open, high, low, close, volume`
- date 索引，已排序，无重复
- A 股前复权 (`adjust="qfq"`)
- 缺失 OHLC 前向填充，停牌日 volume=0
- 负收盘价视为复权异常，报警

## 清洗检查清单

1. 日期排序 + 去重
2. 缺失 OHLC: ffill
3. 异常涨跌幅 (>11%): 警告
4. 收盘价 <= 0: 错误，检查复权
5. 停牌日 volume=0 属于正常

## 缓存策略

数据缓存到 `data/cache/`，parquet 格式：
```
data/cache/{source}_{symbol}_{period}.parquet
```

## 测试

```bash
python -m pytest skills/datasource/tests/test_akshare_data.py skills/datasource/tests/test_baostock_data.py -v
```

---

## 基金组合看板

组合管理、收益追踪、看板生成已抽取为独立 skill：**[`skills/portfolio`](../portfolio/SKILL.md)**

```bash
python skills/portfolio/scripts/generate.py
```
