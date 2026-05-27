---
name: backtest
description: |
  最小回测 skill。用于均线交叉策略回测与绩效统计。
---

# backtest

当前只保留一个最小回测路径：

1. 读取价格序列
2. 生成 `fast/slow` 均线信号
3. 调用 `scripts/metrics.py::vectorized_backtest`
4. 用 `report()` 输出绩效

## 必须输出

- `total_return`
- `cagr`
- `annual_vol`
- `sharpe`
- `sortino`
- `calmar`
- `max_drawdown`
- `max_dd_days`
- `win_rate`
- `pnl_ratio`

## CLI

```bash
whyj-quant backtest run --symbol 000001 --fast 20 --slow 60
```
