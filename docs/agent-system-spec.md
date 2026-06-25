# WhyJ Quant — AI Agent 系统规格 (v3，已实现)

> 最后更新：2026-06-18

**推荐阅读顺序**
- 从这里开始了解系统级架构和所有权边界。
- 然后阅读 `docs/pi-agent-loop-harness.md` 了解 loop/harness 生命周期和队列语义。
- 最后阅读 `docs/agent-loop-context.md` 了解 prompt assembly、`displayUser` 和模型-vs-UI 文本流。

## 1. 概述

Agent 系统现已 vendors WhyJ Quant 所需的最小 pi harness 子集，并用薄 adapter 包装。运行时使用 pi 的 harness 生命周期、JSONL tree session 存储、compaction 和 branch-summary 机制，同时保留 WhyJ Quant 工具、prompt 和 TUI 行为。

**设计参考：**
- `docs/pi-agent-loop-harness.md` — pi agent loop、harness phase、session tree、compaction、resume 边界的技术博客
- `docs/builtin-tool-registry.md` — 未来内置 agent 工具的轻量注册表
- pi `packages/agent/src/harness/agent-harness.ts` — harness 生命周期、hooks、队列管理
- pi `packages/agent/src/harness/compaction/compaction.ts` — token 估算、cut points、摘要生成
- pi `packages/agent/src/harness/session/session.ts` — 基于树的 session 存储
- pi `packages/agent/src/harness/messages.ts` — 消息转换、compaction/branch summary 消息

## 2. 文件地图

```
src/agent/
  src/
    pi/               最小 vendored pi harness 子集（harness + loop + session + compaction）
    session.ts        AgentHarness 之上的 WhyJ Quant facade；持有 prompt/turn context injection 和队列转发
    dispatch.ts       prompt/steer/followUp 路由（对 facade）
    context.ts        Prompt assembly（基础模板 + 动态注入）
    skills.ts         Skill 发现和诊断
  test/
    session.test.ts   estimateTokens, estimateContextTokens, createAgent
    context.test.ts   BASE_SYSTEM_PROMPT, injectSessionContext
    dispatch.test.ts  prompt/steer/followUp 路由

src/cli/
  catalog.ts          Slash 命令目录（帮助文本、自动补全、one-shot help）
  registry.ts         parseCommand()、executeCommand()、slash handlers
  registry.test.ts    Parser 测试

src/tools/
  registry.ts         内置工具注册、显示元数据、CLI 查找、启用的 agent 工具顺序
  data-tools.ts       本地数据获取工具
  quant-tools.ts      5 个计算工具（factor、backtest、risk、benchmark、dashboard）
  bash-tool.ts        Shell 工具（pi NodeExecutionEnv + codex 风格参数）

src/storage/
  index.ts            .ohquant/ 目录布局、settings load/save
  bars.ts             日线数据：loadBars、saveBars、isCacheFresh、getMeta
```

## 3. Agent 架构

`createAgent()` 现在返回一个 facade，它：

- 创建以当前 cwd 为根的 `NodeExecutionEnv`
- 打开或创建 `.ohquant/sessions/` 下的 pi `JsonlSessionRepo` session
- 使用 WhyJ Quant 工具和 system prompt callback 实例化 pi `AgentHarness`
- 镜像核心 `AgentEvent` 状态（`isStreaming`、`pendingToolCalls`、`messages`），使现有 TUI runtime 保持其事件驱动的 UI 流
- 转发 harness `queue_update` 事件，使 Composer 队列状态来自真实 harness queues，而非 runtime 侧的影子队列
- 通过 `injectSessionContext()` 保留轻量每轮 symbol 记忆

### 3.1 Provider 协议分离：OpenAI-compatible vs Anthropic Messages

WhyJ 支持两种模型传输形态，它们不可互换：

| 维度 | OpenAI-compatible | Anthropic Messages |
|-----------|-------------------|--------------------|
| Request shape | `messages` + `tools` + provider 特定兼容性标志 | `messages` + `tools` + `system` + Anthropic message blocks |
| Tool replay | `assistant.tool_calls` 后跟 `tool` messages | `assistant.tool_use` 后紧跟 `user.tool_result` blocks |
| 排序容忍度 | 对空 assistant turn 和工具分组更宽容 | 严格相邻：tool results 必须在下一条消息中紧跟 tool use |
| 空 assistant turn | 通常容忍或被合成消除 | 重放时优先省略 |
| Base URL 行为 | 以 OpenAI-compatible payload 发送；`/v1` 这类尾段应继续走该路径 | `/anthropic` 这类尾段必须通过 Anthropic Messages 语义路由，即使模型名被复用 |

实现规则：

- 如果 `WHYJ_QUANT_BASE_URL` 是 Anthropic 兼容的，通过 `anthropic-messages` 路由
- 如果 provider 是 OpenAI 兼容的，保持现有 OpenAI completion 路径
- 不在同一 request builder 中混合两种重放格式
- URL 尾段优先决定协议形态：尾段为 `anthropic` 走 Anthropic Messages；尾段为 `v1` 之类的 OpenAI-compatible 路径继续走 `openai-completions`
- 终端控制码剥离仅属于呈现层。Model ID、base URL 和环境变量支持的配置值必须原样传递，除非函数被显式记录为仅用于显示。
- 避免为配置解析使用共享的"清理"helper。如果字符串需要 UI 友好的缩短，使用单独的格式化器，使请求路径仍能看到原始值。

故障排查清单：

1. 如果在 Anthropic 兼容端点上看到 `404`，验证模型名在该端点上存在，并验证运行时选择了 Anthropic Messages 路径。
2. 如果看到 `400` 且 `tool_use` / `tool_result` 排序错误，检查重放是否为 Anthropic 形态：每个 `tool_use` 必须在下一条消息中由 `tool_result` block 立即回答。
3. 如果重放以空 assistant turn 开始，为 Anthropic 请求移除它；OpenAI 兼容路径更宽容，但 Anthropic 不是。
4. 如果 provider 正确但请求仍然失败，在查看工具代码之前比较配置的 base URL 和模型标签；大多数不匹配是路由问题，而非工具 bug。
5. 将 OpenAI-compatible 的 `assistant.tool_calls` 重放和 Anthropic 的 `tool_use` 重放保持在不同的代码路径中，即使它们共享相同的高层 agent 逻辑。

已验证的真实 smoke 矩阵：

- `https://api.deepseek.com/anthropic` + `deepseek-v4-pro[1m]` -> `anthropic-messages`
- `https://open.bigmodel.cn/api/anthropic` + `glm-5.2` -> `anthropic-messages`
- `https://open.bigmodel.cn/api/v1` + `glm-5.2` -> `openai-completions`
- `https://api.minimaxi.com/anthropic` + `MiniMax-M2.7` -> `anthropic-messages`
- `https://api.minimaxi.com/v1` + `MiniMax-M2.7` -> `openai-completions`

仓库内置 live smoke 命令：

- `bun run test:providers`
- 默认读取项目根目录 `.ohquant/settings.json` 作为主 case
- 可额外通过 `WHYJ_SMOKE_GLM_AUTH_TOKEN` 和 `WHYJ_SMOKE_MINIMAX_AUTH_TOKEN` 开启 GLM / MiniMax 的 anthropic 与 openai 双协议实测

### 3.2 消息模型分离：模型文本 vs 显示文本

WhyJ 现在区分：

- 模型面向的用户文本：LLM 在 session/turn context injection 之后实际应看到的内容
- UI 面向的用户文本：用户在 Composer 中输入的原始字符串

为保持这两个关注点分离而不重新引入 runtime 侧待处理输入分类账，harness 使用 `src/agent/src/pi/harness/messages.ts` 中的自定义 `displayUser` 消息类型。

- `displayUser.displayText` 是 Composer / Conversation 中显示的原始用户输入
- `displayUser.content` 是面向模型的文本 payload
- `convertToLlm()` 在模型请求前将 `displayUser` 转换回标准 provider `user` 消息

这使 UI 渲染、队列状态、session 持久化和 compaction 保持一致，同时仍允许在 session 层进行 prompt/turn context injection。

## 4. 数据工具 (src/tools/data-tools.ts)

每个工具包装仓库的本地数据 adapter 路径，并在适当时本地缓存。

| 工具 | 后端 | 调用 | 缓存？ |
|------|--------|----------|---------|
| `fetch_bars` | akshare | `fetchBars(symbol, market, start, end)` | 是 |

模式：TypeBox schema → `fetchBars()` → `saveBars()` → `ok(text)`。

## 5. 计算工具 (src/tools/quant-tools.ts)

量化工具是内置 agent 工具，不是 slash 命令。完整功能设计：`docs/quant-tools-design.md`。

| 工具 | 需要 | 输出 |
|------|----------|--------|
| `compute_factor` | 缓存数据 | momentum/reversal/volatility/volume_ratio/rsi/sma_deviation、百分位 |
| `run_backtest` | 缓存数据 | 总收益、CAGR、Sharpe、最大回撤、胜率、盈亏比 |
| `check_risk` | 缓存数据 | 年化波动率、VaR(95/99)、CVaR(95/99)、最大回撤持续时间、偏度、峰度 |
| `score_benchmark` | 直接数据获取 | 获取策略+benchmark、回测、3 维度评分（100分制）、保存 JSON |
| `show_dashboard` | .ohquant/ 文件 | 读取 benchmark 结果、排名、展示前 10 |

`compute_factor`、`run_backtest` 和 `check_risk` 使用 `loadCachedBars(symbol)`，按顺序尝试数据源。如果没有找到则返回 `DATA_NO_CACHE`，因此 agent 应先调用 `fetch_bars`。`score_benchmark` 直接获取策略和 benchmark 数据，并保存结果制品。`show_dashboard` 仅读取已保存制品。

## 5b. Shell 工具 (src/tools/bash-tool.ts)

参考：pi `NodeExecutionEnv` + `executeShellWithCapture`；codex `shell` tool parameters。

| 工具 | 参数 | 行为 |
|------|--------|----------|
| `bash` | `command`、可选 `workdir`、可选 `timeout_ms` | 通过 pi harness 运行 shell（Unix 上 bash，Windows 上 Git Bash）。`executionMode: sequential`。非零退出抛出异常。输出尾部截断在 pi 默认值（约 50KB）。 |

用于 `whyj` CLI、`bun test`、git、文件检查。行情数据仍应通过数据工具。

## 6. Prompt Assembly (src/agent/src/context.ts)

### 基础模板 (BASE_SYSTEM_PROMPT)
- 身份："WhyJ Quant 终端中的量化金融分析师"
- 列出本地数据、量化和 shell 工具及一行描述
- Shell/工具纪律：调查期间禁止仓库本地的临时脚本和临时演示文件夹；使用一次性命令或 OS 临时路径并清理
- 工作流：data → factor → backtest → risk → benchmark
- **输出约束**：无 markdown、无 emoji、纯 ASCII、SI 后缀、金融术语
- 金融术语：年化收益率、momentum premium、tail risk、tracking error、information ratio 等

### 动态注入
- `buildSystemPrompt(extra?)` 追加缓存 symbol（最多 15 个），含 source + bar count
- `injectSessionContext(input, ctx)` 用 `last_symbol`、`last_market` 等包装首个 prompt turn
- `injectTurnContext(input, ctx)` 用相同的 session memory 包装排队的 follow-up / steering turn

重要边界：`AppRuntime` 不再自行注入 prompt 文本。原始 Composer 输入被转发到 `dispatchUserMessage(agent, input, input)`，session facade 是唯一允许在到达 harness 之前增强用户文本的层。

## 7. Token 估算与 Compaction

Compaction 不再是 `src/agent/src/session.ts` 中的本地启发式方法。WhyJ Quant 现在直接复用 pi harness compaction：

- token 估算委托给 vendored pi `estimateTokens()` / `estimateContextTokens()`
- session 历史通过 pi `prepareCompaction()` 和 `compact()` 压缩
- compaction 摘要和 branch summary 作为显式 session-tree entries 存储
- `displayUser` 在 token 估算、cut-point 选择、turn-start 发现、摘要序列化和 branch navigation/editor restore 期间被视为 user-equivalent 消息
- 当前 adapter 为测试和小工具暴露 token 估算 helper，但权威 compaction 行为位于 vendored pi 代码中

## 8. Session 持久化

主要存储现在是 `.ohquant/sessions/<encoded-cwd>/...jsonl` 下的 pi JSONL tree sessions。

- entries 是仅追加的，包括 message、compaction、branch_summary、label 和 leaf 记录
- `app-runtime` 不再在 `agent_end` 时序列化 Markdown 转录
- session 重放通过 pi `buildSessionContext()` 从存储的 branch path 派生

## 9. 生命周期

```
App 挂载
  → ensureDirs(), loadSettings()
  → createAgent()                                // pi AgentHarness 之上的 WhyJ Quant facade
  → agent.subscribe()                            // Core AgentEvent → UI

用户消息
  → src/cli/registry.ts: parseCommand(input)
    → /slash → executeCommand()
    → NL 文本 → dispatchUserMessage(agent, input, input)
      → idle           → session.prompt()      → injectSessionContext()
      → active + tools → session.steer()       → injectTurnContext()
      → active + no tools → session.followUp() → injectTurnContext()
      → harness queue_update 驱动 Composer queue
      → 需要时 pi compaction / branch-summary hooks
      → streamFn → LLM API
      → tool_execution_start/update/end → UI updates
      → agent_end → session 已由 harness 持久化
```

关键架构变化是 TUI 中显示的 Composer 队列现在通过 `queue_update` 从 harness `steer/followUp/nextTurn` 队列派生。`AppRuntime` 不再持有平行的 `composerQueue` 真源。

## 10. 配置

单一真源：`.ohquant/settings.json`

```json
{
  "version": 1,
  "env": {
    "WHYJ_QUANT_API_KEY": "sk-...",
    "WHYJ_QUANT_BASE_URL": "https://api.deepseek.com/anthropic",
    "WHYJ_QUANT_AUTH_TOKEN": "sk-..."
  },
  "model": "sonnet",
  "thinkingLevel": "off",
  "preferences": {},
}
```

模型凭证优先读取 `WHYJ_QUANT_API_KEY`，缺失时回退到 `WHYJ_QUANT_AUTH_TOKEN`。这两个键都从 `.ohquant/settings.json` 的 `env` 块读取；`WHYJ_QUANT_BASE_URL` 用于决定当前走 Anthropic Messages 还是 OpenAI-compatible 路径。

## 11. 洞察系统与提示

Agent thinking 期间显示的投资提示由 insight pipeline 驱动：

```
notes/quant/funder.md  ──┐
                         ├──→ src/quant/insight-generator.ts
notes/quant/notes.md   ──┘         │
                                   ▼
                          .ohquant/insights.json  （启动时自动重新生成）
                                   │
                                   ▼
                          insight.ts → getQuotes() → thinking bar spinner + tips
                                      → getInsightRules() → conversation 关键词匹配
```

**组件：**

| 文件 | 角色 |
|------|------|
| `src/quant/insight-generator.ts` | 解析 `notes/quant/*.md` → `InsightEntry[]`（quote、author、title、principle、wisdom、keywords） |
| `src/quant/insight.ts` | Loading overlay quotes + conversation insight derivation + 内置 risk rules |
| `scripts/generate-insights.ts` | 手动重新生成的 CLI 命令：`bun scripts/generate-insights.ts` |
| `.ohquant/insights.json` | 缓存输出；当 notes 源文件更新时自动重新生成 |

**自动重新生成：** 在每次 `loadEntries()` 调用（首次 `getQuotes()` 或 `getInsightRules()` 调用）时，系统比较 `notes/quant/funder.md` 和 `notes/quant/notes.md` 的 `mtime` 与 `.ohquant/insights.json`。如果 notes 更新，重新生成自动运行。无需手动脚本调用。

**Thinking bar：** 在 agent `"thinking"` 或 `"running tool"` 活动且有对话内容时，保留的底部行显示：`⠋ "quote" — Author`，每 5 秒循环，ora spinner 帧每 80ms 更新。

**Loading overlay：** 当对话为空且 agent 正在启动时，用居中显示的 spinner + 阶梯动画 + 多行投资引言（中文 + 英文 + 作者）替换对话区域。

**回退：** 当 `.ohquant/insights.json` 缺失或为空时，`fallbackQuotes()` 中的 16 条硬编码量化提示作为默认集合。
