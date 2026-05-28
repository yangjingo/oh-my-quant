---
name: jqdata
description: 聚宽 (JoinQuant) 数据源参考 — 因子库、回测、龙虎榜、财务数据
---

# JoinQuant (聚宽)

官网: <https://www.joinquant.com>
SDK: `jqdatasdk` (`pip install jqdatasdk`)
认证: 注册聚宽账号，免费额度每日可调用约 100 万条数据。API key 配置在环境变量 `JQDATA_USER` / `JQDATA_PASS` 中。

## 认证

```python
import jqdatasdk as jq
jq.auth("username", "password")
```

## 核心能力

### 行情

```python
# 日线
df = jq.get_price("000001.XSHE", start_date="2025-01-01", end_date="2025-12-31", frequency="daily")

# 分钟线
df = jq.get_price("000001.XSHE", start_date="2025-01-01", end_date="2025-01-05", frequency="1m")
```

- security 格式: `"000001.XSHE"` (深交所) / `"600000.XSHG"` (上交所)
- frequency: `"daily"` / `"1m"` / `"5m"` / `"15m"` / `"30m"` / `"60m"`
- 支持 fields: `["open", "close", "high", "low", "volume", "money", "factor", "high_limit", "low_limit", "avg", "pre_close", "paused"]`

### 因子 (核心差异化能力)

```python
# 获取因子看板
from jqfactor import get_factor_kanban_values
df = get_factor_kanban_values(universe="hs300", bt_cycle="monthly")

# 批量提取因子值
df = jq.get_factor_values(
    securities=["000001.XSHE", "000002.XSHE"],
    factors=["market_cap", "pe_ratio", "roe", "momentum_1m"],
    start_date="2025-01-01",
    end_date="2025-12-31"
)

# 列出所有可用因子 (200+)
from jqfactor import get_all_factors
factors_df = get_all_factors()
```

常用因子分类:
| 分类 | 示例因子 |
|------|---------|
| 估值 | `market_cap`, `pe_ratio`, `pb_ratio`, `ps_ratio`, `pcf_ratio` |
| 质量 | `roe`, `roa`, `gross_profit_margin`, `net_profit_margin` |
| 成长 | `revenue_growth`, `net_profit_growth`, `operating_profit_growth` |
| 动量 | `momentum_1m`, `momentum_3m`, `momentum_6m`, `momentum_12m` |
| 波动 | `volatility_1m`, `volatility_3m`, `beta`, `turnover_1m` |
| 杠杆 | `debt_to_asset_ratio`, `current_ratio`, `quick_ratio` |
| 技术 | `rsi_14`, `macd`, `boll_up`, `boll_down`, `ma_5`, `ma_20` |

### 财务数据

```python
from jqdata import finance

# 查询 ROE
q = query(
    finance.STK_FINANCIAL_INDICATOR.roe
).filter(
    finance.STK_FINANCIAL_INDICATOR.code == "000001.XSHE"
).order_by(
    finance.STK_FINANCIAL_INDICATOR.stat_date.desc()
).limit(10)

df = finance.run_query(q)
```

### 龙虎榜

```python
df = jq.get_billboard_list(start_date="2025-06-01", end_date="2025-06-30")
```

### 回测

```python
from jqdata import backtest

config = {
    "algorithm_id": "my_algo",
    "start_date": "2020-01-01",
    "end_date": "2025-12-31",
    "universe": ["000300.XSHG"],
    "benchmark": "000300.XSHG",
    "freq": "day"
}
bt = backtest.create_backtest(config)
result = backtest.run_backtest(bt)
```

## 限制

- 每日免费调用量约 100 万条数据
- 部分高级因子和 level2 数据需要付费权限
- 非交易日查询返回空 DataFrame
