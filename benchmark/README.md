# Benchmark Directory

评测数据和结果存储。

## 目录结构

```
benchmark/
├── data/           # 评测输入数据（价格序列、因子面板、基准收益率）
├── results/        # 评测结果（JSON/CSV，按策略+日期组织）
└── reports/        # 生成的评测报告（Markdown/PDF）
```

## 数据格式

### 评测结果 `benchmark/results/{strategy}_{date}.json`

```json
{
  "strategy": "sma_cross",
  "date": "2026-05-26",
  "symbol": "000001",
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

### 评测输入 `benchmark/data/{name}.parquet`

标准化的 OHLCV 或因子值面板，按 `skills/benchmark/scripts/score.py` 的 evaluate() 输入格式。
