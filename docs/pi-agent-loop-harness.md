# pi Agent Loop 与 Harness：WhyJ Quant 的代理运行时内核

> last-updated: 2026-06-18

**Recommended reading order**
- Read `docs/agent-system-spec.md` first for the overall system map.
- Read this file second for the harness lifecycle, phase rules, queue drain points, compaction, and branch navigation.
- Read `docs/agent-loop-context.md` last for the narrower prompt/context assembly path.

这篇文档面向维护 WhyJ Quant agent runtime 的工程师。它不是 API 手册，而是一篇实现导读：解释 vendored pi 的 `agent-loop` 与 `AgentHarness` 如何协作，为什么 `/compact` 必须等待 idle，为什么 TUI 只能消费事件而不能自己判断完整生命周期，以及 WhyJ Quant 的 wrapper 应该遵守哪些边界。

相关代码：

| 模块 | 文件 |
|------|------|
| 低层 agent loop | `src/agent/src/pi/agent-loop.ts` |
| 公共类型与事件 | `src/agent/src/pi/types.ts` |
| harness 状态机 | `src/agent/src/pi/harness/agent-harness.ts` |
| harness 类型 | `src/agent/src/pi/harness/types.ts` |
| session tree | `src/agent/src/pi/harness/session/session.ts` |
| compaction | `src/agent/src/pi/harness/compaction/compaction.ts` |
| message conversion | `src/agent/src/pi/harness/messages.ts` |
| WhyJ wrapper | `src/agent/src/session.ts` |
| WhyJ dispatch | `src/agent/src/dispatch.ts` |

---

## 1. 一句话架构

pi 把 agent 拆成两层：

1. `runAgentLoop()` 是纯运行循环：接收上下文、模型、工具、队列回调，负责“调用模型 → 执行工具 → 写入 tool result → 判断是否继续”。
2. `AgentHarness` 是运行时壳：负责 session tree、phase 状态机、abort、queue、hooks、model/tools/thinking 配置、compaction、branch navigation，以及把 loop 事件持久化。

WhyJ Quant 再包一层 `QuantAgentHarnessSession`，把 pi 的通用 runtime 映射成 TUI 需要的状态：

```text
TUI / app-runtime
  → QuantAgentSession facade
    → pi AgentHarness
      → runAgentLoop
        → pi-ai streamSimple
        → WhyJ tools
```

这个分层是核心：TUI 不应该直接保存消息、判断 session leaf、重放 compaction；CLI slash 也不应该绕过 harness 写 session。

另外，WhyJ 现在把“模型看到的用户文本”和“UI 展示给用户的原始输入”显式分开：

- harness/session 层可以对用户输入做 session/turn context injection
- UI 仍然显示原始输入
- 这通过自定义 `displayUser` message 实现，而不是在 `AppRuntime` 再维护一份待认领的原始输入队列

---

## 2. `runAgentLoop`：真正的 agent loop

入口在 `src/agent/src/pi/agent-loop.ts`。

### 2.1 Prompt run 的基本事件序列

`runAgentLoop(prompts, context, config, emit, signal, streamFn)` 做的第一件事是把 prompt 放进当前上下文，并发出用户消息事件：

```text
agent_start
turn_start
message_start(user)
message_end(user)
```

然后进入 `runLoop()`。这个循环有两层：

```text
outer loop
  用于处理 follow-up：agent 本来要停了，但用户又排了后续消息

inner loop
  用于处理 steering 和 tool call：一轮 assistant 响应后，可能需要继续调工具或插入用户 steering
```

### 2.2 一次 assistant turn

一个 turn 的语义是：

```text
assistant response + optional tool calls + tool result messages
```

内部流程：

```text
streamAssistantResponse()
  → message_start(assistant)
  → message_update(assistant partial ...)
  → message_end(assistant final)

if assistant contains toolCall:
  executeToolCalls()
    → tool_execution_start
    → tool_execution_update*
    → tool_execution_end
    → message_start(toolResult)
    → message_end(toolResult)

turn_end
prepareNextTurn?
getSteeringMessages?
```

如果 assistant 没有 tool call，并且没有 steering/follow-up，loop 最后发：

```text
agent_end
```

### 2.3 为什么 tool result 是 message

pi 把工具执行分成两种事件：

1. UI 事件：`tool_execution_start/update/end`，给 TUI 做进度展示。
2. 上下文消息：`toolResult` message，回喂给模型，让下一次 LLM call 知道工具结果。

这两个概念不能混在一起。TUI 渲染 tool card 可以只看 `tool_execution_*`，但模型后续推理依赖 `toolResult` message。

### 2.4 sequential 与 parallel 工具

`executeToolCalls()` 会检查：

```ts
config.toolExecution === "sequential"
|| tool.executionMode === "sequential"
```

如果任一 tool 要求 sequential，则整批 tool calls 按顺序执行。WhyJ 的 shell 工具属于这类场景，因为文件读写、patch、命令输出顺序对用户可见，不能并发交错。

parallel 模式下，pi 仍然先逐个 prepare/validate/hook，然后并发执行允许的工具；最后按 assistant 原始 tool call 顺序发 tool result message，保证模型看到的工具结果顺序稳定。

### 2.5 `prepareNextTurn` 是 loop 与 harness 的接口

低层 loop 本身不懂 session persistence。每个 turn 完成后，它调用：

```ts
config.prepareNextTurn?.(...)
```

harness 在这里做：

- flush pending session writes
- 重新从 session tree 构建 context
- 读取最新 model / thinking / active tools
- 返回下一轮 LLM call 应该使用的 context/config

这就是为什么运行中修改 model/tools/thinking 可以延迟到下一轮生效，而不是直接突变当前 provider request。

---

## 3. `AgentHarness`：状态机与运行时边界

入口在 `src/agent/src/pi/harness/agent-harness.ts`。

### 3.1 Harness 管什么

`AgentHarness` 负责所有“loop 外”的事情：

- phase 状态机
- session tree 持久化
- queued user messages
- model/thinking/tools/resources 配置
- provider request hooks
- tool call hooks
- compaction
- branch navigation
- abort
- subscriber event settlement

它不是一个薄 wrapper。`runAgentLoop` 只负责当前 run 的机械循环；`AgentHarness` 负责让这个循环成为可恢复、可中断、可压缩、可观测的 agent runtime。

### 3.2 Phase 是权威状态

核心字段：

```ts
private phase: AgentHarnessPhase = "idle";
```

phase 可能是：

| Phase | 含义 |
|-------|------|
| `idle` | 没有正在运行的 turn，可以 prompt/compact/navigate |
| `turn` | 正在处理 agent turn |
| `compaction` | 正在 compact session |
| `branch_summary` | 正在切换 session tree branch |
| `retry` | 预留给 retry 生命周期 |

关键约束：

```ts
prompt()       requires phase === "idle"
skill()        requires phase === "idle"
compact()      requires phase === "idle"
navigateTree() requires phase === "idle"
steer()        requires phase !== "idle"
followUp()     requires phase !== "idle"
```

这也是 `/compact` 的正确接入原则：外层不要只看 wrapper 的 `state.isStreaming`，而应该先 `waitForIdle()`，再调用 `compact()`，让 harness phase 做最终判定。

### 3.3 `runPromise` 是 idle 等待门

`prompt()` 进入 `turn` 后会创建 `runPromise`：

```ts
const finishRunPromise = this.startRunPromise();
...
finally {
  finishRunPromise();
}
```

`waitForIdle()` 的实现很小：

```ts
async waitForIdle(): Promise<void> {
  await this.runPromise;
}
```

它等的不是“assistant 文本结束”，而是整个 run promise settled，包括：

- provider streaming
- tool execution
- tool result message emission
- turn_end
- session write flush
- agent_end listener 执行

所以 UI 上看到最后一行文本，不代表 harness 已经 idle。必须通过 `waitForIdle()` 进入需要独占 phase 的操作，比如 compact 和 navigate tree。

### 3.4 事件监听器也是运行完成的一部分

`AgentEvent` 的注释里明确说明：

```text
agent_end is the last event emitted for a run,
but awaited Agent.subscribe() listeners for that event are still part of run settlement.
The agent becomes idle only after those listeners finish.
```

这解释了一个常见误判：TUI 已经渲染了最终响应，但 app-runtime 的 `agent_end` callback 可能还在同步状态、刷新 overview、写入 UI message。此时直接 compact 可能碰到 busy。

---

## 4. 三种用户输入：prompt、steer、followUp

WhyJ 的 `src/agent/src/dispatch.ts` 直接映射 pi 的三种输入路径。

当前入口已经收敛成：

```text
AppRuntime.submit(text)
  → dispatchUserMessage(agent, text, text)
```

这里第一个 `text` 是会进入 session/harness 注入链的模型文本源，第二个 `text` 是 UI 原始输入，用于 `displayUser.displayText`。

### 4.1 Idle 时：`prompt`

当 agent 不在 streaming：

```text
user input → agent.prompt(text)
```

这会启动一个新的 harness run，要求 phase 是 `idle`。

### 4.2 工具运行中：`steer`

如果当前有 pending tools：

```text
user input → agent.steer(message)
```

steering 会在当前 assistant/tool turn 结束后、下一次 provider request 前插入上下文。它的用途是“修正正在进行的任务”，例如工具还在跑时用户补充要求。

WhyJ 当前实现里，`steer()` / `followUp()` 不只转发纯文本，还会保留 `displayText`，并在 session facade 中对实际送入 harness 的文本调用 `injectTurnContext(...)`。

### 4.3 assistant streaming 中但无工具：`followUp`

如果 agent 正在 streaming，但没有 pending tool calls：

```text
user input → agent.followUp(message)
```

follow-up 会在 agent 本来要停止时继续下一轮，适合“接着问”。它不会打断当前 assistant response。

### 4.4 为什么不能 double prompt

`AgentHarness.prompt()` 在 `phase !== "idle"` 时会抛 busy。WhyJ dispatch 的职责就是避免在 active run 上再次 prompt：

```text
idle → prompt
active + tools → steer
active + no tools → followUp
```

如果绕过 dispatch 直接 prompt，就会破坏 harness 的单 run 约束。

---

## 5. Session tree：不是线性聊天记录

pi session 存储是 append-only tree，不是简单数组。

### 5.1 Entry 类型

核心 entry：

| Entry | 用途 |
|-------|------|
| `message` | user / assistant / toolResult 等消息 |
| `compaction` | 历史压缩摘要 |
| `branch_summary` | 从一个 branch 切到另一个 branch 时的摘要 |
| `model_change` | 模型切换 |
| `thinking_level_change` | thinking level 切换 |
| `active_tools_change` | 工具开关 |
| `label` | 给 entry 打标签 |
| `leaf` | 当前活跃 leaf |

每个 entry 都有：

```ts
id
parentId
timestamp
type
```

所以 session 是一棵树。`leafId` 决定当前对话分支，`getBranch()` 取的是从 root 到 leaf 的路径。

### 5.2 `buildSessionContext`

`src/agent/src/pi/harness/session/session.ts` 的 `buildSessionContext()` 把 branch entries 转成模型可见上下文：

- 找最后的 model / thinking / active tools 状态
- 找最后一次 compaction
- 如果存在 compaction，把它转换成 `compactionSummary` message
- 从 `firstKeptEntryId` 开始保留未压缩消息
- branch summary 转成 `branchSummary` message
- custom message 也可转成模型上下文

这意味着 compaction 并不是删除历史，而是在 session tree 中追加一个摘要 entry。未来构建 context 时，旧历史被 summary message 替代。

### 5.3 为什么 resume 要读 JSONL tree

恢复会打开对应 session metadata，然后 `session.buildContext()` 从 leaf 重建上下文。WhyJ Quant 当前正常的 `/resume` 面板只面向 JSONL session tree，因为只有它包含 leaf、parent、compaction、branch summary 等结构。

仓库里早期曾存在 Markdown transcript 形式的历史存档，但那类文件不包含可恢复的 session-tree 结构。当前策略是：

- 正常 resume 只支持 JSONL session
- 旧 Markdown 存档不再作为可恢复会话保留
- 如果本地残留了旧档案，UI 只把它识别为不受支持的 legacy archive，而不会把它当成正常 resume 目标

---

## 6. Compaction：为什么会 `Nothing to compact`

compaction 入口：

```ts
AgentHarness.compact(customInstructions?)
```

约束：

```ts
if (this.phase !== "idle") throw busy
this.phase = "compaction"
...
finally { this.phase = "idle" }
```

### 6.1 准备阶段

流程：

```text
session.getBranch()
prepareCompaction(branchEntries, DEFAULT_COMPACTION_SETTINGS)
```

默认设置：

```ts
reserveTokens: 16384
keepRecentTokens: 20000
```

`prepareCompaction()` 会：

1. 找最近一次 compaction。
2. 估算当前 branch context tokens。
3. 从尾部反向累计，寻找一个保留约 20k tokens recent context 的 cut point。
4. 如果 cut point 落在一个 turn 中间，则把 turn prefix 单独摘要。
5. 抽取 compacted history 里的文件读写记录。

如果没有可压缩内容，返回 `undefined`。harness 把它映射成：

```text
AgentHarnessError("compaction", "Nothing to compact")
```

所以 `Nothing to compact` 是正常 no-op，不是系统错误。WhyJ CLI/TUI 应该把它显示成 info，而不是 `ERR`。

### 6.2 生成摘要

如果可以 compact：

```text
messagesToSummarize → generateSummary()
turnPrefixMessages  → generateTurnPrefixSummary()  // only when split turn
```

摘要格式是结构化的：

- Goal
- Constraints & Preferences
- Progress
- Key Decisions
- Next Steps
- Critical Context

并追加文件操作摘要：

```text
readFiles
modifiedFiles
```

最后写入 session：

```ts
session.appendCompaction(summary, firstKeptEntryId, tokensBefore, details)
```

### 6.3 WhyJ `/compact` 的正确调用方式

正确：

```text
/compact
  → agent.waitForIdle()
  → agent.compact(customInstructions)
  → on success: sync messages from session
  → on "Nothing to compact": info status
```

错误：

```text
if state.isStreaming return ERR
```

原因：`state.isStreaming` 是 wrapper 给 UI 的镜像状态，不是 pi 的权威 phase。它可能比 harness phase 早一点或晚一点变化。需要独占操作时，以 `waitForIdle()` 和 harness phase 为准。

---

## 7. Branch navigation 与 resume

`AgentHarness.navigateTree(targetId, options)` 同样要求 idle。它的作用不是打开新文件，而是移动 session leaf。

流程：

```text
oldLeafId = session.getLeafId()
targetEntry = session.getEntry(targetId)
collectEntriesForBranchSummary(oldLeafId, targetId)
optional generateBranchSummary()
session.moveTo(newLeafId, optional summary)
emit session_tree
```

如果 target 是 user message 或 custom_message，harness 会把 leaf 移到它的 parent，并返回 `editorText`，这样 UI 可以让用户编辑原输入再重新发起分支。

WhyJ 当前 `/resume <sessionId>` 是更粗粒度的 session 切换：关闭当前 harness，打开另一个 JSONL session，然后从其 leaf 重建 context。未来如果要做“同一个 session 内回到某条历史”，应该走 `navigateTree()`，不是手动截断消息数组。

---

## 8. Hooks：harness 的扩展点

`AgentHarness` 支持两类事件：

1. `emitAny()`：广播所有 agent/core events，用于 UI、状态镜像、日志。
2. `emitHook()`：特定生命周期允许 handler 返回 patch 或 cancel。

重要 hooks：

| Hook | 能力 |
|------|------|
| `before_agent_start` | 注入消息或改 system prompt |
| `context` | 在 convertToLlm 前改 AgentMessage[] |
| `before_provider_request` | patch headers/metadata/retry/timeout |
| `before_provider_payload` | 修改 provider payload |
| `tool_call` | block tool call |
| `tool_result` | patch tool result content/details/isError/terminate |
| `session_before_compact` | cancel 或提供外部 compaction |
| `session_before_tree` | cancel 或提供 branch summary |

WhyJ 目前主要使用 subscribe 做状态镜像，尚未深度使用 hook patch。后续要加审计、权限、工具拦截，应优先挂 hook，而不是改 `runAgentLoop`。

---

## 9. WhyJ Quant wrapper：把 pi 映射成 TUI runtime

`src/agent/src/session.ts` 的 `QuantAgentHarnessSession` 做几件事：

1. 创建 `NodeExecutionEnv`，cwd 指向当前项目。
2. 创建或打开 `.ohquant/sessions/` 下的 JSONL session。
3. 发现 skills，构造 WhyJ system prompt。
4. 注册 WhyJ data/compute/shell tools。
5. 创建 `AgentHarness`。
6. 订阅 harness events，更新 `QuantAgentState`。
7. 把 core `AgentEvent` 和 `queue_update` 一起转发给 app-runtime。

状态镜像：

```ts
message_start      → isStreaming = true
message_update     → streamingMessage, thinkingText
message_end        → append state.messages
tool_start/end     → pendingToolCalls
agent_end          → isStreaming = false, clear pending
model_update       → state.model
thinking_update    → state.thinkingLevel
tools_update       → state.tools
queue_update       → forwarded to UI so Composer queue reflects real harness queues
```

这层 state 是 UI cache，不是 session 真源。恢复、compact、branch 后应调用 session/harness 方法重新构建 state。

### 9.1 `displayUser`：UI 消息和模型消息的桥

WhyJ 在 `src/agent/src/pi/harness/messages.ts` 中定义了自定义消息类型：

```text
displayUser
  role: "displayUser"
  content: model-facing text/image blocks
  displayText: raw user input shown to UI
```

规则：

- dispatch / harness queue 中的用户输入优先用 `displayUser`
- `AppRuntime` 把 `displayUser` 当作普通 user 渲染
- `convertToLlm()` 在真正调用 provider 前把 `displayUser` 还原成标准 `user`
- compaction、turn-start 识别、branch navigation editor restore 都把 `displayUser` 视为 user-like message

这让 WhyJ 不再需要 runtime-side `pendingUserInputs` 或 `composerQueue` 双写状态。

---

## 10. TUI 接入规则

### 10.1 TUI 只消费事件

TUI 应该从 app-runtime 拿 `UIMessage[]`、activity 状态、以及来自 harness 的队列快照，不应该直接读 pi session tree。原因：

- pi 事件已经包含 streaming partial、tool progress、error stop reason。
- harness `queue_update` 已经给出真实 `steer/followUp/nextTurn` 队列状态。
- session tree 是持久化结构，不适合直接渲染实时状态。
- tool result message 和 tool execution card 是两种不同抽象。

WhyJ 当前规则：

- Composer queue 的真源是 harness `queue_update`
- Conversation 里的用户输入真源是 `message_start(displayUser|user)`
- `AppRuntime` 不再维护平行的“待发送原文队列”

### 10.2 Slash 命令分两类

| 类型 | 例子 | 规则 |
|------|------|------|
| local UI/session | `/config`, `/portfolio`, `/resume`, `/compact` | 允许走 deterministic handler |
| quant analysis | factor/backtest/risk/benchmark | 应通过 agent tools |

`/compact`、`/resume`、未来 `/session tree` 这种命令属于 session control，必须通过 `QuantAgentSession` facade，不要改 `state.messages` 代替。

### 10.3 Busy 与 idle 的用户体验

如果用户在 active turn 中输入自然语言：

```text
pending tools > 0 → steer
otherwise         → followUp
```

并且这些排队消息会立即出现在 harness `queue_update` 中，因此 Composer 可以展示真实排队状态，而不需要猜测某条消息是否已经被 harness 接收。

如果用户在 active turn 中输入 `/compact`：

```text
waitForIdle()
compact()
```

如果 compact 仍报 busy，说明 harness 仍在 `turn`/`compaction`/`branch_summary` phase，应提示稍后再试；但不应该把这个视作数据损坏。

---

## 11. 常见故障与定位

### 11.1 `compact() requires idle harness`

含义：调用 compact 时 phase 不是 `idle`。

正确处理：

- slash handler 先 `await agent.waitForIdle()`
- 不直接依赖 `agent.state.isStreaming`
- 如果 wait 后仍 busy，提示 turn 仍在 finalize

### 11.2 `Nothing to compact`

含义：session 当前没有可压缩的历史，通常是消息太少、刚 compact 过，或 branch path 最后就是 compaction entry。

正确处理：

- 显示 info
- 不标红
- 不重置 agent
- 不写 error message 到 conversation

### 11.3 TUI 看到响应结束，但 compact 仍 busy

可能原因：

- `agent_end` listener 仍在执行
- session writes 仍在 flush
- app-runtime 正在 apply command effect
- tool result message 刚写入但 settle 尚未完成

解决方式仍是 `waitForIdle()`。

### 11.4 resume 后看不到历史

排查：

- 是否打开的是 JSONL session，而不是不受支持的 legacy archive
- `JsonlSessionRepo.list({ cwd })` 是否能列出当前 cwd 的 session
- `session.buildContext()` 是否从 leaf 得到消息
- TUI preview 是否只显示 recentMessages，而不是完整 branch

---

## 12. 设计原则

1. **phase 是权威状态。** UI state 只是镜像。
2. **session tree 是真源。** `state.messages` 可重建，不应当作为持久化真源。
3. **tool execution event 不是 tool result message。** 前者给 UI，后者给模型。
4. **compact 是 append，不是 delete。** 历史通过 compaction summary 替代进入上下文。
5. **branch 是移动 leaf，不是清空数组。**
6. **自然语言输入永远不要 double prompt。** active run 只允许 steer/followUp。
7. **需要独占 phase 的操作先 waitForIdle。** compact、navigateTree、session switch 都属于这一类。
8. **Composer queue 以 harness 为准。** 不在 runtime/TUI 再维护第二份待发送真源。
9. **用户显示文本与模型输入文本分离。** 用 `displayUser` 承载 UI 原文，而不是把 prompt injection 结果直接展示给用户。

---

## 13. 最小调用图

### 13.1 用户自然语言

```text
AppRuntime.submit(text)
  → dispatchUserMessage(agent, text, text)
    → if idle: agent.prompt()
      → harness.prompt()
        → phase = "turn"
        → createTurnState()
        → executeTurn()
          → runAgentLoop()
            → streamAssistantResponse()
            → executeToolCalls()
            → turn_end
            → agent_end
        → phase = "idle"
```

### 13.2 工具调用

```text
assistant toolCall
  → tool_execution_start
  → prepareToolCall()
    → validateToolArguments()
    → beforeToolCall hook
  → tool.execute(..., onUpdate)
    → tool_execution_update*
  → afterToolCall hook
  → tool_execution_end
  → toolResult message_start/end
  → next provider request sees toolResult
```

### 13.3 compact

```text
/compact
  → executeCommand()
  → compactHandler()
    → agent.waitForIdle()
    → agent.compact(customInstructions)
      → harness.compact()
        → phase = "compaction"
        → session.getBranch()
        → prepareCompaction()
        → generateSummary()
        → appendCompaction()
        → phase = "idle"
    → syncMessagesFromAgentState()
```

### 13.4 resume

```text
/resume <sessionId>
  → agent.resumeSession(id)
    → abort current harness
    → clear wrapper state
    → open JsonlSessionRepo metadata
    → session.buildContext()
    → create new AgentHarness
  → syncMessagesFromAgentState()
```

---

## 14. 对 WhyJ 后续演进的建议

1. 把 `/session` 面板做成 session tree viewer，而不只是 flat session list。
2. 在 TUI 中把 `Nothing to compact` 显示成灰色 info，不进入 conversation。
3. 给 `session_before_compact` hook 加可观测日志，记录 tokensBefore、firstKeptEntryId、readFiles、modifiedFiles。
4. 给 shell tool 的 file operation details 标准化，提升 compaction summary 的文件上下文质量。
5. 如果未来支持自动 compact，触发点应在 `turn_end` 后、下一轮 provider request 前，而不是 streaming 中途。
6. 对 resume/branch navigation 统一采用 `waitForIdle()` 门，避免和 active run 争 phase。

---

## 15. 快速排查清单

```text
自然语言没响应：
  dispatchUserMessage 是否走 prompt/steer/followUp 正确分支？
  queue_update 是否已经反映到 Composer？
  harness phase 是否卡在 turn？
  provider stream 是否产生 message_start？

工具卡住：
  pendingToolCalls 是否未在 tool_execution_end 删除？
  tool.execute 是否吞掉 abort signal？
  sequential tool 是否阻塞后续工具？

compact 异常：
  是否先 waitForIdle？
  是否只是 Nothing to compact？
  getBranch() 是否返回当前 leaf 路径？
  settings keepRecentTokens 是否导致没有可压缩段？

resume 异常：
  sessionId 是否属于当前 cwd repo list？
  buildContext 是否产生 messages？
  leafId 是否为空或指向不存在 entry？
```

这套模型足够解释 WhyJ Quant 目前遇到的首响应、compact、resume、tool display 等问题：只要分清 loop、harness、wrapper、TUI 四层边界，问题通常能定位到某一个阶段，而不是在 UI 状态里猜。
