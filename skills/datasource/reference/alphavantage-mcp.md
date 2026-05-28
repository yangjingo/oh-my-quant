# Alpha Vantage MCP

## Connection

**方式一 — Claude Desktop / Web (推荐)**
```
Settings → Connectors → Add Custom Connector
MCP URL: https://mcp.alphavantage.co/mcp?apikey=YOUR_API_KEY
```

**方式二 — OAuth**
```
MCP URL: https://mcp.alphavantage.co/mcp
→ 输入 API Key → Authorize Access
```

**方式三 — Claude Code CLI**
```bash
claude mcp add -t http alphavantage https://mcp.alphavantage.co/mcp?apikey=YOUR_API_KEY
```

**方式四 — Claude Desktop (uvx)**
```json
{
  "mcpServers": {
    "alphavantage": {
      "command": "uvx",
      "args": ["marketdata-mcp-server", "YOUR_API_KEY"]
    }
  }
}
```

Get API key: [alphavantage.co/support/#api-key](https://www.alphavantage.co/support/#api-key) (免费，每日 25 次请求)

---

## 核心能力 — 行情 (Time Series)

### 日/周/月线
```
TIME_SERIES_DAILY(symbol="AAPL")
TIME_SERIES_WEEKLY(symbol="MSFT")
TIME_SERIES_MONTHLY(symbol="GOOGL")
→ open, high, low, close, volume (20 年历史)
```

### 日内分时
```
TIME_SERIES_INTRADAY(symbol="IBM", interval="5min", outputsize="compact")
→ 最近 100 根 K 线（compact）或全历史（full）
```
interval: `"1min"` / `"5min"` / `"15min"` / `"30min"` / `"60min"`

### 调整后日线 (含 split/dividend)
```
TIME_SERIES_DAILY_ADJUSTED(symbol="AAPL")
→ 含 adjusted_close, dividend_amount, split_coefficient
```

---

## 核心能力 — 技术指标 (独有差异化能力)

> 这是其他数据源不直接提供的核心能力：无需本地计算，直接获取 SMA/EMA/MACD/RSI 等 30+ 指标的值。

### 移动平均
```
SMA(symbol="AAPL", interval="daily", time_period=20, series_type="close")
EMA(symbol="AAPL", interval="weekly", time_period=50, series_type="close")
WMA(symbol="MSFT", interval="daily", time_period=10)
VWAP(symbol="NVDA", interval="15min")
```

### 动量/趋势
```
MACD(symbol="AAPL", interval="daily", series_type="close")
→ MACD, MACD_Signal, MACD_Hist

RSI(symbol="AAPL", interval="daily", time_period=14, series_type="close")
→ 0-100 超买超卖

STOCH(symbol="MSFT", interval="daily")
→ SlowK, SlowD

CCI(symbol="GOOGL", interval="daily", time_period=20)
ADX(symbol="AAPL", interval="daily", time_period=14)
AROON(symbol="AMZN", interval="daily", time_period=25)
```

### 布林带 / 通道
```
BBANDS(symbol="AAPL", interval="daily", time_period=20)
→ Real Upper Band, Real Middle Band, Real Lower Band
```

### 成交量/波动
```
OBV(symbol="AAPL", interval="daily")       # On Balance Volume
AD(symbol="MSFT", interval="daily")         # Chaikin A/D Line
ATR(symbol="NVDA", interval="daily", time_period=14)
```

### 支撑/阻力
```
SAR(symbol="AAPL", interval="daily")        # Parabolic SAR
HT_PHASOR(symbol="AAPL", interval="daily")  # Hilbert Transform
```

---

## 核心能力 — 基本面

### 公司概况
```
OVERVIEW(symbol="AAPL")
→ market_cap, sector, industry, pe_ratio, dividend_yield,
  EPS, revenue_TTM, profit_margin, quarterly_earnings_growth_YOY
```

### 三大财务报表
```
INCOME_STATEMENT(symbol="AAPL")   → revenue, gross_profit, net_income, EPS
BALANCE_SHEET(symbol="AAPL")      → total_assets, total_liabilities, equity
CASH_FLOW(symbol="AAPL")          → operating/investing/financing cashflow
```
返回最近 5 年年度+季度数据。

### 盈利
```
EARNINGS(symbol="AAPL")
→ annual + quarterly earnings: EPS, revenue, surprise vs estimate
```

---

## 核心能力 — 外汇 & 加密货币

### 外汇 (实时+历史)
```
CURRENCY_EXCHANGE_RATE(from_currency="USD", to_currency="JPY")
FX_DAILY(from_symbol="EUR", to_symbol="USD")
FX_WEEKLY(from_symbol="GBP", to_symbol="USD")
FX_MONTHLY(from_symbol="USD", to_symbol="CNY")
→ 支持 50+ 货币对
```

### 加密货币 (实时+历史)
```
CURRENCY_EXCHANGE_RATE(from_currency="BTC", to_currency="USD")
DIGITAL_CURRENCY_DAILY(symbol="ETH", market="USD")
DIGITAL_CURRENCY_WEEKLY(symbol="BTC", market="CNY")
DIGITAL_CURRENCY_MONTHLY(symbol="LTC", market="USD")
```

---

## 核心能力 — 其他

### 行业板块表现
```
SECTOR() → 美国 11 大行业板块实时表现 (Energy, Tech, Healthcare...)
```

### 搜索/筛选
```
SYMBOL_SEARCH(keywords="Tesla") → 模糊搜索代码
```

### 经济指标
```
TREASURY_YIELD(interval="monthly", maturity="10year")  # 美国国债收益率
FEDERAL_FUNDS_RATE(interval="monthly")                  # 联邦基金利率
REAL_GDP(interval="quarterly")                          # GDP
CPI(interval="monthly")                                 # CPI
UNEMPLOYMENT(interval="monthly")                        # 失业率
```

---

## 限制

- 免费 API Key: 25 requests/day
- Premium API Key: 75 requests/minute
- 历史数据: 日线 20 年+，intraday 受限于 plan tier

## 差异化定位

| 能力 | Alpha Vantage | yfinance | Financial Datasets |
|------|:---:|:---:|:---:|
| 技术指标 (30+) | 唯一 | 需本地计算 | — |
| 外汇 | 唯一 | — | — |
| 行业板块表现 | 唯一 | — | — |
| 基本面 | 最近 5 年 | 有 | 更全 |
| 日内 K 线 | 免费 | 有 | — |
