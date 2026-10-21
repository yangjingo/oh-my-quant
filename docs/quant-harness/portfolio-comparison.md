# 观察组合比较

更新：2026-10-13。入口是自然语言 Agent 工具，适用于假设配置研究。组合仅保存代码、名称和分组；实际账户数量、现金和成本不参与本流程。

## 使用

先用 `/portfolio` 或自然语言创建组合，例如“创建美股科技观察组，加入 AAPL、MSFT；创建港股科技观察组，加入 00700.HK”。Agent 通过 `list_portfolios` 读取分组 ID 和版本，再用 `edit_portfolio` 执行请求的修改，返回前后状态。每次修改必须携带读到的 `expected_revision`；遇到其他窗口修改，重新列出并核对操作。ID 优先于名称，避免名称与另一组 ID 相同导致修改错组；共享标的改名会影响所有引用它的组。

比较示例：

```text
比较美股科技和港股科技两个观察组，2025-01-06 到 2025-06-30，
以 SPY 为基准，用人民币计价。AAPL、MSFT、SPY 报价币种为 USD，
00700.HK 为 HKD。各组初始等权，买入持有；缺成员数据时停止。
```

报价币种必须来自用户提供或核实过的证券资料，不能仅按市场猜测。以上是调用示例，不是投资建议或这些标的的数据可用性保证。工具会自动获取价格/NAV 与所需汇率，不需先手动下载行情。

## 工具契约

| 工具 | 输入与行为 |
|---|---|
| `list_portfolios` | 无参数；只读当前分组、标的与 revision，空列表明确显示。 |
| `edit_portfolio` | `expected_revision` + `edit`；支持 create/rename/delete/add/remove，返回 before/after。没有数量、账户金额或订单参数。 |
| `compare_portfolios` | 两组、区间、基准、币种和配置方法；只读组合，自动获取公开数据、计算并保存比较。 |
| `portfolio_comparisons` | 无 ID 时列出历史；指定 `id` 时校验文件并从当次输入重算，结果不一致则报错。 |

`compare_portfolios` 参数：

| 参数 | 规则 |
|---|---|
| `group_a` / `group_b` | 两个不同的已保存组合 ID 或唯一名称；空组不能比较。 |
| `start` / `end` | 有效 YYYY-MM-DD，start < end，闭区间；实际共同区间另列。 |
| `benchmark` | 完整证券/指数/基金代码；基准缺数据时始终失败。基金用 `.OF`。 |
| `base_currency` | 结果计价币种，例如 CNY。 |
| `currencies` | 所有成员及基准的完整代码 → 三字母大写报价币种；保存为显式研究假设。 |
| `weighting` | `buy-and-hold` 或 `rebalance`，必须明确选择。 |
| `weights_a` / `weights_b` | 可选，每个成员一个正数，合计 1；省略为初始等权。 |
| `missing_members` | 默认 `fail`。显式 `exclude` 才剔除窗口内少于两条价格的成员，并重新归一化剩余权重；不允许整组被剔除。 |

自定义权重示例：`weights_a: {"AAPL": 0.7, "MSFT": 0.3}`。报价币种映射包含基准，即使基准也是某一组成员；同一标的每次请求只获取一次。

## 价格、汇率与计算

股票/指数复用配置的日线源与缓存/回退链，基金单位 NAV 通过 AKShare 实时获取并归档。开始时固定分组、revision 和行情设置，最多并发 4 个唯一标的；计算期间其他窗口编辑组合，不改变当前研究输入。取消传递至 HTTP/Python 和归档，取消后不保存比较结果。

先对齐价格和同日汇率，再计算收益。任一成员或基准在某日缺价格，或某外币缺同日汇率，该日从整份比较中移除并列出原因。无至少两个共同估值日时失败。不能用“一个标的两天涨幅”和“另一个标的一天涨幅”直接平均；不前向填充假期汇率。`exclude` 不吞掉 provider 异常，也不把缺汇率当成汇率 1。

汇率调用 Frankfurter v2，固定 `providers=ecb`。API 返回每单位 base 对应的 quote；适配层取倒数后存成“每单位外币对应多少基准币”，基准币价格为本币价格 × 该汇率。同币种使用恒等换算，不发网络请求。这是日度参考汇率，不能当成可成交报价。[官方文档](https://frankfurter.dev/)、[OpenAPI](https://api.frankfurter.dev/v2/openapi.json)。

初值 NAV 为 1。买入持有的 NAV 为各成员基准币价格相对首日比例的初始权重和；再平衡则在每个共同估值日按目标权重计算下一段的组合涨幅并连接。两者都允许碎份额，明确采用零成本假设，未处理费用、税、股息、拆分或公司行为修复。不同市场同一日期的收盘不是同时发生的交易。

结果包含两组和同日基准的总收益、日历 CAGR、Sharpe、回撤、风险、相对基准累计收益差，并列每个成员的初始权重、本币与基准币收益。CAGR 用实际天数/365.25；风险年化频率为共同收益期间数/实际年数，无风险率 0。缺失日导致期间长度不等，此年化风险只是观测期间近似；VaR/CVaR 是每个共同观测期间的收益分位数，不必然代表一个交易日。只有一个收益期间时风险与 Sharpe 为 N/A；年化溢出时 CAGR 为 N/A，其他数值溢出则失败。

2026-09-15 修正方法说明：买入持有保持初始碎份额，权重随价格/汇率漂移，不执行再平衡；rebalance 在共同估值日恢复目标权重，用于下一收益期间，跳过的日期不模拟交易。工具文本、研究投影与新生成的报告共用 [方法说明模块](../../src/quant/portfolio-comparison-notes.ts)。同时明确累计收益为 `末值 / 初值 - 1`，N 个估值日形成 N−1 个相邻收益期间，超额收益是两个累计收益率的百分点差。说明依据实际计算输入，不将模型复述作为计算事实。

同日补充解释边界：从对齐后的实际日期计算最短/最长日历间隔，明确不等长收益没有先归一到统一期限；Sharpe 的无风险率为零，Sharpe/波动率/VaR/CVaR 只是样本描述，未估计不确定性或调整序列相关，不能凭数值排序证明稳定的风险调整优势。超额百分点不是风险调整 alpha，也不证明收益与承担风险之间的因果关系；最大回撤只覆盖观察点，零回撤不等于零风险。即使间隔相等，也不自动证明交易日历完整或统计可靠；没有人为设置“达到 N 个样本即可信”的阈值。

统计依据：[William F. Sharpe, The Sharpe Ratio — Time Dependence](https://web.stanford.edu/~wfsharpe/art/sr/sr.htm) 说明期限影响，以及年化关系对收益聚合和序列相关假设的依赖。本项目上述披露方式属于工程选择，不声称实现该文未提供的小样本可靠性判据。原数值算法与比较档案保持；当前工具说明及新报告使用补充后的解释。

## 保存与恢复

文件位于 `.ohquant/benchmark/comparisons/portfolios/<uuid>.json`，每次生成独立 ID，原子写入并校验内容哈希。保存完整价格/NAV、汇率观测、来源与观测时间、原始组版本、权重和缺失规则，包含现有 Bars/NAV 引用。价格缓存后来修订不会更改旧比较。

`portfolio_comparisons` 加载时重算记录输入与全部结果，缺失/损坏/不一致明确失败，保留原文件。这证明结果与记录输入一致，不证明上游金融事实、币种假设或历史当时可得性。独立比较恢复不要求重新取数。

新比较的 `methodVersion=2` 修正了版本 1 中无条件出现的再平衡 warning，数值算法未变，外层制品格式仍是 version 1。恢复和研究核验按保存的 methodVersion 重算，包括原版本说明；未知版本和被改动的 warning 仍拒绝。已核验旧档案的当前展示使用实际 weighting 生成准确说明，不改写比较档案、旧会话或已保存 HTML。版本 1 的旧报告可能仍含原措辞；新生成的报告与当前恢复展示使用修正后的说明。

新比较同时记录原始组选择和调用假设，权重的空槽使用可稳定保存的 null。报告先匹配唯一且顺序正确的调用/结果，再加载对应比较归档、逐份核验 Bars/NAV 版本、核对价格/币种/时间和 FX 来源，重算两组及基准的全部结果。FX 固定在比较归档内，没有独立的 FX DatasetRef；它和原始请求同时受比较内容哈希及报告来源 entry 哈希约束，不代表外部签名或金融事实认证。历史比较工具指定 ID 时同样可生成核验卡片。

开启 `/config → Auto Artifacts` 后，新报告展示两组与基准的归一化曲线、收益/风险表、假设权重、成员本币/基准币收益、共同与剔除日期、汇率明细；横轴按实际日历日期。Share preview / Download HTML 中两组显示为 Portfolio A/B，保留公开标的和假设比例，排除自定义组名、组 ID、配置 revision、原始请求、会话内容及任意缺失原因文本。完整原报告仍保存研究轨迹。

归档缺失、价格与版本不符、参数或结果被改动时排除该比较卡片，不回读最新行情或当前组。旧比较缺原始请求时仍可独立重算，但报告将其列为未支持；已保存的报告字节不改写。2026-09-15 已补 Chrome 三尺寸、分享下载与离线检查，修复图表高度裁剪、小屏溢出和预览空白。离线使用下载字节在 offline 浏览器中加载，未验证系统双击文件；这次浏览器观察不覆盖 F05 连续任务或 F21 整体及时性；现行状态见 [产品范围与验收](./product-guide.md#requirements)。

## 验证方式

离线确定性测试：

```powershell
bun test src/quant/test/portfolio-comparison.test.ts src/source/tests/frankfurter.test.ts src/runtime/test/portfolio-comparison.test.ts src/tools/test/portfolio-tools.test.ts
bun test src/artifact/test/report-comparison.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

人工样例：A 价格 `[100,200,100]`，B `[100,50,100]`，初始各 50%。买入持有 NAV `[1,1.25,1]`，收益 0%、回撤 -20%；每期恢复等权 NAV `[1,1.25,1.5625]`，收益 56.25%。另以价格不变、USD/CNY 从 7 到 8.4 验证本币 0%、基准币 +20%。测试覆盖缺失日期、权重、空组、取消、并发去重、版本冲突、损坏制品和实际注册工具链。

报告合成样例（无网络或模型请求，输出目录必须尚不存在）：

```powershell
bun run src/artifact/dev/check-portfolio-report.ts output/portfolio-report-synthetic
```

生成 `report.html`、带合成标识的 `share.html` 和 `evidence.json`，可以直接打开；测试数据临时目录会清理。对应 [当前分享样例](../../output/portfolio-report-2026-09-14-r05-final/share.html) 使用上述再平衡样例，FX 为 `[7,7.7,8.4]`，独立期望末值为 A `1.875`、B `1.2`、基准 `1.452`。这是人工 fixture，provider 标签只用于测试归档契约，不是实际市场收益。

真实公开数据 smoke（需 Python + AKShare 与网络，输出文件必须尚不存在）：

```powershell
bun run src/runtime/dev/check-portfolio-comparison.ts output/portfolio-comparison-live.json
```

脚本在独立临时工作区创建两只公开基金的测试分组，以沪深 300 为基准比较固定历史窗口，检查原组文件未改和记录输入重算一致；另请求 USD/HKD 对 CNY 的汇率。结束清理临时市场数据和观察组，无模型、账户或订单调用。结果中的 DatasetRef 来自已清理的临时工作区，完整比较输入仍保存在输出 JSON 中。

2026-09-14 的 [实测结果](../../output/portfolio-comparison-2026-09-14-r05.json) 为 pass：270042.OF、110022.OF 和 000300.SH 在 2025-01-06–17 有 10 个共同估值日；独立 FX 样本为 10 条。范围仅是这些固定样本，不扩展为全部 A/HK/US/基金权限或真实跨币种组合验收。

## 2026-10-13：相对基准方向与回答复核

保留的真实原文曾在数值正确的表格后说“Stable 与基准收益持平（0% vs +19.5%）”。新增 [同区间收益比较](../../src/quant/relative-return.ts)，共用计算 `组合总收益 − 基准总收益` 的方向：正值跑赢，负值落后，仅绝对差不超过 `1e-12` 的浮点噪声视为持平。这个阈值用于浮点误差，不是统计显著性或显示舍入容差；百分点差不被称为 alpha。

工具输出与归档重算的研究上下文均通过现有方法说明模块加入两组的确定性方向。Core 39%、SPY 19.5% 对应跑赢 19.5 个百分点；Stable 0% 对应落后 19.5 个百分点。共用说明使用公开标签 Portfolio A/B，不携带私有组名。新增的是当前派生说明，不修改比较格式、方法版本或旧归档字节。

[回答检查](../../src/runtime/evidence/portfolio-relative-claims.ts)只核对当前已完成任务、同一核验调用、组名、基准参数及已核验基准总收益绑定后的明确肯定断言。没有基准指标时不凭 fixture 补造证据；否定、条件句、引文与代码块不作为肯定结论。检查覆盖有限语法，不包含任意改写、关系表格或一般金融语义判定。发现矛盾后保留原文并提示复核、暂停该轮自动报告，不另发模型请求。

新增 **42 项测试**。原文红测为 **8 pass / 6 fail**；第一轮定向 **42 pass / 0 fail，5 文件、1.78 秒**。首次全量为 **2181 pass / 2 fail，250 文件、239.00 秒**：新增说明带入私有组名，被公开分享的现有隐私回归拦截。改用 Portfolio A/B 并新增私有名称隔离测试，含报告分享的回归 **55 pass / 0 fail，6 文件、2.41 秒**；第二轮全量 **2184 pass / 0 fail，250 文件、241.00 秒**。实际本地 Pi/SSE 回归覆盖首次研究及恢复阶段的复核、自动报告暂停、错误原文保留、有损压缩后的重启、正确说明恢复生成报告，并核对比较归档字节未变。

[真实模型复验](../../output/relative-benchmark-live-portfolio-2026-10-13.json)使用保存的 zai-coding-cn / glm-5.3-flash 连接与隔离的合成价格：**7/7 自动门槛，7 请求事件，exit 0**，两阶段的 39% / 0% / 19.5% 与 ±19.5 pp 正确，未再出现原持平矛盾。人工阅读发现首次解释仍称单成员买入持有组合的权重随价格漂移；单成员的内部权重始终为 1，这处泛化不严谨。因此完整语义验收仍未通过，不扩展为真实账户、实盘行情或全部研究案例的成功率。

改用公开标签后又运行 [第二次模型复验](../../output/relative-benchmark-public-live-portfolio-2026-10-13.json)：原结果 **7/7 流程门槛、7 请求事件、exit 1、passed=false**，研究阶段的数值检查错误地把“SPY 总收益 19.5%”归到之前的 Stable。保留原失败标记。新增六项测试，区分已绑定基准的指标主语、括号中的普通基准引用，以及明确比较 drawdown/Sharpe/volatility 的断言；后一类不按总收益方向判断。边界红测 **25 pass / 5 fail**，引用语境另为 **8 pass / 1 fail**；最终相关回归 **110 pass / 0 fail，7 文件、19.58 秒**。当前对第二次原文的重检另行保存，不回写原报告，也没有第三次实时模型运行。最后修改限于指标/方向检查与其测试，方向计算、工具说明与模型提示保持第二次运行时的源码。

复跑方式（本地测试与工程检查不调用模型；最后一条调用保存的模型连接，输出路径必须不存在）：

```powershell
bun test src/quant/test/relative-return.test.ts src/quant/test/portfolio-comparison-notes.test.ts
bun test src/runtime/test/portfolio-relative-claims.test.ts src/runtime/test/portfolio-answer-evidence.test.ts src/runtime/test/portfolio-relative-session.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
bun run eval:research -- --case portfolio --timeout-ms 300000 --max-requests 12 --output output/relative-benchmark-next.json
```

最终全量 **2190 pass / 0 fail，250 文件、237.61 秒**，类型检查、架构检查、构建及正常配置下的 `git diff --check` 通过。[验收快照](../../output/relative-benchmark-validation-2026-10-13.json)保留三轮全量日志、两次真实模型结果、当前有限原文重检及源码冻结。F12/F24 仍为部分完成，25 项盘点保持 **17 完成 / 8 部分完成**。
