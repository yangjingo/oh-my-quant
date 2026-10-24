# Agent Runtime：通用会话运行时

更新：2026-10-22。本目录维护架构、会话、存储、配置与扩展；产品、数据和研究规则见 [Quant Harness](../quant-harness/README.md)。文档分类不代表代码已拆包。

调用链：宿主组装 → Agent 会话 → Pi 循环。Quant 注入任务、工具范围与证据核验，复用会话账本；模块边界见[架构](./architecture.md)。

## 本目录与相邻入口

| 入口 | 阅读目的 |
|---|---|
| [模块架构](./architecture.md) | 先看多入口架构图、Host、共享服务与依赖边界 |
| 本页 | 会话生命周期 |
| [存储策略](./storage.md) | 路径、提交与归档 |
| [扩展宿主](./extensions.md) | 理解受信任扩展的资源声明、启停与修订 |
| [Quant Harness](../quant-harness/README.md) | 理解完整量化应用如何消费上述机制 |
| [Quant 配置](./configuration.md) | 数据、报告与回测选项 |

<a id="lifecycle"></a>

## 1. 会话所有权与请求生命周期

Pi 提供模型协议和 agent loop；WhyJ 持有产品会话、JSONL 分支、队列、压缩、工具装配和 UI 事件。协议兼容不等于把整个产品生命周期交给上游。

```text
宿主端口 → 会话资源准备 → 独立请求快照 → Pi loop / tools
                              ↓                 ↓
                         当前任务范围       会话事件账本
                              ↑                 ↓
                    恢复与重新核验 ← 当前 leaf 的祖先链
```

一次 HarnessOperation 覆盖内部准备、模型/工具执行、持久化及被等待的监听器，但不覆盖 facade 之前的模型、技能、研究资源同步。因而 `waitForIdle()` 不是全应用事务屏障；operation 内的监听器也不能等待它自身结束。Overview 有自己的刷新、取消和代次，不由模型空闲状态决定。

独立 `prompt()`、`skill()` 和手动压缩在入口准备新快照；运行中的请求及其排队 follow-up 使用原连接和资源。修改配置不能中途替换模型 endpoint、凭证或工具集合。取消会中止尚未完成的工作，但不回滚已经提交的事件；“停止这次模型请求”与“取消研究任务”是不同动作。

<a id="dependencies"></a>

## 2. 宿主依赖与可替换端口

`agent/src/session.ts` 的 `createAgent({ dependencies, cwd? })` 必须接收完整依赖，不偷偷补默认 settings、sessionsRoot 或 skillPaths；未传 cwd 时取 `dependencies.env.cwd`。本地应用用 [createLocalAgent](../../src/runtime/session.ts)，由 runtime 绑定默认 I/O；显式传入 dependencies 时不再默认组装。需要部分默认行为时，显式调用 [createDefaultSessionDependencies](../../src/runtime/session-dependencies.ts) 再覆盖端口。低层会话不是默认 Quant 工具包的别名，注入空工具数组就是零工具。

| 端口 | 责任与边界 |
|---|---|
| `env` | 执行环境，不从外层进程隐式取项目目录 |
| `sessions` | create/open/list，返回 Session；自定义 repository 不必使用 JSONL |
| `tools` | 完整 schema 与 execute，重复名称立即失败 |
| `readTools` | 可选动态完整工具集合、revision 和扩展技能/能力；不是追加全局工具 |
| `readConnection` | model、thinking、压缩阈值、延迟鉴权和恢复连接；鉴权闭包必须属于同一连接快照 |
| `loadSkills` / `readSkillRevision` | 已解析技能内容及修订观察；非任意文件自动监控 |
| `readSkillCapabilities` / `prepareSkills` | 可选的自定义宿主策略；默认 Skills 直接使用 Pi 加载结果，不附加逐技能资格 |
| `prepareRequestResources` | 由 research、skills、rawSkills 生成本次请求子集，不改写会话活动资源历史 |
| `beforeToolCall` | Pi 参数校验后执行宿主检查，再执行 Quant 任务约束；可阻止并给出原因或终止要求 |
| `prompts.system/turn/skill` | 构造提示；必须与当前真实工具集合一致 |
| `verifyResearch` | 研究扩展端口；Quant 宿主提供证据投影，具体语义归 Quant Harness |
| `verifyReport` | 可选的固定报告来源/版本检查；缺少实现时是未知，不因文件存在就通过 |

runtime 工厂绑定默认 I/O；agent 不导入 runtime/tools/cli/tui，架构及加载链构建回归防止间接引入宿主。回调须自约束 I/O 并响应取消，不构成沙箱。工具 schema、描述和技能内容采用隔离快照；`getSkills()` 不暴露可修改内部数组。恢复的活动工具与宿主当前集合取交集，不能把空集合解释成“全部”。

`readTools` 的工具集合改变会提交活动资源事件；单纯刷新技能不冒充工具变更。新资源需全部准备成功才发布，失败保留旧快照；分支切换后晚到的准备结果不能发布。安装、Python/技能目录配置及可信能力变化参与 revision；路径数组复制，函数路径下次加载时读取。发现与手工 reload 见[Skills](../quant-harness/community-tools.md#discovery)。

shell/local-resource-read 能力只能由真实 bash 工具支持，不能用同名声明伪造；扩展能力的 `requiresTools` 随任务子集再次收缩。图像能力同时受实际模型和输入通道约束，宿主明确的 missing/unverified 不被模型名称覆盖。静态受信任扩展不是 Pi ExtensionAPI，也不是执行沙箱；见[扩展边界](./extensions.md)。

<a id="pi-integration"></a>

## 3. Pi 适配与消息屏障

可执行循环只经 [kernel/loop.ts](../../src/agent/src/kernel/loop.ts)，协议与模型目录经 kernel 接入；共享上游类型可以直接引用，不复制供应商实现。Pi AI / Agent Core 的当前精确版本以 [package.json](../../package.json)和 [bun.lock](../../bun.lock)为准。WhyJ 保留自己的 JSONL v3 会话，不声称兼容 Pi 原生 ExtensionAPI。

UI 的 `tool_execution_*` 是进度，模型的 `toolResult` 是上下文事实；成功、参数错误和被阻止调用都必须按原调用顺序配对。适配使用可等待事件 sink 的 `runAgentLoop`：assistant `message_end` 提交完成后，才能执行工具预检。旁路消费 EventStream 只能观察事件，不能充当提交屏障。顺序/并行工具调度交给 Pi；一次轮次的持久化、`finishTurn` 与停止判断完成后才发出 `turn_end`。

Pi 1.x 使用 TranscriptContext；手写摘要请求先经 `normalizeContext()`，不能继续把旧 Context 直接送入新接口。`whyj.runtime` 命名 system section 用替换而非无限追加，工具增删沿用上游 transcript 语义；模型可见用户 content 与 UI 的 displayText 分开，模型转换仍是标准 user 消息。

每轮先 flush，再准备下一轮 context/model/tools/thinking；仍须遵守同一 operation 的资源快照。独立会话通过自己的 context 更新，不使用“最近会话”全局引用。延迟鉴权、base URL、headers（含 null 移除）、metadata 与显式清除均随连接快照进入对话、压缩和分支摘要，未知协议明确失败。

升级时还需核对 provider ID 与兼容字段：当前 Azure provider ID 是 `azure`，协议仍为 `azure-openai-responses`；旧 ID 不偷偷重映射，需用户修改或重新导入。`supportsMidConvoSystemMessages`、`supportsMidConvoToolAdditions`、`supportsMidConvoToolChanges` 按当前白名单保留；已移除字段 `supportsToolReferences`、`deferredToolsMode` 拒绝。请求模型与响应实际模型分开记录，fallback 计价仍交 Pi；恢复连接使用请求模型，不把服务端选择写成用户设置。

<a id="session-journal"></a>

## 4. 队列、分支与持久化

空闲输入进入 prompt，工具执行期间进入 steer，其余流式期间进入 follow-up；Composer 消费 `queue_update`，不持有另一份执行队列。turn、compaction、branch summary 互斥，清理在 finally 完成。`abort` 贯穿准备、模型与工具，并清理待续队列；监听器异常不能留下永久 busy，未成功 flush 的事件不能提前出队。取消不撤销已经提交的事实。

JSONL v3 用 id、parent、timestamp 和 type 形成分支树。当前上下文只沿 leaf 祖先链读取，恢复最近的模型、thinking、活动工具及摘要；全文分支证据与经过压缩的模型上下文是两个视图。Session 读口返回副本，写操作从已提交 leaf 串行计算。

默认 `SessionFilePort` / `LocalSessionFile` 用精确字节版本、进程锁、唯一临时文件及 fsync/rename 整体替换；外部编辑、追加或删除使旧 writer 冲突，内存只在提交成功后发布。完整 fork 一次提交；分支 fork 保留目标与标签所需祖先，不带入其它分支上下文。leaf 移动与摘要在同一批次提交，取消传播到锁等待，文件观察者异常不改变已确认提交。

失败重试保留原 entry 身份；提交结果不确定时先重新打开核实，不能改 ID 盲目重发。重复/歧义 ID、缺父节点、环、缺 leaf 或截断 JSON 拒绝恢复，Resume 隐藏坏记录但保留原文件。整文件复制成本随历史增长；[存储测量脚本](../../src/storage/dev/measure-session-storage.ts)用于观察这一代价，不承诺所有文件系统的断电安全。

reset/restore 等待旧初始化结束并取消旧工作，目标打开和资源准备全部成功后才替换；失败保留当前会话，迟到的旧事件不得发布。报告恢复即使仍在同一会话，也先完成全部来源核验和资源准备，再提交 leaf；领域要求见 [Quant 恢复](../quant-harness/README.md#recovery)。

<a id="compaction"></a>

## 5. 压缩、导航与扩展钩子

压缩追加摘要，不删除原 journal。默认保留约 20k 的近期上下文并预留 16,384 tokens；自动阈值从当前设置读取，默认模型窗口减预留量。摘要的目标、进度、约束等字段帮助继续对话，但不成为领域事实。手动压缩等待空闲；无可压缩内容是 no-op。

`navigateTree` 在同一文件移动 leaf；选择 user/custom 节点时可回到其父节点并返回可编辑文字，`resumeSession` 则打开整个会话文件。UI 通过 facade 请求导航，不直接截断历史。取消检查必须在追加摘要、移动 leaf 和发布状态前仍然有效。

<a id="hooks"></a>

宿主钩子包括 `before_agent_start`、context、`before_provider_request`/payload、`after_provider_response`、`tool_call`/`tool_result`、`session_before_compact`/`session_before_tree`。这些是受信任的应用回调，不是沙箱；阻塞钩子属于被等待的生命周期。`beforeToolCall` 在 Pi 参数校验后执行，阻止原因及 `terminate` 必须传递给上游；单个被阻止调用可结束请求，混合批次不是事务回滚。Quant 的预检规则由[任务约束](../quant-harness/README.md#tasks)维护。

<a id="verification"></a>

## 6. 实现与升级验证

关键回归：[Kernel 消息顺序](../../src/agent/test/kernel.test.ts)、[生命周期](../../src/agent/test/harness-lifecycle.test.ts)、[独立宿主](../../src/agent/test/session-dependencies.test.ts)、[会话提交](../../src/agent/test/session-journal.test.ts)、[工具停止规则](../../src/agent/test/tool-call-termination.test.ts)、[请求快照](../../src/agent/test/turn-resources.test.ts)。这些使用本地/合成输入，不替代真实模型账号验证。

升级核对 Pi 包精确版本、TypeBox 与锁文件，移除旧协议副本的路径别名；依次验证类型、架构、生命周期及构建。

```powershell
bun run typecheck
bun run check:architecture
bun test src/agent/test
bun run build
```

测量见[评测](../evaluation/README.md#model-performance)。Pi 的模型能力不决定量化研究完成度。
