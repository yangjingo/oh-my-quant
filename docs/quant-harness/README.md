# Quant Harness：量化应用的完整运行环境

更新：2026-10-14。这里的 Quant Harness 指围绕通用 Agent 构建的完整量化应用：产品目标与工作流、数据、计算、工具与技能、存储、执行、报告、UI/UX，以及配置和评测都在本目录内。通用模型循环、队列、取消与会话提交由 [Agent Runtime](../agent-runtime/README.md)维护。

本页先给出整体入口，再维护研究编排核心的任务、范围、证据与恢复契约。`src/runtime/quant-harness.ts` 只是该核心的装配实现，不等于整个目录的范围。执行设计属于 Quant Harness，但是否进入默认 Agent、能否交易和私有账户授权仍由各自契约决定。

## 本目录的阅读路径

| 组成部分 | 现行文档 |
|---|---|
| 目标、状态与演进 | [GOALS](./GOALS.md) · [PRD](./PRD.md) · [Roadmap](./roadmap.md) |
| 应用骨架与持久化 | [模块架构](./module-architecture.md) · [存储策略](./ohquant-storage-policy.md) |
| 数据、工具与技能 | [数据源](./source-data-providers.md) · [工具与计算](./quant-tools-design.md) · [Skills](./trader-skills.md) |
| 领域研究 | [组合比较](./portfolio-comparison.md) · [新闻](./news-research.md) · [Alpha 回测](./alpha-backtest.md) |
| 账户与执行 | [账户业绩](./performance.md) · [执行](./execution.md) |
| 报告与交互 | [制品](./artifacts-design.md) · [年报](./annual-reports.md) · [UI/UX](./quant-uiux.md) · [Windows 桌面宿主](./desktop.md) · [Web 研究工作台](./research-workspace.md) |
| 使用与验证 | [配置](./configuration.md) · [手册](./user-guide.md) · [命令](./slash-commands.md) · [评测](./evaluation.md) |

文档在此归为一个应用体系，代码仍按 Source、Quant、Storage、Execution、Artifact、Runtime 与 TUI 的职责分开。UI/UX 不是研究结束后的包装，它承担输入、过程可见性、错误恢复和结果呈现；数据与计算也不是 Harness 外部的附录，而是研究得以成立的组成部分。返回[全部文档](../README.md)。

<a id="composition"></a>

## 1. 研究编排核心：把规则装配到 Agent

[Quant 工厂](../../src/runtime/quant-harness.ts)在通用会话上绑定 `research_task` 控制工具、请求工具子集、调用前任务守卫与研究核验。它不拥有供应商协议，也不重新实现指标公式。只往普通 Agent 中注册一个同名工具，不等于已接入这些约束。

```text
用户研究目标 → 任务范围与接受条件 → 本轮工具/技能子集
                                      ↓
                         通用 Agent → 工具 → 固定数据/计算
                                      ↓
当前分支事实 ← 会话账本 ← 调用结果 → 证据核验 → 报告与任务状态
```

| 研究编排核心决定 | 配合的运行机制与应用组件 |
|---|---|
| 本任务允许哪些工具、标的、日期与基准 | Agent 负责执行、快照、取消与持久化屏障 |
| 哪个调用和固定版本能满足接受条件 | Source/Storage 提供来源与归档，Quant 执行纯计算 |
| 已给材料、模型能力、依赖是否支持本次技能模式 | [Skills](./trader-skills.md)维护安装/发现/资格机制 |
| 恢复后哪些研究结论仍然有证据 | Artifact 保存报告版本，研究核验重新判断有效性 |

宿主预检先于 Quant 任务预检；成功声明先提交会话事件，再影响下一轮请求。不为请求子集写永久活动工具事件，也不因任务缺能力自动启用扩展。会话空闲不等于研究 complete，模型回答完毕不等于接受条件通过，研究 complete 更不授权交易。

字段与公式分别回到[工具与计算](./quant-tools-design.md)、[数据源](./source-data-providers.md)、[存储](./ohquant-storage-policy.md)和[报告](./artifacts-design.md)。这些都是 Quant Harness 的组成文档；本页维护它们怎样共同约束一次研究，不把接口、公式和布局说明逐字复制到总览。

<a id="research-state"></a>

## 2. 从当前分支重建研究证据

状态读取当前 leaf 的完整祖先链（`Session.getBranch()`），不混入其它分支，也不以压缩后的 `buildContext()` 消息替代原始工具事实。模型总结可以帮助理解，不能产生指标、数据引用或完成证明。

| 投影字段 | 来源 |
|---|---|
| requests | 原始用户 displayText 与 entry 身份，不把隐藏元数据当用户原文 |
| operations | 有序的 tool call/result 配对、callId/callEntryId、受支持参数与执行状态 |
| references | bars/NAV 的固定修订、角色、窗口、provider、观察日期及重新核验状态 |
| findings | 用固定输入独立重算的受支持指标，不从回答文本抽取“事实” |
| comparisons | 成员、版本、权重、窗口、基准、币种和各条曲线 |
| reports | 来源 leaf、父链和固定版本/hash；文件存在不足以验证 |
| task / taskErrors / unresolved | 当前任务、范围或证据错误、尚未解决的调用 |
| availableTools | 宿主活动工具目录，不是本轮任务交集，也不是权限证明或指标验证器清单 |

操作状态需分开：尚无结果为 pending，明确工具错误为 failed，缺归档/不支持/歧义/坏数据为 unverified，重算一致才是 verified，管理操作可以 recorded 而不产生量化 finding。结构化 `details.error` 保留失败原因，不把错误文本中的数字解析为指标。

`evaluatedDates` 是实际参与计算的日期，不能直接使用归档全集日期代替。组合报告的 Portfolio A/B、Benchmark · symbol 保持独立序列身份。数据删除或校验失败会撤销相应 findings，不拿最新缓存补回旧结论；固定报告也不重写原字节。

投影给模型时保留当前任务的验收证据，再补最近操作与未解决事项：近期操作和 unresolved 各取 6 项、去重后总量有界；保留首个和最近 3 个请求，任务绑定报告加最近 3 份报告。嵌套列表、字段和文本另有 24 项、64 字段、2,000 字符等预算，并显式说明省略量。完整状态 API 不受同一投影裁剪。这里是字符/条目预算，不保证精确 token 数或任意规模下的性能。

任务绑定报告靠事件关联，不仅靠相同 reportRef；`reportAvailable` 还要经过宿主固定版本核验。因此很早的任务报告可以保留，而后来同名但属于另一任务的报告不能替代它。投影只是衍生视图，不再保存第二份研究状态文件；它包含用户请求和名称，不应直接公开分享。

<a id="tasks"></a>

## 3. 显式任务、范围与接受条件

ResearchTaskSpec 保存 request、goal、scope（市场/标的/日期及可选 benchmark、观察组 revision）、constraints.allowedTools 与 notes、dataRefs、criteria 和 reportRequired。自然语言转成结构化任务仍可能出错，不能把结构完整当意图理解正确。

宿主显式提交的任务必须有非空 ID。模型第一次声明、且会话尚无任务时，可以省略 ID，由宿主使用当前用户请求 entry 派生 `study-<entryId>`；这只补身份，不补目标、数据或验收条件。已有任务（包括 cancelled）再次声明时，必须显式沿用原 ID 或指定新 ID。原工具调用与规范化后的 journal 分别保留，恢复时重新检查。

| 状态 | 意义 |
|---|---|
| active | 范围内工作尚有未完成接受条件 |
| blocked | 当前范围、证据或必需报告存在不能满足的条件 |
| complete | 所有受支持接受条件和要求的报告都核验通过 |
| cancelled | 显式任务取消；不会由停止一次请求自动产生 |

### 声明与修改

`research_task` 支持 read/declare/resolve/cancel。read 返回当前 requestEntryId、可复制的 expectedRevision、受支持的 acceptanceTools，以及当前可用价格、基金、组合工具的 metricLabels；这些目录来自共享核验规则，不由模型猜测。注册工具并不自动获得研究核验器，用户材料评分和假设持仓算术也不会因此成为归档财务事实。

初始 revision 令牌绑定当前用户 entry；已声明任务使用已提交事件身份。省略/错误/过时令牌拒绝；没有原始用户请求也不能声明。内部 journal 的历史 null 前置条件由宿主处理，不是模型可以省略令牌的理由。同 ID 修订保留任务起点，新 ID 创建新任务；新用户请求或新声明使旧初始令牌失效。

declare 与计算应分开工具轮次。任务起点之前的计算不能事后被追认；符合修订后判据的同任务证据可以复用，但不得为了“完成”而删除用户限制。dataRefs 可以先为空，不能编造 hash。完整 journal 事件和成功工具结果共同证明提交，不修改旧事件。

### 判据与指标

每项 criterion 指定工具、完整计划参数及指标；调用多出 cash、日期、费用或其它参数也会导致不匹配。参数是双向深比较，不能只比较挑选的字段。指标列表为空仍要求该工具结果 verified，不表示自动成功。

验收只使用任务起点之后、范围内且固定输入可重算的调用。同一对象的多个准则不能混用不同观察修订；Dashboard 的既定集合是允许内部多修订的特殊结构，但显式 dataRefs 仍限制其输入。因子 warmup 必须位于窗口内；基金 .OF 规范化、归档全集与实际评价区间不可混同。组 revision 约束主要由组合比较核对。

metricLabels 使用核验器原名；组合包含 Common dates、Portfolio A/B 和明确 Benchmark · symbol 各自的指标。声明前可向 read 提供指定 benchmark 来查询名称，不会修改任务；没指定时不猜一个基准。被禁用工具不出现在目录，零波动导致的 Sharpe=null 不是有效数字；收益分数与百分数不混用。

指定 benchmark 时，`score_benchmark` 的默认 000300.SH 不能代替用户 SPY，即使 SPY 也在 symbols 中。未指定 benchmark 时，评分/比较的辅助基准可在目标标的集之外。Dashboard 核验全部有效记录，而不是屏幕前 10 行；坏文件单列，缺引用的有效记录不能让整个汇总冒充 verified。

### 工具与副作用

一次请求的工具是宿主允许集合与任务 allowedTools 的交集；`research_task` 控制面保留，cancelled 任务只保留控制面。成功声明先持久化，再影响下一工具轮次；不写永久活动资源事件，不自动启用扩展。任务排除 bash 时，相应技能资格也撤销，而不是只隐藏工具标签。

调用前核对工具、对象、日期、基准和数据范围；`constraints.notes` 是说明，不是通用策略语言。单个被阻止的工具批次可终止继续请求，但混合 Pi 批次不能宣称所有兄弟调用都被事务性撤销。宿主 guard 在 Quant guard 之前生效。

通用 system prompt 只描述实际 schema；没有 bash 就没有 shell 引导。对已提供材料的解释不应强制补做“价格→因子→风险”流程。已有任务仍须保留原约束，具体见[技能证据模式](./trader-skills.md#supplied-evidence)。

<a id="recovery"></a>

## 4. 重试、报告与恢复

失败和重试保留各自调用身份，不能靠“后来有成功”清除前一个错误。resolve 要指定 from/to 的 callEntryId、callId 和原因；源必须仍未解决，目标必须是更晚、同参数、同任务数据资格且 verified 的调用。数据消失或修订失效后，原 resolve 也不再生效，不能手动标记成功。

恢复先核对报告字节、hash、来源 leaf 和父链，再准备研究上下文、技能、提示和模型连接，全部成功后提交目标 leaf。外部 SessionRepository 应提供自己的原子提交语义；不能用默认 JSONL 的行为替所有宿主承诺。必需报告的来源 entryIds 须包含当前任务 revision 及全部已满足判据所用的结果 entry，并绑定相应 report entry；同 revision 下、最终计算之前生成的报告也不合格。固定版本无效或未知会阻止要求报告的任务完成。

`/resume --task` 打开当前 Quant 会话的只读任务投影。查看与本地刷新不调用模型、provider，不移动 journal leaf；不添加额外 ID 参数。修订/继续通过 Composer 形成新研究输入。取消 preparation 不回滚此前已成功提交的用户请求或任务事件。

任务状态包含私有请求和参数，不直接变成分享 DTO。固定数据引用只能证明本应用保存过该版本，不证明供应商历史发布时间、完整交易日、总回报口径或真实账户；公开制品另按 [Artifact](./artifacts-design.md) 白名单投影。

<a id="images"></a>

## 5. 显式图表输入

```text
/skill:technical-analyst --image PATH
/skill run technical-analyst --image PATH
```

只读取用户明确指定的本地 PNG/JPEG/WebP，不接收 URL、不扫描目录、不自动读取截图缓存。CLI 一张；session API 最多 4 张、每张 8 MiB、合计 16 MiB，还受模型更低的限制。检查格式头不等于完整图像解码认证。

当前入口用于明确选择的公开市场图表；账户截图仍缺少独立的私有输入/输出契约，不属于这里已经支持的授权边界。

`prompt()` / `skill()` 的 images 与 AbortSignal 通过请求上下文进入模型消息，不把原生图片块永久写入用户 prompt。同一 operation 的工具轮次保留像素，结束/失败/取消后释放。忙碌时携图 steer/follow-up 不被接受，普通文本仍按原队列工作；恢复、压缩或下一次独立请求均须重新显式附图。

JSONL/UI 只保留随机附件 ID、MIME、大小、SHA-256 和过期提示，不保存像素或附件路径；用户自己在原始文字中写出的路径不由这一元数据规则抹除。图像会发给所选模型服务，普通文字与生成分析仍按正常会话持久化。这不是所有输入的隐私过滤器。

只有模型支持 image 且宿主提供图像通道才能使用；文件存在不等于本轮已附图。读图得到的价位、趋势和概率是视觉估计，不升级为 bars 重算或经过校准的交易概率。

<a id="verification"></a>

## 6. 实现与验证入口

核心入口：[会话 facade](../../src/agent/src/session.ts)、[依赖端口](../../src/agent/src/session-contracts.ts)、[默认本地组装](../../src/runtime/session-dependencies.ts)、[Quant 装配](../../src/runtime/quant-harness.ts)、[研究任务工具](../../src/tools/research-task-tool.ts)。自定义量化宿主应从 Quant 工厂保留任务 guard 与证据核验，不能仅把同名控制工具塞进普通 agent。

重点回归：[依赖隔离](../../src/agent/test/session-dependencies.test.ts)、[生命周期](../../src/agent/test/harness-lifecycle.test.ts)、[研究恢复](../../src/agent/test/research-recovery.test.ts)、[请求资源](../../src/agent/test/turn-resources.test.ts)、[图片会话](../../src/agent/test/chart-image-session.test.ts)、[任务工具](../../src/runtime/test/research-task-tool.test.ts)、[报告恢复](../../src/artifact/test/report-recovery.test.ts)。

```powershell
bun test src/agent/test/session-dependencies.test.ts src/agent/test/research-recovery.test.ts src/agent/test/turn-resources.test.ts src/runtime/test/research-task-tool.test.ts
bun run typecheck
bun run check:architecture
```

本地 Pi/SSE、JSONL 与合成输入回归可以检验调用、分支、压缩和拒绝行为，不证明任意模型解释或真实服务均正确。完整状态和真实模型评测方法分别由 [PRD](./PRD.md)、[评测指南](./evaluation.md#tasks) 维护；本页不保存容易过时的阶段通过数。
