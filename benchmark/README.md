# Benchmark

`benchmark/` 包含策略评分和结果看板所需的最小内容。

## 目录

```text
dashboard/
├── data/      # 运行时保留的最小样例数据
├── results/   # 评分结果 JSON
└── scripts/   # score.py / dashboard.py
```

## 结果格式

```json
{
  "strategy": "sma_20_60_000001",
  "date": "2026-05-26",
  "symbol": "000001",
  "benchmark_symbol": "510300.SS",
  "window": {"fast": 20, "slow": 60},
  "source": {
    "strategy": {"market": "A", "fetcher": "akshare.stock_zh_a_hist"},
    "benchmark": {"market": "A", "fetcher": "yfinance (CN mapped)"}
  },
  "total_score": 72.5,
  "grade": "A",
  "return_score": 32,
  "risk_score": 28,
  "robustness_score": 12.5,
  "details": {
    "cagr": 0.12,
    "sharpe": 1.5,
    "max_drawdown": -0.18
  }
}
```
