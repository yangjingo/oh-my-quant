---
name: data
description: |
  数据获取与清洗。触发场景：获取数据、下载行情、股票数据、财务数据、数据清洗、OHLCV、历史行情。
  从 AKShare（A 股）、yfinance（美股）获取行情和财务数据，标准化清洗，缓存为 parquet。
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
**美股**: yfinance (`pip install yfinance`) → Polygon.io → Alpaca
**指数成分**: `ak.index_stock_cons(index_code="000300")` — 沪深 300

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
