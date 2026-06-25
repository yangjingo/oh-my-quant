# TUI 表格/图表渲染指南

状态：已于 2026-06-18 针对当前 agent 流程实现。

## 目标

当用户请求对比型输出（如持仓、排名、交易记录、信号或回测摘要）时，agent 应保留结构化结果可见，而不是将其折叠为长篇叙述。

本仓库不提供独立的 `quant-render` 包。当前方案刻意轻量：

1. 保持现有的 TUI message pipeline 不变。
2. 仅当请求可能产生表格或图表时，向 agent prompt 注入一个小的渲染契约。
3. 在调用 skill 时注入相同的契约，使 skill 驱动的工作流也保留结构化输出可见。

## 当前架构

本仓库中的实际路径为：

`AppRuntime.submit()`
-> `dispatchUserMessage()`
-> `QuantAgentSession.prompt()/followUp()/steer()/skill()`
-> `src/agent/src/context.ts` 中的 prompt injection
-> pi harness
-> tool / skill execution
-> 文本结果渲染回 TUI Conversation 面板

TUI 仍然渲染纯文本。此改动不增加新的渲染器 widget 层。它通过在 agent 决定如何格式化答案之前施加约束来提升输出质量。

## 为什么采用这种方式

此前的设计草案假设：

- 一个独立的渲染器包
- 制品 schema
- 渲染器主题
- MCP render tools

该设计超出了当前代码库的需要。今天的实际代码已经具有：

- 一个稳定的 agent session wrapper
- 一个单一的 prompt assembly 层
- 显式的 skill invocation
- 一个已经能良好展示多行结构化文本的 TUI

基于这些约束，性价比最高的改进是 prompt shaping，而不是渲染器子系统。

## 已实现的规则

基础 system prompt 现在包含一个紧凑的结构化输出契约：

- 对于排名、持仓、交易、信号和其他对比型输出，优先使用紧凑的纯文本表格
- 当工具或 skill 已产出结构化行时，保留它们
- 保持评论简洁
- 除非用户明确要求 markdown，否则不要手写 markdown 表格

同时包含内置工具结果保留契约，使模型对常见量化/数据工具完成后保留哪些行有默认规则：

- `fetch_bars`、`search_symbols`、`fetch_snapshot`
- `compute_factor`、`run_backtest`、`check_risk`
- `score_benchmark`、`show_dashboard`

此外，`injectTurnContext()` 仅对可能的结构化输出请求添加渲染提示，基于关键词触发：

- `table`、`chart`、`compare`、`ranking`、`holdings`、`trade log`、`backtest`
- `表格`、`图表`、`对比`、`比较`、`排行`、`持仓`、`交易记录`、`回测`

这保持常见路径轻量。普通对话风格的请求不会收到额外引导。

注入的提示分两个阶段：

1. 通用的结构化输出提醒
2. 可选的工具族特定提示：
   - backtest
   - risk
   - benchmark / dashboard
   - factor
   - symbol search
   - snapshot

第二个阶段仍然是纯文本。它不增加渲染器层；仅引导模型保留这些工具自然产生的行。

提示现在还可以通过 session context 回退到最近的工具族。这对以下类型的轮次很重要：

- `继续`
- `展开讲一下`
- `drill down`

如果上一个工具是 `check_risk`、`run_backtest`、`score_benchmark` 或 `show_dashboard`，后续轮次仍然可以恢复正确的结构化行偏好，而无需用户重复工具名。

恢复键现在是两部分：

- `recent_tool_state`

`recent_tool_state.result_shape` 是更稳定的提示，因为它直接存储行族，如 `risk_metrics`、`backtest_metrics` 或 `dashboard_ranking`。

## 注入点

### 1. 用户轮次注入

文件：[src/agent/src/context.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/context.ts)

- `injectTurnContext(input, ctx)` 先追加 session context
- 如果请求看起来是对比型，则追加一个小的 `render guidance` 块

### 2. Session 级别执行

文件：[src/agent/src/session.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/src/session.ts)

Session facade 对以下路径应用相同的策略：

- `prompt()`
- `followUp()`
- `steer()`
- `skill()`

这很重要，因为 prompt 契约必须在排队的 follow-up 和显式 skill invocation 中存活，而不仅仅是第一次用户轮次。

### 3. App runtime 简化

文件：[src/app-runtime.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/app-runtime.ts)

`AppRuntime` 不再预先注入 prompt 文本。原始用户输入被转发，session 层持有所有 prompt augmentation。这避免了重复或偏离的注入逻辑。

## 产生的行为

### 用户请求对比

示例：

`compare top 5 holdings and show a table`

Session 发送原始请求加上一个短的渲染提示，内容为：

- 优先使用紧凑的对齐纯文本表格
- 保持评论在表格周围最多 3 行短文
- 不要将结果展开为列表项

### 用户触发 skill

示例：

`/skill:whyj-quant focus on benchmark drift`

Session 传递原始指令加上一个小的 skill 侧附加说明：

- 保持结构化行可见
- 优先使用紧凑纯文本表格或图表风格块
- 保持解释简洁

在可见层，显式 skill 调用使用单独的 display text：

- Conversation 顶部状态行显示为 `● SKILL.<name> ...`
- 模型实际收到的 `<skill>...</skill>` 指令块不会回显到用户对话区
- 当已有同名 skill 状态行时，后续 `SKILL.<name>` 用户回显会被 runtime 折叠，避免出现两行重复标签

## 这不做什么

此更改不：

- 添加新的 TUI widget（表格或图表）
- 添加渲染器 MCP 工具
- 添加制品 schema
- 将工具 JSON 转换为专用视觉组件

如果 TUI 需要更丰富的渲染，这些仍然可以稍后添加。当前更改的范围是针对现有终端工作流的输出规范。

## 测试

覆盖：

- [src/agent/test/context.test.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/test/context.test.ts)
  - 结构化输出请求收到渲染引导
  - 普通对话请求不会收到
  - skill invocation 收到紧凑渲染引导
- [src/agent/test/session.test.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/agent/test/session.test.ts)
  - `prompt()`、`followUp()` 和 `skill()` 全部通过注入的引导
- [src/app-runtime.test.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/app-runtime.test.ts)
  - skill banner 出现后，不再重复渲染同名 `SKILL.<name>` user line
- [src/tui/test/render.test.ts](/abs/path/C:/Users/yangjing/Project/oh-my-quant/src/tui/test/render.test.ts)
  - skill 行渲染为 `SKILL.<name>` 命名空间
  - 仅包含分隔线的表头行会被吸收到完整三线表结构中

## 金融终端色彩方案

下一个渲染增量不应使用通用的 CLI 红/绿默认色。目标是更专业的金融机构终端外观：

- 语义红/绿使用克制的饱和度而非霓虹终端色
- 将 amber / cash gold 作为主强调色族，用于选择、焦点、标题和关键强调
- 保持中性文字温暖且略微降低饱和度，使屏幕更接近行情终端而非开发者控制台

推荐的语义调色板：

- accent amber：Bloomberg 风格琥珀色，用于焦点、选中状态、活动仪表和标题动效
- cash gold：`#E8B339` 用于现金/流动性/资金色调语义
- warning red：克制的红色，用于负值/回撤/突破/移除状态
- warm neutrals：奶油色、柔和的灰褐色、木炭分隔线、暗色代码灰

重要的语义说明：

- 颜色不是唯一的信号
- 表格和图表必须通过标签、对齐、箭头、柱长和显式状态词在单色下仍能正确阅读

## 推出计划

推出应保持增量且文本原生。

### 阶段 1：调色板基础

- 在 `src/tui/src/styles.ts` 中集中管理终端调色板
- 将 `src/tui/src/render.ts` 中的动画琥珀范围与同一强调色族对齐
- 更新固定精确颜色十六进制值的现有测试

### 阶段 2：结构化文本着色

- 新增一个小的辅助函数，用于颜色感知的纯文本表格
- 新增一个小的辅助函数，用于颜色感知的紧凑图表（如柱状块或迷你图）
- 支持单元格级别的语义样式：
  - 标题
  - 正值/负值
  - 选中或高亮行
  - 次要注释/弱化元数据

### 阶段 3：`/compact` 作为第一个原型

在更广泛推出之前，使用 `/compact` 作为试点界面。

为什么是 `/compact` 先：

- 它已经返回一个包含稳定字段的密集摘要
- 它已经结合了指标和量化上下文
- 它是本地 slash-command 路径，因此可以在不干扰 agent 生成流程的情况下迭代格式化

`/compact` 原型应结合：

- 一个对齐的指标表格
- 一个 `quant context kept` 表格
- 一个小型保留图表或仪表块

`/compact` 原型的色彩方案：

- 指标标题和段落标题 -> amber
- 保留/健康行 -> 克制的绿色
- 缺失/风险/下降行 -> 克制的红色
- 次要说明和注释 -> 弱化中性色

### 阶段 4：扩展到 agent 输出

在 `/compact` 效果满意后，将相同的文本辅助函数应用于：

- benchmark 排行榜
- 持仓对比
- 回测指标摘要
- 风险仪表盘

保持相同的语义调色板，避免针对每个功能单独建立色彩系统。

## 如有需要的下一步

如果 prompt shaping 不够，下一个增量仍然应保持增量：

1. 在 `src/tui/src/styles.ts` 和 `src/tui/src/render.ts` 中实现金融终端调色板基础。
2. 使用 `/compact` 原型化一个着色的结构化表格和一个着色的紧凑图表。
3. 将相同的辅助函数复用于排行榜、持仓和风险输出。

除非当前 TUI 文本路径确实不足，否则不要直接跳转到独立的渲染器包。
