---
name: benchmark
description: |
  交易策略基准评测。用于把一条策略收益序列转换成统一评分，并汇总到结果看板。
---

# dashboard

## 做什么

1. 用 `scripts/score.py` 对策略收益打分（三维评分：收益/风险/稳健性）。
2. 用 `scripts/dashboard.py` 汇总 `results/*.json`，生成终端看板。

## 评分入口

```python
from dashboard.scripts.score import evaluate

result = evaluate(
    returns,              # 策略日收益序列
    benchmark_returns,    # 基准日收益序列
    train_returns=None,   # 样本内（用于稳健性评分）
    test_returns=None,    # 样本外（用于稳健性评分）
)
```

返回字段：

| 字段 | 说明 |
|------|------|
| `total_score` | 综合得分 (0-100) |
| `grade` | S(≥80) / A(≥60) / B(≥40) / C(≥20) / D |
| `return_score` | 收益维度 (40分) |
| `risk_score` | 风险维度 (40分) |
| `robustness_score` | 稳健性维度 (20分) |
| `bonus` | 额外加分 (0-3) |
| `details` | cagr, excess_return, sharpe, max_drawdown, calmar, cvar_95 |

## 结果文件格式 (`results/*.json`)

```json
{
  "strategy": "sma_cross_20_60_000001",
  "date": "2026-05-28",
  "symbol": "000001",
  "benchmark_symbol": "510300.SS",
  "window": {"fast": 20, "slow": 60},
  "source": {
    "strategy": {
      "market": "A",
      "fetcher": "akshare.stock_zh_a_hist"
    },
    "benchmark": {
      "market": "A",
      "fetcher": "yfinance (CN mapped)"
    }
  },
  "total_score": 72.5,
  "grade": "A",
  "return_score": 32,
  "risk_score": 28,
  "robustness_score": 12.5,
  "details": {
    "cagr": 0.12,
    "excess_return": 0.05,
    "sharpe": 1.5,
    "max_drawdown": -0.18,
    "calmar": 1.5,
    "cvar_95": -0.03
  }
}
```

### `source` 字段说明

| 路径 | 字段 | 含义 |
|------|------|------|
| `source.strategy.market` | A / US | 策略标的市场 |
| `source.strategy.fetcher` | 具体函数名 | 策略数据实际使用的拉取工具 |
| `source.benchmark.market` | A / US | 基准标的市场 |
| `source.benchmark.fetcher` | 具体函数名 | 基准数据实际使用的拉取工具 |

`fetcher` 可能的值：

| 值 | 数据源 |
|----|--------|
| `akshare.stock_zh_a_hist` | AKShare 直连东方财富 |
| `yfinance (CN mapped)` | 代码映射后通过 yfinance 获取 |
| `yfinance.download` | yfinance 美股日线 |
| `benchmark/data/000001_SZ_daily.csv (local sample)` | 本地样例 CSV (回退) |

## CLI

```bash
whyj-quant benchmark run --symbol 000001 --benchmark-symbol 510300.SS
whyj-quant benchmark dashboard
```

## 看板示例

```
=======================================================
  Benchmark Dashboard
=======================================================
  评测总数: 8
  平均得分: 61.5/100 | 中位数: 60.4/100
  最高得分: 85.2 (gtja191_001)
  平均夏普: 1.17  平均最大回撤: -18.43%

  评级分布:
    S: █ (1)
    A: ███ (3)
    B: ███ (3)
    C: █ (1)
    D:  (0)

  数据源分布:
    akshare.stock_zh_a_hist: 5
    yfinance.download: 2
    unknown: 1

  策略排名 Top 10:
    gtja191_001              85 (S)  sharpe=2.3  dd=-8.00%  [akshare.stock_zh_a_hist]
    low_vol_q1               78 (A)  sharpe=1.8  dd=-12.00% [akshare.stock_zh_a_hist]
    sma_cross_20_60          72 (A)  sharpe=1.5  dd=-18.00% [yfinance.download]
```

## 保留原则

- 不生成 HTML 页面
- `docs/DESIGN.md` 保留为未来 UI 规范
- 所有结果以 JSON 和终端文本为准
