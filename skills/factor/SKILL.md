---
name: factor
description: |
  因子研究。触发场景：因子、alpha、选股、因子测试。
  当前只保留单因子计算与预处理。
---

# factor

定义 → 计算 → 预处理。

## 工具脚本

- `scripts/compute.py` — 因子计算 + 预处理

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

## 因子速查

动量: `close.pct_change(N)` (20/60/120)
反转: `-close.pct_change(N)` (5/10)
波动: `returns.rolling(N).std()`
量比: `volume / volume.rolling(N).mean()`
价值: BP/EP/SP (财报数据 / 市值)
质量: ROE/毛利率/负债率

## CLI

```bash
whyj-quant factor analyze --symbol 000001 --factor-name momentum --period 20
```
