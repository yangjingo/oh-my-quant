# Agent Loop Context Assembly

状态：截至 2026-06-18 最新。

推荐阅读顺序：

- 首先阅读 `docs/agent-system-spec.md` 了解完整架构和所有权边界。
- 其次阅读 `docs/pi-agent-loop-harness.md` 了解 run-loop 和 harness 机制。
- 当您具体需要确切的模型输入 vs UI 文本 assembly 路径时，再阅读本文档。

本文档描述当前 WhyJ Quant agent loop 中真实的 context assembly 路径。

## 高层路径

用户输入路径：

`src/app-runtime.ts`
-> `dispatchUserMessage()`
-> `QuantAgentSession.prompt()` 或 `followUp()` 或 `steer()`
-> `src/agent/src/context.ts` 中的 prompt/context assembly
-> pi `AgentHarness`
-> tool calls / skill calls / assistant generation
-> runtime events 返回 TUI

一个 turn 有两个不同的视图：

1. 模型面向的 context
2. 用户面向的 TUI 文本

它们相关但不完全一致。

## 模型面向的 Context 路径

### 1. 原始用户输入从 `AppRuntime` 进入

文件：[src/app-runtime.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/app-runtime.ts)

`runAgentPrompt(input)` 通过以下方式转发原始用户输入：

`dispatchUserMessage(this.agent, input, input)`

第一个 `input` 是面向模型的文本。第二个是 `displayText`，保留原始用户可见副本。

### 2. Dispatch 选择 turn 模式

文件：[src/agent/src/dispatch.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/dispatch.ts)

- idle -> `prompt()`
- 正在 streaming 且无待处理工具 -> `followUp()`
- 正在 streaming 且有待处理工具 -> `steer()`

三种路由现在都在 `session.ts` 内部使用相同的 turn-context injection 逻辑。

### 3. Session 持有 turn injection

文件：[src/agent/src/session.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/session.ts)

- `prompt()` -> `injectTurnContext(input, sessionCtx)`
- `followUp()` -> `injectTurnContext(extractMessageText(message), sessionCtx)`
- `steer()` -> `injectTurnContext(extractMessageText(message), sessionCtx)`
- `skill()` -> `injectSkillContext(name, additionalInstructions)`

这是面向模型增强的唯一真源。

## Session Context 字段

文件：[src/agent/src/context.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/context.ts)

`injectSessionContext()` 追加一个轻量元数据块：

- `last_symbol`
- `last_market`
- `last_start`
- `last_end`
- `recent_tool_state`

### 含义

- `last_symbol` / `last_market` 帮助解析如"it"这样的后续引用
- `recent_tool_state.tool` 存储最近的工具族，如 `check_risk` 或 `show_dashboard`
- `recent_tool_state.result_shape` 存储更稳定的形状提示，如：
  - `risk_metrics`
  - `backtest_metrics`
  - `dashboard_ranking`
  - `benchmark_score`
  - `factor_metrics`
  - `snapshot_kv`
  - `symbol_list`
  - `bars_summary`

在恢复通用后续请求应保持结构化时，优先使用 `recent_tool_state.result_shape` 而非 `recent_tool_state.tool`。

注入的形状现在有意为 object-like，而不是增长更多扁平字段：

```text
<!-- session context -->
last_symbol: 000300.SH
last_market: A
recent_tool_state:
  tool: show_dashboard
  result_shape: dashboard_ranking
```

## System Prompt 路径

文件：[src/agent/src/context.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/context.ts)

`buildSystemPrompt()` 组装：

1. `BASE_SYSTEM_PROMPT`
2. 可用缓存数据块
3. 发现的 skill 块
4. 可选的额外文本

基础 prompt 现在包括：

- 通用输出约束
- 对比型结构化输出偏好
- 内置工具结果保留契约：
  - `fetch_bars`
  - `search_symbols`
  - `fetch_snapshot`
  - `compute_factor`
  - `run_backtest`
  - `check_risk`
  - `score_benchmark`
  - `show_dashboard`

这使模型偏向于保留重要行，即使用户没有显式要求表格。

## Turn 级渲染引导

文件：[src/agent/src/context.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/context.ts)

`injectTurnContext()` 执行：

1. `injectSessionContext()`
2. 条件渲染引导

渲染引导有两层：

1. 通用结构化输出规则
2. 工具族特定规则

### 渲染引导何时触发

对显式结构化输出请求触发：

- `table`、`chart`、`compare`、`ranking`、`holdings`、`backtest`
- `表格`、`图表`、`比较`、`排行`、`持仓`、`回测`

对通用后续请求也触发：

- `continue`
- `expand`
- `drill down`
- `继续`
- `展开讲一下`

但仅当 `recent_tool_state.tool` 或 `recent_tool_state.result_shape` 可用时。

### 为什么存在 `recent_tool_state.result_shape`

如果用户仅说 `继续`，新 turn 可能完全不包含工具关键词。

在这种情况下：

- `recent_tool_state.tool=check_risk` 有用
- `recent_tool_state.result_shape=risk_metrics` 更好

因为第二个值直接告诉 prompt 层应保留哪个行族。

## 工具到形状的恢复路径

文件：[src/agent/src/session.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/session.ts)

在工具生命周期事件期间：

- `tool_execution_start` 存储：
  - `sessionCtx.recentToolState.toolName`
  - 初始的 `sessionCtx.recentToolState.resultShape`
- `tool_execution_end` 存储：
  - 最终的 `sessionCtx.recentToolState.toolName`
  - 最终的 `sessionCtx.recentToolState.resultShape`

当前形状恢复是轻量的：

1. 首先检查结构化 `result.details`
2. 然后直接从工具名映射
3. 然后可选地从工具结果文本细化

示例映射：

- `run_backtest` -> `backtest_metrics`
- `check_risk` -> `risk_metrics`
- `score_benchmark` -> `benchmark_score`
- `show_dashboard` -> `dashboard_ranking`
- `fetch_snapshot` -> `snapshot_kv`

## Compaction Context 设计

`/compact` 不仅是 session-control slash 命令。在 WhyJ Quant 中它也是 context 设计的一部分，因为 compaction 的输出成为未来的模型面向 context。

文件：

- [src/cli/handlers/system.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/cli/handlers/system.ts)
- [src/agent/src/pi/harness/compaction/compaction.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/pi/harness/compaction/compaction.ts)
- [src/app-runtime.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/app-runtime.ts)
- [src/tui/src/render.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/tui/src/render.ts)

### 运行时路径

当前 `/compact` 流程：

`AppRuntime.submit("/compact ...")`
-> `compactHandler()`
-> `agent.waitForIdle()`
-> `agent.compact(customInstructions)`
-> pi harness `compact()`
-> 将 compaction entry 追加到 session tree
-> 重建 `agent.state.messages`
-> runtime 从 session state 同步 conversation

重要边界：

- `compact()` 之前需要 `waitForIdle()`
- `compact()` 由 harness phase 控制，而非 TUI state
- 生成的摘要作为 session-tree compaction entry 持久化，而非仅在 UI 中显示一次

### 为什么这是 context 层关注点

未来的 turn 在历史被压缩后不会重新读取旧的原始历史。

相反，`buildSessionContext()` 使用以下内容重建 context：

- `firstKeptEntryId` 之后保留的最近消息
- 从 compaction entry 生成的合成 `compactionSummary` 消息

因此 compaction 摘要的质量直接影响：

- 模型仍然记住的内容
- 通用后续请求如 `继续` 是否保持上下文扎根
- 量化输出是否保持与正确的 symbol、日期范围和策略假设关联

### 量化特定的 compaction 要求

WhyJ Quant 现在向 compaction 摘要 prompt 添加量化感知的指令。当 session 涉及量化研究时，摘要应保留：

- symbol、benchmark、universe、交易所和组合名称
- 日期范围、回看窗口、再平衡频率和时间框架假设
- 因子定义、信号规则、策略参数和风险限制
- 数据 provider、缓存/本地文件路径和任何数据质量注意事项
- 已验证的发现、开放假设以及对下一步重要的指标
- 输出形状偏好，如紧凑表格、排名和风险仪表盘

这有意比通用 coding-session compaction 更严格。设计目标是保留研究状态，而不仅仅是实现进度。

### `/compact` 完成回执

slash-command 回执现在也是量化感知的。成功时仍然显示：

- `first kept`
- `tokens before`

但也从生成的摘要中提取紧凑的研究状态回执：

- `scope`
- `dates/window`
- `params/risk`
- `open threads`

此回执不是权威 context 存储。权威存储仍然是 session tree 中的 compaction entry。回执存在的目的是让用户验证最重要的研究状态在 compaction 中幸存。

### Compaction 期间的 TUI 可见性

TUI 现在将 compaction 展示为显式活动，而不仅是静默的 slash 命令：

- runtime 在命令运行前将 activity 设为 `compacting`
- 如果 agent 仍在完成 turn，状态首先说明 compaction 正在等待 idle
- 在 compacting 期间，conversation 面板使用与 `thinking` 相同的 ora 风格 spinner 和动画金色横幅处理
- 当 conversation 为空时，loading overlay 副本从 `WhyJ is thinking...` 变为 `WhyJ is compacting...`

这很重要，因为 compaction 可能耗时足够长，在没有可见进度时感觉像坏了，尤其是当 runtime 仍在排空上一个 turn 时。

## Skill 路径

文件：[src/agent/src/context.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/context.ts)

`injectSkillContext()` 向显式 skill 运行追加一个小的结构化输出契约。

对于 quant / trader / benchmark 风格 skill，它显式强化：

- 保持结构化行可见
- 优先使用紧凑纯文本表格或图表风格块
- 保留评分行、排名行、风险行和回测指标行

## 用户面向的 TUI 路径

TUI 优先使用原始显示文本而非注入文本。

文件：

- [src/agent/src/dispatch.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/dispatch.ts)
- [src/app-runtime.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/app-runtime.ts)

相关行为：

- 用户 turn 携带 `displayText`
- runtime 在渲染队列/对话文本时优先使用 `displayText`

因此模型可能看到额外的 session context 和渲染引导，而用户仍看到原始 prompt 文本。

## 队列路径

排队的 follow-up 在稍后被消费时也流经相同的面向模型注入路径。

运行时队列 UI 保持可读，因为它使用 display text extraction 而非注入文本。

## 具体总结

### 普通用户 turn

`AppRuntime.submit()`
-> `runAgentPrompt(input)`
-> `dispatchUserMessage(agent, input, input)`
-> `session.prompt()/followUp()/steer()`
-> `injectTurnContext(rawInput, sessionCtx)`
-> 可选 session metadata block
-> 可选 structured render guidance block
-> `AgentHarness`

### Skill turn

`/skill:...`
-> `session.skill(name, extra)`
-> `injectSkillContext(name, extra)`
-> `AgentHarness.skill(...)`

### 工具结果后的通用 follow-up

前一个工具结束
-> session 存储 `recent_tool_state.tool` 和 `recent_tool_state.result_shape`
-> 用户说 `继续`
-> `injectTurnContext()` 看到通用 follow-up 语言
-> 从 `recent_tool_state.result_shape` 恢复正确的行族
-> 模型保持与之前结构化结果对齐

## 验证

相关测试：

- [src/agent/test/context.test.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/test/context.test.ts)
- [src/agent/test/session.test.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/test/session.test.ts)
