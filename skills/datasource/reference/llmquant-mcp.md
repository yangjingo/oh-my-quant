# LLMQuant Data MCP

## Connection

```bash
claude mcp add llmquant-data \
  -e LLMQUANT_API_KEY=$LLMQUANT_API_KEY \
  -- npx -y @llmquant/data-mcp
```

Requires `LLMQUANT_API_KEY` env var. Get from [dashboard](https://dashboard.llmquantdata.com) → API Keys.

## Tools

| Tool | What it does | Credits |
|------|-------------|---------|
| `wiki_search` | Semantic search over 50,000+ Quant Wiki entries | 1 |
| `wiki_read` | Load full markdown body of a wiki item by ID | 0 |
| `paper_search` | Semantic search over 1,200+ research paper summaries | 1 |
| `paper_read` | Read specific sections of a paper (intro, methods, conclusion...) | 0 |
| `crypto_historical_klines` | Crypto OHLCV candles (Binance Spot) | 1 |
| `crypto_snapshot` | Latest spot price + 24h stats for a pair | 1 |
| `equity_historical_prices` | US equity daily OHLCV + dividend/split adjustments | 1 |
| `etf_lookup` | ETF basic info + top holdings summary | 0 |
| `etf_holdings` | Full ETF holdings (latest SEC snapshot, sorted by weight) | 1 |
| `macro_indicator_search` | Browse 50+ curated FRED macro indicators | 0 |
| `macro_indicator_history` | Historical observations for a series | 1 |
| `macro_indicator_snapshot` | Latest value for a macro indicator | 1 |
| `sec_filing_browse` | Browse SEC 10-K / 10-Q filing metadata | 0 |
| `sec_filing_read` | Read specific sections of a SEC filing | 1 |
| `sec_13f_list_manager_holdings` | A manager's 13F holdings (Top 1,000 x 4+ quarters) | 1 |
| `sec_13f_list_ticker_holders` | Institutional holders of a ticker (Top 1,000 x 4+ quarters) | 1 |
| `sec_13f_list_top_managers` | Top N smart-money managers ranked by 13F reportable value | 1 |

## Coverage

- **50,000+** Quant Wiki entries (searchable)
- **1,200+** paper summaries
- **30+ years** US equity OHLCV
- **Top 1,000** 13F managers (4+ quarters)
- **50+** FRED macro indicators
- Crypto via Binance Spot (configurable interval)
- ETF holdings + exposure breakdowns
