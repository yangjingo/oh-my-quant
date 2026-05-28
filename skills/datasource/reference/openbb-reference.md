# OpenBB — 统一金融数据协议

## 定位

OpenBB (Open Data Platform) 不是又一个数据源，而是一个**数据协议层** — 30+ 数据提供商通过统一 API 接入。

```
from openbb import obb
# 换 provider 只需改一个参数，代码不变
obb.equity.price.historical(symbol="AAPL", provider="yfinance")
obb.equity.price.historical(symbol="AAPL", provider="alpha_vantage")
obb.equity.price.historical(symbol="AAPL", provider="polygon")
```

## 安装

```bash
pip install openbb                    # 核心 + 公开数据源
pip install "openbb[all]"             # 全部数据源
pip install openbb-yfinance           # 单独安装 yfinance 适配器
pip install openbb-alpha-vantage      # 单独安装 Alpha Vantage 适配器
pip install openbb-mcp                # MCP Server
```

Python 3.10–3.14

---

## 核心架构

```
obb.{asset_class}.{category}.{function}(symbol, provider, start_date, end_date)
```

总览入口：

```python
>>> obb.equity
/equity
    /calendar        # IPO/财报日历
    /compare         # 多品种对比
    /darkpool        # 暗池数据
    /discovery       # 发现/热门
    /estimates       # 分析师预测
    /fundamental     # 基本面数据
    historical_market_cap
    market_snapshots
    /ownership       # 持股/机构
    /price           # 行情
    profile          # 公司概要
    screener         # 筛选器
    search           # 搜索
    /shorts          # 做空数据
```

---

## 资产类别覆盖

| 类别 | 入口 | 说明 |
|------|------|------|
| 权益 (Equity) | `obb.equity` | 美股/全球股票行情、基本面、持仓 |
| 固收 | `obb.fixedincome` | 国债、公司债 |
| 指数 | `obb.index` | 全球指数 |
| ETF | `obb.etf` | ETF 行情/持仓/基本信息 |
| 外汇 | `obb.forex` | 货币对行情 |
| 加密货币 | `obb.crypto` | BTC/ETH 等 |
| 宏观经济 | `obb.economy` | GDP/CPI/PMI/利率 |
| 技术分析 | `obb.technical` | MA/BB/Donchian 等指标 |
| 新闻 | `obb.news` | 财经新闻 |
| 监管 | `obb.regulators` | SEC/CFTC 等监管数据 |

---

## 常用函数示例

### 行情

```python
# 股票报价
obb.equity.price.quote(symbol="AAPL", provider="yfinance")

# 历史行情
obb.equity.price.historical(symbol="AAPL", start_date="2025-01-01",
    end_date="2025-12-31", provider="yfinance", interval="1d")

# 市场快照
obb.equity.market_snapshots(provider="fmp")
```

### 基本面

```python
obb.equity.fundamental.income(symbol="AAPL", provider="fmp", period="annual", limit=5)
obb.equity.fundamental.balance(symbol="AAPL", provider="fmp", period="annual", limit=5)
obb.equity.fundamental.cash(symbol="AAPL", provider="fmp", period="annual", limit=5)
obb.equity.fundamental.ratios(symbol="AAPL", provider="fmp")
obb.equity.profile(symbol="AAPL", provider="yfinance")
```

### 技术分析

```python
data = obb.equity.price.historical(symbol="AAPL", provider="yfinance")
obb.technical.ma(data=data.results, length=20, ma_type="SMA")
obb.technical.donchian(data=data.results, length=20)
obb.technical.rsi(data=data.results)
obb.technical.macd(data=data.results)
obb.technical.bbands(data=data.results)
# ... 20+ built-in TA functions
```

### ETF / 筛选器

```python
obb.etf.holdings(symbol="SPY", provider="fmp")
obb.etf.search(query="AI", provider="fmp")
obb.equity.screener(provider="fmp", market_cap_more_than=100e9, sector="Technology")
```

---

## 数据提供商 (30+)

### 免费/开源

| Provider | 安装 | API Key | 主要能力 |
|----------|------|---------|---------|
| **yfinance** | built-in | 无需 | 美股行情、基本面 |
| **Alpha Vantage** | `openbb-alpha-vantage` | 免费 | 技术指标、外汇、基本面 |
| **FMP** | `openbb-fmp` | 免费 | 财报、分析师预测、筛选器 |
| **FRED** | built-in | 免费注册 | 美国宏观指标 |
| **SEC** | built-in | 无需 | SEC 文件 |
| **Polygon** | `openbb-polygon` | 免费 | 实时行情、历史 |
| **Tiingo** | `openbb-tiingo` | 免费 | 美股行情 |
| **Nasdaq** | `openbb-nasdaq` | 免费 | 另类数据 |
| **CBOE** | `openbb-cboe` | 无需 | 期权数据 |
| **FINRA** | `openbb-finra` | 无需 | 债券 |
| **Finviz** | `openbb-finviz` | 无需 | 可视化/筛选 |
| **EconDB** | `openbb-econdb` | 免费 | 全球经济 |
| **Seeking Alpha** | `openbb-seeking-alpha` | 无需 | 新闻/研报 |
| **Tradier** | `openbb-tradier` | 免费 | 美股行情/交易 |
| **Fama-French** | `openbb-famafrench` | 无需 | 学术因子 |
| **Biztoc** | `openbb-biztoc` | 免费 | 新闻 |
| **Deribit** | `openbb-deribit` | 无需 | 加密货币期权 |

### 官方机构

| Provider | 数据 |
|----------|------|
| **BLS** | 美国劳工统计 (CPI/就业) |
| **CFTC** | 期货持仓报告 |
| **Congress.gov** | 美国国会立法 |
| **ECB** | 欧洲央行 |
| **Federal Reserve** | 美联储 |
| **IMF** | 国际货币基金组织 |
| **OECD** | 经合组织 |
| **US EIA** | 能源数据 |
| **US Government** | 美国政府公开数据 |

### 付费

Intrinio, Benzinga, TradingEconomics (需付费订阅)

---

## OpenBB × 本项目定位

OpenBB 在本项目中的角色是**统一协议层**，不是替代现有数据源。

```
                    ┌─ AKShare (A股)
                    ├─ BaoStock (A股深度)
from openbb import  ├─ yfinance (美股)        ← 通过 OpenBB 统一调用
      obb ─────────┼─ Alpha Vantage (技术指标) ← 通过 OpenBB 统一调用
                    ├─ FMP (基本面)            ← 通过 OpenBB 统一调用
                    ├─ FRED/SEC/ECB...
                    └─ ...
```

**与已有数据源的关系：**
- AKShare / BaoStock / JoinQuant → A 股主战场，OpenBB 不覆盖
- yfinance → 原来直接调，后续可走 `obb.equity.price.historical(provider="yfinance")`
- Alpha Vantage → 原来直接调 MCP，后续可走 `obb.equity.price.historical(provider="alpha_vantage")`
- FMP / FRED / SEC → OpenBB 新增能力

## MCP Server

```bash
pip install openbb-mcp
# 在 Claude Code 中配置
claude mcp add openbb-mcp
```
