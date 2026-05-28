# LLMQuant Data MCP

## Connection

```bash
claude mcp add llmquant-data \
  -e LLMQUANT_API_KEY=$LLMQUANT_API_KEY \
  -- npx -y @llmquant/data-mcp
```

Get API key: [dashboard.llmquantdata.com](https://dashboard.llmquantdata.com) → API Keys

---

## Tools — Knowledge & Research

### `wiki_search` / `wiki_read`
50,000+ Quant Wiki 语义搜索。
```
wiki_search(query="factor momentum IC decay", topK=5)
→ 返回 wiki item IDs + 摘要

wiki_read(wikiItemId="xxx", maxLength=2000)
→ 加载完整 markdown 正文
```

### `paper_search` / `paper_read`
1,200+ 量化论文知识卡片。
```
paper_search(query="CPO photonic integration valuation model", topK=5)
→ 返回 paperCardId + availableSections

paper_read(paperCardId="xxx", sections=["intro", "methods", "conclusion"])
→ 加载指定章节；sections=["all"] 加载全部
```

---

## Tools — Equity & ETF

### `equity_historical_prices`
美股历史 OHLCV（通过 Yahoo Finance）。
```
equity_historical_prices(ticker="AAPL", start_date="2026-01-01", end_date="2026-05-28", limit=30)
→ open, high, low, close, volume, adjusted_close, dividend, stock_split
```
- limit: 1-200 (与 start_date/end_date 互斥)
- 支持 `^GSPC` (S&P 500) 等指数代码

### `etf_lookup` / `etf_holdings`
ETF 持仓分析（SEC N-PORT 监管数据）。
```
etf_lookup(ticker="SPY")
→ fund_name, issuer, asset_class, expense_ratio, aum, nav,
  top_holdings (up to 10), sector exposure, coverage_status

etf_holdings(ticker="SPY", limit=50, as_of="2025-12-31")
→ 各持仓: ticker, cusip, isin, asset_type, sector, country,
  shares, market_value, weight
```
- coverage_status: full / partial / stale / unsupported
- BlackRock IBIT 和 DRAM 返回 unsupported

---

## Tools — Crypto & Macro

### `crypto_historical_klines`
加密货币 OHLCV（Binance Spot，仅已闭合 K 线）。
```
crypto_historical_klines(ticker="BTC-USD", interval="1d", limit=30)
crypto_historical_klines(ticker="ETH-USD", interval="4h",
  start_time="2026-03-01T00:00:00Z", end_time="2026-04-01T00:00:00Z")
```
- interval: `"1h"` / `"4h"` / `"1d"` / `"1w"`
- limit: 1-200

### `crypto_snapshot`
实时价格快照。
```
crypto_snapshot(ticker="BTC-USD")
→ last_price, 24h_change_pct, 24h_volume
```

### `macro_indicator_search` / `macro_indicator_snapshot` / `macro_indicator_history`
美国宏观指标（50+ 来自 FRED）。
```
macro_indicator_search(q="CPI", category="Inflation")
macro_indicator_search()  # 列出全部

macro_indicator_snapshot(indicator="us.cpi.headline")
→ latest_value, previous_value, delta, pct_change

macro_indicator_history(indicator="us.unemployment_rate", limit=60)
→ 时序观测值
```
常用 indicator: `us.cpi.headline`, `us.unemployment_rate`, `us.rates.fed_funds`, `us.yield.10y`, `us.gdp.real`, `us.pce.core`

---

## Tools — SEC Filings & 13F

### `sec_filing_browse` / `sec_filing_read`
美股 SEC 10-K / 10-Q 原文。
```
sec_filing_browse(ticker="NVDA", filing_type="10-K", limit=10)
→ 返回 accession_number, period_of_report, filing_date

sec_filing_read(ticker="NVDA", filing_type="10-K", year=2025, item="7")
→ MD&A 章节全文
```
10-K items: `"1"`, `"1A"`, `"7"`, `"8"`
10-Q items: `"part1item2"`, `"part2item1a"`

### `sec_13f_list_manager_holdings`
查询特定机构经理的 13F 持仓。
```
sec_13f_list_manager_holdings(manager_name="Berkshire")
sec_13f_list_manager_holdings(manager_cik="1067983", year=2025, quarter=4, limit=200)
→ 持仓列表: cusip, ticker, shares, value_usd, put_call
```
Top 1000 机构覆盖，2013 年起。

### `sec_13f_list_ticker_holders`
查询特定股票的机构持有人。
```
sec_13f_list_ticker_holders(ticker="NVDA", year=2025, quarter=4, limit=100)
→ 持有机构列表: manager_name, value_usd, shares, rank
```

### `sec_13f_list_top_managers`
Top N 机构排名。
```
sec_13f_list_top_managers(limit=30)
→ manager_cik, manager_name, period_rank, reportable_value
```

---

## Coverage Summary

| 数据集 | 规模 |
|--------|------|
| Quant Wiki 条目 | 50,000+ |
| 研究论文卡片 | 1,200+ |
| 美股 OHLCV | 30 年+ |
| 13F 机构 | Top 1,000 (4+ 季度) |
| FRED 宏观指标 | 50+ |
| 加密货币 (Binance) | BTC/ETH 等主流 |
| ETF 持仓 (SEC N-PORT) | 全市场覆盖 |
