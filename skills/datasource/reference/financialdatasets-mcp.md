# Financial Datasets MCP

## Connection

```bash
claude mcp add --transport http financial-datasets https://mcp.financialdatasets.ai/
# → 浏览器 OAuth 授权 → claude mcp list 验证
```

Get API key: [financialdatasets.ai](https://financialdatasets.ai) → Dashboard

---

## Tools — Company & Price

### `get_company_facts`
公司基本信息快照。
```
get_company_facts(ticker="AAPL")
→ market_cap, employees, sector, industry, exchange, website, SIC codes,
  weighted_avg_shares, ticker change history
```

### `get_stock_price`
最新实时价格快照。
```
get_stock_price(ticker="AAPL")
→ latest price, volume, open, high, low, close
```

### `get_stock_prices`
历史日/周/月 OHLCV。
```
get_stock_prices(ticker="NVDA", start_date="2026-01-01", end_date="2026-05-28", interval="day", interval_multiplier=1)
→ open, high, low, close, volume, adjusted_close, dividend, stock_split
```
- interval: `"second"` / `"minute"` / `"day"` / `"week"` / `"month"` / `"year"`
- interval_multiplier: 1-30

---

## Tools — Financial Statements

### `get_income_statement`
```
get_income_statement(ticker="MSFT", period="annual", limit=4)
→ revenue, gross_profit, operating_income, net_income, eps, ebitda,
  operating_expenses, r&d, sga, interest_expense, income_tax
```
period: `"annual"` / `"quarterly"` / `"ttm"` (trailing twelve months)

### `get_balance_sheet`
```
get_balance_sheet(ticker="AAPL", period="quarterly", limit=8)
→ total_assets, total_liabilities, shareholders_equity,
  current_assets, current_liabilities, cash, debt, goodwill,
  retained_earnings, treasury_stock
```

### `get_cash_flow_statement`
```
get_cash_flow_statement(ticker="GOOGL", period="annual", limit=4)
→ operating_cash_flow, capex, free_cash_flow,
  investing_cash_flow, financing_cash_flow,
  dividends_paid, share_repurchases, debt_issuance
```

### `get_segmented_financials`
按业务段的收入/利润拆分，用于 SOTP 估值。
```
get_segmented_financials(ticker="AMZN", period="annual", limit=4)
→ 各业务段 revenue, operating_income, depreciation, capex
```

---

## Tools — Valuation & Screening

### `get_financial_metrics_snapshot`
当前估值快照。
```
get_financial_metrics_snapshot(ticker="NVDA")
→ pe_ratio, pb_ratio, ps_ratio, ev_to_ebitda, market_cap,
  dividend_yield, earnings_yield, price_to_book, peg_ratio
```

### `get_financial_metrics`
历史估值指标趋势。
```
get_financial_metrics(ticker="AAPL", period="ttm", limit=20)
→ 上述所有估值指标的时序数据
```

### `screen_stocks` / `list_stock_screener_filters`
按条件筛选美股。
```
# 先查可用筛选项
list_stock_screener_filters()
→ 返回所有可用字段和操作符

# 再筛选
screen_stocks(filters=[
  {"field": "market_cap", "operator": "gt", "value": 100000000000},
  {"field": "pe_ratio", "operator": "lt", "value": 25}
], limit=50)
```

---

## Tools — Earnings, Insider & 13F

### `get_earnings`
```
get_earnings(ticker="AAPL")
→ 最近 SEC 财报 (8-K / 10-Q / 10-K): revenue, eps, surprise vs estimates,
  quarterly/annual blocks, filing_url
# 不加 ticker → 全市场最新财报 feed
```

### `get_insider_trades`
```
get_insider_trades(ticker="AAPL", filing_date_gte="2025-01-01", limit=50)
→ insider_name, transaction_type (buy/sell), shares, price, filing_date
```

### `get_institutional_holdings` / `get_institutional_investors`
13F 机构持仓。
```
get_institutional_holdings(ticker="NVDA", limit=20)
→ 哪些机构持有 NVDA

get_institutional_holdings(filer_cik="0001067983", limit=20)
→ 伯克希尔哈撒韦的持仓

get_institutional_investors(name="Berkshire")
→ 搜索机构 CIK
```

---

## Tools — Other

### `get_interest_rates`
全球央行利率。
```
→ FED, ECB, BOE, BOJ 最新政策利率
```

### `get_news`
```
get_news(ticker="TSLA", start_date="2026-05-01", end_date="2026-05-28")
# 不加 ticker → 宏观/市场新闻
```

### `get_filings` / `get_filing_items` / `list_filing_item_types`
SEC 文件原文。
```
get_filings(ticker="META", filing_type="10-K", limit=5)
get_filing_items(ticker="META", filing_type="10-K", year=2025, item=["Item-7", "Item-1A"])
```
