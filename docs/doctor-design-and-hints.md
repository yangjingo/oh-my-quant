# Doctor、Config 与 UX 指南

本文档定义 WhyJ Quant 的 doctor 检查、配置流程、提示、CLI/TUI 行为、slash 命令、安装和 review 工作流的可用性标准。

## 原则

每个面向用户的流程应回答四个问题：

1. 发生了什么？
2. 为什么会发生？
3. 接下来可以做什么？
4. 需要详细信息时去哪里？

在边界处使用产品语言，在实现内部使用诊断语言。内部消息如 `Session not found`、`Agent harness not initialized`、`Clone failed` 或原始 provider 错误，应在 CLI/TUI 边界处映射后再呈现给用户。

## 配置

单一真源：`.ohquant/settings.json`

推荐字段：

```json
{
  "env": {
    "WHYJ_QUANT_API_KEY": "sk-...",
    "WHYJ_QUANT_BASE_URL": "https://api.deepseek.com/anthropic",
    "WHYJ_QUANT_AUTH_TOKEN": "sk-..."
  }
}
```

规则：

- 不要推荐项目根目录的 `.env` 文件。
- `/config` 应写入 `.ohquant/settings.json`。
- `doctor` 应报告配置路径、认证来源和脱敏值，而不输出完整密钥。
- UI 中显示的模型标签和值在展示前必须剥离终端控制码。
- 统一命名使用 `WHYJ_QUANT_*` 前缀。`WHYJ_QUANT_API_KEY` 是模型凭证槽位，`WHYJ_QUANT_BASE_URL` 是端点槽位。
- 如果 `WHYJ_QUANT_BASE_URL` 指向 Anthropic 兼容端点，如 `/anthropic`，运行时必须自动选择 Anthropic Messages provider，而不是强制使用 OpenAI-compatible 路径。
- 如果 `WHYJ_QUANT_BASE_URL` 的尾段是 OpenAI-compatible 形态，如 `/v1`，运行时必须保持 `openai-completions` 路径，即使同一厂商也同时提供 `/anthropic` 端点。
- 如果配置了 `/anthropic`，doctor 和提示应指出工具重放是 Anthropic 形态的，因此 `tool_use` 之后必须紧跟 `tool_result` 块。
- 仅在显示边界剥离终端控制码。配置值、模型 ID 和 provider URL 应按原样读取和存储，除非代码显式用于渲染。
- 不要将仅用于显示的控制码剥离器当作配置解析器重用。如果值可以合法包含括号或后缀，应保留它并单独为 UI 副本格式化。

## UX 交互

交互文本应描述状态，而非实现。

使用此模式：

```text
Agent 仍在启动中。您的消息已保留在 composer 中；请稍后重新发送。
```

避免此模式：

```text
正在初始化... 请稍候。
```

必要行为：

- 打开面板的命令应避免在面板本身即为结果时产生重复输出。
- 无操作应为 `info` 而非 `error`（当没有损坏时）。
- 长时间运行的操作应命名当前阶段，例如 `compacting`、`running tool` 或 `fetching`。
- 空状态应说明缺失的配置和下一步操作。
- Slash 命令应通过 `/help` 和 composer suggestions 可发现。
- 精确的 slash 输入应直接运行；部分 slash 输入可通过建议补全。
- 排队的输入在 agent 未就绪时应保持可见或可恢复。

## 错误提示

错误必须可操作。推荐结构：

```text
问题描述。
原因：已知原因时的具体描述
下一步：一个具体的恢复操作
```

对于简短状态行，用一句话：

```text
无法找到 session "abc"。运行 /resume 查看已保存的 session，然后选择其中之一。
```

规则：

- 永远不要将原始内部状态作为唯一消息暴露。
- 保留有助于恢复的技术细节，但放在产品级语句之后。
- 网络/provider 故障应提及重试、代理/网络以及如何重新发送。
- 认证失败应指明配置界面：`/config`。
- 本地数据缺失应告诉用户是获取、配置还是添加文件。
- 制品缺失应解释如何创建第一个制品。
- 不要指责用户。优先使用"选择一个 portfolio..."而非"无效参数"。
- 对于 provider 不匹配，优先显式区分"端点/模型不匹配"和"工具重放形状不匹配"。

当前已映射的情况：

- `Connection error.` -> 网络/代理提示，含重新发送引导。
- `Session not found: <id>` -> 运行 `/resume` 并选择一个已保存的 session。
- `Agent harness not initialized` -> 先发送任何 AI 消息，然后重试命令。
- `Nothing to compact` -> 信息性 no-op。
- 无效的 `/skill install` 输入 -> 在调用 `git` 前展示 `owner/repo` 格式。
- Anthropic 兼容端点上的 `404 status code (no body)` -> 检查 base URL、模型名称和 provider 路由；该端点可能不提供该模型。
- `400` 且 `tool_use` id 缺少 `tool_result` 块 -> 检查 Anthropic 重放顺序；不要在块之间插入无关的 assistant 文本。

快速 provider 检查清单：

1. 确认配置来源是 `.ohquant/settings.json`，而非项目根目录的 `.env`。
2. 确认 `WHYJ_QUANT_BASE_URL` 和模型标签指向同一 provider 族。
3. 确认 URL 尾段与协议匹配：`/anthropic` -> Anthropic Messages，`/v1` -> OpenAI-compatible。
4. 确认工具重放形状与 provider 匹配：OpenAI-compatible 的 `assistant.tool_calls` vs Anthropic 的 `tool_use` 后跟 `user.tool_result`。
5. 如果模型仍然失败，在暴露原始 provider 文本前在错误副本中呈现不匹配信息。

已验证的真实 provider smoke：

- DeepSeek `/anthropic`
- GLM `/anthropic`
- GLM `/v1`
- MiniMax `/anthropic`
- MiniMax `/v1`

## 操作引导

Slash 命令应有从命令到下一步操作的清晰路径。

命令引导：

- `/help`：仅命令目录和快捷键。
- `/config`：解释当前模型、API key、base URL、活跃组合和配置路径。
- `/portfolio`：在 TUI 中打开本地组合面板；在 TUI 外，列出可用组合。
- `/portfolio use <name|file|index>`：切换活跃的本地组合。
- `/resume`：在 TUI 中打开恢复面板；在 TUI 外，列出已保存的 sessions。
- `/resume <sessionId>`：恢复已知 session，对缺失 ID 给予友好处理。
- `/compact [focus]`：仅在有用时压缩 session；no-op 为 info。
- `/doctor`：报告运行时、配置路径、认证来源、脱敏值指纹和可操作的设置提示，而不输出完整密钥。
- `/skill`：列出可用 skill。
- `/skill info <name>`：显示来源、可见性、位置和摘要。
- `/skill:<name>` 或 `/skill run <name>`：通过活跃 agent session 运行 skill。
- `/skill install <owner/repo>`：从 GitHub 安装或更新 skill。

面板空状态引导：

- Resume 面板："暂无已保存的 session。先开始一段对话，然后再回到 /resume。"
- Portfolio 面板："暂无本地组合。" 外加 `.ohquant/portfolio/` 设置引导。
- Benchmark dashboard：告诉用户如何创建第一个 benchmark 结果。
- 数据搜索：建议完整代码或更具体的名称。

## 安装

主要安装路径：

```bash
npm i -g whyj-quant
whyj
```

开发者安装路径：

```bash
bun install
bun run src/index.ts
```

首次运行引导：

1. 启动 `whyj`。
2. 打开 `/config`。
3. 配置 `WHYJ_QUANT_API_KEY` 和 `WHYJ_QUANT_BASE_URL`。
4. 如需，配置首选数据源和数据源密钥。
5. 提出自然语言问题或运行 `/help`。

Skill 安装引导：

```text
/skill install LLMQuant/skills
```

规则：

- 仅接受 `owner/repo` 用于 skill 安装。
- 如果 GitHub clone/pull 失败，提及网络/代理访问和重试命令。
- 不要在安装、doctor 或配置输出中打印密钥。
- `doctor` 应报告凭证是否存在、来自哪里以及脱敏值指纹，而非完整密钥值。

## Review 工作流

当前工作区不暴露可调用的 `gstack ux-review` skill。`CLAUDE.md` 中的项目引导列出了以下 gstack review skill：

- `/review`
- `/design-review`
- `/devex-review`
- `/plan-ceo-review`
- `/plan-design-review`
- `/plan-devex-review`
- `/plan-eng-review`

对于可用性工作，将其视为 UX 加 DevEx review：

- 当用户要求广泛的交互变更且范围尚未清晰时，使用 `/plan-design-review`。
- 当 UI 副本、面板状态、命令流或空状态发生变化时，使用 `/design-review`。
- 当涉及安装、设置、命令行行为、JSON envelope 或文档变更时，使用 `/devex-review`。
- 当行为已实现时，使用 `/review` 进行最终代码审查。

如果请求的 review skill 在环境中缺失，记录该事实并继续使用等效的本地 review 检查清单。

## UX Review 检查清单

在合并面向用户的变更前使用此检查清单：

- 首次使用的用户能否从屏幕或错误消息中找到下一步操作？
- 每个错误是否区分了问题、原因和下一步（当信息充足时）？
- No-op 状态是否显示为信息而非错误？
- 网络、provider 和认证失败是否映射到恢复引导？
- Slash 命令是否在 `/help` 和 composer suggestions 中可发现？
- 安装路径是否覆盖全局安装、本地开发和 skill 安装？
- JSON 输出是否保持机器稳定，同时文本输出保持人类可读？
- 密钥是否从所有状态、错误和 `doctor` 输出中脱敏？
- 空面板是否有用，而无需用户查阅文档？
- 测试是否覆盖高风险路径的用户可见副本？

## 实现说明

将映射逻辑保持在拥有用户界面的边界附近：

- Agent/provider 错误：`src/app-runtime.ts`
- Slash 命令 dispatch：`src/cli/registry.ts`
- Slash 命令 handler：`src/cli/handlers/`
- Skill 安装/列表/运行：`src/skill/`
- 数据/量化工具输出：`src/tools/`
- 面板空状态：`src/tui/src/panel-models.ts` 和 `src/tui/src/panel-views.ts`
- 安装和首次运行文档：`README.md` 和本文档

添加新命令或面板时，至少为一种成功状态、一种缺失输入状态和一种空结果状态添加测试。
