---
name: risk
description: |
  风险管理。触发场景：风险、VaR、风险指标、波动率、最大回撤。
  当前只保留收益序列的风险指标计算。
---

# risk

计算风险指标。

## 工具脚本

- `scripts/risk_metrics.py` — 风险指标计算

## 工作流

### 1. 风险指标
`risk_metrics.metrics(returns, rf=0.02)` 返回:
- annual_vol / downside_vol
- var_95 / var_99 / var_95_parametric
- cvar_95 / cvar_99
- max_drawdown / max_dd_days
- skewness / kurtosis

输出格式: 表格 (指标/数值/评价)

## 风控阈值看板

| 触发条件 | 级别 | 建议动作 |
|----------|------|----------|
| 单日回撤 > 3% | 黄 | 检查市场异动 |
| 单周回撤 > 8% | 橙 | 减仓 50% |
| 累计回撤 > 15% | 红 | 暂停策略 |
| 波动率超 2σ | 黄 | 降低杠杆 |
| 连续亏损 5 笔 | 橙 | 检查失效 |
| VaR 突破 连续 3 天 | 红 | 暂停策略 |

## CLI

```bash
whyj-quant risk check --symbol 000001 --start 20240101 --end 20241231
```
