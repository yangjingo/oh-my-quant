# 内置量化工具设计

> 最后更新：2026-06-16

量化分析以内置工具形式暴露给 agent，而非 slash 命令。用户应以自然语言提问；agent 自行决定何时先调用数据工具，再调用对应的量化工具。

## 1. 边界

Slash 命令保留用于本地 UI/session 操作，如 `/help`、`/config`、`/portfolio`、`/resume`、`/compact` 和 `/clear`。

量化工作流为 agent 工具：

| 对话标签 | 工具名 | 用途 |
|--------------------|-----------|---------|
| `Quant.Factor` | `compute_factor` | 计算某个 symbol 的单个技术因子。 |
| `Quant.Backtest` | `run_backtest` | 运行 SMA 双均线策略回测。 |
| `Quant.Risk` | `check_risk` | 计算收益分布和回撤风险指标。 |
| `Quant.Benchmark` | `score_benchmark` | 对策略进行 benchmark 评分并保存结果制品。 |
| `Quant.Dashboard` | `show_dashboard` | 读取已保存的 benchmark 制品并展示排名摘要。 |

TUI 应在 Conversation 面板中使用上述名称渲染这些工具调用，例如：

```text
● Quant.Risk · 000300.SH
  ⎿ 年化波动率 18.42% ...
```

## 2. 数据契约

`compute_factor`、`run_backtest` 和 `check_risk` 需要缓存的日线数据。它们调用 `loadCachedBars(symbol)`，按以下顺序搜索缓存源：

1. `akshare`
2. `tushare`
3. `llmquant-data`
4. `financial-datasets`

如果无缓存数据，工具返回 `DATA_NO_CACHE`，agent 应先调用 `fetch_bars`。推荐的 agent 流程为：

```text
fetch_bars -> Quant.Factor / Quant.Backtest / Quant.Risk
```

`score_benchmark` 有所不同：优先使用缓存数据，否则分别为策略 symbol 和 benchmark symbol 抓取本地数据，对齐日期，评估策略，并写入 benchmark 结果制品。

`show_dashboard` 不抓取行情数据，仅读取 `.ohquant/benchmark/results/*.json`。

## 3. 工具规格

### `compute_factor`

输入：

| 字段 | 必填 | 默认值 | 说明 |
|-------|----------|---------|-------|
| `symbol` | 是 | - | 行情 symbol。 |
| `factor` | 是 | - | 可选值：`momentum`、`reversal`、`volatility`、`volume_ratio`、`rsi`、`sma_deviation`。 |
| `period` | 否 | `20` | 回看窗口。 |

输出文本：

- symbol 和因子窗口
- 缓存来源
- 最新因子值
- 历史均值
- 百分位排名

Details 对象包含 `symbol`、`factor`、`period`、`last`、`mean` 和 `percentile`。

### `run_backtest`

输入：

| 字段 | 必填 | 默认值 | 说明 |
|-------|----------|---------|-------|
| `symbol` | 是 | - | 行情 symbol。 |
| `fast` | 否 | `20` | 快线 SMA 窗口。 |
| `slow` | 否 | `60` | 慢线 SMA 窗口。 |
| `cash` | 否 | `100000` | 初始资金。 |
| `start` | 否 | - | 预留：日期过滤。 |
| `end` | 否 | - | 预留：日期过滤。 |

前置条件：缓存数据至少包含 `slow + 10` 行。

输出文本：

- 总收益率
- CAGR
- Sharpe
- 最大回撤
- 胜率
- 盈亏比

Details 对象包含 `symbol` 和各项报告指标。

### `check_risk`

输入：

| 字段 | 必填 | 默认值 | 说明 |
|-------|----------|---------|-------|
| `symbol` | 是 | - | 行情 symbol。 |
| `start` | 否 | - | 预留：日期过滤。 |
| `end` | 否 | - | 预留：日期过滤。 |

输出文本：

- 年化波动率
- 下行波动率
- 历史 VaR 和参数 VaR 95
- VaR 99
- CVaR 95
- 最大回撤及回撤持续时间
- 偏度和峰度

Details 对象包含 `symbol` 和所有风险指标。

### `score_benchmark`

输入：

| 字段 | 必填 | 默认值 | 说明 |
|-------|----------|---------|-------|
| `symbol` | 是 | - | 策略 symbol。 |
| `benchmark_symbol` | 否 | `000300.SH` | Benchmark symbol。 |
| `fast` | 否 | `20` | 快线 SMA 窗口。 |
| `slow` | 否 | `60` | 慢线 SMA 窗口。 |
| `cash` | 否 | `100000` | 初始资金。 |
| `label` | 否 | `sma_<fast>_<slow>` | 制品策略标签。 |

行为：

1. 推断策略和 benchmark symbol 的市场。
2. 为两个 symbol 抓取本地数据。
3. 按日期对齐数据。
4. 运行 SMA 策略。
5. 将数据拆分为训练/测试窗口用于稳健性评分。
6. 按 100 分制对收益、风险和稳健性进行评分。
7. 保存 JSON 至 `.ohquant/benchmark/results/`。

输出文本包含评级、总分、各维度得分、CAGR、Sharpe、最大回撤和已保存的文件名。

Details 对象包含 `filename` 和 benchmark score 对象。

### `show_dashboard`

输入：

| 字段 | 必填 | 默认值 | 说明 |
|-------|----------|---------|-------|
| `sort_by` | 否 | - | 预留：`score`、`cagr` 或 `sharpe`。当前实现按总分排名。 |

行为：

1. 读取 `.ohquant/benchmark/results/*.json`。
2. 构建 dashboard 行。
3. 计算总评估次数、平均分、中位数分、最佳策略和评级分布。
4. 展示前 10 行。

如无制品存在，工具返回自然语言提示，建议用户先运行 benchmark 分析。

## 4. 存储影响

| 工具 | 读取 | 写入 |
|------|-------|--------|
| `compute_factor` | `.ohquant/data/{source}/{symbol}/` | 无 |
| `run_backtest` | `.ohquant/data/{source}/{symbol}/` | 无 |
| `check_risk` | `.ohquant/data/{source}/{symbol}/` | 无 |
| `score_benchmark` | 优先缓存数据，否则通过 source adapter 获取 | `.ohquant/benchmark/results/*.json` |
| `show_dashboard` | `.ohquant/benchmark/results/*.json` | 无 |

所有本地文件系统活动应发出 storage file event，以便 Conversation tool-call stream 统一展示 READ/WRITE/MKDIR 活动。

## 5. Agent 使用规则

- 不要将这些工具暴露为 slash 命令。
- 量化工作优先使用自然语言。
- 在调用 factor、backtest 或 risk 工具之前，当缓存缺失或过期时先抓取数据。
- 当用户要求策略评分、排名、评级或 benchmark 对比时使用 `score_benchmark`。
- 当用户要求查看已保存的 benchmark 结果或策略排行榜时使用 `show_dashboard`。
- 个人投资组合持仓不得存入 `.ohquant/portfolio/`；portfolio 存储规则与量化工具制品分离。
