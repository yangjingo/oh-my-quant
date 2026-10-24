# 量化评测：论文、因子基线与公开 Benchmark

更新：2026-10-23。评测围绕产品的量化研究能力组织：理解金融材料、生成与筛选因子、构建组合、持续观察结果。本文解释论文与基准的采用理由，不记录运行流水；列出的外部评测仍是候选，未声明已经接入或复现。

## 先区分基线、基准与研究方法

Alpha101 提供可比较的因子公式；AlphaBench 提供因子挖掘任务与评价方法；Qlib 提供研究基础设施；回测过拟合论文约束实验结论。它们各有作用，不能都当成一个排行榜。

我们的主线是：**固定因子基线 → 评价生成与搜索 → 验证时间外表现 → 检查扣除成本后的组合价值**。通用 Agent 基准作为工具调用和交互能力的补充。

## 从因子论文到研究基准

### Alpha101：明确公式的比较起点

Zura Kakushadze 的 [101 Formulaic Alphas](https://arxiv.org/abs/1601.00991)（2016）公开了 101 个公式化 Alpha。它适合作为因子库的参考与比较基线，帮助判断新生成的公式是否只是已有信号的变形。

复现时必须明确输入、窗口、截面排名、缺失值与行业中性化等口径；缺少所需数据时不能悄悄替代。论文公开公式，不等于提供跨市场统一的现成成绩，也不保证这些信号今天仍有收益。上述复现要求是我们的采用原则。

### Qlib / Alpha158：固定特征与实验流程

[Qlib 论文](https://arxiv.org/abs/2009.11189)（2020）讨论面向 AI 的量化研究平台；其 [Alpha158 实现](https://github.com/microsoft/qlib/blob/main/qlib/contrib/data/handler.py)可作为固定特征基线。Alpha158 是一组特征及处理方式，不能只凭名字把它当作一份固定行情数据集。

对我们而言，它的价值在于比较时固定特征、标签、样本划分与回测配置。Alpha101 和 Alpha158 来源与构造不同；调整股票池、时间范围或预测周期后，应报告本地实验配置，不能直接借用上游结果。

### AlphaBench：生成、评价与搜索分别评

[AlphaBench](https://www.cs.cityu.edu.hk/~cliu644/HomePage/doc/AlphaBench/AlphaBench_PDF.pdf)（ICLR 2026；[项目与代码](https://alphabench.cc/)）将公式因子挖掘拆成生成、评价和搜索三类任务。它比通用问答成绩更贴近我们“丰富因子库与自动调整观察指标”的目标。

生成要看公式是否可执行、是否符合描述；评价要区分模型对因子质量的判断与实际计算结果；搜索则要在相同预算下比较改进与成本。我们不会用模型说“这个因子很好”替代回测，也不会把找到一次高 IC 当成长期有效。IC/RankIC 衡量因子与后续收益的相关性，仍需要时间外和组合层面的验证。

### 从单因子走向策略与组合

[AlphaForgeBench](https://arxiv.org/abs/2602.18481)（2026）让模型产出可执行因子和因子策略，再由执行过程评估，适合作为研究生成与交易动作分离的参照。[FactorBench](https://arxiv.org/abs/2610.06947)（2026 年 10 月预印本）进一步关注因子的时间泛化、与已有因子池的区别，以及扣除成本后的组合表现。

我们重点借鉴“新因子是否给已有组合增加价值”这个问题；这两项基准的数据与代码的完整复现条件尚未审计，暂不作为默认测试门槛。

## 金融决策与报告能力如何补齐

[InvestorBench](https://arxiv.org/abs/2412.18174)（2024 预印本）提供股票、加密资产与 ETF 等金融决策任务及环境；[AI-Trader](https://arxiv.org/abs/2512.10971)（2025）强调自主获取与综合实时市场信息，覆盖美股、A 股和加密市场。

它们适合观察连续决策、信息利用和风险行为。我们更关心相同资金与信息条件下的基准比较、回撤、换手和成本，而不只看收益排名。实时实验还需要保留当时可见的信息；短窗口胜出不能直接推导长期有效。借鉴评测不表示产品已获得实盘下单能力或授权。

报告与数值解释另用 [FinanceBench](https://github.com/patronus-ai/financebench)、[FinQA](https://github.com/czyssrs/FinQA) 和 [ConvFinQA](https://github.com/czyssrs/ConvFinQA)补充，分别关注财务依据与数值推理。FinanceBench 官方公开样本为 150 题；给定正确证据与自行检索应分开比较。答对财报问题也不能替代因子、回测和组合评测。

## 用方法论文约束“看起来有效”

Bailey 等人的 [The Probability of Backtest Overfitting](https://escholarship.org/uc/item/4w1110bb)研究从大量回测配置中挑选赢家所造成的过拟合，并提出 PBO 与 CSCV 方法。它直接对应仓库笔记提出的问题：Agent 能快速尝试很多因子，但挑出的最好结果可能只是选择偏差。

因此，我们保留全部尝试的数量与选择过程，搜索阶段不反复查看最终测试集，采用时间顺序的训练、验证和独立测试。标签区间重叠时，还需处理泄漏。PBO 是诊断方法，不能当成任何策略都适用的收益保证；这些约束是我们的实验设计，不表示已实现该论文算法。

书籍按研究问题阅读，作为方法依据，不列作 benchmark：

- Ernest P. Chan，[Quantitative Trading](https://onlinelibrary.wiley.com/doi/book/10.1002/9781119203377)：建立从策略研究到交易系统的基本认识。
- Richard C. Grinold、Ronald N. Kahn，[Active Portfolio Management](https://www.mheducation.com/highered/mhp/product/active-portfolio-management-quantitative-approach-producing-superior-returns-selecting-superior-returns-controlling-risk.html)，第 2 版：连接预测能力、主动组合和风险控制。
- Andrew Ang，[Asset Management: A Systematic Approach to Factor Investing](https://academic.oup.com/book/3342)（2014）：从风险暴露解释因子与资产配置。
- Marcos López de Prado，[Advances in Financial Machine Learning](https://www.wiley.com/en-gb/advances-in-financial-machine-learning-p-9781119482086)（2018）：补充金融交叉验证、回测和模型选择的方法。

## 采用顺序与辅助评测

优先建立 **Alpha101/Alpha158 基线与 AlphaBench 式因子任务**，再评价时间外稳定性、已有因子池之外的增量和成本后组合表现。InvestorBench、AI-Trader 用于后续金融决策研究；报告质量保留金融问答评测。每次比较固定市场、数据版本、预测周期、工具权限与搜索预算，按维度报告结果，不合成含义模糊的整体分数。

[BFCL](https://gorilla.cs.berkeley.edu/leaderboard.html)补充工具调用，[GAIA](https://huggingface.co/datasets/gaia-benchmark/GAIA)补充多步材料处理，[τ-bench](https://github.com/sierra-research/tau2-bench)补充交互约束；明确提供电脑操作能力后再考虑 [OSWorld](https://github.com/xlang-ai/OSWorld)。它们不代替 Quant 主线。公开基准仍需遵守数据访问、版本与划分要求，改写后的 Quant 任务应标为衍生评测。

## 与内部回归的分工

<a id="tasks"></a>
<a id="news"></a>
<a id="annual"></a>
<a id="skills"></a>
<a id="suite"></a>

已有[研究评测入口](../../src/runtime/dev/evaluate-research.ts)覆盖本地任务、新闻、年报与技能案例；它们用于检查本产品的行为，不是上述公开 benchmark 的实现。具体参数由入口帮助维护，历史结果留在运行产物中。

<a id="data"></a>

[数据刷新测量](../../src/runtime/dev/measure-data-refresh.ts)与 [Overview 测量](../../src/runtime/dev/overview/measure-overview-refresh.ts)观察本地性能；[数据源检查](../../src/runtime/dev/check-data-providers.ts)检查真实连接与样本有效性。这些结果不能充当 Agent 能力分数。

<a id="model-performance"></a>

[模型延迟测量](../../src/runtime/dev/measure-model.ts)只回答连接与响应性能问题，不评价研究答案。真实模型和数据请求可能产生用量，不能用历史成功代替本次结果。

<a id="验证脚本的维护边界"></a>

CI 的确定性检查由[交付流程](../ci-release.md)维护；测量脚本按[模块职责](../agent-runtime/architecture.md#开发入口与-npm-命令)归属。各入口的结果只解释其实际输入与环境，替换脚本不代表原样复现历史场景。本文不再复制命令清单、删除记录或逐轮通过数。
