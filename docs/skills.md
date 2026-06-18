# Skills

## 架构

```
src/skill/          ← whyj skill 模块（安装/CLI handler/TUI suggestions）
src/agent/src/      ← 桥接层：discoverSkills() → QuantSkill → AgentHarness
src/agent/src/pi/   ← pi harness 通用引擎：文件加载、验证、formatSkillInvocation
src/tui/src/        ← 对话渲染（⚡ skill:name）和 Composer 建议
```

`src/skill/` 目录：

| 文件 | 职责 |
|---|---|
| `types.ts` | `SkillEntry`（TUI 建议）、`SkillState`（对话展示） |
| `store.ts` | `SKILLS_DIR`、`ensureDefaultSkills()`、`installSkills()` |
| `handler.ts` | CLI 命令：list / info / run / install / `:name` 直接调用 |
| `index.ts` | 公共导出 |

## 生命周期

### 1. 安装

启动时自动安装，无需用户操作：

```
app.ts:startApp()
  → ensureDefaultSkills()
    → git clone --depth 1 LLMQuant/skills           → .ohquant/skills/LLMQuant-skills/
    → git clone --depth 1 tradermonty/claude-trading-skills → .ohquant/skills/tradermonty-claude-trading-skills/
```

- 首次运行 clone，后续跳过（目录已存在）
- 手动安装：`/skill install <owner/repo>`，已存在则 `git pull`
- 路径由 `OHQUANT_SKILLS_DIR` 环境变量覆盖

### 2. 发现

AgentHarness 初始化时加载所有 skill：

```
session.ts:initialize()
  → discoverSkills({ cwd, env, extraPaths: [.ohquant/skills/] })
    → resolveSkillSources()
      收集：.agents/skills/  .pi/skills/  ~/.agents/skills/  extraPaths
    → loadSourcedSkills() → loadSkillsFromDirInternal()
      → 递归遍历目录，读取 SKILL.md
      → 解析 YAML frontmatter（name 必填，description 必填）
      → 校验：name 小写+连字符 ≤64字符，description ≤1024字符
    → 按 name 去重（先到先得）
  → this.skills = QuantSkill[]
  → AgentHarness.resources.skills = QuantSkill[]
```

TUI 独立加载（不依赖 Agent 是否启动）：

```
tui.ts:start() → this.loadSkills()
  → discoverSkills({ extraPaths: [SKILLS_DIR] })
  → SkillEntry[] → buildSuggestions() 用
```

### 3. 注入 System Prompt

```
context.ts:buildSystemPrompt()
  → formatSkillsForSystemPrompt(skills)
    → 过滤：排除 disableModelInvocation === true 的 skill
    → 生成 XML：
      <available_skills>
        <skill>
          <name>llmquant-macro</name>
          <description>Fed, central-bank, inflation, growth, liquidity</description>
          <location>.ohquant/skills/LLMQuant-skills/skills/llmquant-macro/SKILL.md</location>
        </skill>
        ...
      </available_skills>
  → 追加到 system prompt 末尾
```

LLM 看到 `<available_skills>` 后按 description 自行决定何时使用。

### 4. 调用（两条路径）

**A. LLM 隐式调用** — 模型从 system prompt 读取 skill 定义，认为相关时自动参考其指令内容。

**B. 显式 `/skill:name` 调用**：

```
Composer 输入 "/skill:llmquant-macro 分析当前宏观环境"
  → parseCommand() → command="skill", positional=["llmquant-macro", "分析当前宏观环境"]
  → app-runtime.ts: isSkillInvoke = true
    → push UIMessage { role: "skill", skill: { name, label, status: "running" } }
    → emitMessages() → TUI 显示 "⚡ skill:llmquant-macro  0.5s"
  → executeCommand() → skillHandler
    → 查找 skill 对象 → agentSession.skill("llmquant-macro", "分析当前宏观环境")
      │
      ▼ AgentHarness.skill(name, extra)
        → 在 this.resources.skills 中按 name 查找
        → 未找到 → throw "Unknown skill"
        → formatSkillInvocation(skill, extra)
          包装为 user message：
          <skill name="llmquant-macro" location=".ohquant/skills/.../SKILL.md">
          References are relative to .ohquant/skills/.../
          {skill.content}
          </skill>

          {extra instructions}
        → executeTurn(turnState, formattedText)
          → LLM 处理 skill 内容 + 额外指令
          → LLM 可调用任何已注册 Tool（fetch_bars, compute_factor, …）
          → LLM 返回分析结果
        → 返回 AssistantMessage
  → finalizeSkillMessage(false) → status: "done"
```

### 5. TUI 渲染

```
对话中：
  ⚡ skill:llmquant-macro  2.1s      ← running 时显示耗时
  ⚡ skill:llmquant-macro             ← done 后显示
  ✗ skill:unknown-skill               ← error

建议栏（/skill 或 /ski）：
  skill:llmquant-macro  [p] Router skill for LLMQuant macro workflows...
  skill:position-sizer  [p] Calculate risk-based position sizes...
  ...
  / Commands (1/23)                    ← 可上下滚动
```

## 与 pi AgentHarness 的关系

- `AgentHarness<TSkill, TPromptTemplate, TTool>` 是泛型类，whyj 实例化：`AgentHarness<QuantSkill, PromptTemplate, AgentTool>`
- Skill **不是可执行函数**，是指令文本 — 通过 `formatSkillInvocation()` 包装后作为 user message 注入 agent turn
- `AgentHarness.skill(name, extra)` 流程：查找 → 格式化 → `executeTurn()`，返回 `AssistantMessage`
- Skill turn 中 LLM 可调用所有 Tool（`equity_historical_prices`、`compute_factor` 等），与普通对话无异
- `disableModelInvocation: true` 的 skill 不会出现在 system prompt，只能通过 `/skill:name` 显式调用
- Skill 发现结果被缓存（`WHYJ_SKILL_CACHE=off` 可禁用，调试用）

## 关键文件

| 文件 | 说明 |
|---|---|
| `src/skill/store.ts` | 安装、路径、默认 repo |
| `src/skill/handler.ts` | CLI 命令实现 |
| `src/agent/src/skills.ts` | `discoverSkills()` 桥接函数 |
| `src/agent/src/pi/harness/skills.ts` | pi 通用 loader：`loadSkills()`、`formatSkillInvocation()` |
| `src/agent/src/pi/harness/agent-harness.ts:645` | `AgentHarness.skill()` |
| `src/agent/src/pi/harness/system-prompt.ts` | `formatSkillsForSystemPrompt()` → XML |
| `src/agent/src/context.ts` | `buildSystemPrompt()` 拼装 |
| `src/agent/src/session.ts` | `QuantAgentSession.skill()`、`getSkills()` |
| `src/tui/src/render.ts:595` | skill 消息渲染 |
| `src/tui/src/input.ts:127` | skill 建议生成 |
| `src/app-runtime.ts:253` | `isSkillInvoke` 检测 + `finalizeSkillMessage` |
| `docs/skills.md` | 本文档 |

---

## 技能目录

### 默认安装（10 个，首次启动自动 clone）

#### LLMQuant (5)

| Skill | 触发场景 |
|---|---|
| `llmquant-data` | SEC filings, 13F, macro snapshots |
| `llmquant-macro` | Macro dashboards, Fed, inflation, GDP |
| `llmquant-equities` | Stock analysis, equity comparison, merger-arb |
| `llmquant-portfolio` | Thesis tracking, watchlist monitoring, alerts |
| `llmquant-risk` | Fear scoring, VIX regime, hedge design |

#### Trading (5) — 无需 API

| Skill | 触发场景 | 输出 |
|---|---|---|
| `market-breadth-analyzer` | 市场宽度、涨跌比健康度 | 0-100 综合评分 |
| `technical-analyst` | 图表分析、趋势识别 | 多场景概率评估 |
| `position-sizer` | 仓位计算、ATR 止损 | 股数、每笔风险 |
| `macro-regime-detector` | 宏观状态切换、收益率曲线 | 状态分类 |
| `market-environment-analysis` | 全球市场、risk-on/off | 多市场环境报告 |

### 完整目录

`/skill install LLMQuant/skills` 后可用 18 个 LLMQuant skill（commodities, credit, crypto, data, equities, equity-derivatives, etfs, events, investor-lenses, macro, market-intelligence, options, portfolio, portfolio-lab, prediction-markets, rates-fx, risk, strategies）。

`/skill install tradermonty/claude-trading-skills` 后可用 30+ trading skill。

## Skill 图

```
                    ┌─────────────────────────────┐
                    │   market-environment-analysis │  ← global cross-asset
                    └──────────────┬──────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          ▼                        ▼                        ▼
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────┐
│ macro-regime-   │    │ llmquant-macro      │    │ llmquant-market-│
│ detector        │    │                     │    │ intelligence    │
└────────┬────────┘    └──────────┬──────────┘    └────────┬────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Portfolio Decision Layer                     │
│  llmquant-portfolio  llmquant-portfolio-lab  llmquant-risk      │
│  llmquant-credit     llmquant-strategies     position-sizer     │
└─────────────────────────────────────────────────────────────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Execution + Instruments                    │
│  llmquant-equities   llmquant-etfs    llmquant-options          │
│  llmquant-crypto     llmquant-commodities  llmquant-rates-fx    │
└─────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────┐
                    │   llmquant-events           │  ← catalysts + calendar
                    │   llmquant-data             │  ← SEC filings + 13F
                    │   llmquant-investor-lenses  │  ← reasoning overlay
                    └─────────────────────────────┘
```

## References

| Source | URL |
|---|---|
| LLMQuant Skills | <https://github.com/LLMQuant/skills> |
| Claude Trading Skills | <https://github.com/tradermonty/claude-trading-skills> |
