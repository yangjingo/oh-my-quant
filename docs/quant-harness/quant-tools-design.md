# 内置量化工具设计

> 更新：2026-10-13。本页统一维护工具注册、计算方法与证据边界；误判和修正放在[评测博客](../blog/05-evaluation-beyond-green.md)，不保留旧设计或阶段汇编。

量化分析以内置工具形式暴露给 agent，而非 slash 命令。用户应以自然语言提问；agent 选择分析工具。行情类工具负责按运行时契约获取数据，显式加权评分与持仓情景仅使用用户提供的参数；策略基准评分仍需要行情输入。

本页快速入口：[行情与计算工具](#3-工具规格) · [显式评分](#weighted-score) · [持仓情景](#position-scenarios) · [数值稳定性](#numeric-stability)。工具接入见[注册与能力](#registry)，计算细节见[六因子](#factor-methods)与[已收盘价量 API](#price-volume)。

## 1. 边界

Slash 命令保留用于本地 UI/session 操作，如 `/help`、`/config`、`/portfolio`、`/resume`、`/compact` 和 `/clear`。

量化工作流为 agent 工具：

| 对话标签 | 工具名 | 用途 |
|--------------------|-----------|---------|
| `Quant.Factor` | `compute_factor` | 计算某个 symbol 的单个技术因子。 |
| `Quant.Backtest` | `run_backtest` | 运行 SMA 双均线策略回测。 |
| `Quant.Risk` | `check_risk` | 计算收益分布和回撤风险指标。 |
| `Quant.WeightedScore` | `calculate_weighted_score` | 对已给定的 0–100 成分分数和小数权重计算合计、贡献与最大贡献项。 |
| `Quant.PositionScenarios` | `calculate_position_scenarios` | 对显式假设股数、成本、观察价格、币种和变化计算未对冲情景；不读取账户或行情。 |
| `Quant.ArchiveAnalysis` | `analyze_archived_bars` | 用明确日期窗口与应用观察截止前的不可变归档计算因子、SMA 回测或风险。 |
| `Tool.quant.fund.dca` | `fund_dca_backtest` | 基于基金公开 NAV 模拟定投，区分本金收益、TWR 与 XIRR。 |
| `Quant.Benchmark` | `score_benchmark` | 对策略进行 benchmark 评分并保存结果制品。 |
| `Quant.Dashboard` | `show_dashboard` | 读取已保存的 benchmark 制品并展示排名摘要。 |
| `Quant.Portfolios` / `Quant.PortfolioEdit` | `list_portfolios` / `edit_portfolio` | 观察组读取与基于 revision 的用户请求修改。 |
| `Quant.Compare` / `Quant.Comparisons` | `compare_portfolios` / `portfolio_comparisons` | 自动获取价格/NAV/同日汇率，比较两组并保存/重算历史。 |

TUI 应在 Conversation 面板中使用上述名称渲染这些工具调用，例如：

```text
● Quant.Risk · 000300.SH
  ⎿ 年化波动率 18.42% ...
```

## 2. 数据契约

`compute_factor`、`run_backtest`、`check_risk` 和 `score_benchmark` 统一调用 `runtime/data/analysis-data.ts`：

```text
当前研究 → loadAnalysisBars → runtime.fetchBars → 新鲜缓存 / provider / 标记为陈旧的缓存
显式 observed_before → loadAnalysisBars → runtime.fetchBars → 截止前的单次不可变应用观察归档
```

`compute_factor`、`run_backtest`、`check_risk` 默认仍自动刷新；显式给出 `observed_before` 时，必须同时给 `market`、`start`、`end`，可选 `source`，只读取本应用截至该精确 UTC 时刻保存的一个完整响应，不调用当前 provider 或最新缓存 head。没有符合条件的归档、损坏归档及缺足够行分别返回不同错误。报告、任务和恢复用原 DatasetRef 重算指标并核对截止；证据只说明应用观察时间，不证明供应商当时发布、复权或交易日全集。专门的历史读取和 `analyze_archived_bars` 仍提供独立 `local` 能力入口。

无需手工预取数据。工具按当前市场与 source 配置自动抓取，沿用 5 分钟 freshness 和区间覆盖规则，展示实际 provider、origin 和 asOfDate。未给 start 时，取至少 365 个日历日或所需行数的三倍作为回看窗口；给定 end 时从该日期回推。上游有效样本不足时明确返回数据不足，不编造指标。

因子、回测与风险的 start/end 为闭区间；日期必须有效且 start ≤ end。因子 warmup 也在窗口内，不额外加载窗口外观察。因子周期、SMA 参数必须是正整数，fast < slow，cash > 0。Benchmark 将两条序列都限制到共同交易日期，要求训练/测试窗口都有足够数据。

无可用数据且 provider 返回错误时，分析准备保留来源诊断；正常空数据或样本不足使用结构化 `details.error` 返回 DATA_NOT_ENOUGH。研究状态将该结果记录为 failed，保留原原因供续问和同参重试使用，不混同于缺失归档的未核验结果。有效 stale-cache 仍按原策略明确展示。

`show_dashboard` 不抓取行情数据，仅读取 `.ohquant/benchmark/results/*.json`。

## 3. 工具规格

### `compute_factor`

输入：

| 字段 | 必填 | 默认值 | 说明 |
|-------|----------|---------|-------|
| `symbol` | 是 | - | 行情 symbol。 |
| `factor` | 是 | - | 可选值：`momentum`、`reversal`、`volatility`、`volume_ratio`、`rsi`、`sma_deviation`。 |
| `period` | 否 | `20` | 回看窗口。 |
| `start` / `end` | 当前模式否；历史模式是 | 自动回看窗口 | 抓取、计算及核验共用的日期边界；至少 period + 1 个有效观察，sma_deviation 另须满足固定 SMA(5)，即 max(period + 1, 5)。 |
| `market` / `source` / `observed_before` | 当前模式可传匹配代码的 `market`，不传 `source`/截止；历史模式须给 market 和截止 | - | 当前 `market` 只校验身份，数据源仍取配置；历史 `source` 可选，截止必须是精确 UTC 时刻，只读同一旧响应。 |

输出文本：

- symbol 和因子窗口
- 实际数据源、缓存状态和数据日期
- 最新因子值
- 历史均值
- 百分位排名

Details 对象包含 `symbol`、`factor`、`period`、`last`、`mean` 和 `percentile`。

六类因子的窗口、单位、独立数值样本和恢复核验统一见[因子口径](#factor-methods)。

### `run_backtest`

输入：

| 字段 | 必填 | 默认值 | 说明 |
|-------|----------|---------|-------|
| `symbol` | 是 | - | 行情 symbol。 |
| `fast` | 否 | `20` | 快线 SMA 窗口。 |
| `slow` | 否 | `60` | 慢线 SMA 窗口。 |
| `cash` | 否 | `100000` | 初始资金。 |
| `commission` | 否 | `0.0003` | 双向模拟佣金率，非真实券商费率。 |
| `stamp_duty` | 否 | `0` | 卖出方向附加费率，由研究者显式指定。 |
| `start` | 当前模式否；历史模式是 | - | 实际参与抓取和计算的日期边界。 |
| `end` | 当前模式否；历史模式是 | - | 实际参与抓取和计算的日期边界。 |
| `market` / `source` / `observed_before` | 当前模式可传匹配代码的 `market`，不传 `source`/截止；历史模式须给 market 和截止 | - | 当前 `market` 只校验身份，数据源仍取配置；历史 `source` 可选，截止必须是精确 UTC 时刻，只读同一旧响应。 |

前置条件：自动获取的有效数据至少包含 `slow + 10` 行。

输出文本：

- 总收益率
- CAGR
- Sharpe
- 最大回撤
- 上涨期间比例（非交易胜率）
- 平均盈利期间 / 平均亏损期间的收益绝对值之比

Details 包含 `symbol`、报告指标、`dates`、`ledger`（cash/position/trade/cost/equity/returns）和 `assumptions`。前一根信号在下一根收盘成交，允许碎股，无滑点；费用从现金支付，不默认借款。CAGR 按实际日历跨度 / 365.25 复利年化；波动率和 Sharpe 按注明的 252 期间频率。Sharpe 默认年化无风险率 2%，Sortino 默认目标收益 0；下行偏差使用全部期间。无可定义分母时比率为 null，文本展示 N/A。首行现金快照不计入收益期间。独立账本回归见 [backtest-correctness](../../src/quant/test/backtest-correctness.test.ts)。

回测的仓位与现金以逐期账本为准，费用计入资金约束。无整手、滑点和涨跌停成交模型。带日期的回测与基准通过实际日历跨度计算年化；无日期的纯收益调用才使用声明的期间频率。实现见 [回测账本](../../src/quant/backtest.ts) 与 [绩效方法](../../src/quant/performance.ts)，不把旧 252/N 简式作为所有调用的唯一口径。

### `check_risk`

输入：

| 字段 | 必填 | 默认值 | 说明 |
|-------|----------|---------|-------|
| `symbol` | 是 | - | 行情 symbol。 |
| `start` | 当前模式否；历史模式是 | - | 实际参与抓取和计算的日期边界。 |
| `end` | 当前模式否；历史模式是 | - | 实际参与抓取和计算的日期边界。 |
| `market` / `source` / `observed_before` | 当前模式可传匹配代码的 `market`，不传 `source`/截止；历史模式须给 market 和截止 | - | 当前 `market` 只校验身份，数据源仍取配置；历史 `source` 可选，截止必须是精确 UTC 时刻，只读同一旧响应。 |

输出文本：

- 年化波动率
- 下行波动率
- 历史 VaR 和参数 VaR 95
- VaR 99
- CVaR 95
- 最大回撤深度与最长处于回撤中的观察期数分别显示；后者不是最大回撤峰谷段的持续时间，也未校验交易所日历完整性
- 偏度和峰度

Details 对象包含 `symbol` 和所有风险指标。

工具文本和归档报告共用 [风险口径说明](../../src/quant/risk.ts)。波动率和零目标下行偏差按 252 期年化；历史 VaR 是样本低收益分位，CVaR 是该分位及以下收益的均值，两者保留逐期收益符号、不年化，也不表示未来损失上限。最长回撤持续期按连续低于前峰的观察期数计算，不是日历天数或最深回撤的峰谷跨度。模型回答的六项明确数字与当前验收调用绑定；识别范围和复跑方式见 [评测指南](./evaluation.md#tasks)。

### `fund_dca_backtest`

用户直接提出定投研究，例如“按每月 1 日投入 1000，回测 270042.OF 在 2025 年的定投表现”。工具通过 `runtime/data/fund-data.ts` 实时获取 AKShare 单位 NAV，保存不可变公开输入引用，不读取账户持仓或历史 NAV 缓存。

| 字段 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `symbol` | 是 | - | 六位基金代码或 `.OF`；股票交易所后缀拒绝。 |
| `start_date` | 否 | 有效结束日前五年 | YYYY-MM-DD；闰日回推到目标月末。 |
| `end_date` | 否 | 最新 NAV 日期 | 上限为最新观察日期，不在此日期之后申购。 |
| `frequency` | 否 | `monthly` | weekly / biweekly / monthly / quarterly。 |
| `invest_amount` | 否 | `1000` | 每期固定总投入，含申购费，有限且大于 0。 |
| `invest_day` | 否 | `1` | 周频 1–7（周一为 1）；月/季频 1–31，短月按月末。 |
| `purchase_fee_rate` | 否 | 当前公开费率或零费假设 | 显式指定时不请求当前费率；`0` 是明确的零费假设。 |
| `purchase_fee_unit` | 否 | 显式值保留既有自动解释 | 推荐明确 decimal / percent，例如 `0.0013` decimal 与 `0.13` percent 均为 0.13%。 |

未指定 fee unit 时，显式 rate 大于 `0.05` 按百分数，否则按小数；该既有解释会使 `0.03` 被视为 3%，研究调用应显式给单位。AKShare `fund_purchase_em` 字段始终按百分数转换，`0.03` 为 0.03%。`feeBasis` 区分 `explicit-assumption`、`current-published-assumption`、`unavailable-assumed-zero`，当前费率并非历史费率证据。

计划在约定日之后的首个可用 NAV 申购，允许碎份额；净投入 = 总投入 / (1 + 费率)。起点早于首个 NAV 超过 31 天时裁到首日，31 天内保留计划日以支持顺延；终点裁到最新观察。日期必须有效，区间无数据/无计划交易明确报错。只有上游完全空 NAV 时返回 `NAV Rows 0`，不生成伪摘要或复用旧归档。

`methodVersion: 2` 结果含 `dataset`、`feeBasis`、`navCurve`、`latestNav`、`dcaPlan`、`dcaTrades`、`dcaAccountCurve` 和 `dcaSummary`。本金收益率是利润/累计投入；TWR 先估值旧份额再剔除新投入，申购费计入收益，最大回撤基于 TWR 而非累计市值。申购前基准为 1，首个观察点已扣首笔费用。XIRR 用实际天数/365，对日期现金流求 NPV 为零的年率；无可求解结果为 null，不能用本金收益率代替。

解释说明由已计算账本生成：给出首末笔实际申购日、申购 NAV、期末持有天数与净投入/总份额形成的混合平均单位成本；平均成本不是每笔申购 NAV。收益解释明确本金收益随 NAV 路径、份额、投入日期和费用变化，`.OF` 与 A 市场取数路由不证明基金底层资产类别或 A 股持仓。跨基金/基准 TWR 比较需对齐估值期间、收益类型、币种，以及费用和分红处理；本工具只有单位 NAV，不能直接与未对齐的总收益基准比较，也不构成符合 [GIPS 业绩标准](https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/) 的报告。

输入只含单位 NAV，未处理现金分红、拆分、赎回费用或历史申购限额，不能称为完整基金总回报或真实账户业绩。参数、NAV/费率引用及全账本核对通过后才进入报告的 Verified research results 和无金额分享；旧方法报告保持原字节。确定性回归见 [基金定投测试](../../src/quant/test/fund-dca.test.ts)。

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
7. 保存 JSON 至 `.ohquant/benchmark/results/`，文件名包含唯一 ID，多次评分不会互相覆盖。

输出文本包含评级、总分、各维度得分、CAGR、Sharpe、最大回撤和已保存的文件名。

Details 对象包含 `filename` 和 benchmark score 对象。

评分工具同样接受 `commission` / `stamp_duty`（默认 0.0003 / 0）。保存的 `methodVersion: 3` 结果包含共同日期、费用、年化与成交假设，并保存完整 `parameters`（fast/slow/cash/commission/stampDuty）供独立 Dashboard 研究重算；评分算法沿用第二版。训练/测试分别重新从现金开始，Benchmark 为同日无费用买入持有基线。两条曲线各自使用 provider 收盘价，不做同币种换算；跨币种时“超额 CAGR”只是两个报价价格收益率之差，不是统一计价币种的投资者收益。此时若要比较统一币种收益，需使用带显式报价币种与同日 FX 的 `compare_portfolios`。新评分制品的 `priceBasis` 与研究重算口径冲突时不进入已核验报告；旧制品缺少该字段时从原计算路径重推，不把缺失字段当作已换汇证据。月度胜率按观测到的日历月份聚合（含首末不完整月），不是滚动 21 天块。未定义 Sharpe/Calmar 不贡献相应评分，Dashboard 的 Sharpe 排名将 N/A 放在末尾。

### `show_dashboard`

输入：

| 字段 | 必填 | 默认值 | 说明 |
|-------|----------|---------|-------|
| `sort_by` | 否 | - | 按 `score`（默认）、`cagr` 或 `sharpe` 降序排名。 |

行为：

1. 按文件名排序，捕获 `.ohquant/benchmark/results/*.json` 的一次读取集合。每条包含文件名、解析后 JSON 的 SHA-256 和原结果；损坏文件保留并计数，每 32 个文件让出事件循环以响应取消。
2. 非空策略名且总分为有限的 0–100 才是有效记录；缺失 CAGR/Sharpe/回撤为 null，不当作 0。
3. 汇总全部有效记录，偶数样本中位数取中间两值平均；Sharpe/回撤平均值只计有值样本。
4. 按所选键降序展示前 10 行，缺失值最后，同值保留捕获顺序。不同标的/区间的历史评分排名不等于统一窗口的组合比较；报价价格未经汇率换算，跨币种排序也不代表统一计价币种的投资者收益排序。

如无制品存在，工具返回自然语言提示，建议用户先运行 benchmark 分析。

Details 使用 `methodVersion: 1`，含 `sortBy`、`snapshots`、`unavailableFiles`、`invalidResults`、`rows`、`summary`。文件系统没有全目录事务：集合是这次扫描实际读到的文件版本，捕获后随工具结果进入 session/报告，不另建会漂移的 catalog。后续报告不重新读取当前评分目录。

报告核对集合中全部有效评分的参数、数据引用、费用、指标，再核对完整汇总与排名。有旧版缺参数评分时仍可本地浏览，但整份汇总计为未支持；输入丢失或结果被改写计为未核验，不用部分记录冒充完整排名。分享仅展示核对通过的公开标的/区间/费率假设、分数和比率，不包含策略私密标签、文件名、现金或原评分对象。现行产物边界见 [Artifact 契约](./artifacts-design.md)。

## 4. 存储影响

`calculate_weighted_score` 是无 IO 的用户材料算术工具：显式 subject、observationDate 和 components（name、score、weight），权重以 0.2 表示 20% 且须合计为 1。返回逐项贡献、未舍入/舍入总分、最大贡献项（保留浮点同值），不创建财务核验任务，不映射原始指标为分数，不补缺项、不校准信号。[模块、真实调用与测试](#weighted-score)分别验证这些边界。

组合工具完整参数、币种/权重/缺失规则、计算公式与测试见 [观察组合比较](./portfolio-comparison.md)。它们使用独立纯计算、runtime 编排和版本化制品，不调用未注册的旧 compare handler。

| 工具 | 读取 | 写入 |
|------|-------|--------|
| `compute_factor` | 新鲜缓存或 provider | 成功抓取后更新行情缓存 |
| `run_backtest` | 新鲜缓存或 provider | 成功抓取后更新行情缓存 |
| `check_risk` | 新鲜缓存或 provider | 成功抓取后更新行情缓存 |
| `calculate_weighted_score` | 仅显式提供的参数；无文件读取 | 无 |
| `calculate_position_scenarios` | 显式假设股数、成本、观察价、日期与币种 | 无 |
| `fund_dca_backtest` | 实时 AKShare NAV / 可选公开申购费 | 公开 NAV/费率不可变归档，不保存模拟金额到该目录 |
| `score_benchmark` | 新鲜缓存或 provider | 行情缓存和 `.ohquant/benchmark/results/*.json` |
| `show_dashboard` | `.ohquant/benchmark/results/*.json` | 无 |
| `list_portfolios` / `edit_portfolio` | 观察组合配置与 revision | 仅 edit 按期望版本修改观察组，返回 before/after |
| `compare_portfolios` | 观察组、公开价格/NAV 与 FX | 市场数据归档和不可变比较制品；不修改观察组 |
| `portfolio_comparisons` | `.ohquant/benchmark/comparisons/portfolios/*.json` | 无；加载从记录输入重算 |

所有本地文件系统活动应发出 storage file event，以便 Conversation tool-call stream 统一展示 READ/WRITE/MKDIR 活动。

## 5. Agent 使用规则

- 不要将这些工具暴露为 slash 命令。
- 量化工作优先使用自然语言。
- 直接调用分析工具；数据获取由工具负责。用户单独请求原始行情时使用 `fetch_bars`。
- 当用户要求策略评分、排名、评级或 benchmark 对比时使用 `score_benchmark`。
- 当用户要求查看已保存的 benchmark 结果或策略排行榜时使用 `show_dashboard`。
- 个人投资组合持仓不得存入 `.ohquant/portfolio/`；portfolio 存储规则与量化工具制品分离。

`check_risk` 的可读结果分别列出收盘观测数和收益区间数，并列出 CVaR 95 实际纳入的区间数。以十次 `100,110,88,99` 为例，40 条收盘形成 39 个相邻收益，分位处并列值使尾部为 10/39，而非恰好 5%。最大回撤描述整个窗口的累计峰谷跌幅，不能归为单期收益；计算公式未改。历史/参数 VaR 标签及观察期单位的核对方法见 [评测指南](./evaluation.md#tasks)。


<a id="numeric-stability"></a>

## 共享数值稳定性

<a id="numeric-stability--计算边界"></a>

### 计算边界

均值、样本标准差、下行 RMS、标准化和分布形状集中在 `src/quant/statistics.ts`，由 performance、risk 和 factor 复用；模块没有 IO。标准差仍使用 N−1，下行 RMS 仍使用全部 N 个收益区间，偏度与超额峰度使用总体中心矩。这里改善计算顺序，不改变统计口径。

直接平方 `1e200` 会溢出，平方 `1e-200` 会下溢；标准差本身仍可能可表示。实现先平移、缩放，再计算中心矩并恢复量纲。平移保留大公共偏移附近的可表示小差；均值采用补偿求和并保留大数相消后的极小贡献。缩放平方和的背景可参考 [LAPACK DLASSQ](https://netlib.org/lapack/explore-html/d8/d76/group__lassq_gae8f40b0a34771b4f2d9c863de3af7be5.html)；本项目实现没有复制 LAPACK 代码。

回撤在对数累计收益上求峰谷差，避免中间权益乘积溢出，并通过 expm1 保留极小回撤；回撤持续期沿用原有 1e−12 恢复容差。真实不可表示的统计结果抛出错误，不输出 Infinity/NaN 或伪造零。缺失因子观察在标准化后仍是 null。

工具的 `formatPercent` 保持普通百分比格式；有限原值转换为百分比会溢出时，移动十进制指数，以字符串表示，例如 `1.60e+310%`。原始 details 保留原量纲有限数值，不修改或截断它。

这些检查覆盖指定浮点边界，不承诺任意数组和任意量级组合都有任意精度；行情源、复权、分红、日历和金融解释仍需要各自的验收。

<a id="numeric-stability--测试方式"></a>

### 测试方式

在仓库根目录执行：

```powershell
bun test src/quant/test/numeric-stability.test.ts src/quant/test/numeric-decimal.test.ts src/tools/test/quant-numeric-display.test.ts src/tools/test/shared/format-percent.test.ts
python src/quant/dev/check-numeric-reference.py
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

数值回归覆盖大数、极小数、相消、公共偏移、缺失观察、回撤路径和不可表示结果。独立参考样本由 Python Decimal 的 800 位精度中心矩公式得到，输入用 Decimal.from_float 保留实际二进制浮点值；Python 脚本独立复核保存值，Bun 测试将实现结果与这些参考值比较。极小非零值使用相对误差断言，避免绝对容差把错误的零判为通过。

百分比边界与真实工具执行回归另检查有限数值的显示；工具回归注入 100 根合成日线，确认 details 有限、文本不会出现 Infinity/NaN。测试不访问真实行情、账户或模型。

<a id="weighted-score"></a>

## 显式评分与贡献

显式算术和输入绑定由工具承担；模型仍负责解释材料含义。贡献排名误判及修正见[评测博客](../blog/05-evaluation-beyond-green.md)。

<a id="weighted-score--模块与入口"></a>

### 模块与入口

`src/quant/weighted-score.ts` 是无 IO 纯函数；`src/tools/weighted-score-tool.ts` 定义 `calculate_weighted_score` 的 schema 和返回值。注册表、能力清单、提示词和 Conversation 标签使用同一个工具，标签为 `Quant.WeightedScore`。

用户可直接提出“解释 AURX 在 2026-09-17 的这份评分”，提供 subject、observationDate 及 components。每项含 name、已给定的 0–100 score 和小数 weight；20% 必须传 0.2。权重合计为 1，仅允许浮点累加误差。空数据、重复名、非法分数、百分数当小数、缺失权重和不可表示的非零贡献拒绝，不自行补值或归一化。

输出：contribution = score × weight；score 为贡献合计；roundedScore 按最近整数舍入；largestContributors 保留浮点误差范围内的同值。输入顺序和原值保留，输出不修改调用者对象。日期是声明的材料日期，不证明行情新鲜度；观察的“连续下跌”等含义由回答另行完整保留。

例如六项贡献为 12、19.50、16、11.25、7、6.50 时，合计 72.25、舍入为 72，最大贡献为 19.50；原始分数最高不代表加权贡献最大。该计算不验证原始指标的分数映射，不校准信号，也不证明反转或交易适合性。

工具没有网络、文件、进程或账户访问，能力为 local，effects 为空。它不授予 `research_task` 新的财务验收器；用户材料的计算和行情归档的独立核验是不同证据。

<a id="weighted-score--pi-技能与评测"></a>

### Pi 技能与评测

真实技能入口仍经过依赖预检、固定 Markdown 工作流和 Pi 原循环。Fear-score 案例只开放单次只读工作流读取与这个生产算术工具，要求一次计算使用原始 subject、日期、名称、分数和权重；顺序变化允许，替换输入、漏调用或伪造工具回执不允许。其余技能案例仍只开放原来的只读工作流工具。

两个新检查核对原输入与算术回执进入下一次模型请求。最终回答的有限检查识别带标签的未舍入合计和明确最大贡献项；改变权重后正确的驱动项随计算改变，同值允许，否定/引用反例不当成肯定声明。不判断任意跨句指代或没有标签的隐含排名，人工审阅仍必需。

连续下跌的条件要求明确保留连续含义，不能用任意“4 天”通过。旧失败不因此回写为新的成绩。

<a id="weighted-score--测试方式"></a>

### 测试方式

```powershell
bun test src/quant/test/weighted-score.test.ts src/quant/test/volume-ratio-method.test.ts src/tools/test/weighted-score-tool.test.ts src/runtime/test/weighted-score-answer.test.ts src/runtime/test/weighted-score-session.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

确定性回归覆盖纯评分、量比反例、工具/能力、回答边界及实际 Pi + localhost SSE 技能流程。固定公开工作流的五文件 fixture 来自 LLMQuant/skills 的已审阅提交 `1918237467c2dff4cc97a18ebc0892dfd46e8129`，保留 MIT LICENSE；普通测试不依赖用户的安装目录或真实模型凭证。

真实模型复测另行记录，产生模型用量，并拒绝覆盖原输出：

```powershell
bun run eval:research -- --case skill-risk-fear-score --timeout-ms 300000 --max-requests 12 --output output/research-fear-score-new.json
```

<a id="position-scenarios"></a>

## 显式持仓情景

`calculate_position_scenarios` 是默认启用的 Quant 工具，用于显式提供的假设多头股票参数。它调用 [纯计算模块](../../src/quant/position-scenarios.ts)，不访问账户、文件或行情，不写缓存、报告，不执行订单。结果保留原始参数、观察日期、币种、方法与限制。

<a id="position-scenarios--输入与方法"></a>

### 输入与方法

| 输入 | 契约 |
|---|---|
| `shares` | 正的有限股数，可以为小数 |
| `costPerShare` | 正的有限每股成本 |
| `observedClose` | 正的有限给定收盘价 |
| `observationDate` | 该收盘价的真实公历日期，`YYYY-MM-DD`；不证明时效 |
| `currency` | 成本与收盘价共用的三个大写字母币种标签；不进行 FX 换算 |
| `changes` | 1–32 个有限情景变化，小数表示；0.1 为 +10%，不得低于 −1 |

总成本 = 股数 × 每股成本；情景价格 = 给定收盘价 ×（1 + 价格变化）；情景市值 = 股数 × 情景价格；盈亏 = 情景市值 − 总成本；成本收益率 = 盈亏 ÷ 总成本。价格变化和成本收益率使用不同分母。

例如 200 股、每股成本 50、收盘价 42，给定币种 USD、收盘观察日 2026-09-17：

| 收盘价变化 | 情景价格 | 市值 | 相对成本盈亏 | 成本收益率 |
|---|---:|---:|---:|---:|
| −20% | 33.60 | 6,720 | −3,280 | −32.8% |
| −10% | 37.80 | 7,560 | −2,440 | −24.4% |
| 0% | 42.00 | 8,400 | −1,600 | −16.0% |
| +10% | 46.20 | 9,240 | −760 | −7.6% |

这些是无费用、未对冲股票的条件算术，不能用来推断期权赔付、市场预测、账户真实性或成交。缺少股数、成本、观察日或币种时，需要用户补齐；工具不从本地文件或模型猜测中生成这些输入。

<a id="position-scenarios--会话中的使用"></a>

### 会话中的使用

启动 `bun run start`，在自然语言输入中提供上述完整参数，要求调用 `calculate_position_scenarios` 并列出未对冲情景。例如：

> 只使用我提供的假设参数：200 股、每股成本 USD 50、2026-09-17 收盘 USD 42；changes 为 [-0.2, -0.1, 0, 0.1]。调用 calculate_position_scenarios，列出价格、市值、相对成本盈亏与成本收益率，不查询行情或账户。

[工具定义](../../src/tools/position-scenarios-tool.ts)提供真实 schema；[注册表](../../src/tools/registry.ts)负责活动工具、显示标签与 capability 投影。Doctor Tools 阶段显示 `local`，表示无需行情 provider，不等于已经计算；TUI 的 Tool capabilities 可查看必填参数。当前未把该结果加入归档数据支持的 ResearchTask 核验指标，也不让它满足价格归档或真实账户的接受条件。

<a id="position-scenarios--回答核对与评测范围"></a>

### 回答核对与评测范围

[情景回答检查](../../src/runtime/evidence/hedge-scenario-answer.ts)仅核对带明确列标签的未对冲股票表，并绑定调用方显式提供的股数、成本和收盘价。支持 Markdown/对齐文本、行内收益率和百分号表头下的裸数字；按显示精度核对价格、市值、成本盈亏和收益率。未知 IV shock、缺数、未识别格式或自由文本没有被赋予完整语义通过。引文及代码围栏不作为当前断言检查。

LLMQuant 对冲评测的输入现在由同一纯模块生成股票情景表，再由模型执行原有唯一 workflow 读取。该 limited-evidence 评测仍只提供工作流 reader，不提供计算工具；其数字来自明确标记的宿主算术输入。普通会话使用的注册工具另由真实 Pi loop 和选定真实模型调用验证。两条路径分别保留，不混成同一工具调用证据。

有限表格校验不覆盖任意期权解释；错误情景回答、旧成绩保留和新提示的取舍见[评测博客](../blog/05-evaluation-beyond-green.md)。

<a id="position-scenarios--测试方式"></a>

### 测试方式

```powershell
# 本地确定性测试，不调用模型或市场
bun test src/quant/test/position-scenarios.test.ts src/tools/test/position-scenarios-tool.test.ts src/runtime/test/hedge-scenario-answer.test.ts src/runtime/test/hedge-answer-regression.test.ts src/runtime/test/research-task-tool.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build

# 构建 CLI 的工具发现；Tools 阶段会检查已有 Python 依赖
bun run dist/index.js --json doctor --phase tools

# 使用保存的模型连接；输出必须为新文件
bun run eval:research -- --case skill-risk-hedge --timeout-ms 300000 --max-requests 12 --output output/hedge-scenario-next.json
```

工程测试、模型自动门槛与人工解释审阅分别记录。当前完整特性状态只在 [产品范围与验收](./product-guide.md#requirements) 维护；F12/F24 的其它解释、真实任务和服务缺口不因局部通过而消失。

<a id="registry"></a>

## 工具注册、能力与端点检查

[registry.ts](../../src/tools/registry.ts) 是内置工具装配入口，静态定义随应用发布；它不是动态插件加载器。注册记录绑定实现、领域（data/quant/system）、启用顺序、显示标签与 requirements：市场、provider、凭证、Python、端点权限和副作用。显示名集中在 [display.ts](../../src/tools/display.ts)，不在 CLI/TUI 各复制一份。

| API | 消费者与责任 |
|---|---|
| `BUILTIN_TOOLS` | 无会话绑定的默认静态工具 |
| `bindResearchTools(tools, read)` | 给当前 Quant Session 追加 research_task，重复名称拒绝；无全局 currentAgent |
| `createBuiltinTools({ analysisData, news, alpha })` | 注入单宿主数据/新闻/引擎端口，保留原 schema 与纯计算，不改变其它实例 |
| `findBuiltinTool(name)` | 内部查找，不增加新的 slash 调用入口 |
| `listBuiltinToolRegistrations(domain?)` | 注册顺序、分组与实现检查 |
| `listBuiltinToolCapabilities()` | 从实际注册投影名称、schema、标签、要求，不导出 execute |
| `builtinToolDisplay(name)` | Conversation 标签映射 |

最终活动集合由会话显式消费，并按任务范围再缩小，见 [Harness](./README.md#tasks)。`research_task` 需要当前分支，只做 read/declare/resolve/cancel，不伪装成无会话 Doctor 的行情端点；其说明只有在真实活动集合包含该工具时才注入。

能力状态是只读投影：blocked 为已知缺前提，unverified 为缺检查，sample-verified 只证明所测样本，local 只表示无行情 provider 依赖而非执行成功。Tools 阶段检查全部已注册 AKShare 路由依赖，即使首选源不是 AKShare。公开 schema 按请求复制，调用方不能修改下一次发现结果；目录读取目标元数据，不反复复制全体 schema。

### 不同路由不能互相证明

- `fetch_bars_archive` 必填 UTC `observed_before`，只读旧响应；显式 source 时不因损坏的付费行情设置阻断本地读取。`analyze_archived_bars` 还要求窗口、模式及足够行。local 不证明档案存在、完好或供应商当时已发布。
- `compute_factor/run_backtest/check_risk` 的可选归档模式仍共用原计算；默认能力包含网络模式，因此要单独发现 provider-free 入口，应选择归档工具。一次归档调用不会因为能力清单列了网络就发请求。
- `search_symbols` 只走 Tushare stock_basic、只支持 A 股，日线权限不是搜索权限。`fetch_index_spot` 先 Sina HTTP 再 AKShare，缺 Python 只阻断后者。基金端点固定 AKShare，不随首选日线 provider 改变。
- `research_news` 的新闻与价格依赖分开；Endpoint check 默认选新闻路由，US/HK 为 Yahoo。日线样本不能验证新闻响应。注入 news 端口保留原 schema。
- 组合比较包括可替代股票日线、基金 NAV，以及跨币种 Frankfurter/ECB FX；ecb-fx 可单独检查 base/quote/start/end，同币种请求拒绝，避免恒等计算冒充联网成功。观察组修改另有 portfolio-preferences 副作用，比较没有。
- `annual_report/annual_reports/research_decisions` 读取选定公开归档并写研究制品/选择日志，无账户端口。用户声明的理由/日期不是成交或独立核验的批准；年报只消费明确 decision_ids。细节见[年度报告](./annual-reports.md)。
- `alpha_backtest` 取数前还需指定 AKQuant 环境与版本；`alpha_runs/alpha_engine_status` 分别读取运行记录和检查引擎。行情成功不证明引擎就绪，见[Alpha](./alpha-backtest.md)。

Tool capabilities / Doctor 的 Endpoint check 复用 CLI/TUI 的 runtime/tool-probe。每次只执行选定公开数据路由及参数，不执行量化计算或 shell，不写缓存、报告、设置。日线路径继续做 bars 校验；具名端点的 endpoint-response 仅表示非空响应，不认证全部字段语义、实时性或财务事实。目录接口可能返回全量，不能把本地 limit 叫上游分页。

基金具名端点使用真实 API 参数 schema，排除只影响工具呈现的 fund_code/keyword/limit；指数通用接口沿用白名单和 kwargs 约束。参数/连接变更使检查回执失效，关闭后不保存成长期权限；取消/超时不接受晚到结果。完整操作见 [Slash](./product-guide.md#commands)。

### 添加工具

实现 AgentTool，从领域模块导出，在注册表绑定实现、显示名和真实 requirements，补充 [registry 测试](../../src/tools/test/registry.test.ts)及相应领域契约。重复名称或缺失实现应在装配时失败；实验性工具可显式 enabledByDefault:false。不要在注册入口外拼接另一套默认数组，也不要为每个 UI 复制静态工具目录。

<a id="factor-methods"></a>

## 六类因子的口径与证据

| 因子 | 方法 | 单位 |
|---|---|---|
| momentum(N) | close[t]/close[t−N]−1 | 收益分数 |
| reversal(N) | momentum(N) 的相反数 | 构造分数，不表示反转已经或即将发生 |
| volatility(N) | N 个相邻收盘收益的样本标准差，分母 N−1 | 未年化期间离散度 |
| volume_ratio(N) | 当前量 / 包含当前观察的 N 期均量 | 无量纲倍数 |
| rsi(N) | Wilder 平均上涨幅/平均下跌幅递推 | 0–100 指数，不是收益百分比 |
| sma_deviation(N) | (SMA(5)−SMA(N))/SMA(N) | 均线差分数，不是收盘偏离或斜率 |

[RSI](../../src/quant/rsi.ts) 前 N 个变化播种平均上涨/下跌，后续每个收盘先消费自己的变化再输出。收盘 [10,11,12,11,10]、N=2 应得 [null,null,100,50,25]；持续正收益且下跌幅为零为 100，当前也保留既有零下跌幅返回 100 的平盘约定。工具和归档重算共用 factorRequiredBars：至少 N+1；SMA 差为 max(N+1,5)，不从窗口外补 warmup。

因子 volatility 不年化；check_risk 的普通波动率与零目标下行偏差都乘 √252，但前者去均值且分母 N−1，后者以零为目标且分母包括全部 N 期。“估计方法不同”不等于“只有一个年化”。

volume_ratio 包含当日不意味着恒等于 1：[10,20] 得 4/3，[10,10] 得 1，[5,15,10] 得 1；当期等于正窗口均值才为 1，全零均值为 null。这不是下面排除当日、使用中位数的 precedingVolumeRatio。

### 多因子验收和恢复

每个因子绑定自己的 callId/callEntryId、完整参数和 verified 指标，不要求六个因子来自一个调用。同一计算支撑多个准则时去重，错周期/日期/市场、不同观察截止、重复身份和未核验结果不得混合。旧归档不改写；与新计算不一致的旧 RSI 结果撤销核验资格，而非继续兼容错误。

[Latest 检查](../../src/runtime/evidence/factor-latest-claims.ts)支持有明确因子/周期的标签、标题及表格；多个候选仅写 Latest 时提示消歧。当前入口限定同任务窗口、单标的，不宣称识别任意跨标的自由文本。AppRuntime 保留错误原文，显示本地复核提示、暂停自动报告，不额外请求模型；RSI/量比的百分号和方法叙述仍需人工审阅。

独立 40 收盘样本为 100…138、最后 124，量恒为 10，日期 2026-01-01 至 2026-02-09：

| 验收项 | Latest 独立期望 |
|---|---|
| momentum(2) / reversal(2) | −13/137 / 13/137 |
| volatility(2) | (1/137 + 7/69)/√2 |
| volume_ratio(20) | 1 |
| rsi(14) | 1300/27 |
| sma_deviation(20) | 21/515 |

末次下跌检验递推是否错位，期望不从被测函数生成。六次数值全对但回答漏了一项仍不通过完整评测。复跑入口：

```powershell
bun test src/quant/test/factor-method-regression.test.ts src/tools/test/factor-method-regression.test.ts src/runtime/test/factor-multiple-evidence.test.ts src/runtime/test/factor-method-session.test.ts src/runtime/test/risk-annualization.test.ts
# 以下使用保存的模型连接，会产生用量；输出需为新路径
bun run eval:research -- --case stock-factors --timeout-ms 300000 --max-requests 16 --output output/factors-next.json
```

本地回归、旧模型回答的离线重审、新模型运行是三种记录，不能拼成当前整套通过率。RSI 错位、SMA 暖机和单调样本漏检的反思见[评测博客](../blog/05-evaluation-beyond-green.md)。

<a id="price-volume"></a>

## 已收盘数据的价量 API

这组纯 API 是显式研究基础，不自动替换上面的内置工具，也不是买点或交易策略系统。输入 DailyBarDataset 与 ResearchContext 的来源、单位、交易日历和 finality 约束由[数据源契约](./source-data-providers.md#research-data)维护。当前只接受 A 市场的指定上海时区收盘规则，其它市场不套用 A 股日历。

| API | 计算约定 |
|---|---|
| relativeStrength(stock, benchmark, context, N) | (股票收益−基准收益)×100，单位百分点；同市场和声明复权口径，最近 N+1 个日历会话必须完整，不补零、不前填、不退到更早共同日期 |
| atr(bars, N=14, smoothing="wilder") | TR=max(high−low, abs(high−prevClose), abs(low−prevClose))；首根只供 prevClose，index N 首次平均 N 个 TR；后续 Wilder=(前值×(N−1)+TR)/N，SMA 则滚动均值 |
| closeLocationEfficiency(bar) | (close−low)/(high−low)，零振幅为 null |
| precedingVolumeRatio(bars, N=20) | 最新量 / 前 N 根量的中位数，不含最新；不足或零基线为 null；不是同分钟日内量比 |
| medianTradedAmount(bars, N=20) | 最近 N 根（含最新已收盘）的成交额中位数；底层不认证币种，标作 CNY 前须核对单位 |

低层数组函数校验 bars 和窗口，不证明已收盘。`analyzePriceVolume` 使用直到 lastCompletedSession 的连续 verified 后缀，要求足够样本和明确单位，不跨未核验缺口；保留可用 Wilder 初始化历史，返回 historyStart/historyObservations 便于重算。

```ts
import { fetchResearchBars } from "../src/runtime/data/source-runtime.ts";
import { analyzePriceVolume, relativeStrength } from "../src/quant/index.ts";
import type { ResearchContext } from "../src/types/research-data.ts";

async function research(context: ResearchContext) {
  const stock = await fetchResearchBars("600000.SH", "A");
  const benchmark = await fetchResearchBars("000300.SH", "A");
  if (!stock.dataset || !benchmark.dataset) return { status: "data_insufficient" };
  return {
    priceVolume: analyzePriceVolume(stock.dataset, context),
    rs: [5, 10, 20, 60].map(n => relativeStrength(stock.dataset!, benchmark.dataset!, context, n)),
    attempts: { stock: stock.attempts, benchmark: benchmark.attempts },
  };
}
```

context 必须来自有来源的交易日历，不假设已有内置日历 feed。当前内置 provider 沿保守 legacy 路径，不能仅凭这段调用得到已核验收盘指标；需证据感知 adapter。合成证据测试检验计算和拒绝，不证明盈利。没有由这些 API 自动触发的 slash、报告、组合持久化或交易动作。
