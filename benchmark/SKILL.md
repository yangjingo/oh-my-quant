---
name: benchmark
description: |
  交易策略基准评测。用于把一条策略收益序列转换成统一评分，并汇总到结果看板。
---

# benchmark

最小版 benchmark 只做两件事：

1. 用 `scripts/score.py` 对策略收益打分。
2. 用 `scripts/dashboard.py` 汇总 `benchmark/results/*.json`。

## 评分入口

```python
from benchmark.scripts.score import evaluate

result = evaluate(
    returns,
    benchmark_returns,
    train_returns=None,
    test_returns=None,
)
```

返回字段：

- `total_score`
- `grade`
- `return_score`
- `risk_score`
- `robustness_score`
- `details`

## CLI 对应关系

```bash
whyj-quant benchmark run --symbol 000001 --benchmark-symbol 510300.SS
whyj-quant benchmark dashboard
```

## 保留原则

- 不生成 HTML 页面
- 不维护独立设计系统
- 所有结果以 JSON 和终端文本为准
