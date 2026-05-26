# Financial Datasets MCP

## Connection

```bash
claude mcp add --transport http financial-datasets https://mcp.financialdatasets.ai/
# → 浏览器 OAuth 授权 → claude mcp list 验证
```

## Tools

| Group | Tool | Params |
|-------|------|--------|
| Company | `get_company_facts` | `ticker` (or `cik`) |
| Earnings | `get_earnings` | `ticker` (optional) |
| Valuation | `get_financial_metrics_snapshot` | `ticker` |
| Valuation | `get_financial_metrics` | `ticker`, `period`, `limit` |
| Income | `get_income_statement` | `ticker`, `period`, `limit` |
| Balance | `get_balance_sheet` | `ticker`, `period`, `limit` |
| Cash Flow | `get_cash_flow_statement` | `ticker`, `period`, `limit` |
| Insider | `get_insider_trades` | `ticker`, `name`, `filing_date_gte/lte`, `limit` |
| 13F | `get_institutional_holdings` | `ticker` or `filer_cik`, `limit` |
| 13F | `get_institutional_investors` | `name` (prefix) |
| Rates | `get_interest_rates` | — |
| News | `get_news` | `ticker` (optional), `start_date/end_date`, `limit` |
| SEC | `get_filings` | `ticker`, `filing_type`, `limit` |
| SEC | `get_filing_items` | `ticker`, `filing_type`, `year`, `item` |
| SEC | `list_filing_item_types` | — |
| Segment | `get_segmented_financials` | `ticker`, `period`, `limit` |
| Price | `get_stock_prices` | `ticker`, `start_date/end_date`, `interval` |
| Price | `get_stock_price` | `ticker` |
| Screener | `screen_stocks` | `filters[]`, `limit` |
| Screener | `list_stock_screener_filters` | — |
