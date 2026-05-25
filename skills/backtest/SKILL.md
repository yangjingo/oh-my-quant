---
name: backtest
description: |
  回测系统。触发场景：回测、backtest、策略测试、绩效评估、策略验证、收益分析、最大回撤、夏普比率、策略表现。
  运行历史回测，生成绩效指标和可视化。支持 backtrader（事件驱动）和 vectorbt（向量化）两种框架。
---

# backtest

回测交易策略，生成绩效报告。

## 流程

1. 解析策略逻辑（标的/频率/入场/出场/仓位/约束）
2. 获取数据 — 调用 `data` skill 或直接 pip install + import akshare/yfinance
3. 选择框架并执行回测
4. 计算绩效指标（使用 `scripts/metrics.py` 中的函数）
5. 生成 matplotlib 图表 + 绩效报告表格

## 框架选择

- **backtrader** — 事件驱动，适合止损/止盈/加仓等复杂逻辑
- **vectorbt** — 向量化，适合批量信号回测和参数扫描
- **简易回测** — 直接用 `scripts/metrics.py::vectorized_backtest()`

## 绩效指标（必须输出）

| 指标 | 函数 |
|------|------|
| 总收益率 / 年化 CAGR | `report()` |
| 年化波动率 | `report()` |
| 夏普比率 | `sharpe()` |
| 索提诺比率 | `sortino()` |
| 卡玛比率 | `calmar()` |
| 最大回撤 + 回撤区间 | `max_drawdown()` / `max_dd_duration()` |
| 胜率 / 盈亏比 | `win_rate()` / `profit_loss_ratio()` |
| 超额收益 vs 基准 | `report(benchmark_returns=...)` |

## 参数默认值

```python
{
    "initial_cash": 100000,
    "commission": 0.0003,    # A 股万三
    "stamp_duty": 0.0005,    # 卖出印花税（沪市）
    "benchmark": "000300",
}
```

## A 股特殊规则

- T+1: 当日买入次日才能卖出
- 涨跌停: 主板 ±10%，科/创 ±20%，北交所 ±30%
- 前复权数据 (adjust="qfq")
- 停牌日: volume=0, OHLC 用前一日收盘价填充

## 图表

1. 权益曲线（策略 vs 基准，标注最大回撤区间）
2. 回撤曲线
3. 月度收益热力图
4. 单笔交易盈亏散点图

中文字体: `plt.rcParams['font.sans-serif'] = ['SimHei', 'WenQuanYi Micro Hei', 'Microsoft YaHei']`

## 报告输出格式

```
## 回测报告：{策略名称}

### 策略概述

### 绩效摘要
| 指标 | 策略 | 基准 |
|------|------|------|
| ... | | |

### 关键发现
- 优势 (2-3)
- 风险 (2-3)
- 改进方向 (2-3)
```

## 常见陷阱（必须避免）

- 前视偏差: 信号只用当时已知数据
- 停牌处理: 停牌期间不产生信号
- 幸存者偏差: 股票池包含已退市股票
- 过拟合: 参数超过 3 个时输出过拟合警告
