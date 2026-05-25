---
name: risk
description: |
  风险管理。触发场景：风险、VaR、压力测试、组合优化、仓位管理、风险指标、波动率、最大回撤、归因分析。
  计算风险指标（VaR/CVaR）、压力测试、组合优化、归因分析。
---

# risk

计算风险指标 → 压力测试 → 组合优化 → 归因分析。

## 工具脚本

- `scripts/risk_metrics.py` — 风险指标计算
- `scripts/optimize.py` — 压力测试 + 组合优化

## 工作流

### 1. 风险指标
`risk_metrics.metrics(returns, rf=0.02)` 返回:
- annual_vol / downside_vol
- var_95 / var_99 / var_95_parametric
- cvar_95 / cvar_99
- max_drawdown / max_dd_days
- skewness / kurtosis

输出格式: 表格 (指标/数值/评价)

### 2. 压力测试
`optimize.stress_test(returns, custom_scenarios)`

默认情景: 2008(-70%) / 2015(-45%) / 2018(-30%) / 2020(-10%) / 2022(-20%)

### 3. 组合优化
`optimize.optimize(returns, method, rf)`

方法: `equal_weight` | `min_variance` | `max_sharpe` | `risk_parity`

输出最优权重表 + 优化前后对比

### 4. 归因分析
回归分解: `alpha` + `factor_betas` + `r_squared`

## 风控阈值看板

| 触发条件 | 级别 | 建议动作 |
|----------|------|----------|
| 单日回撤 > 3% | 黄 | 检查市场异动 |
| 单周回撤 > 8% | 橙 | 减仓 50% |
| 累计回撤 > 15% | 红 | 暂停策略 |
| 波动率超 2σ | 黄 | 降低杠杆 |
| 连续亏损 5 笔 | 橙 | 检查失效 |
| VaR 突破 连续 3 天 | 红 | 暂停策略 |
