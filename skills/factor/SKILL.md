---
name: factor
description: |
  因子研究。触发场景：因子、alpha、选股、IC 分析、因子测试、因子挖掘、RankIC、分层回测、中性化。
  定义和计算因子，执行 IC 分析、分层回测、因子相关性分析。
---

# factor

定义 → 计算 → 预处理 → IC 分析 → 分层回测 → 相关性分析。

## 工具脚本

- `scripts/compute.py` — 因子计算 + 预处理
- `scripts/analysis.py` — IC 分析 + 分层回测

## 工作流

### 1. 因子定义
提取: 名称、经济逻辑、公式、数据类型（量价/基本面/另类）

### 2. 因子计算
常用因子可直接用 `scripts/compute.py`：
- `momentum(close, n)` / `reversal(close, n)`
- `volatility(close, n)` / `volume_ratio(volume, n)`
- `rsi(close, n)` / `sma_deviation(close, short, long)`

截面批量: `panel.groupby("stock_code").apply(fn)`

### 3. 预处理
`preprocess(series, exposures)` → MAD 去极值 → 行业-市值中性化（可选）→ z-score 标准化

### 4. IC 分析
`ic_summary(factor_panel, forward_returns, periods=[1,5,20])`

判断标准:
- IC Mean > 0.03: 强 | 0.01-0.03: 可用 | < 0.01: 弱
- ICIR > 0.5: 稳定 | < 0.3: 不稳定

### 5. 分层回测
`quantile_test(factor, returns, n_groups=5)` — 检验 Q1 到 Q5 单调性

### 6. 相关性
`factor_corr({"f1": s1, "f2": s2})` — |r|>0.7 高度重叠, <0.3 互补

## 因子速查

动量: `close.pct_change(N)` (20/60/120)
反转: `-close.pct_change(N)` (5/10)
波动: `returns.rolling(N).std()`
量比: `volume / volume.rolling(N).mean()`
价值: BP/EP/SP (财报数据 / 市值)
质量: ROE/毛利率/负债率

## 报告格式

```
## 因子分析：{名称}
### 逻辑
### IC 分析表格 (period / IC Mean / IC Std / ICIR / IC>0)
### 分层回测 (分组收益表 + 多空曲线)
### 结论 (有效性 + 使用建议)
```
