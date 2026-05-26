---
name: benchmark
description: |
  交易策略基准评测。触发场景：benchmark、评测、对比、排名、baseline、基准测试、策略对比。
  为交易策略/agent 定义标准化评测协议，计算多维度得分（收益/风险/稳健性），与 AI-Trader 基准对齐。
  当用户想对比多个策略、评测 agent 表现、或建立 baseline 时使用。
---

# benchmark

标准化评测交易策略或 AI trading agent。

> **UI rule**: 所有图表、看板、报告必须遵守 [`docs/DESIGN.md`](../docs/DESIGN.md) NewForm 规范。

## 参考基准: AI-Trader

基于 [AI-Trader](https://arxiv.org/abs/2512.10971) 的评测范式：
- **Minimal Information Paradigm**: agent 仅获得最小上下文，需自主搜索/验证/合成信息
- **三大市场**: 美股 / A 股 / 加密货币
- **核心发现**: 通用智能 ≠ 交易能力；风控能力决定跨市场鲁棒性；高流动性市场比政策驱动型市场更容易获得超额收益

## 评测维度

### 1. 收益能力 (Return)
| 指标 | 计算 | 权重 |
|------|------|------|
| 年化收益率 CAGR | `(1+r_mean)^252 - 1` | 20% |
| 超额收益 vs 基准 | CAGR - benchmark_CAGR | 15% |
| 正收益月份占比 | `(月收益 > 0).mean()` | 5% |

### 2. 风险控制 (Risk)
| 指标 | 计算 | 权重 |
|------|------|------|
| 夏普比率 | `(r_mean - rf/252) / r_std * sqrt(252)` | 15% |
| 最大回撤 | `min((cum - running_max) / running_max)` | 15% |
| 卡玛比率 | `CAGR / |max_dd|` | 5% |
| CVaR 95% | 尾部 5% 平均损失 | 5% |

### 3. 稳健性 (Robustness)
| 指标 | 计算 | 权重 |
|------|------|------|
| 样本外/样本内收益比 | `CAGR_os / CAGR_is` | 10% |
| 训练期 vs 测试期夏普衰减 | `1 - sharpe_test/sharpe_train` | 5% |
| 参数敏感度 | 参数扰动 ±20% 后的收益标准差 | 5% |

### 4. 额外加分项
- 跨市场可迁移性: 同一策略在 A 股 + 美股 + 加密都跑通 (+5 分)
- 极端行情表现: 2008/2015/2020/2022 情景下最大回撤 < 20% (+5 分)
- 实盘日志验证: 至少 1 个月 paper trading 记录 (+3 分)

## 计算流程

使用 `scripts/score.py`：

```python
from scripts.score import evaluate

result = evaluate(
    returns,              # 策略日收益
    benchmark_returns,    # 基准日收益
    train_returns=None,   # 训练期收益（如有）
    test_returns=None,    # 测试期收益（如有）
)
# 返回: {"total_score": 0-100, "return_score": XX, "risk_score": XX, "robustness_score": XX}
```

## 评分等级

| 分数 | 评级 | 含义 |
|------|------|------|
| 80-100 | S | 实盘就绪 |
| 60-79 | A | 可实盘，需持续监控 |
| 40-59 | B | 方向正确，需优化 |
| 20-39 | C | 无明显 alpha，需重新设计 |
| 0-19 | D | 随机漫步水平 |

## 与 AI-Trader 的对齐

本 benchmark 与 AI-Trader 评测框架对齐：
- 同样覆盖美股/A 股/加密三大市场
- 同样强调风控能力（权重 40%）高于纯收益（权重 40%）
- 同样关注样本外衰减和参数稳健性
- 输出格式兼容 AI-Trader 的 agent 评分卡

## 可视化模板

### K-line 走势图 (必备)

每个评测标的必须生成交互式 K 线图，用于直观审查策略信号的合理性。

**工具**: `scripts/kline_chart.py` — NewForm 主题 Plotly 蜡烛图

```python
from scripts.kline_chart import make_kline, kline_html

# 生成 K 线 HTML
html = kline_html(symbol="000001", name="平安银行")
# 输出: reports/kline_000001.html
```

**K 线模板包含**:
- OHLC 蜡烛图（涨=薄荷绿 `#39E180`，跌=红 `#E04040`）
- MA5 / MA20 / MA60 均线叠加
- 成交量柱（与蜡烛同色）
- 右侧垂直 legend
- 交互: hover 十字光标、缩放、拖拽平移

**输出路径**: `benchmark/reports/kline_{symbol}.html`

### Dashboard 统计看板

聚合所有评测结果的 HTML 看板。

**工具**: `scripts/dashboard_html.py`

```python
from scripts.dashboard_html import build, collect
df = collect()
html = build(df)
# 输出: reports/dashboard.html
```

## 报告输出

```markdown
## 策略基准评测：{策略名称}

### 综合得分: XX/100 (评级: S/A/B/C/D)

### 收益能力: XX/40
### 风险控制: XX/40
### 稳健性: XX/20
### 加分项: +XX

### 详细指标
| 维度 | 指标 | 值 | 得分 |
|------|------|-----|------|
| 收益 | CAGR | XX% | X/20 |
| ... | | | |

### 可视化
- [K-line 走势图](reports/kline_{symbol}.html)
- [Dashboard 看板](reports/dashboard.html)

### 与基准对比
- AI-Trader 评测中位数: ~35-45 分
- 本策略: XX 分

### 改进建议
- 最高 ROI 改进项
- 最弱维度
```

## Metric 页面调用经验

评测完成后，必须为每个指标生成独立的 metric 页面。每个页面包含定义、公式、使用场景分级、交互图表。

### 生成命令

```bash
# 一次性生成全部 6 个 metric 页面
python benchmark/scripts/metric_pages.py
# → benchmark/metrics/{sharpe,max_dd,win_rate,profit,car_mdd,ulcer}.html
```

### 指标速查

| Metric | 文件 | 核心公式 | 优秀阈值 | 坏阈值 |
|--------|------|----------|---------|--------|
| Sharpe Ratio | `sharpe.html` | (Rp−Rf)/σp | > 2.0 | < 0.5 |
| Max Drawdown | `max_dd.html` | min((V−peak)/peak) | < -10% | > -35% |
| Win Rate | `win_rate.html` | Nwin/Ntotal | 看组合 | 单独看无意义 |
| Profit Factor | `profit.html` | ΣProfit/|ΣLoss| | > 2.0 | < 1.0 |
| CAR/MDD | `car_mdd.html` | CAGR/|MDD| | > 2.0 | < 0.2 |
| Ulcer Index | `ulcer.html` | √(mean(R²)) | < 0.05 | > 0.15 |

### 调用原则

1. **不孤立看任一指标**: 单独一个指标会误导——高夏普可能来自短样本，高胜率可能来自小赢大亏
2. **先看 Calmar + Ulcer**: 回撤控制是生存前提，这两个指标通过才看收益指标
3. **结合交易次数**: 样本 < 30 笔交易时所有指标统计意义不足，标注置信度
4. **滚动窗口看稳定性**: 单一数字不可靠——看 60 日/252 日滚动曲线判断指标是否随时间恶化
5. **与基准横向对比**: 同市场、同期、同品种的被动基准跑一遍，超额才有意义
6. **每个页面独立可分享**: metric HTML 页面自包含（CDN plotly + 内联 CSS），可直接发送或嵌入 Notion
