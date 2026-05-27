---
name: data
description: |
  数据获取与清洗。触发场景：获取数据、下载行情、股票数据、数据清洗、OHLCV、历史行情。
  从 A 股与美股价格源获取行情数据，标准化清洗，作为 CLI 的基础输入。
---

# data

获取金融数据，清洗后缓存。

## 工具脚本

两个运行时脚本：

**`scripts/akshare.py`** — A 股行情:
- `daily(symbol, start, end)` / `minute(symbol, period)` / `index_cons(code)`

**`scripts/yfinance.py`** — 美股行情:
- `daily(ticker, start, end)` / `multi(tickers, start, end)`

## 数据源优先级

**A 股**: yfinance 代码映射 (`000001` -> `000001.SZ`) → AKShare
**美股行情**: yfinance (`pip install yfinance`)
**指数成分**: `ak.index_stock_cons(index_code="000300")` — 沪深 300

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

- 适合：量化研究、SEC / 宏观、Quant Wiki、长历史 OHLCV
- 当前仓库未直接接入 CLI，只保留参考说明

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
