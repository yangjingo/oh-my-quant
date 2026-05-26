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

**A 股**: AKShare (`pip install akshare`) → Tushare → baostock
**美股行情**: `financial-datasets.get_stock_prices` / `get_stock_price` → yfinance (`pip install yfinance`) → Polygon.io
**美股财报 / 估值 / 新闻 / 13F**: `financial-datasets` MCP → `llmquant-data` MCP → SEC / Yahoo Finance 直连
**指数成分**: `ak.index_stock_cons(index_code="000300")` — 沪深 300

## MCP 数据源

### financial-datasets

- 覆盖：company facts、earnings、financial metrics、三大报表、insider trades、13F institutional holdings、interest rates、KPI、news、SEC filings、segmented financials、stock prices、stock screener
- 连接（Claude Code）:
  - `claude mcp add --transport http financial-datasets https://mcp.financialdatasets.ai/`
  - 然后输入 `/mcp` 完成 OAuth
  - 用 `claude mcp list` 检查连接
- 数据来源：整合开放数据和第三方 API，包括 Yahoo Finance、SEC EDGAR 等，形成更完整的美股基本面与披露数据层

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
