---
name: data
description: |
  数据获取与清洗。触发场景：获取数据、下载行情、股票数据、财务数据、数据清洗、OHLCV、历史行情。
  从 AKShare（A 股）、yfinance（美股）以及结构化 MCP 数据源获取行情和财务数据，标准化清洗，缓存为 parquet。
---

# data

获取金融数据，清洗后缓存。

## 工具脚本

优先使用 `scripts/fetch.py`：
- `fetch_a_stock(symbol, start, end, period, adjust)` — A 股日线
- `fetch_a_minute(symbol, period)` — A 股分钟线
- `fetch_index_cons(index_code)` — 指数成分股
- `fetch_us_stock(ticker, start, end)` — 美股日线
- `cache_get(symbol, source, fetcher, **kwargs)` — 带缓存的获取

## 数据源优先级

**A 股**: AKShare (`pip install akshare`) → Tushare → JQData → baostock
**美股行情**: `financial-datasets.get_stock_prices` / `get_stock_price` → yfinance (`pip install yfinance`) → Polygon.io
**美股财报 / 估值 / 新闻 / 13F**: `financial-datasets` MCP → `llmquant-data` MCP → SEC / Yahoo Finance 直连
**A 股财务 / 指数 / 期货**: JQData (`pip install jqdatasdk`) — 聚宽官方 SDK，需注册账号，覆盖行情/财务/指数/期货/基金/行业/因子
**指数成分**: `ak.index_stock_cons(index_code="000300")` — 沪深 300

## JQData 使用

### 安装与认证

```bash
pip install jqdatasdk
# 升级: pip install -U jqdatasdk
# C++ 组件缺失时: pip install thriftpy2==0.4.20
```

```python
from jqdatasdk import auth, get_query_count, logout

auth('手机号', '密码')  # 聚宽官网登录密码 → 显示 "auth success"

# 查询剩余流量
get_query_count()  # → {'total': 1000000, 'spare': 996927}

# 切换账号前需注销
logout()  # JQData 仅支持 1 个连接数
```

### 试用限制

| 项目 | 试用账号 | 正式账号 |
|------|---------|---------|
| 有效期 | 3 个月 | 12 个月 |
| 日流量 | 100 万条 | 2 亿条 |
| 连接数 | 1 | 3 |
| 历史范围 | 前 15 月~近 3 月 | 不限 |

### 可用数据模块

| 类别 | 内容 |
|------|------|
| 沪深 A 股 | 股票列表、交易统计、融资融券、行业概念、市场通、集合竞价、分时 |
| 基金 | 标的列表、主体信息、投资组合、财务指标、分红、净值、分时 |
| A 股财务 | 单季度/年度财务、报告期财务、上市公司概况、股东股本 |
| 指数 | 标的列表、分时、成分股及权重 |
| 期货 | 合约信息、主力合约、连续指数、龙虎榜、仓单、结算价、持仓量 |
| 期权 | 合约资料、交易排名、风险指标、行权交收、合约调整、日/周/月历史 |
| 因子 | 聚宽因子库、Alpha191、Alpha101、资金流因子 |
| 风险模型 | CNE5、CNE6、宽基指数风格暴露、因子分位数收益率 |

## MCP 数据源

### financial-datasets

- 覆盖：company facts、earnings、financial metrics、三大报表、insider trades、13F institutional holdings、interest rates、KPI、news、SEC filings、segmented financials、stock prices、stock screener
- API Key: 在 `.env` 中设置 `FINANCIAL_DATASETS_KEY=<your_key>`
- 连接（Claude Code MCP）:
  ```
  claude mcp add --transport http financial-datasets https://mcp.financialdatasets.ai/ \
    --header "X-API-KEY: $FINANCIAL_DATASETS_KEY"
  ```
- 可用 MCP 工具:

| 分组 | 工具 |
|------|------|
| 公司信息 | `get_company_facts` — 员工数、行业、交易所等 |
| 财报数据 | `get_earnings`, `get_income_statement`, `get_balance_sheet`, `get_cash_flow_statement` |
| 估值指标 | `get_financial_metrics`, `get_financial_metrics_snapshot` — PE/PS/市值/股息率 |
| 内部交易 | `get_insider_trades` — 高管/董事/大股东买卖 |
| 机构持仓 | `get_institutional_investors`, `get_institutional_holdings` — 13F 持仓 |
| 利率 | `get_interest_rates` — FED/ECB/BOE/BOJ 政策利率 |
| 新闻 | `get_news` — 公司/市场新闻 |
| SEC 文件 | `get_filings`, `get_filing_items`, `list_filing_item_types` — 10-K/10-Q/8-K 提取 |
| 分部分析 | `get_segmented_financials` — 按产品/地区拆分收入 |
| 股价 | `get_stock_prices`, `get_stock_price` — OHLCV 历史 + 快照 |
| 筛选 | `screen_stocks`, `list_stock_screener_filters` — 多条件选股 |
| KPI (Pro) | `get_kpi_guidance`, `get_kpi_metrics`, `get_kpi_non_gaap` — 运营指标 |

- 数据来源：整合 Yahoo Finance、SEC EDGAR 等，形成完整美股基本面与披露数据层

### llmquant-data

- 适合：量化研究、13F Top Managers、SEC / 宏观、Quant Wiki、长历史 OHLCV
- 当用户问顶级基金共识、13F 排名、机构共识加仓时，优先与 `consensus` skill 配合使用

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
